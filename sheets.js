// sheets.js
// 使用 Google Service Account 將投票紀錄 / 結果同步到 Google Sheet。
//
// 設定步驟(README.md 有詳細圖文版):
// 1. 到 Google Cloud Console 建立一個專案,啟用 "Google Sheets API"
// 2. 建立一組 Service Account,下載 JSON 金鑰,存到專案的 credentials.json
//    (絕對不要把這個檔案上傳到公開 repo!)
// 3. 打開你要寫入的 Google Sheet,把 credentials.json 裡的 client_email
//    加到該 Sheet 的「共用」名單,並給「編輯者」權限
// 4. 在 .env 設定 GOOGLE_SHEET_ID(從 Sheet 網址取得)

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      '找不到 credentials.json,請依 README 說明建立 Google Service Account 金鑰'
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  sheetsClient = google.sheets({ version: 'v4', auth: client });
  return sheetsClient;
}

// 是否已完成 Google Sheets 設定(讓 API 可以優雅地跳過同步,不中斷投票功能)
function isConfigured() {
  return Boolean(SHEET_ID) && fs.existsSync(CREDENTIALS_PATH);
}

// 每次有人投票時,附加一列紀錄到 "Votes" 分頁
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

// 把某個投票目前的彙總結果,覆寫到 "Results" 分頁
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
