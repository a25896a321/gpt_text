# Changelog

所有版本變更記錄依 [Semantic Versioning](https://semver.org/) 規範。

---

## v0.1.0 — 2026-05-15

### 新增
- `scripts/capture.js`：F12 Console 單檔腳本，支援 ChatGPT 分享頁對話捕獲
  - 掃描 `data-message-author-role="user"` 與 `"assistant"` 節點
  - 自動滾動展開懶加載內容（scrollHeight 穩定判斷）
  - 浮動選取器面板：逐筆勾選 + 全選 User/Assistant 快捷
  - 匯出格式：TXT、HTML、剪貼簿
- `.cursor/rules/core-product.mdc`：產品目標與資料模型規範
- `.cursor/rules/console-capture.mdc`：Console 腳本開發規範
- `.cursor/rules/release-versioning.mdc`：PR 合併後版本管理規範
