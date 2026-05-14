# GPT 文字捕獲工具

解決 ChatGPT 等 React 動態渲染頁面無法 Ctrl+A 一次全選的問題。  
透過 F12 Console 貼入腳本，精準選取並匯出對話文字。

## 使用方式（Method 1 — F12 Console）

### 步驟

1. 在 Chrome 開啟目標頁面，等待內容完整載入  
   例如：`https://chatgpt.com/share/6780d979-d9ec-8011-b0c0-a2b1271ad4c5`

2. 按 `F12` 開啟開發者工具 → 點選 **Console** 分頁

3. 若看到「Pasting code...」警告，輸入 `allow pasting` 後按 Enter

4. 複製 [`scripts/capture.js`](scripts/capture.js) 的全部內容，貼入 Console，按 Enter

5. 頁面右側出現「📋 GPT 文字捕獲工具」面板：

   | 步驟 | 操作 |
   |------|------|
   | ① 掃描 | 點擊「🔍 掃描訊息」→ 等待滾動展開完成 |
   | ② 選取 | 勾選要捕獲的訊息（可用「全選 User」等快捷鍵） |
   | ③ 捕獲 | 點擊「⚡ 捕獲選取項目」 |
   | ④ 匯出 | 點擊 TXT / HTML / 剪貼簿 |

### 捕獲目標說明

| 角色徽章 | DOM 屬性 | 代表 |
|---------|---------|------|
| `User`（紫色） | `data-message-author-role="user"` | 您的提問 |
| `GPT`（綠色） | `data-message-author-role="assistant"` | ChatGPT 回答 |

### TXT 匯出格式範例

```
=== GPT 對話捕獲 ===
網址：https://chatgpt.com/share/...
時間：2026/5/15 上午 12:55:00
捕獲訊息：4 筆
========================================

[User] #1
Epoxy 地板有哪些優勢？
────────────────────────────────────────

[ChatGPT] #2
Epoxy 地板具有以下幾項主要優勢：
1. 耐磨性強…
────────────────────────────────────────
```

## 檔案結構

```
GPT_text/
├── .cursor/rules/
│   ├── core-product.mdc        # 產品目標規範（always apply）
│   ├── console-capture.mdc     # Console 腳本開發規範
│   └── release-versioning.mdc  # PR 版本管理規範
├── scripts/
│   └── capture.js              # 唯一核心腳本
├── exports/                    # 輸出目錄（.gitignore 排除）
├── CHANGELOG.md
├── VERSION
└── README.md
```

## 版本管理

PR 合併後依 [`release-versioning.mdc`](.cursor/rules/release-versioning.mdc) 更新版本：

```bash
# 1. 更新 VERSION 與 CHANGELOG.md
# 2. Commit
git add VERSION CHANGELOG.md
git commit -m "chore: release v1.x.x"
# 3. Tag 並推送
git tag v1.x.x
git push origin main
git push origin v1.x.x
```

## 已知限制

- **跨域 iframe**：Console 受同源政策限制，無法讀取第三方嵌入框架
- **需登入的私人對話**：需先在瀏覽器登入後再執行腳本
- **ChatGPT DOM 改版**：若 `data-message-author-role` 屬性被移除，需更新腳本的選取器
- **超長對話**：滾動展開最多等待 60 秒，極長對話建議分段捕獲
