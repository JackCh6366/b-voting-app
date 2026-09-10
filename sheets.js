// sheets.js
// 使用 Google Service Account 將投票紀錄 / 結果同步到 Google Sheet。
//
// 金鑰有兩種讀取方式：
// 1. 環境變數 GOOGLE_SERVICE_ACCOUNT_KEY（存整個 JSON 金鑰內容的字串）
//    → 這是部署到 Vercel 時要用的方式，因為 Vercel 是 Serverless 架構，
//      檔案系統唯讀且不持久，credentials.json 檔案放上去也沒用。
// 2. 本機的 credentials.json 檔案 → 只在本機開發、且沒設定上面那個環境變數時，才會用這個。

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

let sheetsClient = null;

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    } catch (err) {
      throw new Error('環境變數 GOOGLE_SERVICE_ACCOUNT_KEY 的內容不是合法的 JSON，請確認貼上的是完整、沒有被截斷的金鑰內容');
    }
  }
  if (fs.existsSync(CREDENTIALS_PATH)) {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  }
  return null;
}

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const credentials = loadCredentials();
  if (!credentials) {
    throw new Error(
      '找不到 Google 金鑰，請依 README 說明設定 credentials.json（本機）或 GOOGLE_SERVICE_ACCOUNT_KEY 環境變數（Vercel）'
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: client });
  return sheetsClient;
}

function isConfigured() {
  return Boolean(SHEET_ID) && Boolean(loadCredentials());
}

async function appendVoteRow({ pollTitle, optionText, timestamp }) {
  if (!isConfigured()) return { skipped: true, reason: 'Google Sheets 尚未設定' };

  const sheets = await getSheetsClient();
  const readableTime = new Date(timestamp).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei'
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Votes!A:C',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[readableTime, pollTitle, optionText]]
    }
  });

  return { skipped: false };
}

async function syncResultsSummary({ pollTitle, options }) {
  if (!isConfigured()) return { skipped: true, reason: 'Google Sheets 尚未設定' };

  const sheets = await getSheetsClient();

  const header = [['投票主題', '選項', '票數']];
  const rows = options.map(o => [pollTitle, o.text, o.votes]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: 'Results!A:C'
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Results!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [...header, ...rows] }
  });

  return { skipped: false };
}

module.exports = { appendVoteRow, syncResultsSummary, isConfigured };