'use strict';

// ── Pinned-window detection ────────────────────────────────────────────────────
const IS_PINNED = new URLSearchParams(location.search).get('pin') === '1';

// ── Default config ─────────────────────────────────────────────────────────────
const XLS_EXCLUDE_DEFAULT = [
  '已思考','推理花了','好的','好的！','可以！以下',
  '新的標題與內容','新的標題與知識','當然可以','http','標題：',
].join('\n');

const CFG_DEFAULTS = {
  selector:               '[data-message-author-role]',
  roleAttr:               'data-message-author-role',
  targetRoles:            'assistant,user',
  scrollDelay:            600,
  defaultSelection:       'assistant',
  exportFormat:           'xls',
  exportFilename:         '',            // supports $D $T $Ts $M $K tokens
  downloadSubfolder:      '',
  exportRole:             false,
  // XLS: first-column extraction
  xlsPrefix:              '|標題：',
  xlsSuffix:              '|',
  xlsSuffixNewline:       true,
  // XLS: remove exact substrings
  xlsCleanTargets:        '標題：',
  // XLS: remove lines containing keywords (newline-separated)
  xlsExcludeLines:        XLS_EXCLUDE_DEFAULT,
  // XLS: minimum cell chars
  xlsMinCellCharsEnabled: false,
  xlsMinCellChars:        10,
  // XLS: anomaly marker column
  xlsKeepAnomalyMarker:   false,
  showIndex:              true,
  autoExport:             true,
  alwaysOnTop:            true,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const elPageTitle    = $('page-title');
const elBtnScan      = $('btn-scan');
const elBtnStop      = $('btn-stop-scan');
const elBtnSidebar   = $('btn-sidebar');
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
    xlsMinCellCharsEnabled: cfg.xlsMinCellCharsEnabled === true,
    xlsMinCellChars:        Number(cfg.xlsMinCellChars) || 10,
    xlsKeepAnomalyMarker:   cfg.xlsKeepAnomalyMarker === true,
    showIndex:              cfg.showIndex,
    autoExport:             cfg.autoExport !== false,
  };
}

// ── Log system ────────────────────────────────────────────────────────────────
let logs = [];

function addLog(entry) {
  const d  = new Date();
  const ts = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  logs.unshift({ ts, ...entry });
  if (logs.length > 500) logs.pop();
  renderLogList();
}

function renderLogList() {
  const el = $('log-list');
  if (!el) return;
  if (!logs.length) {
    el.innerHTML = '<div class="empty-hint">尚無日誌記錄</div>';
    return;
  }
  el.innerHTML = logs.map(l => {
    let detail = '';
    switch (l.type) {
      case 'scan':
        detail = `掃描完成 · 找到 ${l.count} 則`; break;
      case 'export': {
        detail = `匯出 ${(l.format || '').toUpperCase()} · ${l.count} 則`;
        if (l.total != null) detail += ` （原始 ${l.total} 筆，處理後 ${l.remaining} 筆）`;
        break;
      }
      case 'batch':
        detail = `批量 · 第 ${l.page}/${l.total} 頁 · ${l.count} 則`; break;
      case 'error':
        detail = `⚠ 錯誤：${l.message}`; break;
      default:
        detail = JSON.stringify(l).slice(0, 120);
    }
    const cls = l.type === 'error' ? ' log-error' : '';
    return `<div class="log-item${cls}">
      <span class="log-ts">${escHtml(l.ts)}</span>
      <span class="log-detail">${escHtml(detail)}</span>
    </div>`;
  }).join('');
}

$('btn-clear-log').addEventListener('click', () => {
  logs = [];
  renderLogList();
  setFooter('日誌已清除');
});

$('btn-export-log').addEventListener('click', () => {
  if (!logs.length) { setFooter('無日誌可匯出'); return; }
  const lines = logs.map(l => `[${l.ts}] [${l.type}] ${JSON.stringify(l)}`).join('\n');
  const blob  = new Blob([lines], { type: 'text/plain;charset=utf-8' });
  const url   = URL.createObjectURL(blob);
  const d     = new Date();
  const fname = `gct_log_${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}.txt`;
  const a     = Object.assign(document.createElement('a'), { href: url, download: fname });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setFooter('日誌已匯出：' + fname);
});

