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

// 文字標準化工具函式（去除頭尾空格、縮減連續空格）
function normalizeOptionText(str) {
  if (!str || typeof str !== 'string') return '';
  return str.trim().replace(/\s+/g, ' ');
}

// 建立一筆新投票
async function createPoll({ id, shortCode, title, options, isMultiple = false, maxChoices = 1, createdAt, note = '', allowCustomOption = false, customOptionMaxLength = 40 }) {
  const maxLen = Math.max(5, Math.min(200, Number(customOptionMaxLength) || 40));
  const poll = {
    id,
    shortCode,
    title,
    note: typeof note === 'string' ? note.trim() : '',
    options: options.map((text, idx) => ({ index: idx, text, votes: 0, isCustom: false })),
    isMultiple: Boolean(isMultiple),
    maxChoices: isMultiple ? Math.max(2, Math.min(options.length, Number(maxChoices) || 2)) : 1,
    allowCustomOption: Boolean(allowCustomOption),
    customOptionMaxLength: maxLen,
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
async function updatePoll(shortCode, { title, options, active, isMultiple, maxChoices, note, allowCustomOption, customOptionMaxLength }) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return null;

  if (title !== undefined) poll.title = typeof title === 'string' ? title.trim() : poll.title;
  if (note !== undefined) poll.note = typeof note === 'string' ? note.trim() : '';
  if (active !== undefined) poll.active = active;
  if (isMultiple !== undefined) poll.isMultiple = Boolean(isMultiple);
  if (allowCustomOption !== undefined) poll.allowCustomOption = Boolean(allowCustomOption);
  if (customOptionMaxLength !== undefined) {
    poll.customOptionMaxLength = Math.max(5, Math.min(200, Number(customOptionMaxLength) || 40));
  }
  if (maxChoices !== undefined) {
    const optCount = options ? options.length : poll.options.length;
    poll.maxChoices = poll.isMultiple ? Math.max(2, Math.min(optCount, Number(maxChoices) || 2)) : 1;
  }

  if (options !== undefined) {
    const oldByText = Object.fromEntries(poll.options.map(o => [o.text, o.votes]));
    poll.options = options.map((text, idx) => ({
      index: idx,
      text,
      votes: oldByText[text] || 0,
      isCustom: Boolean(poll.options.find(o => o.index === idx && o.isCustom))
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
async function submitVote(shortCode, { voterId, voterName, optionIndices, customText }) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return { error: '找不到這個投票' };
  if (!poll.active) return { error: '這個投票已經結束，無法進行投票或更換選項' };

  if (!Array.isArray(optionIndices) || optionIndices.length === 0) {
    return { error: '請至少選擇一個選項' };
  }

  let finalOptionIndices = [...optionIndices];

  // 處理自填選項邏輯
  const cleanCustomText = normalizeOptionText(customText);
  const hasCustomFlag = finalOptionIndices.includes(-1);

  if (hasCustomFlag || cleanCustomText) {
    if (!poll.allowCustomOption) {
      return { error: '本投票尚未開啟自訂選項功能' };
    }
    if (!cleanCustomText) {
      return { error: '請輸入你的自訂選項內容' };
    }
    const maxLen = poll.customOptionMaxLength || 40;
    if (cleanCustomText.length > maxLen) {
      return { error: `自訂選項內容不能超過 ${maxLen} 個字（目前為 ${cleanCustomText.length} 字）` };
    }

    // 依「標準化後的字串（去除連續空白、忽略大小寫）」尋找是否已有相同的自訂選項
    let existingOption = poll.options.find(
      o => o.isCustom && normalizeOptionText(o.text).toLowerCase() === cleanCustomText.toLowerCase()
    );

    let customIndex;
    if (existingOption) {
      customIndex = existingOption.index;
    } else {
      // 動態建立新的自訂選項
      const nextIdx = poll.options.length > 0 ? Math.max(...poll.options.map(o => o.index)) + 1 : 0;
      const newOption = {
        index: nextIdx,
        text: cleanCustomText,
        votes: 0,
        isCustom: true
      };
      poll.options.push(newOption);
      customIndex = nextIdx;
    }

    // 將虛擬的 -1 替換為實際的 customIndex
    if (hasCustomFlag) {
      finalOptionIndices = finalOptionIndices.map(idx => idx === -1 ? customIndex : idx);
    } else if (!finalOptionIndices.includes(customIndex)) {
      finalOptionIndices.push(customIndex);
    }
  }

  // 確保選項索引無重複
  const uniqueIndices = [...new Set(finalOptionIndices)];
  if (uniqueIndices.length !== finalOptionIndices.length) {
    return { error: '不能重複選擇相同選項' };
  }

  // 驗證複選上限
  const limit = poll.isMultiple ? (poll.maxChoices || 2) : 1;
  if (uniqueIndices.length > limit) {
    return { error: `最多只能選擇 ${limit} 個選項` };
  }

  // 驗證所有選項編號皆存在於選項列表中
  for (const idx of uniqueIndices) {
    if (idx < 0 || !poll.options.some(o => o.index === idx)) {
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
    voterName: (voterName || '').toString().trim().slice(0, 20) || null,
    previousIndices,
    newIndices: uniqueIndices,
    customText: cleanCustomText || null,
    isChange
  });

  if (useKV && kv) {
    await kv.set(POLL_KEY(shortCode), poll);
  } else {
    const data = readLocalDb();
    data.polls[shortCode] = poll;
    writeLocalDb(data);
  }

  return { poll, isChange, userVotes: uniqueIndices };
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

// 系統全域設定（例如：管理安全鎖）
const CONFIG_KEY = 'system:config';

async function getSystemConfig() {
  const force = process.env.ADMIN_AUTH_FORCE === 'true';
  let adminAuthEnabled = false;

  if (useKV && kv) {
    try {
      const config = await kv.get(CONFIG_KEY);
      if (config && typeof config.adminAuthEnabled === 'boolean') {
        adminAuthEnabled = config.adminAuthEnabled;
      }
    } catch (e) {
      console.warn('讀取 KV 設定失敗，使用預設值：', e.message);
    }
  } else {
    const data = readLocalDb();
    if (data.systemConfig && typeof data.systemConfig.adminAuthEnabled === 'boolean') {
      adminAuthEnabled = data.systemConfig.adminAuthEnabled;
    }
  }

  return {
    adminAuthEnabled: force ? true : adminAuthEnabled,
    isForced: force,
    hasAdminKeyConfigured: Boolean(process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.trim())
  };
}

async function setSystemConfig(newConfig) {
  const current = await getSystemConfig();
  if (current.isForced) {
    throw new Error('系統目前由環境變數 ADMIN_AUTH_FORCE 強制鎖定，無法透過介面修改');
  }

  const updated = {
    adminAuthEnabled: Boolean(newConfig.adminAuthEnabled)
  };

  if (useKV && kv) {
    await kv.set(CONFIG_KEY, updated);
  } else {
    const data = readLocalDb();
    data.systemConfig = updated;
    writeLocalDb(data);
  }

  return getSystemConfig();
}

module.exports = {
  createPoll,
  getPollByShortCode,
  getAllPolls,
  updatePoll,
  submitVote,
  addVote,
  deletePoll,
  getSystemConfig,
  setSystemConfig
};