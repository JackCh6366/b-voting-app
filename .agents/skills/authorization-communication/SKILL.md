---
name: authorization-communication
description: >-
  Enforces communicating in Traditional Chinese (繁體中文) whenever confirming with the user, seeking user authorization, or requesting approval.
---

# 使用者授權與確認溝通準則 (Authorization & Confirmation Protocol)

## 核心準則
當需要向使用者確認或需要使用者授權時，**必須一律以繁體中文（Traditional Chinese）** 與使用者溝通。

## 適用情境
1. **要求授權 (Requesting Authorization)**：
   - 執行系統終端機指令、環境建置、安裝套件或檔案異動。
   - 涉及敏感資料、金鑰、環境變數或不可逆操作（如資料庫清除、檔案刪除）之授權。
2. **尋求確認與決策 (Seeking Confirmation & Approval)**：
   - 實作計畫 (Implementation Plan) 審核與確認。
   - 需求不明確時的釐清或架構方案的多選確認。
3. **階段任務回報與授權推進**：
   - 階段性完成工作後的成果回報，並確認是否繼續執行下一階段。

## 溝通要求
- **語言規範**：一律使用標準繁體中文（台灣繁體習慣用語，如：伺服器、資料庫、終端機、快取、短網址等）。
- **內容清晰**：清楚列出預計執行的動作、影響範圍與預期結果，讓使用者能一目了然並安心授權。
- **友善明確**：提供清晰的操作提示或按鈕指引，方便使用者快速確認或給予回饋。
