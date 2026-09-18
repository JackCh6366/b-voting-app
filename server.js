require('dotenv').config();
const express = require('express');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');
const sheets = require('./sheets');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;

// 不再用寫死的 BASE_URL，改成每次請求時自動判斷當下的網址，
// 本機測試會是 http://localhost:3000，部署到 Vercel 會自動變成正式網域，
// 不需要手動設定環境變數，也不會設錯。
app.set('trust proxy', true); // 讓 req.protocol 正確反映 Vercel 的 https（不會誤判成 http）
function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL; // 如果有手動設定，優先使用
  return `${req.protocol}://${req.get('host')}`;
}

// 支援 Base64 圖片上傳（預設 100KB 太小，放寬至 15MB 支援 10MB 圖片）
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 管理權限驗證中介軟體 ----------
function requireAdminAuth(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey || !configuredKey.trim()) {
    console.error('⚠️ 伺服器尚未設定 ADMIN_API_KEY 環境變數，拒絕所有管理操作以維護安全性');
    return res.status(500).json({ error: '伺服器尚未設定管理授權金鑰 (ADMIN_API_KEY)，請聯絡管理員設定' });
  }

  const authHeader = req.headers.authorization || '';
  const tokenFromBearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const tokenFromHeader = req.headers['x-admin-key'];
  const providedKey = (tokenFromBearer || tokenFromHeader || '').trim();

  if (!providedKey || providedKey !== configuredKey.trim()) {
    return res.status(401).json({ error: '未授權的管理操作：管理金鑰無效或尚未提供' });
  }

  next();
}

// ---------- 管理 API ----------

app.post('/api/polls', requireAdminAuth, async (req, res) => {
  const { title, options, isMultiple, maxChoices, note } = req.body;

  if (!title || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: '請提供投票主題，以及至少兩個選項' });
  }

  const multiple = Boolean(isMultiple);
  let limit = 1;
  if (multiple) {
    limit = Number(maxChoices) || 2;
    if (limit < 2 || limit > options.length) {
      return res.status(400).json({ error: `複選投票的最高票數限制必須介於 2 到 ${options.length} 之間` });
    }
  }

  try {
    const shortCode = nanoid(6);
    const poll = await db.createPoll({
      id: nanoid(12),
      shortCode,
      title,
      note,
      options,
      isMultiple: multiple,
      maxChoices: limit,
      createdAt: Date.now()
    });

    const { voters, voteLog, ...safePoll } = poll;
    res.json({
      ...safePoll,
      voteUrl: `${getBaseUrl(req)}/v/${shortCode}`
    });
  } catch (err) {
    console.error('建立投票失敗：', err);
    res.status(500).json({ error: '建立投票失敗，請稍後再試' });
  }
});

app.get('/api/polls', async (req, res) => {
  try {
    const allPolls = await db.getAllPolls();
    const polls = allPolls.map(p => {
      // 排除敏感個資 voters 與投票日誌 voteLog
      const { voters, voteLog, ...safePoll } = p;
      return {
        ...safePoll,
        voteUrl: `${getBaseUrl(req)}/v/${p.shortCode}`
      };
    });
    res.json(polls);
  } catch (err) {
    console.error('讀取投票列表失敗：', err);
    res.status(500).json({ error: '讀取投票列表失敗，請稍後再試' });
  }
});

app.get('/api/polls/:shortCode', async (req, res) => {
  try {
    const poll = await db.getPollByShortCode(req.params.shortCode);
    if (!poll) return res.status(404).json({ error: '找不到這個投票' });

    const voterId = req.query.voterId;
    const userVotes = (poll.voters && voterId) ? (poll.voters[voterId] || null) : null;

    // 排除全員 voters 名單與完整 voteLog，僅回傳當前訪客個人的 userVotes
    const { voters, voteLog, ...safePoll } = poll;

    res.json({
      ...safePoll,
      userVotes,
      voteUrl: `${getBaseUrl(req)}/v/${poll.shortCode}`
    });
  } catch (err) {
    console.error('讀取投票詳情失敗：', err);
    res.status(500).json({ error: '讀取投票失敗，請稍後再試' });
  }
});

app.put('/api/polls/:shortCode', requireAdminAuth, async (req, res) => {
  try {
    const { title, options, active, isMultiple, maxChoices, note } = req.body;
    const poll = await db.updatePoll(req.params.shortCode, { title, options, active, isMultiple, maxChoices, note });
    if (!poll) return res.status(404).json({ error: '找不到這個投票' });
    const { voters, voteLog, ...safePoll } = poll;
    res.json(safePoll);
  } catch (err) {
    console.error('更新投票失敗：', err);
    res.status(500).json({ error: '更新投票失敗，請稍後再試' });
  }
});

