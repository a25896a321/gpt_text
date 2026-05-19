'use strict';

// ── Pinned-window detection ────────────────────────────────────────────────────
const IS_PINNED = new URLSearchParams(location.search).get('pin') === '1';

// ── Default config ─────────────────────────────────────────────────────────────
const XLS_EXCLUDE_DEFAULT = [
  'ChatGPT','已思考','推理花了','好的，','好的！','可以！以下',
  '新的標題與內容','新的標題與知識','當然可以','http','標題：',
].join('\n');

const CFG_DEFAULTS = {
  selector:               '[data-message-author-role]',
  roleAttr:               'data-message-author-role',
  targetRoles:            'assistant,user',
  scrollDelay:            350,
  defaultSelection:       'assistant',
  exportFormat:           'xls',
  exportFilename:         '$D$T-$M-$K',  // supports $D $T $Ts $M $K tokens
  downloadSubfolder:      '',
  exportRole:             false,
  // XLS: first-column extraction
  xlsPrefix:              '|標題：',
  xlsSuffix:              '|',
  xlsSuffixNewline:       true,
  xlsPrefixTrimSpaces:    true,         // allow spaces between prefix/suffix chars
  // XLS: column headers (comma-separated)
  xlsColNames:            '標題,內容',
  // XLS: remove exact substrings
  xlsCleanTargets:        '標題：,「,」',
  // XLS: remove lines containing keywords (newline-separated)
  xlsExcludeLines:        XLS_EXCLUDE_DEFAULT,
  // XLS: minimum cell chars
  xlsMinCellCharsEnabled: true,
  xlsMinCellChars:        300,
  // XLS: anomaly marker column
  xlsKeepAnomalyMarker:   false,
  autoExport:             true,
  alwaysOnTop:            true,
  // Log settings
  logAutoExport:          true,
  logDownloadSubfolder:   '',
  logFilename:            '',
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elPageTitle    = $('page-title');
const elBtnScan      = $('btn-scan');
const elBtnStop      = $('btn-stop-scan');
const elProgressWrap = $('scan-progress-wrap');
const elProgressBar  = $('scan-progress-bar');
const elScanStatus   = $('scan-status');
const elMsgList      = $('msg-list');
const elMsgEmpty     = $('msg-empty');
const elCaptureBar   = $('capture-bar');
const elSelCount     = $('sel-count');
const elBtnCapture   = $('btn-capture');
const elExportRow    = $('export-row');

const elBatchUrls      = $('batch-urls');
const elBtnBatchStart  = $('btn-batch-start');
const elBtnBatchCancel = $('btn-batch-cancel');
const elBatchProgWrap  = $('batch-progress-wrap');
const elBatchProgBar   = $('batch-progress-bar');
const elBatchStatus    = $('batch-status');

const elFooter = $('footer-bar');

// ── State ─────────────────────────────────────────────────────────────────────
let currentTabId = null;
let summaries    = [];
let scanning     = false;
let cfg          = { ...CFG_DEFAULTS };
let currentRoles = ['assistant', 'user'];

// ── Utility ───────────────────────────────────────────────────────────────────
const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const pad2    = n => String(n).padStart(2, '0');

function setFooter(msg) { elFooter.textContent = msg; }

async function sendToContent(payload) {
  try {
    if (!currentTabId) throw new Error('找不到目標頁面，請先開啟目標網頁再點擊擴充元件');
    return await chrome.tabs.sendMessage(currentTabId, { ...payload, config: buildConfig() });
  } catch (e) {
    setFooter('無法與頁面通訊：' + e.message);
    return null;
  }
}

async function sendToBg(payload) {
  try   { return await chrome.runtime.sendMessage(payload); }
  catch (e) { setFooter('背景通訊錯誤：' + e.message); return null; }
}

function buildConfig() {
  return {
    selector:               cfg.selector,
    roleAttr:               cfg.roleAttr,
    targetRoles:            cfg.targetRoles.split(',').map(s => s.trim()).filter(Boolean),
    scrollDelay:            Number(cfg.scrollDelay) || 600,
    defaultSelection:       cfg.defaultSelection,
    exportFormat:           cfg.exportFormat,
    exportFilename:         cfg.exportFilename,
    downloadSubfolder:      cfg.downloadSubfolder,
    exportRole:             cfg.exportRole === true,
    xlsPrefix:              cfg.xlsPrefix,
    xlsSuffix:              cfg.xlsSuffix,
    xlsSuffixNewline:       cfg.xlsSuffixNewline !== false,
    xlsCleanTargets:        cfg.xlsCleanTargets.split(',').map(s => s.trim()).filter(Boolean),
    xlsExcludeLines:        cfg.xlsExcludeLines.split('\n').map(s => s.trim()).filter(Boolean),
    xlsPrefixTrimSpaces:    cfg.xlsPrefixTrimSpaces === true,
    xlsColNames:            cfg.xlsColNames ? cfg.xlsColNames.split(',').map(s => s.trim()) : ['標題', '內容'],
    xlsMinCellCharsEnabled: cfg.xlsMinCellCharsEnabled === true,
    xlsMinCellChars:        Number(cfg.xlsMinCellChars) || 300,
    xlsKeepAnomalyMarker:   cfg.xlsKeepAnomalyMarker === true,
    autoExport:             cfg.autoExport !== false,
  };
}

// ── Log system ────────────────────────────────────────────────────────────────
let logs = [];
const expandedLogs = new Set();

function getLogSummary(l) {
  switch (l.type) {
    case 'scan':   return `🔍 掃描完成 · 找到 ${l.count} 則訊息`;
    case 'export': {
      let s = `💾 匯出 ${(l.format || '').toUpperCase()} · ${l.count} 則`;
      if (l.total != null) s += ` （原始 ${l.total}，處理後 ${l.remaining}）`;
      return s;
    }
    case 'batch': {
      const xstats = l.xlsTotal != null ? `（原始 ${l.xlsTotal}，處理後 ${l.xlsRemaining}）` : '';
      return `🔗 批量第 ${l.page}/${l.total} 頁 · ${l.count} 則 ${xstats}`.trim();
    }
    case 'batch-complete': return `✅ 批量完成 · 共 ${l.total} 頁`;
    case 'error':  return `⚠ 錯誤：${l.message}`;
    case 'config': return `⚙ ${l.message}`;
    default:       return JSON.stringify(l).slice(0, 100);
  }
}

function getLogDetails(l) {
  const lines = [];
  if (l.url)   lines.push(`頁面：${l.title || ''}\n      ${l.url}`);
  switch (l.type) {
    case 'scan':
      lines.push(`找到訊息：${l.count} 則`);
      if (l.roles) lines.push(`角色分布：${l.roles}`);
      break;
    case 'export':
      lines.push(`格式：${(l.format || '').toUpperCase()}`);
      if (l.filename) lines.push(`檔案：${l.filename}`);
      lines.push(`匯出筆數：${l.count}`);
      if (l.total != null) {
        lines.push(`原始筆數：${l.total}`);
        lines.push(`處理後筆數：${l.remaining}`);
      }
      if (l.cleanedCells  != null) lines.push(`清除字串儲存格：${l.cleanedCells} 個`);
      if (l.excludedLines != null) lines.push(`排除關鍵字行：${l.excludedLines} 行`);
      if (l.tooShortRows  != null) lines.push(`字數不足刪除：${l.tooShortRows} 筆`);
      break;
    case 'batch':
      lines.push(`批量頁數：第 ${l.page} / ${l.total} 頁`);
      lines.push(`訊息筆數：${l.count}`);
      if (l.xlsTotal      != null) lines.push(`原始筆數：${l.xlsTotal}`);
      if (l.xlsRemaining  != null) lines.push(`處理後筆數：${l.xlsRemaining}`);
      if (l.cleanedCells  != null) lines.push(`清除字串儲存格：${l.cleanedCells} 個`);
      if (l.excludedLines != null) lines.push(`排除關鍵字行：${l.excludedLines} 行`);
      if (l.tooShortRows  != null) lines.push(`字數不足刪除：${l.tooShortRows} 筆`);
      break;
    case 'batch-complete':
      lines.push(`共完成 ${l.total} 頁`);
      break;
    case 'error':
      lines.push(`錯誤內容：${l.message}`);
      break;
  }
  return lines.join('\n');
}

function addLog(entry) {
  const d  = new Date();
  const ts = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  logs.unshift({ ts, ...entry });
  if (logs.length > 500) logs.pop();
  // Shift expanded indices because new item at 0
  const newExpanded = new Set();
  expandedLogs.forEach(i => newExpanded.add(i + 1));
  expandedLogs.clear();
  newExpanded.forEach(i => expandedLogs.add(i));
  renderLogList();
}

function renderLogList() {
  const el = $('log-list');
  if (!el) return;
  if (!logs.length) {
    el.innerHTML = '<div class="empty-hint">尚無日誌記錄</div>';
    return;
  }
  el.innerHTML = logs.map((l, i) => {
    const isExp   = expandedLogs.has(i);
    const summary = escHtml(getLogSummary(l));
    const details = escHtml(getLogDetails(l));
    const errCls  = l.type === 'error' ? ' log-error' : '';
    return `<div class="log-item${errCls}${isExp ? ' expanded' : ''}" data-idx="${i}">
      <div class="log-summary">
        <span class="log-toggle">${isExp ? '▼' : '▶'}</span>
        <span class="log-ts">${escHtml(l.ts)}</span>
        <span class="log-detail">${summary}</span>
      </div>
      <pre class="log-body">${details}</pre>
    </div>`;
  }).join('');

  el.querySelectorAll('.log-item').forEach(item => {
    item.querySelector('.log-summary').addEventListener('click', () => {
      const idx = Number(item.dataset.idx);
      if (expandedLogs.has(idx)) expandedLogs.delete(idx);
      else expandedLogs.add(idx);
      renderLogList();
    });
  });
}

// ── Log export ────────────────────────────────────────────────────────────────
async function doExportLog() {
  if (!logs.length) { setFooter('無日誌可匯出'); return; }
  const lines = logs.map(l =>
    `[${l.ts}] ${getLogSummary(l)}\n${getLogDetails(l)}`
  ).join('\n\n---\n');

  const d   = new Date();
  const D   = `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`;
  const T   = `${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const Ts  = T + pad2(d.getSeconds());
  const base = (cfg.logFilename?.trim() || '$D$T')
    .replace(/\$Ts/g, Ts).replace(/\$T/g, T).replace(/\$D/g, D)
    .replace(/\$M/g, '').replace(/\$K/g, '');
  const safe = ('log-' + base).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + '.txt';
  const subf = (cfg.logDownloadSubfolder || cfg.downloadSubfolder || '').trim().replace(/\/+$/, '');
  const fullName = subf ? `${subf}/${safe}` : safe;

  const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: fullName, saveAs: false });
  } catch {
    const a = Object.assign(document.createElement('a'), { href: url, download: fullName });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setFooter('日誌已匯出：' + safe);
}

async function maybeAutoExportLog() {
  if (cfg.logAutoExport) await doExportLog();
}

$('btn-clear-log').addEventListener('click', () => {
  logs = [];
  expandedLogs.clear();
  renderLogList();
  setFooter('日誌已清除');
});

$('btn-export-log').addEventListener('click', () => doExportLog());

$('btn-save-log-cfg').addEventListener('click', async () => {
  cfg.logAutoExport        = $('cfg-logAutoExport').checked;
  cfg.logDownloadSubfolder = $('cfg-logDownloadSubfolder').value.trim();
  cfg.logFilename          = $('cfg-logFilename').value.trim();
  const stored = await chrome.storage.sync.get('gct_cfg').catch(() => ({}));
  const saved  = { ...(stored.gct_cfg || {}), logAutoExport: cfg.logAutoExport, logDownloadSubfolder: cfg.logDownloadSubfolder, logFilename: cfg.logFilename };
  await chrome.storage.sync.set({ gct_cfg: saved }).catch(() => {});
  setFooter('日誌設定已儲存');
});

// ── doExport: popup handles download (supports downloadSubfolder) ─────────────
async function doExport(format) {
  const res = await sendToContent({ type: 'DO_EXPORT', format });
  if (!res?.ok) return;

  if (format === 'clipboard') {
    setFooter(`已複製至剪貼簿（${res.count} 則）`);
    addLog({ type: 'export', format, count: res.count, url: res.url, title: res.title });
    await maybeAutoExportLog();
    return;
  }

  if (!res.content || !res.filename) { setFooter('匯出失敗：無內容'); return; }

  const subf     = (cfg.downloadSubfolder || '').trim().replace(/\/+$/, '');
  const fullName = subf ? `${subf}/${res.filename}` : res.filename;
  const blob     = new Blob([res.content], { type: res.mime });
  const url      = URL.createObjectURL(blob);

  try {
    await chrome.downloads.download({ url, filename: fullName, saveAs: false });
  } catch {
    const a = Object.assign(document.createElement('a'), { href: url, download: fullName });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  const stats = (format === 'xls' && res.total != null)
    ? ` （原始 ${res.total}，處理後 ${res.remaining}）` : '';
  setFooter(`已匯出 ${res.count} 則（${format.toUpperCase()}）${stats}`);
  addLog({
    type:          'export',
    format,
    count:         res.count,
    filename:      res.filename,
    total:         res.total,
    remaining:     res.remaining,
    cleanedCells:  res.cleanedCells,
    excludedLines: res.excludedLines,
    tooShortRows:  res.tooShortRows,
    url:           res.url,
    title:         res.title,
  });
  await maybeAutoExportLog();
}

// ── Role-aware UI refresh ─────────────────────────────────────────────────────
function updateRoleUI(preserveSelection) {
  const roles = cfg.targetRoles.split(',').map(s => s.trim()).filter(Boolean);
  currentRoles = roles;

  const btn0 = $('qs-role0');
  const btn1 = $('qs-role1');
  btn0.textContent   = roles[0] ? `僅選 ${roles[0]}` : '僅選 role0';
  btn0.style.display = '';
  if (roles[1]) {
    btn1.textContent   = `僅選 ${roles[1]}`;
    btn1.style.display = '';
  } else {
    btn1.style.display = 'none';
  }

  const sel  = $('cfg-defaultSelection');
  const prev = preserveSelection !== undefined ? preserveSelection : sel.value;
  sel.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('')
    + '<option value="all">全部</option>'
    + '<option value="none">不選取</option>';
  const valid = [...sel.options].some(o => o.value === prev);
  sel.value = valid ? prev : (roles[0] || 'all');
}

$('cfg-targetRoles').addEventListener('input', () => {
  cfg.targetRoles = $('cfg-targetRoles').value;
  updateRoleUI();
});

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// ── Helper: resolve the target tab robustly ───────────────────────────────────
async function resolveTargetTab() {
  let tab = null;
  if (IS_PINNED) {
    try {
      const s = await chrome.storage.session.get('gct_target_tab');
      if (s.gct_target_tab) tab = await chrome.tabs.get(s.gct_target_tab);
    } catch {}
  } else {
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = t;
    } catch {}
  }
  // Fallback: last focused normal window's active tab
  if (!tab) {
    try {
      const [t] = await chrome.tabs.query({ active: true, windowType: 'normal', lastFocusedWindow: true });
      tab = t;
    } catch {}
  }
  return tab;
}

// ── Restart button: reload the extension popup from scratch ──────────────────
$('btn-refresh-tab').addEventListener('click', () => {
  location.reload();
});

// ── Pin toggle button ─────────────────────────────────────────────────────────
function updatePinButton() {
  const btn = $('btn-pin-toggle');
  if (!btn) return;
  const active = cfg.alwaysOnTop !== false;
  btn.classList.toggle('pin-active', active);
  btn.title = `置頂：${active ? '開啟' : '關閉'}（點擊切換）`;
}

$('btn-pin-toggle')?.addEventListener('click', async () => {
  cfg.alwaysOnTop = !cfg.alwaysOnTop;
  // Persist immediately
  const stored = await chrome.storage.sync.get('gct_cfg').catch(() => ({}));
  const saved  = { ...(stored.gct_cfg || {}), alwaysOnTop: cfg.alwaysOnTop };
  await chrome.storage.sync.set({ gct_cfg: saved }).catch(() => {});
  updatePinButton();

  if (cfg.alwaysOnTop && !IS_PINNED) {
    // Re-open as pinned window
    try {
      await chrome.storage.session.set({ gct_target_tab: currentTabId });
    } catch {}
    const stored2 = await chrome.storage.session.get('gct_popup_win').catch(() => ({}));
    if (stored2.gct_popup_win) {
      try {
        await chrome.windows.update(stored2.gct_popup_win, { focused: true });
        window.close();
        return;
      } catch {}
    }
    try {
      const win = await chrome.windows.create({
        url:     chrome.runtime.getURL('popup/popup.html?pin=1'),
        type:    'popup',
        width:   500,
        height:  620,
        top:     60,
        left:    Math.max(0, screen.availWidth - 420),
        focused: true,
      });
      await chrome.storage.session.set({ gct_popup_win: win.id });
    } catch {}
    window.close();
    return;
  }

  setFooter(`置頂已${cfg.alwaysOnTop ? '開啟，下次點擊圖示生效' : '關閉，下次點擊圖示生效'}`);
});

// ── Render message list ────────────────────────────────────────────────────────
function renderMsgList() {
  if (!summaries.length) {
    elMsgList.classList.add('hidden');
    elMsgEmpty.classList.remove('hidden');
    elCaptureBar.classList.add('hidden');
    elExportRow.classList.add('hidden');
    return;
  }
  elMsgEmpty.classList.add('hidden');
  elMsgList.classList.remove('hidden');
  elCaptureBar.classList.remove('hidden');

  elMsgList.innerHTML = summaries.map(m => {
    const ri  = currentRoles.indexOf(m.role);
    const cls = ri === 0 ? 'badge-user' : ri === 1 ? 'badge-asst' : 'badge-other';
    return `<div class="msg-item${m.selected ? ' selected' : ''}" data-idx="${m.index}">
      <input type="checkbox" ${m.selected ? 'checked' : ''} data-idx="${m.index}">
      <span class="msg-badge ${cls}">${m.role}</span>
      <span class="msg-preview">#${m.index} ${m.preview}</span>
    </div>`;
  }).join('');

  updateSelCount();

  elMsgList.querySelectorAll('.msg-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return;
      const cb = row.querySelector('input[type=checkbox]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });
  elMsgList.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const item = summaries.find(m => m.index === Number(cb.dataset.idx));
      if (item) item.selected = cb.checked;
      cb.closest('.msg-item').classList.toggle('selected', cb.checked);
      updateSelCount();
    });
  });
}

function updateSelCount() {
  elSelCount.textContent = `已選 ${summaries.filter(m => m.selected).length} 筆`;
}

// ── Quick-select ──────────────────────────────────────────────────────────────
$('qs-role0').addEventListener('click', () => setSelection(m => m.role === currentRoles[0]));
$('qs-role1').addEventListener('click', () => setSelection(m => m.role === currentRoles[1]));
$('qs-all'  ).addEventListener('click', () => setSelection(() => true));
$('qs-none' ).addEventListener('click', () => setSelection(() => false));

function setSelection(pred) {
  summaries.forEach(m => m.selected = pred(m));
  renderMsgList();
}

// ── Scan ──────────────────────────────────────────────────────────────────────
elBtnScan.addEventListener('click', async () => {
  if (scanning) return;
  if (!currentTabId) {
    setFooter('找不到目標頁面，請先點擊🔄重新整理');
    return;
  }
  scanning = true;
  elBtnScan.disabled = true;
  elBtnStop.disabled = false;
  elProgressWrap.classList.remove('hidden');
  elProgressBar.style.width = '0%';
  elScanStatus.textContent  = '掃描中…';
  setFooter('掃描中，請稍候…');

  // Ensure content script is loaded (handles freshly-opened / post-update tabs)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      files:  ['content/content.js'],
    });
  } catch { /* already injected or restricted page – proceed anyway */ }

  const storageKey = 'gct_tab_' + currentTabId;
  const watcher = changes => {
    const c = changes[storageKey];
    if (!c?.newValue) return;
    const v = c.newValue;
    if (v.status === 'scanning') {
      elProgressBar.style.width = (v.pct || 0) + '%';
      elScanStatus.textContent  = `掃描中… ${v.pct || 0}%（已找到 ${v.count || 0} 則）`;
    }
    if (v.status === 'done') {
      chrome.storage.session.onChanged.removeListener(watcher);
      summaries = v.summaries || [];
      scanFinished();
    }
  };
  chrome.storage.session.onChanged.addListener(watcher);

  const res = await sendToContent({ type: 'DO_SCAN' });
  if (!res) {
    chrome.storage.session.onChanged.removeListener(watcher);
    scanFinished();
    setFooter('掃描失敗，請確認頁面已完全載入');
    addLog({ type: 'error', message: '掃描失敗' });
  }
});

elBtnStop.addEventListener('click', async () => {
  await sendToContent({ type: 'STOP_SCAN' });
  setFooter('已停止掃描');
});

function scanFinished() {
  scanning = false;
  elBtnScan.disabled = false;
  elBtnStop.disabled = true;
  elProgressBar.style.width = '100%';
  elScanStatus.textContent  = `掃描完成，共 ${summaries.length} 則訊息`;
  setFooter(`找到 ${summaries.length} 則訊息`);
  renderMsgList();
  addLog({ type: 'scan', count: summaries.length });

  if (cfg.autoExport && summaries.length) autoExportCapture();
}

async function autoExportCapture() {
  let indices;
  if (cfg.defaultSelection === 'none') return;
  if (cfg.defaultSelection === 'all') {
    indices = summaries.map(m => m.index);
  } else {
    indices = summaries.filter(m => m.role === cfg.defaultSelection).map(m => m.index);
  }
  if (!indices.length) return;

  const r1 = await sendToContent({ type: 'SET_SELECTION', indices });
  if (!r1?.ok) return;
  summaries.forEach(m => m.selected = indices.includes(m.index));
  renderMsgList();

  await doExport(cfg.exportFormat);
  elExportRow.classList.remove('hidden');
}

// ── Confirm selection ─────────────────────────────────────────────────────────
elBtnCapture.addEventListener('click', async () => {
  const indices = summaries.filter(m => m.selected).map(m => m.index);
  if (!indices.length) { setFooter('請先勾選要捕獲的訊息'); return; }
  const res = await sendToContent({ type: 'SET_SELECTION', indices });
  if (res?.ok) {
    elExportRow.classList.remove('hidden');
    setFooter(`已確認選取 ${indices.length} 則，可進行匯出`);
  }
});

// ── Export buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-export').forEach(btn => {
  btn.addEventListener('click', () => doExport(btn.dataset.fmt));
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
async function toggleSidebar() {
  const res = await sendToContent({ type: 'TOGGLE_SIDEBAR' });
  if (res) {
    const open = res.sidebarOpen;
    $('btn-sidebar-bottom').textContent = open ? '📕 關閉閱讀模式' : '📖 閱讀模式瀏覽';
    setFooter(open ? '側邊閱讀模式已開啟' : '側邊閱讀模式已關閉');
  }
}
$('btn-sidebar-bottom').addEventListener('click', toggleSidebar);

// ── Batch ─────────────────────────────────────────────────────────────────────
elBtnBatchStart.addEventListener('click', async () => {
  const raw  = elBatchUrls.value.trim();
  const urls = raw.split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
  if (!urls.length) { setFooter('請輸入至少一個有效 URL'); return; }

  elBtnBatchStart.classList.add('hidden');
  elBtnBatchCancel.classList.remove('hidden');
  elBatchProgWrap.classList.remove('hidden');
  elBatchProgBar.style.width = '0%';
  elBatchStatus.textContent  = `批量啟動中，共 ${urls.length} 頁…`;
  setFooter(`批量掃描：0 / ${urls.length}`);

  const res = await sendToBg({ type: 'START_BATCH', urls, config: buildConfig(), tabId: currentTabId });
  if (res?.ok) {
    monitorBatch(res.total);
  } else {
    resetBatchUI();
    setFooter('批量啟動失敗：' + (res?.error || '未知錯誤'));
    addLog({ type: 'error', message: '批量啟動失敗：' + (res?.error || '') });
  }
});

elBtnBatchCancel.addEventListener('click', async () => {
  await sendToBg({ type: 'CANCEL_BATCH' });
  resetBatchUI();
  setFooter('批量已取消');
});

function resetBatchUI() {
  elBtnBatchStart.classList.remove('hidden');
  elBtnBatchCancel.classList.add('hidden');
  elBatchProgWrap.classList.add('hidden');
}

function monitorBatch(total) {
  let lastDoneIdx = 0;
  const interval = setInterval(async () => {
    const bRes  = await sendToBg({ type: 'GET_BATCH_STATE' });
    const batch = bRes?.batch;
    if (!batch) { clearInterval(interval); resetBatchUI(); return; }

    const done = batch.doneIdx || 0;

    if (batch.done) {
      elBatchProgBar.style.width = '100%';
      elBatchStatus.textContent  = `✅ 批量完成！共 ${total} 頁，每頁已自動匯出`;
      clearInterval(interval);
      resetBatchUI();
      setFooter(`批量完成 ${total} 頁`);
      // Log any remaining completed pages then final summary
      const completedPages = batch.completedPages || [];
      while (lastDoneIdx < completedPages.length) {
        const p = completedPages[lastDoneIdx++];
        addLog({
          type:          'batch',
          page:          p.pageNum,
          total,
          count:         p.exportStats?.count      || 0,
          xlsTotal:      p.exportStats?.total,
          xlsRemaining:  p.exportStats?.remaining,
          cleanedCells:  p.exportStats?.cleanedCells,
          excludedLines: p.exportStats?.excludedLines,
          tooShortRows:  p.exportStats?.tooShortRows,
          url:           p.url,
          title:         p.title,
        });
      }
      addLog({ type: 'batch-complete', total });
      await maybeAutoExportLog();
      return;
    }

    // Log newly completed pages as soon as completedPages array grows
    const completedPages = batch.completedPages || [];
    while (lastDoneIdx < done && lastDoneIdx < completedPages.length) {
      const p = completedPages[lastDoneIdx++];
      addLog({
        type:          'batch',
        page:          p.pageNum,
        total,
        count:         p.exportStats?.count      || 0,
        xlsTotal:      p.exportStats?.total,
        xlsRemaining:  p.exportStats?.remaining,
        cleanedCells:  p.exportStats?.cleanedCells,
        excludedLines: p.exportStats?.excludedLines,
        tooShortRows:  p.exportStats?.tooShortRows,
        url:           p.url,
        title:         p.title,
      });
    }

    const tabRes    = await sendToBg({ type: 'GET_TAB_STATE', tabId: currentTabId });
    const tabStatus = tabRes?.status;
    const current   = done + 1;

    if (tabStatus === 'scanning') {
      const pct   = tabRes.pct   || 0;
      const count = tabRes.count || 0;
      const combined = Math.round(((done + pct / 100) / total) * 100);
      elBatchProgBar.style.width = combined + '%';
      elBatchStatus.textContent  = `掃描中… ${pct}%（已找到 ${count} 則）進行第 ${current} 頁 / 共 ${total} 頁`;
      setFooter(`第 ${current}/${total} 頁  掃描 ${pct}%`);
    } else if (tabStatus === 'done') {
      const pct = Math.round((done / total) * 100);
      elBatchProgBar.style.width = pct + '%';
      elBatchStatus.textContent  = `第 ${done} 頁完成，等待跳轉至第 ${current} 頁…（${done}/${total}）`;
      setFooter(`已完成 ${done}/${total} 頁，準備跳轉…`);
    } else {
      const pct = Math.round((done / total) * 100);
      elBatchProgBar.style.width = pct + '%';
      elBatchStatus.textContent  = `正在載入第 ${current} 頁…（${done}/${total} 頁已完成）`;
      setFooter(`批量：${done}/${total} 頁`);
    }
  }, 800);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await chrome.storage.sync.get('gct_cfg');
  cfg = { ...CFG_DEFAULTS, ...(stored.gct_cfg || {}) };
  applySettingsToUI();
}

function applySettingsToUI() {
  $('cfg-selector').value              = cfg.selector;
  $('cfg-roleAttr').value              = cfg.roleAttr;
  $('cfg-targetRoles').value           = cfg.targetRoles;
  $('cfg-scrollDelay').value           = cfg.scrollDelay;
  $('cfg-exportFormat').value          = cfg.exportFormat;
  $('cfg-exportFilename').value        = cfg.exportFilename;
  $('cfg-downloadSubfolder').value     = cfg.downloadSubfolder || '';
  $('cfg-exportRole').checked          = cfg.exportRole === true;
  $('cfg-xlsColNames').value           = cfg.xlsColNames || '標題,內容';
  $('cfg-xlsPrefix').value             = cfg.xlsPrefix;
  $('cfg-xlsSuffix').value             = cfg.xlsSuffix;
  $('cfg-xlsSuffixNewline').checked    = cfg.xlsSuffixNewline !== false;
  $('cfg-xlsPrefixTrimSpaces').checked = cfg.xlsPrefixTrimSpaces !== false;
  $('cfg-xlsCleanTargets').value       = cfg.xlsCleanTargets;
  $('cfg-xlsExcludeLines').value       = cfg.xlsExcludeLines;
  $('cfg-xlsMinCellCharsEnabled').checked = cfg.xlsMinCellCharsEnabled !== false;
  $('cfg-xlsMinCellChars').value       = cfg.xlsMinCellChars;
  $('cfg-xlsKeepAnomalyMarker').checked = cfg.xlsKeepAnomalyMarker === true;
  $('cfg-autoExport').checked          = cfg.autoExport !== false;
  $('cfg-logAutoExport').checked       = cfg.logAutoExport === true;
  $('cfg-logDownloadSubfolder').value  = cfg.logDownloadSubfolder || '';
  $('cfg-logFilename').value           = cfg.logFilename || '';
  updateRoleUI(cfg.defaultSelection);
  updatePinButton();
}

function readSettingsFromUI() {
  return {
    selector:               $('cfg-selector').value.trim(),
    roleAttr:               $('cfg-roleAttr').value.trim(),
    targetRoles:            $('cfg-targetRoles').value.trim(),
    scrollDelay:            Number($('cfg-scrollDelay').value) || 350,
    defaultSelection:       $('cfg-defaultSelection').value,
    exportFormat:           $('cfg-exportFormat').value,
    exportFilename:         $('cfg-exportFilename').value.trim(),
    downloadSubfolder:      $('cfg-downloadSubfolder').value.trim(),
    exportRole:             $('cfg-exportRole').checked,
    xlsColNames:            $('cfg-xlsColNames').value.trim() || '標題,內容',
    xlsPrefix:              $('cfg-xlsPrefix').value,
    xlsSuffix:              $('cfg-xlsSuffix').value,
    xlsSuffixNewline:       $('cfg-xlsSuffixNewline').checked,
    xlsPrefixTrimSpaces:    $('cfg-xlsPrefixTrimSpaces').checked,
    xlsCleanTargets:        $('cfg-xlsCleanTargets').value.trim(),
    xlsExcludeLines:        $('cfg-xlsExcludeLines').value,
    xlsMinCellCharsEnabled: $('cfg-xlsMinCellCharsEnabled').checked,
    xlsMinCellChars:        Number($('cfg-xlsMinCellChars').value) || 300,
    xlsKeepAnomalyMarker:   $('cfg-xlsKeepAnomalyMarker').checked,
    autoExport:             $('cfg-autoExport').checked,
    logAutoExport:          $('cfg-logAutoExport').checked,
    logDownloadSubfolder:   $('cfg-logDownloadSubfolder').value.trim(),
    logFilename:            $('cfg-logFilename').value.trim(),
    alwaysOnTop:            cfg.alwaysOnTop,  // preserved from pin button, not a form field
  };
}

$('btn-save-cfg').addEventListener('click', async () => {
  cfg = readSettingsFromUI();
  await chrome.storage.sync.set({ gct_cfg: cfg });
  updateRoleUI(cfg.defaultSelection);
  setFooter('設定已儲存');
  addLog({ type: 'config', message: '設定已儲存' });
});

$('btn-reset-cfg').addEventListener('click', async () => {
  cfg = { ...CFG_DEFAULTS };
  await chrome.storage.sync.set({ gct_cfg: cfg });
  applySettingsToUI();
  setFooter('設定已重置為預設值');
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  updatePinButton();

  // ── Auto-popout if alwaysOnTop ────────────────────────────────────────────
  if (cfg.alwaysOnTop && !IS_PINNED) {
    try {
      // Use active tab from current window (standard popup context) or last focused normal window
      let tabForPin = null;
      try {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabForPin = t;
      } catch {}
      if (!tabForPin) {
        const [t] = await chrome.tabs.query({ active: true, windowType: 'normal', lastFocusedWindow: true }).catch(() => []);
        tabForPin = t;
      }
      if (tabForPin) await chrome.storage.session.set({ gct_target_tab: tabForPin.id });
    } catch {}

    const stored = await chrome.storage.session.get('gct_popup_win').catch(() => ({}));
    if (stored.gct_popup_win) {
      try {
        await chrome.windows.update(stored.gct_popup_win, { focused: true, drawAttention: true });
        window.close();
        return;
      } catch {}
    }

    try {
      const win = await chrome.windows.create({
        url:     chrome.runtime.getURL('popup/popup.html?pin=1'),
        type:    'popup',
        width:   500,
        height:  620,
        top:     60,
        left:    Math.max(0, screen.availWidth - 420),
        focused: true,
      });
      await chrome.storage.session.set({ gct_popup_win: win.id });
    } catch {}
    window.close();
    return;
  }

  // ── Pinned window setup ───────────────────────────────────────────────────
  if (IS_PINNED) {
    document.body.classList.add('pinned');
    const closeEl = $('btn-close-panel');
    if (closeEl) closeEl.style.display = 'none';
    window.addEventListener('beforeunload', () => {
      chrome.storage.session.remove('gct_popup_win').catch(() => {});
    });
  }

  // ── Resolve target tab (with fallback) ───────────────────────────────────
  try {
    const tab = await resolveTargetTab();
    if (tab) {
      currentTabId = tab.id;
      elPageTitle.textContent = tab.title || '未知頁面';
      elPageTitle.title       = tab.url   || '';
      // Keep session storage in sync for pinned window
      if (IS_PINNED) await chrome.storage.session.set({ gct_target_tab: tab.id }).catch(() => {});
    }
  } catch {}

  // ── Restore previous scan state ───────────────────────────────────────────
  const state = await sendToBg({ type: 'GET_TAB_STATE', tabId: currentTabId });
  if (state?.status === 'done' && state.summaries?.length) {
    summaries = state.summaries;
    renderMsgList();
    elScanStatus.textContent = `上次掃描：${summaries.length} 則訊息`;
    elBtnSidebar.disabled    = false;
    setFooter(`已載入上次掃描結果（${summaries.length} 則）`);
  }

  // ── Resume batch UI ───────────────────────────────────────────────────────
  const bRes  = await sendToBg({ type: 'GET_BATCH_STATE' });
  const batch = bRes?.batch;
  if (batch && !batch.done) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      if (b.dataset.tab === 'batch') b.click();
    });
    elBtnBatchStart.classList.add('hidden');
    elBtnBatchCancel.classList.remove('hidden');
    elBatchProgWrap.classList.remove('hidden');
    monitorBatch(batch.total);
  }
}

// ── Close button ──────────────────────────────────────────────────────────────
$('btn-close-panel')?.addEventListener('click', () => window.close());

init();
