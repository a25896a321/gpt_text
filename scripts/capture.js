(function () {
  'use strict';

  if (window.__GPTCapture) window.__GPTCapture.destroy();

  // ── 可調整設定（⚙ 面板可即時修改）─────────────────────────────────────────
  const CFG = {
    selector:    '[data-message-author-role]',
    roleAttr:    'data-message-author-role',
    targetRoles: ['user', 'assistant'],
    scrollStep:  0,       // 0 = 自動（容器高 × 0.6）
    scrollDelay: 600,     // 每步等待毫秒（虛擬渲染需要足夠時間）
    maxListRows: 10,       // 清單同時可見筆數
  };

  const STATE = {
    messages: [],
    capturedData: null,
  };

  // ── 樣式 ──────────────────────────────────────────────────────────────────────
  const STYLES = `
    #gcp-panel {
      position: fixed; top: 16px; right: 16px;
      width: 385px;
      background: #1a1a1a; color: #e0e0e0;
      border: 1px solid #3a3a3a; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.65);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; display: flex; flex-direction: column;
      overflow: hidden;
      /* 面板整體最大高度，超出時各 section 不縮放，只有清單滾動 */
      max-height: 92vh;
    }
    #gcp-panel * { box-sizing: border-box; margin: 0; padding: 0; }
    .gcp-header {
      background: #242424; padding: 11px 14px;
      display: flex; justify-content: space-between; align-items: center;
      font-weight: 700; font-size: 14px; border-bottom: 1px solid #333;
      flex-shrink: 0; user-select: none;
    }
    .gcp-header-title { display: flex; align-items: center; gap: 7px; }
    .gcp-header-actions { display: flex; gap: 4px; align-items: center; }
    .gcp-icon-btn {
      cursor: pointer; background: none; border: none;
      color: #888; font-size: 15px; line-height: 1; padding: 3px 5px;
      border-radius: 4px; transition: color .15s, background .15s;
    }
    .gcp-icon-btn:hover { color: #fff; background: #3a3a3a; }
    .gcp-icon-btn.active { color: #10a37f; background: #1a3a30; }
    .gcp-close {
      cursor: pointer; background: none; border: none;
      color: #888; font-size: 20px; line-height: 1; padding: 0 3px;
    }
    .gcp-close:hover { color: #fff; }
    /* ── 設定面板 ── */
    #gcp-settings {
      padding: 12px 14px; border-bottom: 1px solid #2a2a2a;
      background: #141414; flex-shrink: 0;
      overflow-y: auto; max-height: 300px;
    }
    .gcp-settings-title {
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .07em; color: #555; margin-bottom: 9px;
    }
    .gcp-field { margin-bottom: 8px; }
    .gcp-label { font-size: 11px; color: #888; margin-bottom: 3px; display: block; }
    .gcp-input {
      width: 100%; background: #1f1f1f; border: 1px solid #3a3a3a; border-radius: 4px;
      color: #ddd; font-size: 12px; padding: 5px 8px; outline: none;
      font-family: 'Consolas', 'Courier New', monospace; line-height: 1.4;
    }
    .gcp-input-sm {
      width: 72px; background: #1f1f1f; border: 1px solid #3a3a3a; border-radius: 4px;
      color: #ddd; font-size: 12px; padding: 5px 8px; outline: none; text-align: center;
    }
    .gcp-input:focus, .gcp-input-sm:focus { border-color: #10a37f; }
    .gcp-hint { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.4; }
    /* ── 通用 ── */
    .gcp-section {
      padding: 10px 14px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
    }
    .gcp-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .gcp-btn {
      padding: 5px 11px; border-radius: 5px; border: none;
      cursor: pointer; font-size: 12px; font-weight: 500; line-height: 1.4;
      transition: opacity .15s;
    }
    .gcp-btn:disabled { opacity: .4; cursor: not-allowed; }
    .gcp-btn:not(:disabled):hover { opacity: .82; }
    .gcp-btn-primary   { background: #10a37f; color: #fff; }
    .gcp-btn-secondary { background: #2e2e2e; color: #bbb; }
    .gcp-btn-export    { background: #2563eb; color: #fff; }
    .gcp-status { font-size: 12px; color: #666; margin-top: 6px; min-height: 15px; line-height: 1.4; }
    .gcp-ok   { color: #10a37f; }
    .gcp-warn { color: #f59e0b; }
    .gcp-err  { color: #ef4444; }
    /* ── 清單（高度由 JS 動態設定）── */
    .gcp-list {
      overflow-y: auto; flex-shrink: 0; padding: 4px 0;
      /* max-height 由 updateListHeight() 注入 */
    }
    .gcp-empty { color: #555; font-size: 12px; padding: 24px 14px; text-align: center; }
    .gcp-item {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 7px 14px; cursor: pointer; border-bottom: 1px solid #1e1e1e;
    }
    .gcp-item:hover { background: #222; }
    .gcp-item input[type=checkbox] {
      margin-top: 2px; flex-shrink: 0; cursor: pointer; accent-color: #10a37f;
    }
    .gcp-badge {
      font-size: 10px; padding: 2px 6px; border-radius: 3px;
      font-weight: 700; flex-shrink: 0; margin-top: 1px; line-height: 1.3; white-space: nowrap;
    }
    .gcp-badge-user  { background: #6d28d9; color: #fff; }
    .gcp-badge-asst  { background: #047857; color: #fff; }
    .gcp-badge-other { background: #92400e; color: #fff; }
    .gcp-item-idx  { font-size: 11px; color: #555; flex-shrink: 0; margin-top: 2px; }
    .gcp-item-text { font-size: 12px; color: #999; line-height: 1.45; flex: 1; }
    /* 清單捲動提示 */
    .gcp-list-footer {
      text-align: center; font-size: 10px; color: #444; padding: 4px 0;
      border-top: 1px solid #1e1e1e; flex-shrink: 0;
    }
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
        <div class="gcp-header-actions">
          <button class="gcp-icon-btn" id="gcp-cfg-btn" title="捕獲目標設定">⚙</button>
          <button class="gcp-close" id="gcp-x">×</button>
        </div>
      </div>

      <!-- ⚙ 設定面板（預設隱藏）-->
      <div id="gcp-settings" style="display:none">
        <div class="gcp-settings-title">⚙ 捕獲目標設定</div>

        <div class="gcp-field">
          <label class="gcp-label">CSS 選取器</label>
          <input class="gcp-input" id="gcp-cfg-sel" value="${CFG.selector}"
            placeholder="e.g. [data-message-author-role]">
        </div>

        <div class="gcp-field">
          <label class="gcp-label">角色屬性名稱</label>
          <input class="gcp-input" id="gcp-cfg-attr" value="${CFG.roleAttr}"
            placeholder="e.g. data-message-author-role">
        </div>

        <div class="gcp-field">
          <label class="gcp-label">捕獲角色值（逗號分隔）</label>
          <input class="gcp-input" id="gcp-cfg-roles" value="${CFG.targetRoles.join(', ')}"
            placeholder="e.g. user, assistant">
          <div class="gcp-hint">留空 = 不過濾，顯示全部角色</div>
        </div>

        <div class="gcp-field">
          <label class="gcp-label">清單預覽筆數（可捲動）</label>
          <div class="gcp-row">
            <input class="gcp-input-sm" id="gcp-cfg-rows" type="number"
              min="3" max="50" value="${CFG.maxListRows}">
            <span style="font-size:11px;color:#666">筆（預設 10，超出可向下捲動）</span>
          </div>
        </div>

        <div class="gcp-field">
          <label class="gcp-label">每步滾動延遲（毫秒）</label>
          <div class="gcp-row">
            <input class="gcp-input-sm" id="gcp-cfg-delay" type="number"
              min="200" max="3000" value="${CFG.scrollDelay}">
            <span style="font-size:11px;color:#666">ms（越小越快，但過小可能遺漏節點）</span>
          </div>
        </div>

        <div class="gcp-row" style="margin-top:6px">
          <button class="gcp-btn gcp-btn-primary" id="gcp-cfg-apply">套用設定</button>
          <span class="gcp-status" id="gcp-cfg-status"></span>
        </div>
      </div>

      <!-- 步驟 1：掃描 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <button class="gcp-btn gcp-btn-primary" id="gcp-scan">🔍 掃描訊息</button>
          <span id="gcp-scan-info" style="font-size:12px;color:#555">尚未掃描</span>
        </div>
        <div class="gcp-status" id="gcp-scan-status"></div>
      </div>

      <!-- 步驟 2：快捷選取 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-user">僅選 User</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-asst">僅選 Assistant</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-all">全選</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-sel-none">清除</button>
        </div>
      </div>

      <!-- 訊息清單（高度由 JS 控制）-->
      <div class="gcp-list" id="gcp-list">
        <div class="gcp-empty">請先點擊「掃描訊息」</div>
      </div>
      <div class="gcp-list-footer" id="gcp-list-footer" style="display:none"></div>

      <!-- 步驟 3：捕獲 -->
      <div class="gcp-section">
        <div class="gcp-row" style="justify-content:space-between">
          <span id="gcp-sel-count" style="font-size:12px;color:#777">已選 0 筆</span>
          <button class="gcp-btn gcp-btn-primary" id="gcp-capture">⚡ 捕獲選取項目</button>
        </div>
      </div>

      <!-- 步驟 4：匯出 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <span style="font-size:12px;color:#555">匯出：</span>
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

  // ── 工具 ──────────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function timestamp() {
    const d = new Date();
    return [d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'), '_',
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0')].join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: filename,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function roleBadge(role) {
    if (role === 'user')      return { label: 'User', cls: 'gcp-badge-user' };
    if (role === 'assistant') return { label: 'GPT',  cls: 'gcp-badge-asst' };
    return { label: role.slice(0, 8).toUpperCase(), cls: 'gcp-badge-other' };
  }

  // ── 偵測真正的滾動容器 ────────────────────────────────────────────────────────
  // ChatGPT 的對話內容可能在 overflow-y:auto 的內層 div 中，而非 window。
  // 策略：從第一個訊息節點向上尋找最近的可滾動祖先元素。
  function findScrollContainer() {
    const firstMsg = document.querySelector(CFG.selector);
    if (firstMsg) {
      let el = firstMsg.parentElement;
      while (el && el !== document.documentElement) {
        const oy = window.getComputedStyle(el).overflowY;
        // 可滾動且內容高度確實超過顯示高度
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 30) {
          return el;
        }
        el = el.parentElement;
      }
    }
    // 退回到 window 滾動
    return null;
  }

  // 根據偵測結果建立統一滾動 API
  function makeScroller(container) {
    const isWin = !container;
    return {
      scrollTo(y)    { if (isWin) window.scrollTo(0, y); else container.scrollTop = y; },
      get scrollH()  { return isWin
          ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
          : container.scrollHeight; },
      get clientH()  { return isWin ? window.innerHeight : container.clientHeight; },
      get scrollTop(){ return isWin ? window.scrollY : container.scrollTop; },
      label: isWin ? 'window' : (container.tagName + (container.id ? '#' + container.id : '')),
    };
  }

  // ── 核心掃描：偵測容器 → 從頂端逐步往下收集所有訊息節點 ───────────────────────
  async function scrollAndScan(statusEl) {
    // 1. 先讓 window 小幅滾動，觸發 React 初始渲染
    window.scrollTo(0, 0);
    await sleep(500);
    window.scrollTo(0, window.innerHeight * 0.4);
    await sleep(700);
    window.scrollTo(0, 0);
    await sleep(500);

    // 2. 偵測正確的滾動容器
    const scroller = makeScroller(findScrollContainer());
    statusEl.textContent = `偵測到滾動容器：${scroller.label}`;
    statusEl.className = 'gcp-status gcp-warn';
    await sleep(300);

    // 3. 回到頂端
    scroller.scrollTo(0);
    await sleep(600);

    // 4. 用 Map 去重：key = role + '\0' + 前 120 字
    const seen = new Map();

    function harvest() {
      document.querySelectorAll(CFG.selector).forEach(node => {
        const role = node.getAttribute(CFG.roleAttr) || 'unknown';
        if (CFG.targetRoles.length > 0 && !CFG.targetRoles.includes(role)) return;
        const text = node.innerText.trim();
        if (!text) return;
        const key = role + '\x00' + text.slice(0, 120);
        if (!seen.has(key)) {
          seen.set(key, {
            role, text,
            preview: text.replace(/\s+/g, ' ').slice(0, 60),
            order: seen.size,
            selected: true,
          });
        }
      });
    }

    // 5. 逐步滾動收集
    const step = CFG.scrollStep > 0
      ? CFG.scrollStep
      : Math.max(200, Math.floor(scroller.clientH * 0.6));

    let pos = 0;
    let stableRounds = 0;
    let lastScrollH = 0;

    for (let iter = 0; iter < 800; iter++) {
      harvest();

      const totalH = scroller.scrollH;
      const pct = totalH > 0 ? Math.min(100, Math.round((pos / totalH) * 100)) : 0;
      statusEl.textContent = `掃描中 ${pct}%… 已收集 ${seen.size} 筆`;
      statusEl.className = 'gcp-status gcp-warn';

      if (pos >= totalH) {
        if (totalH === lastScrollH) {
          if (++stableRounds >= 3) break; // 底部穩定，結束
        } else {
          stableRounds = 0; // scrollHeight 增長，繼續
        }
        lastScrollH = totalH;
      }

      pos += step;
      scroller.scrollTo(pos);
      await sleep(CFG.scrollDelay);
    }

    // 6. 最後再 harvest 一次，確保底部節點不遺漏
    harvest();

    // 7. 滾回頂端
    scroller.scrollTo(0);

    return Array.from(seen.values())
      .sort((a, b) => a.order - b.order)
      .map((m, i) => ({ ...m, index: i + 1 }));
  }

  // ── 清單高度（依 maxListRows 動態設定）──────────────────────────────────────
  const ITEM_H = 40; // 每筆項目約 40px（上下 padding 7px + 文字 ~26px）

  function updateListHeight() {
    const listEl   = document.getElementById('gcp-list');
    const footerEl = document.getElementById('gcp-list-footer');
    if (!listEl) return;
    const maxH = CFG.maxListRows * ITEM_H;
    listEl.style.maxHeight = maxH + 'px';
    listEl.style.overflowY = 'auto';

    // 顯示捲動提示
    const total = STATE.messages.length;
    if (footerEl) {
      if (total > CFG.maxListRows) {
        footerEl.textContent = `共 ${total} 筆，向下捲動查看更多`;
        footerEl.style.display = 'block';
      } else {
        footerEl.style.display = 'none';
      }
    }
  }

  // ── 渲染清單 ──────────────────────────────────────────────────────────────────
  function renderList(listEl, messages, onToggle) {
    if (messages.length === 0) {
      listEl.innerHTML = '<div class="gcp-empty">未找到訊息，請確認選取器或頁面是否完整載入</div>';
      updateListHeight();
      return;
    }
    listEl.innerHTML = '';
    messages.forEach((msg, i) => {
      const { label, cls } = roleBadge(msg.role);
      const item = document.createElement('label');
      item.className = 'gcp-item';
      item.innerHTML = `
        <input type="checkbox" data-i="${i}" ${msg.selected ? 'checked' : ''}>
        <span class="gcp-badge ${cls}">${escHtml(label)}</span>
        <span class="gcp-item-idx">#${msg.index}</span>
        <span class="gcp-item-text">${escHtml(msg.preview)}…</span>
      `;
      item.querySelector('input').addEventListener('change', e => onToggle(i, e.target.checked));
      listEl.appendChild(item);
    });
    updateListHeight();
  }

  // ── 匯出格式 ──────────────────────────────────────────────────────────────────
  function formatTxt(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const divider = '─'.repeat(40);
    const header = [
      '=== GPT 對話捕獲 ===',
      `網址：${location.href}`,
      `時間：${now}`,
      `捕獲訊息：${messages.length} 筆`,
      '='.repeat(40), '',
    ].join('\n');
    const body = messages.map(m => {
      const label = m.role === 'user' ? '[User]' : m.role === 'assistant' ? '[ChatGPT]' : `[${m.role}]`;
      return `${label} #${m.index}\n${m.text}\n${divider}`;
    }).join('\n\n');
    return header + body;
  }

  function formatHtml(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const rows = messages.map(m => {
      const isUser = m.role === 'user';
      const label = isUser ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
      const color = isUser ? '#6d28d9' : m.role === 'assistant' ? '#047857' : '#92400e';
      return `<article style="margin-bottom:1.5em;padding:1em 1.2em;border-left:4px solid ${color};background:#f9fafb;border-radius:0 6px 6px 0">
  <header style="font-weight:700;color:${color};margin-bottom:.5em;font-size:.88em">[${escHtml(label)}] #${m.index}</header>
  <pre style="white-space:pre-wrap;font-family:inherit;margin:0;color:#1a1a1a;line-height:1.65">${escHtml(m.text)}</pre>
</article>`;
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>GPT 捕獲 ${escHtml(now)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:840px;margin:2em auto;padding:0 1.2em;color:#111}h2{font-size:1.15em;margin-bottom:.3em}.meta{color:#777;font-size:.85em;margin-bottom:1.8em}</style>
</head>
<body>
  <h2>📋 GPT 對話捕獲</h2>
  <p class="meta">網址：<a href="${escHtml(location.href)}">${escHtml(location.href)}</a><br>時間：${escHtml(now)}，共 ${messages.length} 筆</p>
  ${rows}
</body></html>`;
  }

  // ── 主邏輯 ────────────────────────────────────────────────────────────────────
  async function init() {
    try {
      injectStyles();
      buildPanel();

      const cfgBtn     = document.getElementById('gcp-cfg-btn');
      const cfgSection = document.getElementById('gcp-settings');
      const cfgApply   = document.getElementById('gcp-cfg-apply');
      const cfgStatus  = document.getElementById('gcp-cfg-status');
      const scanBtn    = document.getElementById('gcp-scan');
      const scanInfo   = document.getElementById('gcp-scan-info');
      const scanStatus = document.getElementById('gcp-scan-status');
      const listEl     = document.getElementById('gcp-list');
      const selCount   = document.getElementById('gcp-sel-count');
      const expStatus  = document.getElementById('gcp-export-status');

      function refreshCount() {
        const n = STATE.messages.filter(m => m.selected).length;
        selCount.textContent = `已選 ${n} 筆`;
      }

      function onToggle(i, checked) {
        STATE.messages[i].selected = checked;
        refreshCount();
      }

      function rerender() {
        renderList(listEl, STATE.messages, onToggle);
        refreshCount();
      }

      // ⚙ 切換設定面板
      cfgBtn.addEventListener('click', () => {
        const open = cfgSection.style.display === 'none';
        cfgSection.style.display = open ? 'block' : 'none';
        cfgBtn.classList.toggle('active', open);
      });

      // 套用設定
      cfgApply.addEventListener('click', () => {
        const sel   = document.getElementById('gcp-cfg-sel').value.trim();
        const attr  = document.getElementById('gcp-cfg-attr').value.trim();
        const roles = document.getElementById('gcp-cfg-roles').value
          .split(',').map(s => s.trim()).filter(Boolean);
        const rows  = parseInt(document.getElementById('gcp-cfg-rows').value, 10);
        const delay = parseInt(document.getElementById('gcp-cfg-delay').value, 10);

        if (!sel) { setStatus(cfgStatus, '⚠ 選取器不可空白', 'err'); return; }
        try { document.querySelectorAll(sel); } catch {
          setStatus(cfgStatus, '⚠ 選取器語法錯誤', 'err'); return;
        }
        CFG.selector    = sel;
        CFG.roleAttr    = attr || CFG.roleAttr;
        CFG.targetRoles = roles;
        if (!isNaN(rows) && rows >= 1) CFG.maxListRows = rows;
        if (!isNaN(delay) && delay >= 100) CFG.scrollDelay = delay;

        setStatus(cfgStatus, '✔ 設定已套用，請重新掃描', 'ok');

        STATE.messages = [];
        STATE.capturedData = null;
        listEl.innerHTML = '<div class="gcp-empty">設定已變更，請重新掃描</div>';
        updateListHeight();
        scanInfo.textContent = '尚未掃描';
        scanInfo.style.color = '#555';
        refreshCount();
      });

      // 關閉
      document.getElementById('gcp-x').addEventListener('click', () => {
        document.getElementById('gcp-panel')?.remove();
        document.getElementById('gcp-styles')?.remove();
        window.__GPTCapture = null;
      });

      // 掃描
      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        STATE.capturedData = null;
        expStatus.textContent = '';

        try {
          STATE.messages = await scrollAndScan(scanStatus);
          rerender();
          const n = STATE.messages.length;
          scanInfo.textContent = `已找到 ${n} 筆`;
          scanInfo.style.color = n > 0 ? '#10a37f' : '#ef4444';
          setStatus(scanStatus,
            n === 0 ? '未找到訊息，請確認選取器設定或頁面是否完整載入' : `掃描完成（共 ${n} 筆）`,
            n === 0 ? 'err' : 'ok');
        } catch (err) {
          setStatus(scanStatus, `掃描失敗：${err.message}`, 'err');
        } finally {
          scanBtn.disabled = false;
        }
      });

      // 快捷選取
      document.getElementById('gcp-sel-user').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = m.role === 'user'; });
        rerender();
      });
      document.getElementById('gcp-sel-asst').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = m.role === 'assistant'; });
        rerender();
      });
      document.getElementById('gcp-sel-all').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = true; });
        rerender();
      });
      document.getElementById('gcp-sel-none').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = false; });
        rerender();
      });

      // 捕獲
      document.getElementById('gcp-capture').addEventListener('click', () => {
        const selected = STATE.messages.filter(m => m.selected);
        if (selected.length === 0) {
          setStatus(expStatus, '⚠ 請先勾選至少一筆訊息', 'err'); return;
        }
        STATE.capturedData = selected;
        setStatus(expStatus, `✔ 已捕獲 ${selected.length} 筆，請選擇匯出格式`, 'ok');
      });

      function requireCaptured() {
        if (!STATE.capturedData) {
          setStatus(expStatus, '⚠ 請先點擊「捕獲選取項目」', 'err'); return false;
        }
        return true;
      }

      // 匯出
      document.getElementById('gcp-exp-txt').addEventListener('click', () => {
        if (!requireCaptured()) return;
        download(formatTxt(STATE.capturedData), `chatgpt_${timestamp()}.txt`, 'text/plain;charset=utf-8');
        setStatus(expStatus, '✔ TXT 下載中…', 'ok');
      });

      document.getElementById('gcp-exp-html').addEventListener('click', () => {
        if (!requireCaptured()) return;
        download(formatHtml(STATE.capturedData), `chatgpt_${timestamp()}.html`, 'text/html;charset=utf-8');
        setStatus(expStatus, '✔ HTML 下載中…', 'ok');
      });

      document.getElementById('gcp-exp-clip').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        const txt = formatTxt(STATE.capturedData);
        try {
          await navigator.clipboard.writeText(txt);
          setStatus(expStatus, '✔ 已複製到剪貼簿', 'ok');
        } catch {
          const ta = Object.assign(document.createElement('textarea'), {
            value: txt, style: 'position:fixed;opacity:0;top:0;left:0;',
          });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          setStatus(expStatus, '✔ 已複製（降級模式）', 'ok');
        }
      });

      // 初始化清單高度
      updateListHeight();

    } catch (err) {
      console.error('[GPTCapture] 初始化失敗:', err);
    }
  }

  function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = 'gcp-status' + (type ? ' gcp-' + type : '');
  }

  window.__GPTCapture = {
    destroy() {
      document.getElementById('gcp-panel')?.remove();
      document.getElementById('gcp-styles')?.remove();
    },
  };

  init();
})();
