# 投票系統原型

可編輯投票主題與選項、產生短連結分享、投票結果可同步到 Google Sheet 的簡易投票系統。

## 功能

- 管理後台：建立/編輯/結束/刪除投票
- 自動產生短連結（例如 `http://your-domain.com/v/aB3xQ9`）
- 投票頁面：手機/電腦皆可使用
- 即時結果統計（長條圖）
- 一鍵同步結果到 Google Sheet（也支援每票即時寫入紀錄）

## 目前規模說明

原型使用 JSON 檔案（`data/polls.json`）當資料庫，適合測試與小型使用（幾百票內完全沒問題）。
若之後要長期營運、多人同時大量投票，建議把 `db.js` 換成 SQLite 或 PostgreSQL——
其他程式碼（server.js、前端）幾乎不用改，因為都是透過 `db.js` 提供的函式操作資料。

## 安裝與啟動

```bash
cd voting-app
npm install
cp .env.example .env
npm start
```

啟動後：
- 管理後台：http://localhost:3000/admin.html
- 建立投票後會得到短連結，例如 http://localhost:3000/v/aB3xQ9

## 設定 Google Sheets 同步（選用，可以之後再做）

不設定的話，投票系統一樣可以正常運作，只是不會同步到 Sheet。

### 步驟

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)，建立一個新專案
2. 在「API 和服務」中啟用 **Google Sheets API**
3. 建立憑證 → 選擇「服務帳戶 (Service Account)」
4. 建立完成後，進入該服務帳戶，新增一組 JSON 金鑰並下載
5. 把下載的檔案重新命名為 `credentials.json`，放到專案根目錄（跟 `server.js` 同一層）
   ⚠️ 這個檔案包含金鑰，**絕對不要**放到公開的 GitHub repo，記得加進 `.gitignore`
6. 開啟你要寫入結果的 Google Sheet：
   - 建立兩個分頁，分別命名為 `Votes` 和 `Results`
   - 點「共用」，把 `credentials.json` 裡的 `client_email` 欄位那個 email
     加入共用名單，權限設為「編輯者」
7. 複製這個 Sheet 網址中的 ID（`.../spreadsheets/d/【這段】/edit`），
   填入 `.env` 的 `GOOGLE_SHEET_ID`
8. 重新啟動伺服器（`npm start`），啟動訊息會顯示「Google Sheets 同步：已設定」

設定完成後：
- 每次有人投票，會即時附加一列紀錄到 `Votes` 分頁
- 在管理後台按「同步到 Sheet」，會把該投票目前的彙總票數覆寫到 `Results` 分頁

## 部署到正式環境

原型目前沒有登入機制、沒有防重複投票驗證（依你的需求先不設限）。
若要正式對內部/活動使用，建議部署前補上：

1. **管理後台加上登入驗證**（目前任何人都能開啟 admin.html）
2. **防重複投票**：目前只用瀏覽器 localStorage 做簡單防呆，同一人清除瀏覽器紀錄
   或換裝置就能重複投票。若需要更嚴謹，可以加：
   - Email 驗證碼，或
   - 公司 SSO / 帳號登入
3. 部署平台推薦：**Vercel**、**Render**、**Railway**，都有免費方案，
   上百人規模的流量完全夠用
4. 部署後記得把 `.env` 的 `BASE_URL` 換成正式網域，短連結才會正確

## 專案結構

```
voting-app/
├── server.js       # Express 伺服器與所有 API 路由
├── db.js           # 資料存取層（目前是 JSON 檔案，之後可換成正式資料庫）
├── sheets.js        # Google Sheets API 串接
├── public/
│   ├── admin.html / admin.js   # 管理後台
│   ├── vote.html / vote.js     # 投票頁面
│   └── style.css
├── credentials.json  # Google Service Account 金鑰（需自行建立，不會上傳）
└── .env               # 環境變數（需自行建立，不會上傳）
```
