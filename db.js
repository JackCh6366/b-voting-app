// db.js
// 原型階段使用 JSON 檔案做為資料儲存。
// 正式上線(上百人規模、需要並發寫入)建議換成 SQLite / PostgreSQL,
// 只需要替換這個檔案裡的函式實作,其他程式碼不用動。

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'polls.json');

function ensureDbFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ polls: {} }, null, 2));
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// 建立一筆新投票
function createPoll({ id, shortCode, title, options, createdAt }) {
  const data = readDb();
  data.polls[shortCode] = {
    id,
    shortCode,
    title,
    options: options.map((text, idx) => ({ index: idx, text, votes: 0 })),
    createdAt,
    active: true,
    voteLog: [] // { timestamp, optionIndex }
  };
  writeDb(data);
  return data.polls[shortCode];
}

// 依短碼取得投票
function getPollByShortCode(shortCode) {
  const data = readDb();
  return data.polls[shortCode] || null;
}

// 取得所有投票(管理後台列表用)
function getAllPolls() {
  const data = readDb();
  return Object.values(data.polls).sort((a, b) => b.createdAt - a.createdAt);
}

// 更新投票主題/選項(編輯功能)
function updatePoll(shortCode, { title, options, active }) {
  const data = readDb();
  const poll = data.polls[shortCode];
  if (!poll) return null;

  if (title !== undefined) poll.title = title;
  if (active !== undefined) poll.active = active;

  if (options !== undefined) {
    // 保留舊選項的票數(依文字比對),新增的選項票數從 0 開始
    const oldByText = Object.fromEntries(poll.options.map(o => [o.text, o.votes]));
    poll.options = options.map((text, idx) => ({
      index: idx,
      text,
      votes: oldByText[text] || 0
    }));
  }

  writeDb(data);
  return poll;
}

// 新增一票
function addVote(shortCode, optionIndex) {
  const data = readDb();
  const poll = data.polls[shortCode];
  if (!poll) return null;
  const option = poll.options.find(o => o.index === optionIndex);
  if (!option) return null;

  option.votes += 1;
  poll.voteLog.push({ timestamp: Date.now(), optionIndex });
  writeDb(data);
  return poll;
}

// 刪除投票
function deletePoll(shortCode) {
  const data = readDb();
  if (!data.polls[shortCode]) return false;
  delete data.polls[shortCode];
  writeDb(data);
  return true;
}

module.exports = {
  createPoll,
  getPollByShortCode,
  getAllPolls,
  updatePoll,
  addVote,
  deletePoll
};
