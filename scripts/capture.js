(function () {
  'use strict';

  // ── 守衛：重複執行時先清除舊面板 ────────────────────────────────────────────
  if (window.__GPTCapture) {
    window.__GPTCapture.destroy();
  }

  // ── 狀態 ──────────────────────────────────────────────────────────────────────
  const STATE = {
    messages: [],       // Message[]
    capturedData: null, // 捕獲後的完整資料
  };

  // ── 樣式 ──────────────────────────────────────────────────────────────────────
  const STYLES = `
    #gcp-panel {
      position: fixed; top: 16px; right: 16px;
      width: 370px; max-height: 92vh;
      background: #1a1a1a; color: #e0e0e0;
      border: 1px solid #3a3a3a; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.6);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; display: flex; flex-direction: column; overflow: hidden;
    }
    #gcp-panel * { box-sizing: border-box; margin: 0; padding: 0; }
    .gcp-header {
      background: #242424; padding: 11px 14px;
      display: flex; justify-content: space-between; align-items: center;
      font-weight: 700; font-size: 14px; border-bottom: 1px solid #333;
      flex-shrink: 0; user-select: none;
    }
    .gcp-header-title { display: flex; align-items: center; gap: 7px; }
    .gcp-close {
      cursor: pointer; background: none; border: none;
      color: #888; font-size: 20px; line-height: 1; padding: 0 2px;
    }
    .gcp-close:hover { color: #fff; }
    .gcp-section {
      padding: 10px 14px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
    }
    .gcp-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .gcp-btn {
      padding: 5px 11px; border-radius: 5px; border: none;
      cursor: pointer; font-size: 12px; font-weight: 500; line-height: 1.4;
      transition: opacity .15s;
    }
    .gcp-btn:disabled { opacity: .45; cursor: not-allowed; }
    .gcp-btn:not(:disabled):hover { opacity: .85; }
    .gcp-btn-primary  { background: #10a37f; color: #fff; }
    .gcp-btn-secondary { background: #333; color: #ccc; }
    .gcp-btn-export   { background: #2563eb; color: #fff; }
    .gcp-status { font-size: 12px; color: #888; margin-top: 6px; min-height: 16px; }
    .gcp-ok  { color: #10a37f; }
    .gcp-warn { color: #f59e0b; }
    .gcp-err { color: #ef4444; }
    .gcp-list {
      overflow-y: auto; flex: 1; padding: 4px 0; min-height: 120px;
    }
    .gcp-empty { color: #555; font-size: 12px; padding: 24px 14px; text-align: center; }
    .gcp-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 7px 14px; cursor: pointer; border-bottom: 1px solid #222;
    }
    .gcp-item:hover { background: #242424; }
    .gcp-item input[type=checkbox] { margin-top: 2px; flex-shrink: 0; cursor: pointer; accent-color: #10a37f; }
    .gcp-badge {
      font-size: 10px; padding: 2px 6px; border-radius: 3px;
      font-weight: 700; flex-shrink: 0; margin-top: 1px; line-height: 1.3;
    }
    .gcp-badge-user { background: #6d28d9; color: #fff; }
    .gcp-badge-asst { background: #047857; color: #fff; }
    .gcp-item-idx  { font-size: 11px; color: #555; flex-shrink: 0; margin-top: 2px; }
    .gcp-item-text { font-size: 12px; color: #aaa; line-height: 1.45; flex: 1; }
  `;

  function injectStyles() {
    if (document.getElementById('gcp-styles')) return;
    const s = document.createElement('style');
    s.id = 'gcp-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ── 面板 HTML ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    const el = document.createElement('div');
    el.id = 'gcp-panel';
    el.innerHTML = `
      <div class="gcp-header">
        <span class="gcp-header-title">📋 GPT 文字捕獲工具</span>
        <button class="gcp-close" id="gcp-x">×</button>
      </div>

      <!-- 步驟 1：掃描 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <button class="gcp-btn gcp-btn-primary" id="gcp-scan">🔍 掃描訊息</button>
          <span id="gcp-scan-info" style="font-size:12px;color:#666">尚未掃描</span>
        </div>
        <div class="gcp-status" id="gcp-scan-status"></div>
      </div>

      <!-- 步驟 2：快捷選取 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-user">全選 User</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-asst">全選 Assistant</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-all">全選</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-none">清除</button>
        </div>
      </div>

      <!-- 訊息清單 -->
      <div class="gcp-list" id="gcp-list">
        <div class="gcp-empty">請先點擊「掃描訊息」</div>
      </div>

      <!-- 步驟 3：捕獲 -->
      <div class="gcp-section">
        <div class="gcp-row" style="justify-content:space-between">
          <span id="gcp-sel-count" style="font-size:12px;color:#888">已選 0 筆</span>
          <button class="gcp-btn gcp-btn-primary" id="gcp-capture">⚡ 捕獲選取項目</button>
        </div>
      </div>

      <!-- 步驟 4：匯出 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <span style="font-size:12px;color:#666">匯出：</span>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-txt">TXT</button>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-html">HTML</button>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-clip">剪貼簿</button>
        </div>
        <div class="gcp-status" id="gcp-export-status"></div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  // ── 工具函式 ──────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function timestamp() {
    const d = new Date();
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
      '_',
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0'),
    ].join('');
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ── 滾動展開 ──────────────────────────────────────────────────────────────────
  async function scrollToBottom(statusEl) {
    statusEl.textContent = '正在展開頁面內容，請稍候…';
    statusEl.className = 'gcp-status gcp-warn';
    let lastHeight = -1;
    let stable = 0;
    const deadline = Date.now() + 60000;

    while (stable < 3) {
      const h = document.body.scrollHeight;
      window.scrollTo(0, h);
      await sleep(800);
      if (h === lastHeight) {
        stable++;
      } else {
        stable = 0;
        lastHeight = h;
      }
      if (Date.now() > deadline) {
        statusEl.textContent = '⚠ 頁面載入逾時，部分內容可能未完整，建議稍後重試';
        statusEl.className = 'gcp-status gcp-warn';
        return;
      }
    }
    statusEl.textContent = '頁面已展開完畢';
    statusEl.className = 'gcp-status gcp-ok';
  }

  // ── 掃描訊息節點 ──────────────────────────────────────────────────────────────
  function scanMessages() {
    const nodes = document.querySelectorAll('[data-message-author-role]');
    return Array.from(nodes).map((node, i) => ({
      index: i + 1,
      role: node.getAttribute('data-message-author-role'), // 'user' | 'assistant'
      preview: node.innerText.trim().replace(/\s+/g, ' ').slice(0, 60),
      text: '',        // 捕獲時才填入完整文字
      selected: true,
      node,
    }));
  }

  // ── 渲染清單 ──────────────────────────────────────────────────────────────────
  function renderList(listEl, messages, onToggle) {
    if (messages.length === 0) {
      listEl.innerHTML = '<div class="gcp-empty">未找到訊息，請確認頁面已完整載入後重新掃描</div>';
      return;
    }
    listEl.innerHTML = '';
    messages.forEach((msg, i) => {
      const item = document.createElement('label');
      item.className = 'gcp-item';
      const isUser = msg.role === 'user';
      item.innerHTML = `
        <input type="checkbox" data-i="${i}" ${msg.selected ? 'checked' : ''}>
        <span class="gcp-badge ${isUser ? 'gcp-badge-user' : 'gcp-badge-asst'}">${isUser ? 'User' : 'GPT'}</span>
        <span class="gcp-item-idx">#${msg.index}</span>
        <span class="gcp-item-text">${escHtml(msg.preview)}…</span>
      `;
      item.querySelector('input').addEventListener('change', e => onToggle(i, e.target.checked));
      listEl.appendChild(item);
    });
  }

  // ── 格式化輸出 ────────────────────────────────────────────────────────────────
  function formatTxt(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const divider = '─'.repeat(40);
    const header = [
      '=== GPT 對話捕獲 ===',
      `網址：${location.href}`,
      `時間：${now}`,
      `捕獲訊息：${messages.length} 筆`,
      '='.repeat(40),
      '',
    ].join('\n');
    const body = messages
      .map(m => `${m.role === 'user' ? '[User]' : '[ChatGPT]'} #${m.index}\n${m.text}\n${divider}`)
      .join('\n\n');
    return header + body;
  }

  function formatHtml(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const rows = messages.map(m => {
      const isUser = m.role === 'user';
      const label = isUser ? 'User' : 'ChatGPT';
      const color = isUser ? '#6d28d9' : '#047857';
      return `<article style="margin-bottom:1.5em;padding:1em 1.2em;border-left:4px solid ${color};background:#f9f9f9;border-radius:0 6px 6px 0">
  <header style="font-weight:700;color:${color};margin-bottom:.5em;font-size:.9em">[${label}] #${m.index}</header>
  <pre style="white-space:pre-wrap;font-family:inherit;margin:0;color:#222;line-height:1.6">${escHtml(m.text)}</pre>
</article>`;
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GPT 捕獲 ${now}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 820px; margin: 2em auto; padding: 0 1.2em; color: #222; }
    h2 { font-size: 1.2em; margin-bottom: .3em; }
    .meta { color: #666; font-size: .85em; margin-bottom: 1.5em; }
  </style>
</head>
<body>
  <h2>📋 GPT 對話捕獲</h2>
  <p class="meta">
    網址：<a href="${location.href}">${escHtml(location.href)}</a><br>
    時間：${now}，共 ${messages.length} 筆
  </p>
  ${rows}
</body>
</html>`;
  }

  // ── 主邏輯 ────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      injectStyles();
      buildPanel();

      const scanBtn      = document.getElementById('gcp-scan');
      const scanInfo     = document.getElementById('gcp-scan-info');
      const scanStatus   = document.getElementById('gcp-scan-status');
      const listEl       = document.getElementById('gcp-list');
      const selCount     = document.getElementById('gcp-sel-count');
      const captureBtn   = document.getElementById('gcp-capture');
      const exportStatus = document.getElementById('gcp-export-status');

      function refreshCount() {
        const n = STATE.messages.filter(m => m.selected).length;
        selCount.textContent = `已選 ${n} 筆`;
      }

      function onToggle(i, checked) {
        STATE.messages[i].selected = checked;
        refreshCount();
      }

      function quickSelect(filterFn) {
        STATE.messages.forEach(m => { m.selected = filterFn(m); });
        renderList(listEl, STATE.messages, onToggle);
        refreshCount();
      }

      // 關閉按鈕
      document.getElementById('gcp-x').addEventListener('click', () => {
        document.getElementById('gcp-panel')?.remove();
        document.getElementById('gcp-styles')?.remove();
        window.__GPTCapture = null;
      });

      // 掃描
      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        STATE.capturedData = null;
        exportStatus.textContent = '';

        try {
          await scrollToBottom(scanStatus);
          STATE.messages = scanMessages();
          renderList(listEl, STATE.messages, onToggle);
          const n = STATE.messages.length;
          scanInfo.textContent = `已找到 ${n} 筆`;
          scanInfo.style.color = n > 0 ? '#10a37f' : '#ef4444';
          if (n === 0) {
            scanStatus.textContent = '未找到訊息，請確認頁面已完整載入';
            scanStatus.className = 'gcp-status gcp-err';
          }
          refreshCount();
        } catch (err) {
          scanStatus.textContent = `掃描失敗：${err.message}`;
          scanStatus.className = 'gcp-status gcp-err';
        } finally {
          scanBtn.disabled = false;
        }
      });

      // 快捷選取
      document.getElementById('gcp-sel-user').addEventListener('click', () => quickSelect(m => m.role === 'user'));
      document.getElementById('gcp-sel-asst').addEventListener('click', () => quickSelect(m => m.role === 'assistant'));
      document.getElementById('gcp-sel-all').addEventListener('click',  () => quickSelect(() => true));
      document.getElementById('gcp-sel-none').addEventListener('click', () => quickSelect(() => false));

      // 捕獲
      captureBtn.addEventListener('click', () => {
        const selected = STATE.messages.filter(m => m.selected);
        if (selected.length === 0) {
          exportStatus.textContent = '⚠ 請先勾選至少一筆訊息';
          exportStatus.className = 'gcp-status gcp-err';
          return;
        }
        STATE.capturedData = selected.map(m => ({
          ...m,
          text: m.node.innerText.trim(),
        }));
        exportStatus.textContent = `✔ 已捕獲 ${STATE.capturedData.length} 筆，請選擇匯出格式`;
        exportStatus.className = 'gcp-status gcp-ok';
      });

      // 匯出前置檢查
      function requireCaptured() {
        if (!STATE.capturedData) {
          exportStatus.textContent = '⚠ 請先點擊「捕獲選取項目」';
          exportStatus.className = 'gcp-status gcp-err';
          return false;
        }
        return true;
      }

      // 匯出 TXT
      document.getElementById('gcp-exp-txt').addEventListener('click', () => {
        if (!requireCaptured()) return;
        download(formatTxt(STATE.capturedData), `chatgpt_${timestamp()}.txt`, 'text/plain;charset=utf-8');
        exportStatus.textContent = '✔ TXT 下載中…';
        exportStatus.className = 'gcp-status gcp-ok';
      });

      // 匯出 HTML
      document.getElementById('gcp-exp-html').addEventListener('click', () => {
        if (!requireCaptured()) return;
        download(formatHtml(STATE.capturedData), `chatgpt_${timestamp()}.html`, 'text/html;charset=utf-8');
        exportStatus.textContent = '✔ HTML 下載中…';
        exportStatus.className = 'gcp-status gcp-ok';
      });

      // 匯出剪貼簿
      document.getElementById('gcp-exp-clip').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        const txt = formatTxt(STATE.capturedData);
        try {
          await navigator.clipboard.writeText(txt);
          exportStatus.textContent = '✔ 已複製到剪貼簿';
        } catch {
          // 降級方案
          const ta = Object.assign(document.createElement('textarea'), {
            value: txt,
            style: 'position:fixed;opacity:0;',
          });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          exportStatus.textContent = '✔ 已複製（降級模式）';
        }
        exportStatus.className = 'gcp-status gcp-ok';
      });

    } catch (err) {
      console.error('[GPTCapture] 初始化失敗:', err);
    }
  }

  // 暴露銷毀方法供重複執行時使用
  window.__GPTCapture = {
    destroy() {
      document.getElementById('gcp-panel')?.remove();
      document.getElementById('gcp-styles')?.remove();
    },
  };

  init();
})();
