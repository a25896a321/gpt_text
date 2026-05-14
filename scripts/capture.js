(function () {
  'use strict';

  if (window.__GPTCapture) window.__GPTCapture.destroy();

  // ── localStorage 批量模式鍵值 ────────────────────────────────────────────────
  const BATCH_KEY = '__GPTCapture_batch';

  // ── 可調整設定（⚙ 面板即時修改）──────────────────────────────────────────────
  const CFG = {
    // 捕獲目標
    selector:    '[data-message-author-role]',
    roleAttr:    'data-message-author-role',
    targetRoles: ['user', 'assistant'],
    // 掃描行為
    scrollStep:  0,
    scrollDelay: 600,
    maxListRows: 10,
    // 自動化
    autoCapture: true,          // 掃描完成後自動捕獲
    autoExport:  true,          // 捕獲完成後自動匯出
    autoExportFormat: 'txt',    // txt | html | xls | clipboard
    defaultSelection: 'assistant',  // user | assistant | all | none
    // 顯示
    showIndex: true,
    // XLS
    xlsDelimiter:     '|',
    xlsCleanupTargets: ['標題：'],  // 包含此字串的儲存格將被移除
  };

  // ── 執行狀態 ─────────────────────────────────────────────────────────────────
  const STATE = {
    messages: [],
    capturedData: null,
    stopScan: false,
    // 批量
    batchQueue:   [],
    batchResults: [],
    batchActive:  false,
    batchTotal:   0,
  };

  // ── 樣式 ──────────────────────────────────────────────────────────────────────
  const STYLES = `
    #gcp-panel {
      position:fixed; top:16px; right:16px; width:390px;
      background:#1a1a1a; color:#e0e0e0;
      border:1px solid #3a3a3a; border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,.65);
      z-index:999999;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px; display:flex; flex-direction:column; overflow:hidden;
      max-height:96vh;
    }
    #gcp-panel * { box-sizing:border-box; margin:0; padding:0; }
    .gcp-header {
      background:#242424; padding:11px 14px;
      display:flex; justify-content:space-between; align-items:center;
      font-weight:700; font-size:14px; border-bottom:1px solid #333;
      flex-shrink:0; user-select:none;
    }
    .gcp-header-title { display:flex; align-items:center; gap:7px; }
    .gcp-header-actions { display:flex; gap:4px; align-items:center; }
    .gcp-icon-btn {
      cursor:pointer; background:none; border:none;
      color:#888; font-size:15px; line-height:1; padding:3px 5px;
      border-radius:4px; transition:color .15s,background .15s;
    }
    .gcp-icon-btn:hover { color:#fff; background:#3a3a3a; }
    .gcp-icon-btn.active { color:#10a37f; background:#1a3a30; }
    .gcp-close { cursor:pointer; background:none; border:none; color:#888; font-size:20px; line-height:1; padding:0 3px; }
    .gcp-close:hover { color:#fff; }
    /* ── 設定面板 ── */
    #gcp-settings {
      padding:12px 14px; border-bottom:1px solid #2a2a2a;
      background:#141414; flex-shrink:0; overflow-y:auto; max-height:55vh;
    }
    .gcp-group {
      font-size:10px; font-weight:700; text-transform:uppercase;
      letter-spacing:.06em; color:#555; margin:10px 0 6px;
      border-top:1px solid #252525; padding-top:8px;
    }
    .gcp-group:first-child { border-top:none; margin-top:0; padding-top:0; }
    .gcp-field { margin-bottom:7px; }
    .gcp-label { font-size:11px; color:#888; margin-bottom:3px; display:block; }
    .gcp-input {
      width:100%; background:#1f1f1f; border:1px solid #3a3a3a; border-radius:4px;
      color:#ddd; font-size:12px; padding:5px 8px; outline:none;
      font-family:'Consolas','Courier New',monospace; line-height:1.4;
    }
    .gcp-input-sm {
      width:68px; background:#1f1f1f; border:1px solid #3a3a3a; border-radius:4px;
      color:#ddd; font-size:12px; padding:5px 8px; outline:none; text-align:center;
    }
    .gcp-input:focus,.gcp-input-sm:focus,.gcp-select:focus { border-color:#10a37f; }
    .gcp-select {
      background:#1f1f1f; border:1px solid #3a3a3a; border-radius:4px;
      color:#ddd; font-size:12px; padding:5px 8px; outline:none; cursor:pointer;
    }
    .gcp-check {
      display:flex; align-items:center; gap:7px;
      font-size:12px; color:#bbb; cursor:pointer; margin-bottom:5px;
    }
    .gcp-check input { accent-color:#10a37f; cursor:pointer; }
    .gcp-hint { font-size:10px; color:#555; margin-top:3px; line-height:1.4; }
    /* ── 批量面板 ── */
    #gcp-batch-body {
      padding:10px 14px; border-bottom:1px solid #2a2a2a;
      background:#161616; flex-shrink:0;
    }
    /* ── 通用 section ── */
    .gcp-section { padding:9px 14px; border-bottom:1px solid #2a2a2a; flex-shrink:0; }
    .gcp-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
    .gcp-btn {
      padding:5px 10px; border-radius:5px; border:none;
      cursor:pointer; font-size:12px; font-weight:500; line-height:1.4;
      transition:opacity .15s;
    }
    .gcp-btn:disabled { opacity:.4; cursor:not-allowed; }
    .gcp-btn:not(:disabled):hover { opacity:.82; }
    .gcp-btn-primary   { background:#10a37f; color:#fff; }
    .gcp-btn-secondary { background:#2e2e2e; color:#bbb; }
    .gcp-btn-danger    { background:#7f1d1d; color:#fca5a5; }
    .gcp-btn-export    { background:#2563eb; color:#fff; }
    .gcp-status { font-size:12px; color:#666; margin-top:5px; min-height:15px; line-height:1.4; }
    .gcp-ok   { color:#10a37f; }
    .gcp-warn { color:#f59e0b; }
    .gcp-err  { color:#ef4444; }
    /* ── 清單 ── */
    .gcp-list { overflow-y:auto; flex-shrink:0; padding:4px 0; }
    .gcp-empty { color:#555; font-size:12px; padding:22px 14px; text-align:center; }
    .gcp-item {
      display:flex; align-items:flex-start; gap:8px;
      padding:7px 14px; cursor:pointer; border-bottom:1px solid #1e1e1e;
    }
    .gcp-item:hover { background:#222; }
    .gcp-item input[type=checkbox] { margin-top:2px; flex-shrink:0; cursor:pointer; accent-color:#10a37f; }
    .gcp-badge {
      font-size:10px; padding:2px 6px; border-radius:3px;
      font-weight:700; flex-shrink:0; margin-top:1px; line-height:1.3; white-space:nowrap;
    }
    .gcp-badge-user  { background:#6d28d9; color:#fff; }
    .gcp-badge-asst  { background:#047857; color:#fff; }
    .gcp-badge-other { background:#92400e; color:#fff; }
    .gcp-item-idx  { font-size:11px; color:#555; flex-shrink:0; margin-top:2px; }
    .gcp-item-text { font-size:12px; color:#999; line-height:1.45; flex:1; }
    .gcp-list-footer { text-align:center; font-size:10px; color:#444; padding:4px 0; border-top:1px solid #1e1e1e; flex-shrink:0; }
  `;

  function injectStyles() {
    if (document.getElementById('gcp-styles')) return;
    const s = document.createElement('style');
    s.id = 'gcp-styles'; s.textContent = STYLES;
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
          <button class="gcp-icon-btn" id="gcp-batch-toggle" title="批量掃描">🔗</button>
          <button class="gcp-icon-btn" id="gcp-cfg-btn" title="設定">⚙</button>
          <button class="gcp-close" id="gcp-x">×</button>
        </div>
      </div>

      <!-- ⚙ 設定面板 -->
      <div id="gcp-settings" style="display:none">
        <div class="gcp-group">捕獲目標</div>
        <div class="gcp-field">
          <label class="gcp-label">CSS 選取器</label>
          <input class="gcp-input" id="gcp-cfg-sel" value="${CFG.selector}">
        </div>
        <div class="gcp-field">
          <label class="gcp-label">角色屬性名稱</label>
          <input class="gcp-input" id="gcp-cfg-attr" value="${CFG.roleAttr}">
        </div>
        <div class="gcp-field">
          <label class="gcp-label">捕獲角色值（逗號分隔，留空=全部）</label>
          <input class="gcp-input" id="gcp-cfg-roles" value="${CFG.targetRoles.join(', ')}">
        </div>

        <div class="gcp-group">掃描行為</div>
        <div class="gcp-field">
          <div class="gcp-row">
            <span class="gcp-label" style="width:60px;flex-shrink:0">清單筆數</span>
            <input class="gcp-input-sm" id="gcp-cfg-rows" type="number" min="3" max="50" value="${CFG.maxListRows}">
            <span class="gcp-label" style="width:55px;flex-shrink:0;margin-left:8px">延遲 ms</span>
            <input class="gcp-input-sm" id="gcp-cfg-delay" type="number" min="200" max="3000" value="${CFG.scrollDelay}">
          </div>
        </div>

        <div class="gcp-group">自動化</div>
        <label class="gcp-check">
          <input type="checkbox" id="gcp-cfg-autocap" ${CFG.autoCapture?'checked':''}>
          掃描完成後自動捕獲
        </label>
        <label class="gcp-check">
          <input type="checkbox" id="gcp-cfg-autoexp" ${CFG.autoExport?'checked':''}>
          捕獲完成後自動匯出
        </label>
        <div class="gcp-field" style="padding-left:18px">
          <label class="gcp-label">自動匯出格式</label>
          <select class="gcp-select" id="gcp-cfg-expfmt">
            <option value="txt"       ${CFG.autoExportFormat==='txt'      ?'selected':''}>TXT</option>
            <option value="html"      ${CFG.autoExportFormat==='html'     ?'selected':''}>HTML</option>
            <option value="xls"       ${CFG.autoExportFormat==='xls'      ?'selected':''}>Excel (XLS)</option>
            <option value="clipboard" ${CFG.autoExportFormat==='clipboard'?'selected':''}>剪貼簿</option>
          </select>
        </div>
        <div class="gcp-field">
          <label class="gcp-label">掃描後預設選取</label>
          <select class="gcp-select" id="gcp-cfg-defsel">
            <option value="user"      ${CFG.defaultSelection==='user'     ?'selected':''}>僅選 User</option>
            <option value="assistant" ${CFG.defaultSelection==='assistant'?'selected':''}>僅選 Assistant</option>
            <option value="all"       ${CFG.defaultSelection==='all'      ?'selected':''}>全選</option>
            <option value="none"      ${CFG.defaultSelection==='none'     ?'selected':''}>不選</option>
          </select>
        </div>

        <div class="gcp-group">顯示</div>
        <label class="gcp-check">
          <input type="checkbox" id="gcp-cfg-showidx" ${CFG.showIndex?'checked':''}>
          顯示序號 #1 #2 …
        </label>

        <div class="gcp-group">Excel (XLS) 設定</div>
        <div class="gcp-field">
          <label class="gcp-label">欄位分隔符（各欄之間）</label>
          <input class="gcp-input-sm" id="gcp-cfg-delim" value="${CFG.xlsDelimiter}" placeholder="|">
        </div>
        <div class="gcp-field">
          <label class="gcp-label">清除目標（逗號分隔）</label>
          <input class="gcp-input" id="gcp-cfg-cleanup" value="${CFG.xlsCleanupTargets.join(', ')}" placeholder="標題：">
          <div class="gcp-hint">儲存格包含任一目標字串時，該儲存格將被移除</div>
        </div>

        <div class="gcp-row" style="margin-top:8px">
          <button class="gcp-btn gcp-btn-primary" id="gcp-cfg-apply">套用設定</button>
          <span class="gcp-status" id="gcp-cfg-status"></span>
        </div>
      </div>

      <!-- 🔗 批量掃描面板 -->
      <div id="gcp-batch-body" style="display:none">
        <div class="gcp-hint" style="margin-bottom:6px;font-size:11px;color:#888">
          每行一個網址。掃描完當前頁後自動跳轉下一頁（同分頁），重新貼上腳本後自動繼續。
        </div>
        <textarea id="gcp-batch-urls" class="gcp-input" rows="4"
          style="resize:vertical;font-size:11px;line-height:1.5"
          placeholder="https://chatgpt.com/share/...&#10;https://chatgpt.com/share/..."></textarea>
        <div class="gcp-row" style="margin-top:6px">
          <button class="gcp-btn gcp-btn-primary" id="gcp-batch-start">▶ 開始批量</button>
          <button class="gcp-btn gcp-btn-secondary" id="gcp-batch-export-all">⬇ 匯出全部結果</button>
          <button class="gcp-btn gcp-btn-danger" id="gcp-batch-clear">✕ 清除</button>
        </div>
        <div class="gcp-status" id="gcp-batch-status"></div>
      </div>

      <!-- 步驟 1：掃描 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <button class="gcp-btn gcp-btn-primary" id="gcp-scan">🔍 掃描訊息</button>
          <button class="gcp-btn gcp-btn-danger" id="gcp-stop" style="display:none">⏹ 停止</button>
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

      <!-- 訊息清單 -->
      <div class="gcp-list" id="gcp-list">
        <div class="gcp-empty">請先點擊「掃描訊息」</div>
      </div>
      <div class="gcp-list-footer" id="gcp-list-footer" style="display:none"></div>

      <!-- 步驟 3：捕獲 -->
      <div class="gcp-section">
        <div class="gcp-row" style="justify-content:space-between">
          <span id="gcp-sel-count" style="font-size:12px;color:#777">已選 0 筆</span>
          <button class="gcp-btn gcp-btn-primary" id="gcp-capture">⚡ 確認當前選取項目</button>
        </div>
      </div>

      <!-- 步驟 4：匯出 -->
      <div class="gcp-section">
        <div class="gcp-row">
          <span style="font-size:12px;color:#555">匯出：</span>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-txt">TXT</button>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-html">HTML</button>
          <button class="gcp-btn gcp-btn-export" id="gcp-exp-xls">XLS</button>
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
      String(d.getMonth()+1).padStart(2,'0'),
      String(d.getDate()).padStart(2,'0'), '_',
      String(d.getHours()).padStart(2,'0'),
      String(d.getMinutes()).padStart(2,'0'),
      String(d.getSeconds()).padStart(2,'0')].join('');
  }

  function safeFilename(name) {
    return (name || 'export')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_').trim().slice(0, 50) || 'export';
  }

  function autoFilename(ext) {
    return `${safeFilename(document.title)}_${timestamp()}.${ext}`;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: filename,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function setStatus(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'gcp-status' + (type ? ' gcp-' + type : '');
  }

  function roleBadge(role) {
    if (role === 'user')      return { label: 'User', cls: 'gcp-badge-user' };
    if (role === 'assistant') return { label: 'GPT',  cls: 'gcp-badge-asst' };
    return { label: role.slice(0,8).toUpperCase(), cls: 'gcp-badge-other' };
  }

  // ── 預設選取 ──────────────────────────────────────────────────────────────────
  function applyDefaultSelection() {
    const sel = CFG.defaultSelection;
    STATE.messages.forEach(m => {
      m.selected = sel === 'all'       ? true
                 : sel === 'none'      ? false
                 : sel === 'user'      ? m.role === 'user'
                 : sel === 'assistant' ? m.role === 'assistant'
                 : true;
    });
  }

  // ── 滾動容器偵測 ──────────────────────────────────────────────────────────────
  function findScrollContainer() {
    const firstMsg = document.querySelector(CFG.selector);
    if (firstMsg) {
      let el = firstMsg.parentElement;
      while (el && el !== document.documentElement) {
        const oy = window.getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 30) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  function makeScroller(container) {
    const isWin = !container;
    return {
      scrollTo(y)    { if (isWin) window.scrollTo(0, y); else container.scrollTop = y; },
      get scrollH()  { return isWin ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) : container.scrollHeight; },
      get clientH()  { return isWin ? window.innerHeight : container.clientHeight; },
      label: isWin ? 'window' : (container.tagName.toLowerCase() + (container.id ? '#'+container.id : '')),
    };
  }

  // ── 核心掃描 ──────────────────────────────────────────────────────────────────
  async function scrollAndScan(statusEl) {
    STATE.stopScan = false;

    window.scrollTo(0, 0); await sleep(500);
    window.scrollTo(0, window.innerHeight * 0.4); await sleep(700);
    window.scrollTo(0, 0); await sleep(400);

    const scroller = makeScroller(findScrollContainer());
    setStatus(statusEl, `偵測容器：${scroller.label}`, 'warn');
    await sleep(200);

    scroller.scrollTo(0); await sleep(600);

    const seen = new Map();

    function harvest() {
      document.querySelectorAll(CFG.selector).forEach(node => {
        const role = node.getAttribute(CFG.roleAttr) || 'unknown';
        if (CFG.targetRoles.length > 0 && !CFG.targetRoles.includes(role)) return;
        const text = node.innerText.trim();
        if (!text) return;
        const key = role + '\x00' + text.slice(0, 120);
        if (!seen.has(key)) {
          seen.set(key, { role, text, preview: text.replace(/\s+/g,' ').slice(0,60), order: seen.size, selected: true });
        }
      });
    }

    const step = CFG.scrollStep > 0 ? CFG.scrollStep : Math.max(200, Math.floor(scroller.clientH * 0.6));
    let pos = 0, stableRounds = 0, lastScrollH = 0;

    for (let i = 0; i < 800; i++) {
      if (STATE.stopScan) {
        setStatus(statusEl, `⏹ 已停止（收集 ${seen.size} 筆）`, 'warn');
        break;
      }
      harvest();
      const totalH = scroller.scrollH;
      const pct = totalH > 0 ? Math.min(100, Math.round((pos / totalH) * 100)) : 0;
      setStatus(statusEl, `掃描中 ${pct}%… 已收集 ${seen.size} 筆`, 'warn');

      if (pos >= totalH) {
        if (totalH === lastScrollH) { if (++stableRounds >= 3) break; }
        else { stableRounds = 0; }
        lastScrollH = totalH;
      }
      pos += step;
      scroller.scrollTo(pos);
      await sleep(CFG.scrollDelay);
    }

    harvest();
    scroller.scrollTo(0);

    return Array.from(seen.values()).sort((a,b) => a.order - b.order).map((m,i) => ({ ...m, index: i+1 }));
  }

  // ── 清單高度 ─────────────────────────────────────────────────────────────────
  function updateListHeight() {
    const listEl   = document.getElementById('gcp-list');
    const footerEl = document.getElementById('gcp-list-footer');
    if (!listEl) return;
    listEl.style.maxHeight = (CFG.maxListRows * 40) + 'px';
    listEl.style.overflowY = 'auto';
    if (footerEl) {
      const total = STATE.messages.length;
      footerEl.textContent = total > CFG.maxListRows ? `共 ${total} 筆，向下捲動查看更多` : '';
      footerEl.style.display = total > CFG.maxListRows ? 'block' : 'none';
    }
  }

  // ── 渲染清單 ──────────────────────────────────────────────────────────────────
  function renderList(listEl, messages, onToggle) {
    if (messages.length === 0) {
      listEl.innerHTML = '<div class="gcp-empty">未找到訊息，請確認選取器或等待頁面載入後重試</div>';
      updateListHeight(); return;
    }
    listEl.innerHTML = '';
    messages.forEach((msg, i) => {
      const { label, cls } = roleBadge(msg.role);
      const item = document.createElement('label');
      item.className = 'gcp-item';
      const idxSpan = CFG.showIndex ? `<span class="gcp-item-idx">#${msg.index}</span>` : '';
      item.innerHTML = `
        <input type="checkbox" data-i="${i}" ${msg.selected ? 'checked' : ''}>
        <span class="gcp-badge ${cls}">${escHtml(label)}</span>
        ${idxSpan}
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
    const header = ['=== GPT 對話捕獲 ===', `網址：${location.href}`, `時間：${now}`, `捕獲訊息：${messages.length} 筆`, '='.repeat(40), ''].join('\n');
    const body = messages.map(m => {
      const label = m.role === 'user' ? '[User]' : m.role === 'assistant' ? '[ChatGPT]' : `[${m.role}]`;
      const idx = CFG.showIndex ? ` #${m.index}` : '';
      return `${label}${idx}\n${m.text}\n${divider}`;
    }).join('\n\n');
    return header + body;
  }

  function formatHtml(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const rows = messages.map(m => {
      const isUser = m.role === 'user';
      const label = isUser ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
      const color = isUser ? '#6d28d9' : m.role === 'assistant' ? '#047857' : '#92400e';
      const idx = CFG.showIndex ? ` #${m.index}` : '';
      return `<article style="margin-bottom:1.5em;padding:1em 1.2em;border-left:4px solid ${color};background:#f9fafb;border-radius:0 6px 6px 0">
  <header style="font-weight:700;color:${color};margin-bottom:.5em;font-size:.88em">[${escHtml(label)}]${idx}</header>
  <pre style="white-space:pre-wrap;font-family:inherit;margin:0;color:#1a1a1a;line-height:1.65">${escHtml(m.text)}</pre>
</article>`;
    }).join('\n');
    return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"><title>GPT 捕獲 ${escHtml(now)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:840px;margin:2em auto;padding:0 1.2em;color:#111}h2{font-size:1.15em}.meta{color:#777;font-size:.85em;margin-bottom:1.8em}</style></head>
<body><h2>📋 GPT 對話捕獲</h2><p class="meta">網址：<a href="${escHtml(location.href)}">${escHtml(location.href)}</a><br>時間：${escHtml(now)}，共 ${messages.length} 筆</p>${rows}</body></html>`;
  }

  function formatXls(messages) {
    const now = new Date().toLocaleString('zh-TW');
    const delim = CFG.xlsDelimiter || '|';
    const cleanTargets = CFG.xlsCleanupTargets.filter(Boolean);

    const dataRows = messages.map(m => {
      const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
      const idxCell = CFG.showIndex ? `<td>${m.index}</td>` : '';
      const roleCell = `<td>${escHtml(label)}</td>`;

      // 分割欄位
      let parts = m.text.split(delim).map(p => p.trim()).filter(p => p.length > 0);
      // 清除含目標字串的儲存格
      if (cleanTargets.length > 0) {
        parts = parts.filter(p => !cleanTargets.some(t => t && p.includes(t)));
      }
      const dataCells = parts.map(p => `<td>${escHtml(p)}</td>`).join('');
      return `  <tr>${idxCell}${roleCell}${dataCells}</tr>`;
    }).join('\n');

    const hIdx  = CFG.showIndex ? '<th>序號</th>' : '';
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>GPT對話</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>
<p>網址：${escHtml(location.href)}　時間：${escHtml(now)}　共 ${messages.length} 筆</p>
<table border="1" cellpadding="4" cellspacing="0">
  <tr style="background:#e8f5e9;font-weight:bold">
    ${hIdx}<th>角色</th><th>內容（分隔符：${escHtml(delim)}）</th>
  </tr>
${dataRows}
</table>
</body></html>`;
  }

  // ── 匯出觸發（含批量跳轉）────────────────────────────────────────────────────
  async function triggerExport(fmt) {
    if (!STATE.capturedData || STATE.capturedData.length === 0) return;
    const name = autoFilename(fmt === 'xls' ? 'xls' : fmt === 'html' ? 'html' : 'txt');
    switch (fmt) {
      case 'txt':       download(formatTxt(STATE.capturedData), name, 'text/plain;charset=utf-8'); break;
      case 'html':      download(formatHtml(STATE.capturedData), name, 'text/html;charset=utf-8'); break;
      case 'xls':       download(formatXls(STATE.capturedData), name, 'application/vnd.ms-excel;charset=utf-8'); break;
      case 'clipboard':
        try { await navigator.clipboard.writeText(formatTxt(STATE.capturedData)); }
        catch { fallbackCopy(formatTxt(STATE.capturedData)); }
        break;
    }
    // 批量：匯出後跳轉下一頁
    if (STATE.batchActive) await advanceBatch();
  }

  function fallbackCopy(txt) {
    const ta = Object.assign(document.createElement('textarea'), { value: txt, style: 'position:fixed;opacity:0;' });
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }

  // ── 批量模式 ─────────────────────────────────────────────────────────────────
  function saveBatchState() {
    try {
      localStorage.setItem(BATCH_KEY, JSON.stringify({
        queue:   STATE.batchQueue,
        results: STATE.batchResults.map(r => ({ url: r.url, title: r.title, txt: formatTxt(r.messages) })),
        total:   STATE.batchTotal,
      }));
    } catch(e) { console.warn('[GPTCapture] batch save failed', e); }
  }

  function loadBatchState() {
    try { const r = localStorage.getItem(BATCH_KEY); return r ? JSON.parse(r) : null; }
    catch { return null; }
  }

  function urlsMatch(a, b) {
    try {
      const ua = new URL(a), ub = new URL(b);
      return ua.hostname === ub.hostname &&
             ua.pathname.replace(/\/$/,'') === ub.pathname.replace(/\/$/,'');
    } catch { return a === b; }
  }

  async function advanceBatch() {
    const batchStatus = document.getElementById('gcp-batch-status');
    // 儲存當前頁結果
    if (STATE.capturedData) {
      STATE.batchResults.push({ url: location.href, title: document.title, messages: STATE.capturedData });
    }
    if (STATE.batchQueue.length > 0) {
      const nextUrl = STATE.batchQueue.shift();
      saveBatchState();
      setStatus(batchStatus, `✔ 第 ${STATE.batchResults.length}/${STATE.batchTotal} 頁完成，正在跳轉…`, 'warn');
      await sleep(1500);
      location.href = nextUrl;
    } else {
      // 全部完成
      try { localStorage.removeItem(BATCH_KEY); } catch {}
      STATE.batchActive = false;
      setStatus(batchStatus, `✅ 批量完成！共 ${STATE.batchResults.length} 頁，點擊「匯出全部結果」`, 'ok');
    }
  }

  function checkBatchResume() {
    const state = loadBatchState();
    if (!state) return;
    const expected = state.queue[0];
    if (!expected || !urlsMatch(location.href, expected)) return; // 網址不符，不繼續

    STATE.batchQueue   = state.queue.slice(1);
    STATE.batchResults = state.results || [];
    STATE.batchActive  = true;
    STATE.batchTotal   = state.total;

    const done = STATE.batchTotal - STATE.batchQueue.length - 1;
    const batchStatus = document.getElementById('gcp-batch-status');
    if (batchStatus) setStatus(batchStatus, `批量模式：第 ${done + 1}/${STATE.batchTotal} 頁，自動掃描中…`, 'warn');

    // 展開批量面板
    const body = document.getElementById('gcp-batch-body');
    const btn  = document.getElementById('gcp-batch-toggle');
    if (body) body.style.display = 'block';
    if (btn)  btn.classList.add('active');

    // 自動開始掃描
    setTimeout(() => document.getElementById('gcp-scan')?.click(), 600);
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
      const stopBtn    = document.getElementById('gcp-stop');
      const scanInfo   = document.getElementById('gcp-scan-info');
      const scanStatus = document.getElementById('gcp-scan-status');
      const listEl     = document.getElementById('gcp-list');
      const selCount   = document.getElementById('gcp-sel-count');
      const expStatus  = document.getElementById('gcp-export-status');

      function refreshCount() {
        const n = STATE.messages.filter(m => m.selected).length;
        selCount.textContent = `已選 ${n} 筆`;
      }

      function onToggle(i, checked) { STATE.messages[i].selected = checked; refreshCount(); }

      function rerender() { renderList(listEl, STATE.messages, onToggle); refreshCount(); }

      // ── ⚙ 設定 ──
      cfgBtn.addEventListener('click', () => {
        const open = cfgSection.style.display === 'none';
        cfgSection.style.display = open ? 'block' : 'none';
        cfgBtn.classList.toggle('active', open);
      });

      cfgApply.addEventListener('click', () => {
        const sel = document.getElementById('gcp-cfg-sel').value.trim();
        if (!sel) { setStatus(cfgStatus,'⚠ 選取器不可空白','err'); return; }
        try { document.querySelectorAll(sel); } catch { setStatus(cfgStatus,'⚠ 選取器語法錯誤','err'); return; }

        CFG.selector    = sel;
        CFG.roleAttr    = document.getElementById('gcp-cfg-attr').value.trim() || CFG.roleAttr;
        CFG.targetRoles = document.getElementById('gcp-cfg-roles').value.split(',').map(s=>s.trim()).filter(Boolean);
        CFG.maxListRows = Math.max(3, parseInt(document.getElementById('gcp-cfg-rows').value,10)||10);
        CFG.scrollDelay = Math.max(100, parseInt(document.getElementById('gcp-cfg-delay').value,10)||600);
        CFG.autoCapture = document.getElementById('gcp-cfg-autocap').checked;
        CFG.autoExport  = document.getElementById('gcp-cfg-autoexp').checked;
        CFG.autoExportFormat = document.getElementById('gcp-cfg-expfmt').value;
        CFG.defaultSelection = document.getElementById('gcp-cfg-defsel').value;
        CFG.showIndex   = document.getElementById('gcp-cfg-showidx').checked;
        CFG.xlsDelimiter = document.getElementById('gcp-cfg-delim').value || '|';
        CFG.xlsCleanupTargets = document.getElementById('gcp-cfg-cleanup').value.split(',').map(s=>s.trim()).filter(Boolean);

        setStatus(cfgStatus,'✔ 已套用，請重新掃描','ok');
        STATE.messages = []; STATE.capturedData = null;
        listEl.innerHTML = '<div class="gcp-empty">設定已變更，請重新掃描</div>';
        updateListHeight();
        scanInfo.textContent = '尚未掃描'; scanInfo.style.color = '#555';
        refreshCount();
      });

      // ── 🔗 批量 ──
      document.getElementById('gcp-batch-toggle').addEventListener('click', () => {
        const body = document.getElementById('gcp-batch-body');
        const btn  = document.getElementById('gcp-batch-toggle');
        const open = body.style.display === 'none';
        body.style.display = open ? 'block' : 'none';
        btn.classList.toggle('active', open);
      });

      document.getElementById('gcp-batch-start').addEventListener('click', async () => {
        const batchStatus = document.getElementById('gcp-batch-status');
        const rawUrls = document.getElementById('gcp-batch-urls').value.trim();
        const urls = rawUrls.split('\n').map(u=>u.trim()).filter(u=>u.startsWith('http'));
        if (urls.length === 0) { setStatus(batchStatus,'⚠ 請輸入至少一個網址','err'); return; }

        STATE.batchResults = [];
        STATE.batchTotal   = urls.length;
        STATE.batchActive  = true;
        STATE.batchQueue   = urls.slice(1);  // 第一筆即當前頁

        // 若第一個 URL 不是當前頁，先儲存並跳轉
        if (!urlsMatch(location.href, urls[0])) {
          STATE.batchQueue = urls.slice(1);
          saveBatchState();
          setStatus(batchStatus, `跳轉至第 1/${urls.length} 頁…`, 'warn');
          await sleep(800);
          location.href = urls[0];
          return;
        }
        setStatus(batchStatus, `批量模式：第 1/${urls.length} 頁，自動掃描中…`, 'warn');
        saveBatchState();
        scanBtn.click();
      });

      document.getElementById('gcp-batch-export-all').addEventListener('click', () => {
        const batchStatus = document.getElementById('gcp-batch-status');
        if (STATE.batchResults.length === 0) {
          setStatus(batchStatus,'⚠ 尚無批量結果','err'); return;
        }
        const combined = STATE.batchResults.map(r =>
          `====== ${r.title} ======\n網址：${r.url}\n${r.txt || ''}`
        ).join('\n\n' + '═'.repeat(50) + '\n\n');
        download(combined, `batch_${timestamp()}.txt`, 'text/plain;charset=utf-8');
        setStatus(batchStatus,`✔ 已匯出 ${STATE.batchResults.length} 頁合併結果`,'ok');
      });

      document.getElementById('gcp-batch-clear').addEventListener('click', () => {
        try { localStorage.removeItem(BATCH_KEY); } catch {}
        STATE.batchQueue = []; STATE.batchResults = []; STATE.batchActive = false;
        setStatus(document.getElementById('gcp-batch-status'),'已清除批量狀態','ok');
      });

      // ── 關閉 ──
      document.getElementById('gcp-x').addEventListener('click', () => {
        document.getElementById('gcp-panel')?.remove();
        document.getElementById('gcp-styles')?.remove();
        window.__GPTCapture = null;
      });

      // ── 掃描 ──
      scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        stopBtn.style.display = 'inline-flex';
        STATE.capturedData = null;
        setStatus(expStatus, '', '');

        try {
          STATE.messages = await scrollAndScan(scanStatus);
          applyDefaultSelection();
          rerender();
          const n = STATE.messages.length;
          scanInfo.textContent = `已找到 ${n} 筆`;
          scanInfo.style.color = n > 0 ? '#10a37f' : '#ef4444';

          if (n === 0) {
            setStatus(scanStatus, '未找到訊息，請確認選取器設定', 'err');
          } else {
            setStatus(scanStatus, `掃描完成（共 ${n} 筆）`, 'ok');
            // 自動捕獲
            if (CFG.autoCapture) {
              const selected = STATE.messages.filter(m => m.selected);
              if (selected.length > 0) {
                STATE.capturedData = selected;
                setStatus(expStatus, `✔ 自動捕獲 ${selected.length} 筆`, 'ok');
                // 自動匯出
                if (CFG.autoExport) {
                  await sleep(300);
                  setStatus(expStatus, `✔ 自動捕獲 ${selected.length} 筆，匯出中…`, 'ok');
                  await triggerExport(CFG.autoExportFormat);
                  if (!STATE.batchActive) {
                    setStatus(expStatus, `✔ 已匯出 ${selected.length} 筆（${CFG.autoExportFormat.toUpperCase()}）`, 'ok');
                  }
                }
              }
            }
          }
        } catch (err) {
          setStatus(scanStatus, `掃描失敗：${err.message}`, 'err');
        } finally {
          scanBtn.disabled = false;
          stopBtn.style.display = 'none';
        }
      });

      // ── 停止 ──
      stopBtn.addEventListener('click', () => {
        STATE.stopScan = true;
        setStatus(scanStatus, '⏹ 停止中…', 'warn');
      });

      // ── 快捷選取 ──
      document.getElementById('gcp-sel-user').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = m.role === 'user'; }); rerender();
      });
      document.getElementById('gcp-sel-asst').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = m.role === 'assistant'; }); rerender();
      });
      document.getElementById('gcp-sel-all').addEventListener('click',  () => {
        STATE.messages.forEach(m => { m.selected = true; }); rerender();
      });
      document.getElementById('gcp-sel-none').addEventListener('click', () => {
        STATE.messages.forEach(m => { m.selected = false; }); rerender();
      });

      // ── 確認選取 ──
      document.getElementById('gcp-capture').addEventListener('click', async () => {
        const selected = STATE.messages.filter(m => m.selected);
        if (selected.length === 0) { setStatus(expStatus,'⚠ 請先勾選至少一筆訊息','err'); return; }
        STATE.capturedData = selected;
        setStatus(expStatus, `✔ 已確認 ${selected.length} 筆，請選擇匯出格式`, 'ok');
        if (CFG.autoExport) {
          await sleep(200);
          await triggerExport(CFG.autoExportFormat);
          setStatus(expStatus, `✔ 已匯出 ${selected.length} 筆（${CFG.autoExportFormat.toUpperCase()}）`, 'ok');
        }
      });

      function requireCaptured() {
        if (!STATE.capturedData) { setStatus(expStatus,'⚠ 請先點擊「確認當前選取項目」','err'); return false; }
        return true;
      }

      // ── 手動匯出 ──
      document.getElementById('gcp-exp-txt').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        download(formatTxt(STATE.capturedData), autoFilename('txt'), 'text/plain;charset=utf-8');
        setStatus(expStatus,'✔ TXT 下載中…','ok');
      });
      document.getElementById('gcp-exp-html').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        download(formatHtml(STATE.capturedData), autoFilename('html'), 'text/html;charset=utf-8');
        setStatus(expStatus,'✔ HTML 下載中…','ok');
      });
      document.getElementById('gcp-exp-xls').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        download(formatXls(STATE.capturedData), autoFilename('xls'), 'application/vnd.ms-excel;charset=utf-8');
        setStatus(expStatus,'✔ XLS 下載中…','ok');
      });
      document.getElementById('gcp-exp-clip').addEventListener('click', async () => {
        if (!requireCaptured()) return;
        const txt = formatTxt(STATE.capturedData);
        try { await navigator.clipboard.writeText(txt); }
        catch { fallbackCopy(txt); }
        setStatus(expStatus,'✔ 已複製到剪貼簿','ok');
      });

      // 初始化清單高度
      updateListHeight();

      // 批量模式斷點續傳偵測
      checkBatchResume();

    } catch (err) {
      console.error('[GPTCapture] 初始化失敗:', err);
    }
  }

  window.__GPTCapture = {
    destroy() {
      document.getElementById('gcp-panel')?.remove();
      document.getElementById('gcp-styles')?.remove();
    },
  };

  init();
})();
