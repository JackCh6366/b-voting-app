require('dotenv').config();
const express = require('express');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');
const sheets = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 管理 API ----------

// 建立新投票
app.post('/api/polls', (req, res) => {
  const { title, options } = req.body;

  if (!title || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: '請提供投票主題,以及至少兩個選項' });
  }

  const shortCode = nanoid(6); // 6 碼短碼,例如 aB3xQ9
  const poll = db.createPoll({
    id: nanoid(12),
    shortCode,
    title,
    options,
    createdAt: Date.now()
  });

  res.json({
    ...poll,
    voteUrl: `${BASE_URL}/v/${shortCode}`
  });
});

// 取得所有投票(後台列表)
app.get('/api/polls', (req, res) => {
  const polls = db.getAllPolls().map(p => ({
    ...p,
    voteUrl: `${BASE_URL}/v/${p.shortCode}`
  }));
  res.json(polls);
});

// 取得單一投票詳細資料(含目前票數,後台編輯/查看結果用)
app.get('/api/polls/:shortCode', (req, res) => {
  const poll = db.getPollByShortCode(req.params.shortCode);
  if (!poll) return res.status(404).json({ error: '找不到這個投票' });
  res.json({ ...poll, voteUrl: `${BASE_URL}/v/${poll.shortCode}` });
});

// 編輯投票主題/選項/啟用狀態
app.put('/api/polls/:shortCode', (req, res) => {
  const { title, options, active } = req.body;
  const poll = db.updatePoll(req.params.shortCode, { title, options, active });
  if (!poll) return res.status(404).json({ error: '找不到這個投票' });
  res.json(poll);
});

// 刪除投票
app.delete('/api/polls/:shortCode', (req, res) => {
  const ok = db.deletePoll(req.params.shortCode);
  if (!ok) return res.status(404).json({ error: '找不到這個投票' });
  res.json({ success: true });
});

// 手動觸發：把目前結果彙總同步到 Google Sheet
app.post('/api/polls/:shortCode/sync', async (req, res) => {
  const poll = db.getPollByShortCode(req.params.shortCode);
  if (!poll) return res.status(404).json({ error: '找不到這個投票' });

  try {
    const result = await sheets.syncResultsSummary({
      pollTitle: poll.title,
      options: poll.options
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 投票（一般使用者）API ----------

// 短連結進入點：/v/短碼 -> 導向投票頁面
app.get('/v/:shortCode', (req, res) => {
  const poll = db.getPollByShortCode(req.params.shortCode);
  if (!poll) {
    return res.status(404).send('找不到這個投票，連結可能已失效。');
  }
  res.sendFile(path.join(__dirname, 'public', 'vote.html'));
});

// 送出投票
app.post('/api/polls/:shortCode/vote', async (req, res) => {
  const { optionIndex } = req.body;
  const poll = db.getPollByShortCode(req.params.shortCode);

  if (!poll) return res.status(404).json({ error: '找不到這個投票' });
  if (!poll.active) return res.status(403).json({ error: '這個投票已經結束' });
  if (typeof optionIndex !== 'number') {
    return res.status(400).json({ error: '請選擇一個選項' });
  }

  const updated = db.addVote(req.params.shortCode, optionIndex);
  if (!updated) return res.status(400).json({ error: '選項不存在' });

  // 非同步寫入 Google Sheet，不擋住投票的回應速度
  const option = updated.options.find(o => o.index === optionIndex);
  sheets
    .appendVoteRow({
      pollTitle: updated.title,
      optionText: option.text,
      timestamp: Date.now()
    })
    .catch(err => console.error('Google Sheets 同步失敗:', err.message));

  res.json({ success: true, results: updated.options });
});

app.listen(PORT, () => {
  console.log(`投票系統已啟動： ${BASE_URL}`);
  console.log(`管理後台： ${BASE_URL}/admin.html`);
  console.log(
    sheets.isConfigured()
      ? 'Google Sheets 同步：已設定'
      : 'Google Sheets 同步：尚未設定（可先忽略，之後照 README 補上即可）'
  );
});
