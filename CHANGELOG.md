# Changelog

所有版本變更記錄依 [Semantic Versioning](https://semver.org/) 規範。

---

## v0.3.0 — 2026-05-15

### 修正
- 修正掃描僅抓取部分資料的問題：
  - 新增 `findScrollContainer()` 自動偵測真正的滾動容器
    （ChatGPT 對話在 overflow-y:auto 的內層 div，並非 window）
  - 新增 `makeScroller()` 統一滾動 API，支援 window 與內層容器兩種模式
  - 掃描前先讓 window 小幅滾動以觸發 React 初始渲染，再偵測容器並從頂端掃描至底端
  - 掃描狀態列顯示「偵測到滾動容器：XXX」方便除錯

### 新增
- 清單改為固定可見筆數（預設 10 筆），超出部分透過捲動顯示
  - 超過預覽筆數時顯示「共 N 筆，向下捲動查看更多」提示
- ⚙ 設定面板新增兩個欄位：
  - **清單預覽筆數**（預設 10，範圍 3–50，即時套用）
  - **每步滾動延遲**（預設 600ms，可調整以應對不同速度的虛擬渲染）

---

## v0.2.0 — 2026-05-15

### 新增
- `capture.js` 新增 ⚙ 設定面板，可即時修改：
  - CSS 選取器（`[data-message-author-role]` 可替換為任意選取器）
  - 角色屬性名稱（`data-message-author-role` 可替換）
  - 捕獲角色值（逗號分隔，留空 = 全部角色）
- 設定套用後自動清除舊掃描結果，提示重新掃描

### 修正
- 掃描策略改為「從頂端逐步滾動至底端」，每個滾動位置即時擷取並儲存完整文字
  - 解決 React 虛擬渲染導致節點被移除、`querySelectorAll` 無法一次取得全部訊息的問題
  - 文字在掃描時即儲存（非捕獲時重讀 DOM），避免節點已不在 DOM 的問題
  - 掃描結束後自動滾回頂端

### 變更
- 快捷選取按鈕：「全選 User」→「僅選 User」、「全選 Assistant」→「僅選 Assistant」
  - 語意更精確：點擊後取消其他選取，僅保留指定角色

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