// ── doExport: popup handles download (supports downloadSubfolder) ─────────────
async function doExport(format) {
  const res = await sendToContent({ type: 'DO_EXPORT', format });
  if (!res?.ok) return;

  if (format === 'clipboard') {
    setFooter(`已複製至剪貼簿（${res.count} 則）`);
    addLog({ type: 'export', format, count: res.count });
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
    ? ` （原始 ${res.total} 筆，處理後 ${res.remaining} 筆）` : '';
  setFooter(`已匯出 ${res.count} 則（${format.toUpperCase()}）${stats}`);
  addLog({ type: 'export', format, count: res.count, total: res.total, remaining: res.remaining });
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

// ── Refresh tab info button ───────────────────────────────────────────────────
$('btn-refresh-tab').addEventListener('click', async () => {
  try {
    let tab;
    if (IS_PINNED) {
      const s = await chrome.storage.session.get('gct_target_tab');
      if (s.gct_target_tab) tab = await chrome.tabs.get(s.gct_target_tab);
    } else {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = t;
    }
    if (tab) {
      currentTabId = tab.id;
      elPageTitle.textContent = tab.title || '未知頁面';
      elPageTitle.title       = tab.url   || '';
      setFooter('頁面資訊已更新：' + (tab.title || tab.url));
    }
  } catch (e) {
    setFooter('重新整理失敗：' + e.message);
  }
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
  scanning = true;
  elBtnScan.disabled = true;
  elBtnStop.disabled = false;
  elProgressWrap.classList.remove('hidden');
  elProgressBar.style.width = '0%';
  elScanStatus.textContent  = '掃描中…';
  setFooter('掃描中，請稍候…');

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
  elBtnSidebar.disabled = summaries.length === 0;
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
  elBtnSidebar.disabled = false;
}

// ── Confirm selection ─────────────────────────────────────────────────────────
elBtnCapture.addEventListener('click', async () => {
  const indices = summaries.filter(m => m.selected).map(m => m.index);
  if (!indices.length) { setFooter('請先勾選要捕獲的訊息'); return; }
  const res = await sendToContent({ type: 'SET_SELECTION', indices });
  if (res?.ok) {
    elExportRow.classList.remove('hidden');
    elBtnSidebar.disabled = false;
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
    elBtnSidebar.textContent             = open ? '📕' : '📖';
    $('btn-sidebar-bottom').textContent  = open ? '📕 關閉' : '📖 閱讀';
    setFooter(open ? '側邊閱讀模式已開啟' : '側邊閱讀模式已關閉');
  }
}
elBtnSidebar.addEventListener('click', toggleSidebar);
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
      addLog({ type: 'batch', page: total, total, count: 0 });
      return;
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
  $('cfg-xlsPrefix').value             = cfg.xlsPrefix;
  $('cfg-xlsSuffix').value             = cfg.xlsSuffix;
  $('cfg-xlsSuffixNewline').checked    = cfg.xlsSuffixNewline !== false;
  $('cfg-xlsCleanTargets').value       = cfg.xlsCleanTargets;
  $('cfg-xlsExcludeLines').value       = cfg.xlsExcludeLines;
  $('cfg-xlsMinCellCharsEnabled').checked = cfg.xlsMinCellCharsEnabled === true;
  $('cfg-xlsMinCellChars').value       = cfg.xlsMinCellChars;
  $('cfg-xlsKeepAnomalyMarker').checked = cfg.xlsKeepAnomalyMarker === true;
  $('cfg-showIndex').checked           = cfg.showIndex;
  $('cfg-autoExport').checked          = cfg.autoExport !== false;
  $('cfg-alwaysOnTop').checked         = cfg.alwaysOnTop !== false;
  updateRoleUI(cfg.defaultSelection);
}

function readSettingsFromUI() {
  return {
    selector:               $('cfg-selector').value.trim(),
    roleAttr:               $('cfg-roleAttr').value.trim(),
    targetRoles:            $('cfg-targetRoles').value.trim(),
    scrollDelay:            Number($('cfg-scrollDelay').value) || 600,
    defaultSelection:       $('cfg-defaultSelection').value,
    exportFormat:           $('cfg-exportFormat').value,
    exportFilename:         $('cfg-exportFilename').value.trim(),
    downloadSubfolder:      $('cfg-downloadSubfolder').value.trim(),
    exportRole:             $('cfg-exportRole').checked,
    xlsPrefix:              $('cfg-xlsPrefix').value,
    xlsSuffix:              $('cfg-xlsSuffix').value,
    xlsSuffixNewline:       $('cfg-xlsSuffixNewline').checked,
    xlsCleanTargets:        $('cfg-xlsCleanTargets').value.trim(),
    xlsExcludeLines:        $('cfg-xlsExcludeLines').value,
    xlsMinCellCharsEnabled: $('cfg-xlsMinCellCharsEnabled').checked,
    xlsMinCellChars:        Number($('cfg-xlsMinCellChars').value) || 10,
    xlsKeepAnomalyMarker:   $('cfg-xlsKeepAnomalyMarker').checked,
    showIndex:              $('cfg-showIndex').checked,
    autoExport:             $('cfg-autoExport').checked,
    alwaysOnTop:            $('cfg-alwaysOnTop').checked,
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

  // ── Auto-popout if alwaysOnTop ────────────────────────────────────────────
  if (cfg.alwaysOnTop && !IS_PINNED) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.storage.session.set({ gct_target_tab: tab.id });
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
    const pinEl   = $('pin-indicator');
    const closeEl = $('btn-close-panel');
    if (pinEl)   pinEl.classList.remove('hidden');
    if (closeEl) closeEl.style.display = 'none';
    window.addEventListener('beforeunload', () => {
      chrome.storage.session.remove('gct_popup_win').catch(() => {});
    });
  }

  // ── Resolve target tab ────────────────────────────────────────────────────
  try {
    let tab;
    if (IS_PINNED) {
      const s = await chrome.storage.session.get('gct_target_tab');
      if (s.gct_target_tab) tab = await chrome.tabs.get(s.gct_target_tab);
    } else {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = t;
    }
    if (tab) {
      currentTabId = tab.id;
      elPageTitle.textContent = tab.title || '未知頁面';
      elPageTitle.title       = tab.url   || '';
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
