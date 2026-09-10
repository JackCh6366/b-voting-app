// db.js
// 使用 Vercel KV（Upstash Redis）做為資料儲存。

const { kv } = require('@vercel/kv');

const POLL_KEY = shortCode => `poll:${shortCode}`;
const INDEX_KEY = 'poll:index';

async function createPoll({ id, shortCode, title, options, createdAt }) {
  const poll = {
    id,
    shortCode,
    title,
    options: options.map((text, idx) => ({ index: idx, text, votes: 0 })),
    createdAt,
    active: true,
    voteLog: []
  };
  await kv.set(POLL_KEY(shortCode), poll);
  await kv.sadd(INDEX_KEY, shortCode);
  return poll;
}

async function getPollByShortCode(shortCode) {
  const poll = await kv.get(POLL_KEY(shortCode));
  return poll || null;
}

async function getAllPolls() {
  const codes = await kv.smembers(INDEX_KEY);
  if (!codes || codes.length === 0) return [];
  const polls = await Promise.all(codes.map(code => kv.get(POLL_KEY(code))));
  return polls.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

async function updatePoll(shortCode, { title, options, active }) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return null;
  if (title !== undefined) poll.title = title;
  if (active !== undefined) poll.active = active;
  if (options !== undefined) {
    const oldByText = Object.fromEntries(poll.options.map(o => [o.text, o.votes]));
    poll.options = options.map((text, idx) => ({
      index: idx,
      text,
      votes: oldByText[text] || 0
    }));
  }
  await kv.set(POLL_KEY(shortCode), poll);
  return poll;
}

async function addVote(shortCode, optionIndex) {
  const poll = await getPollByShortCode(shortCode);
  if (!poll) return null;
  const option = poll.options.find(o => o.index === optionIndex);
  if (!option) return null;
  option.votes += 1;
  poll.voteLog.push({ timestamp: Date.now(), optionIndex });
  await kv.set(POLL_KEY(shortCode), poll);
  return poll;
}

async function deletePoll(shortCode) {
  const existed = await getPollByShortCode(shortCode);
  if (!existed) return false;
  await kv.del(POLL_KEY(shortCode));
  await kv.srem(INDEX_KEY, shortCode);
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