// db.js
// 支援雙模式儲存：
// 1. 若環境變數包含 KV_REST_API_URL，使用 Vercel KV (Upstash Redis)
// 2. 若無環境變數（如本地開發測試），自動切換至本地 JSON 檔案 (data/polls.json)

const fs = require('fs');
const path = require('path');

let kv = null;
const useKV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

if (useKV) {
  try {
    const vercelKv = require('@vercel/kv');
    kv = vercelKv.kv;
  } catch (err) {
    console.warn('載入 @vercel/kv 失敗，切換至本地 JSON 儲存模式');
  }
}

const DB_FILE = path.join(__dirname, 'data', 'polls.json');
const POLL_KEY = shortCode => `poll:${shortCode}`;
const INDEX_KEY = 'poll:index';

function ensureDbFile() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ polls: {} }, null, 2));
  }
}

function readLocalDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { polls: {} };
  }
}

function writeLocalDb(data) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 建立一筆新投票
async function createPoll({ id, shortCode, title, options, isMultiple = false, maxChoices = 1, createdAt, note = '' }) {
  const poll = {
    id,
    shortCode,
    title,
    note: typeof note === 'string' ? note.trim() : '',
    options: options.map((text, idx) => ({ index: idx, text, votes: 0 })),
    isMultiple: Boolean(isMultiple),
    maxChoices: isMultiple ? Math.max(2, Math.min(options.length, Number(maxChoices) || 2)) : 1,
    createdAt: createdAt || Date.now(),
    active: true,
    voteLog: [],
    voters: {} // { [voterId]: number[] }
  };

  if (useKV && kv) {
    await kv.set(POLL_KEY(shortCode), poll);
    await kv.sadd(INDEX_KEY, shortCode);
  } else {
    const data = readLocalDb();
    data.polls[shortCode] = poll;
    writeLocalDb(data);
  }

  return poll;
}

// 依短碼取得投票
async function getPollByShortCode(shortCode) {
  if (useKV && kv) {
    const poll = await kv.get(POLL_KEY(shortCode));
    return poll || null;
  } else {
    const data = readLocalDb();
    return data.polls[shortCode] || null;
  }
}

// 取得所有投票 (管理後台列表用)
async function getAllPolls() {
  if (useKV && kv) {
    const codes = await kv.smembers(INDEX_KEY);
    if (!codes || codes.length === 0) return [];
    const polls = await Promise.all(codes.map(code => kv.get(POLL_KEY(code))));
    return polls.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  } else {
    const data = readLocalDb();
    return Object.values(data.polls).sort((a, b) => b.createdAt - a.createdAt);
  }
}

// 更新投票資訊
async function updatePoll(shortCode, { title, options, active, isMultiple, maxChoices, note }) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return null;

  if (title !== undefined) poll.title = title;
  if (note !== undefined) poll.note = typeof note === 'string' ? note.trim() : '';
  if (active !== undefined) poll.active = active;
  if (isMultiple !== undefined) poll.isMultiple = Boolean(isMultiple);
  if (maxChoices !== undefined) {
    const optCount = options ? options.length : poll.options.length;
    poll.maxChoices = poll.isMultiple ? Math.max(2, Math.min(optCount, Number(maxChoices) || 2)) : 1;
  }

  if (options !== undefined) {
    const oldByText = Object.fromEntries(poll.options.map(o => [o.text, o.votes]));
    poll.options = options.map((text, idx) => ({
      index: idx,
      text,
      votes: oldByText[text] || 0
    }));
  }

  if (!poll.voters) poll.voters = {};

  if (useKV && kv) {
    await kv.set(POLL_KEY(shortCode), poll);
  } else {
    const data = readLocalDb();
    data.polls[shortCode] = poll;
    writeLocalDb(data);
  }

  return poll;
}

// 提交投票或更換選項（核心函式）
async function submitVote(shortCode, { voterId, optionIndices }) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return { error: '找不到這個投票' };
  if (!poll.active) return { error: '這個投票已經結束，無法進行投票或更換選項' };

  if (!Array.isArray(optionIndices) || optionIndices.length === 0) {
    return { error: '請至少選擇一個選項' };
  }

  // 驗證複選上限
  const limit = poll.isMultiple ? (poll.maxChoices || 2) : 1;
  if (optionIndices.length > limit) {
    return { error: `最多只能選擇 ${limit} 個選項` };
  }

  // 確保選項索引有效且無重複
  const uniqueIndices = [...new Set(optionIndices)];
  if (uniqueIndices.length !== optionIndices.length) {
    return { error: '不能重複選擇相同選項' };
  }

  for (const idx of uniqueIndices) {
    if (idx < 0 || idx >= poll.options.length) {
      return { error: `無效的選項編號: ${idx}` };
    }
  }

  if (!poll.voters) poll.voters = {};
  if (!poll.voteLog) poll.voteLog = [];

  const previousIndices = poll.voters[voterId] || null;
  const isChange = Boolean(previousIndices && previousIndices.length > 0);

  // 若使用者先前投過票，將舊選項票數扣除
  if (isChange) {
    for (const oldIdx of previousIndices) {
      const opt = poll.options.find(o => o.index === oldIdx);
      if (opt && opt.votes > 0) {
        opt.votes -= 1;
      }
    }
  }

  // 將新選項票數加 1
  for (const newIdx of uniqueIndices) {
    const opt = poll.options.find(o => o.index === newIdx);
    if (opt) {
      opt.votes += 1;
    }
  }

  // 記錄該 voterId 當前選擇
  poll.voters[voterId] = uniqueIndices;

  // 寫入日誌
  poll.voteLog.push({
    timestamp: Date.now(),
    voterId,
    previousIndices,
    newIndices: uniqueIndices,
    isChange
  });

  if (useKV && kv) {
    await kv.set(POLL_KEY(shortCode), poll);
  } else {
    const data = readLocalDb();
    data.polls[shortCode] = poll;
    writeLocalDb(data);
  }

  return { poll, isChange };
}

// 舊版單選相容函式
async function addVote(shortCode, optionIndex, voterId = 'legacy') {
  const result = await submitVote(shortCode, { voterId, optionIndices: [optionIndex] });
  if (result.error) return null;
  return result.poll;
}

// 刪除投票
async function deletePoll(shortCode) {
  const existed = await getPollByShortCode(shortCode);
  if (!existed) return false;

  if (useKV && kv) {
    await kv.del(POLL_KEY(shortCode));
    await kv.srem(INDEX_KEY, shortCode);
  } else {
    const data = readLocalDb();
    delete data.polls[shortCode];
    writeLocalDb(data);
  }
  return true;
}

module.exports = {
  createPoll,
  getPollByShortCode,
  getAllPolls,
  updatePoll,
  submitVote,
  addVote,
  deletePoll
};