// 管理員專用端點：檢視投票詳細審計日誌與投票者對應（僅限授權管理員存取）
app.get('/api/admin/polls/:shortCode/log', requireAdminAuth, async (req, res) => {
  try {
    const poll = await db.getPollByShortCode(req.params.shortCode);
    if (!poll) return res.status(404).json({ error: '找不到這個投票' });
    res.json({
      shortCode: poll.shortCode,
      title: poll.title,
      voters: poll.voters || {},
      voteLog: poll.voteLog || []
    });
  } catch (err) {
    console.error('讀取投票日誌失敗：', err);
    res.status(500).json({ error: '讀取投票日誌失敗，請稍後再試' });
  }
});

// ---------- AI 輔助建立 API ----------

app.post('/api/ai/extract-poll', requireAdminAuth, async (req, res) => {
  const { image, provider, prompt } = req.body;
  try {
    const result = await ai.extractPollFromImage({ image, provider, prompt });
    res.json(result);
  } catch (err) {
    console.error('AI 圖片分析失敗：', err.message);
    res.status(400).json({ error: err.message || 'AI 分析圖片失敗，請稍後再試' });
  }
});

app.delete('/api/polls/:shortCode', requireAdminAuth, async (req, res) => {
  try {
    const ok = await db.deletePoll(req.params.shortCode);
    if (!ok) return res.status(404).json({ error: '找不到這個投票' });
    res.json({ success: true });
  } catch (err) {
    console.error('刪除投票失敗：', err);
    res.status(500).json({ error: '刪除投票失敗，請稍後再試' });
  }
});

app.post('/api/polls/:shortCode/sync', requireAdminAuth, async (req, res) => {
  try {
    const poll = await db.getPollByShortCode(req.params.shortCode);
    if (!poll) return res.status(404).json({ error: '找不到這個投票' });

    const result = await sheets.syncResultsSummary({
      pollTitle: poll.title,
      options: poll.options
    });
    res.json(result);
  } catch (err) {
    console.error('同步 Google Sheet 失敗：', err);
    res.status(500).json({ error: '同步至 Google Sheet 失敗，請稍後再試或檢查設定' });
  }
});

// ---------- 投票（一般使用者）API ----------

app.get('/v/:shortCode', async (req, res) => {
  const poll = await db.getPollByShortCode(req.params.shortCode);
  if (!poll) {
    return res.status(404).send('找不到這個投票，連結可能已失效。');
  }
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

app.post('/api/polls/:shortCode/vote', async (req, res) => {
  const { optionIndices, optionIndex } = req.body;
  let voterId = req.body.voterId;
  const voterName = (req.body.voterName || '').toString().trim().slice(0, 20);

  if (!voterId) {
    voterId = nanoid(16);
  }

  // 相容單個選項與陣列
  let selected = optionIndices;
  if (!Array.isArray(selected) && typeof optionIndex === 'number') {
    selected = [optionIndex];
  }

  if (!Array.isArray(selected) || selected.length === 0) {
    return res.status(400).json({ error: '請至少選擇一個選項' });
  }

  const poll = await db.getPollByShortCode(req.params.shortCode);
  if (!poll) return res.status(404).json({ error: '找不到這個投票' });
  if (!poll.active) return res.status(403).json({ error: '這個投票已經結束，無法更換選項或投票' });

  const limit = poll.isMultiple ? (poll.maxChoices || 2) : 1;
  if (selected.length > limit) {
    return res.status(400).json({ error: `本投票最多只能選擇 ${limit} 項` });
  }

  const voteResult = await db.submitVote(req.params.shortCode, { voterId, optionIndices: selected });
  if (voteResult.error) {
    return res.status(400).json({ error: voteResult.error });
  }

  const updated = voteResult.poll;
  const chosenTexts = selected
    .map(idx => updated.options.find(o => o.index === idx)?.text)
    .filter(Boolean);

  const prefix = voteResult.isChange ? '【更換選項】' : '';
  const nameLabel = voterName ? `[投票者: ${voterName}] ` : '';
  sheets
    .appendVoteRow({
      pollTitle: updated.title,
      optionText: `${nameLabel}${prefix}${chosenTexts.join(' + ')}`,
      timestamp: Date.now()
    })
    .catch(err => console.error('Google Sheets 同步失敗:', err.message));

  res.json({
    success: true,
    results: updated.options,
    userVotes: selected,
    voterId,
    isChange: voteResult.isChange
  });
});

app.listen(PORT, () => {
  const localUrl = `http://localhost:${PORT}`;
  console.log(`投票系統已啟動： ${localUrl}`);
  console.log(`管理後台： ${localUrl}/admin.html`);
  console.log(
    sheets.isConfigured()
      ? 'Google Sheets 同步：已設定'
      : 'Google Sheets 同步：尚未設定（可先忽略，之後照 README 補上即可）'
  );
});