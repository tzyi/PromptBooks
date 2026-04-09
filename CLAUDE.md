# CLAUDE.md

此檔案提供 Claude AI 在協助開發本專案時所需的背景資訊與指引。

## 專案概述

**PromptBooks** 是一個 Chrome 瀏覽器擴充套件，讓使用者能夠儲存、管理並快速取用常用的 AI 提示詞（Prompts）。

## 專案結構

```
PromptBooks/
├── CLAUDE.md          # Claude AI 指引檔案
├── README.md          # 專案說明
└── doc/               # 文件目錄
```

## 技術棧

- **平台**: Chrome Extension (Manifest V3)
- **語言**: HTML / CSS / JavaScript
- **儲存**: Chrome Storage API (`chrome.storage.sync` / `chrome.storage.local`)

## 開發指引

### Chrome 擴充套件慣例

- 使用 **Manifest V3**，避免使用已棄用的 Manifest V2 API
- Background scripts 使用 **Service Worker** 而非持久性背景頁
- 遵循 Chrome Extensions 最小權限原則，只申請必要的 permissions
- Content Security Policy (CSP) 須嚴格設定，禁止 inline scripts

### 程式碼風格

- 使用 2 個空格縮排
- 使用 `const` / `let`，避免使用 `var`
- 非同步操作優先使用 `async/await`
- 函式與變數命名使用 **camelCase**，常數使用 **UPPER_SNAKE_CASE**

### 安全性注意事項

- 所有使用者輸入必須經過 sanitize，防止 XSS 攻擊
- 不可使用 `eval()` 或 `innerHTML` 直接插入未經處理的字串
- 與外部服務通訊需確認來源（避免 SSRF）

## 常用指令

> 目前尚未設定 build 流程，擴充套件可直接在 Chrome 以開發者模式載入。

```
# 在 Chrome 載入擴充套件（開發模式）
1. 開啟 chrome://extensions/
2. 啟用「開發人員模式」
3. 點選「載入未封裝項目」，選擇專案根目錄
```

## 待辦 / 規劃功能

- [ ] 基本提示詞 CRUD（新增、讀取、更新、刪除）
- [ ] 分類與標籤管理
- [ ] 快速搜尋與篩選
- [ ] 匯出 / 匯入（JSON 格式）
- [ ] 一鍵複製提示詞至剪貼簿
