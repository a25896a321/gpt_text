'use strict';

// ── Default config ─────────────────────────────────────────────────────────────
const CFG_DEFAULTS = {
  selector:         '[data-message-author-role]',
  roleAttr:         'data-message-author-role',
  targetRoles:      'user,assistant',
  scrollDelay:      600,
  defaultSelection: 'assistant',
  exportFormat:     'xls',
  exportFilename:   '',
  xlsDelim:         '|',
  xlsCleanTargets:  '標題：',
  showIndex:        true,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Scan tab
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

// Batch tab
const elBatchUrls    = $('batch-urls');
const elBtnBatchStart  = $('btn-batch-start');
const elBtnBatchCancel = $('btn-batch-cancel');
const elBatchProgWrap  = $('batch-progress-wrap');
const elBatchProgBar   = $('batch-progress-bar');
const elBatchStatus    = $('batch-status');

// Footer
const elFooter       = $('footer-bar');

// ── State ─────────────────────────────────────────────────────────────────────
let currentTabId    = null;
let summaries       = [];   // [{ role, preview, index, selected }]
let capturedIndices = [];   // indices confirmed by user
let scanning        = false;
let cfg             = { ...CFG_DEFAULTS };

// ── Helpers ──────────────────────────────────────────────────────────────────
function setFooter(msg) { elFooter.textContent = msg; }

async function sendToContent(payload) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await chrome.tabs.sendMessage(tab.id, { ...payload, config: buildConfig() });
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
    selector:         cfg.selector,
    roleAttr:         cfg.roleAttr,
    targetRoles:      cfg.targetRoles.split(',').map(s => s.trim()).filter(Boolean),
    scrollDelay:      Number(cfg.scrollDelay) || 600,
    defaultSelection: cfg.defaultSelection,
    exportFormat:     cfg.exportFormat,
    exportFilename:   cfg.exportFilename,
    xlsDelim:         cfg.xlsDelim || '|',
    xlsCleanTargets:  cfg.xlsCleanTargets.split(',').map(s => s.trim()).filter(Boolean),
    showIndex:        cfg.showIndex,
  };
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
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
    const badgeCls = m.role === 'user' ? 'badge-user' : m.role === 'assistant' ? 'badge-asst' : 'badge-other';
    const label    = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'GPT' : m.role;
    const checked  = m.selected ? 'checked' : '';
    return `<div class="msg-item${m.selected ? ' selected' : ''}" data-idx="${m.index}">
      <input type="checkbox" ${checked} data-idx="${m.index}">
      <span class="msg-badge ${badgeCls}">${label}</span>
      <span class="msg-preview">#${m.index} ${m.preview}</span>
    </div>`;
  }).join('');

  updateSelCount();

  // Toggle checkbox on row click
  elMsgList.querySelectorAll('.msg-item').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return; // handled by change
      const cb = row.querySelector('input[type=checkbox]');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });
  elMsgList.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx  = Number(cb.dataset.idx);
      const item = summaries.find(m => m.index === idx);
      if (item) item.selected = cb.checked;
      cb.closest('.msg-item').classList.toggle('selected', cb.checked);
      updateSelCount();
    });
  });
}

function updateSelCount() {
  const n = summaries.filter(m => m.selected).length;
  elSelCount.textContent = `已選 ${n} 筆`;
}

// ── Quick-select shortcuts ─────────────────────────────────────────────────────
$('qs-user').addEventListener('click', () => setSelection(m => m.role === 'user'));
$('qs-asst').addEventListener('click', () => setSelection(m => m.role === 'assistant'));
$('qs-all' ).addEventListener('click', () => setSelection(() => true));
$('qs-none').addEventListener('click', () => setSelection(() => false));

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

  // Listen for progress via storage changes
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
      summaries = (v.summaries || []);
      scanFinished();
    }
  };
  chrome.storage.session.onChanged.addListener(watcher);

  const res = await sendToContent({ type: 'DO_SCAN' });
  if (!res) {
    chrome.storage.session.onChanged.removeListener(watcher);
    scanFinished();
    setFooter('掃描失敗，請確認頁面已完全載入');
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
}

// ── Confirm selection (capture) ───────────────────────────────────────────────
elBtnCapture.addEventListener('click', async () => {
  const indices = summaries.filter(m => m.selected).map(m => m.index);
  if (!indices.length) { setFooter('請先勾選要捕獲的訊息'); return; }

  const res = await sendToContent({ type: 'SET_SELECTION', indices });
  if (res?.ok) {
    capturedIndices = indices;
    elExportRow.classList.remove('hidden');
    elBtnSidebar.disabled = false;
    setFooter(`已確認選取 ${indices.length} 則，可進行匯出`);
  }
});

// ── Export ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-export').forEach(btn => {
  btn.addEventListener('click', async () => {
    const fmt = btn.dataset.fmt;
    const res = await sendToContent({ type: 'DO_EXPORT', format: fmt });
    if (res?.ok) setFooter(`已匯出 ${res.count} 則（${fmt.toUpperCase()}）`);
  });
});

// ── Sidebar toggle ────────────────────────────────────────────────────────────
async function toggleSidebar() {
  const res = await sendToContent({ type: 'TOGGLE_SIDEBAR' });
  if (res) {
    const open = res.sidebarOpen;
    elBtnSidebar.textContent       = open ? '📕' : '📖';
    $('btn-sidebar-bottom').textContent = open ? '📕 關閉' : '📖 閱讀';
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

  const res = await sendToBg({ type: 'START_BATCH', urls, config: buildConfig() });
  if (res?.ok) {
    monitorBatch(res.total);
  } else {
    resetBatchUI();
    setFooter('批量啟動失敗：' + (res?.error || '未知錯誤'));
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
    const res   = await sendToBg({ type: 'GET_BATCH_STATE' });
    const batch = res?.batch;
    if (!batch) { clearInterval(interval); resetBatchUI(); return; }

    const done = batch.doneIdx || 0;
    const pct  = Math.round((done / total) * 100);
    elBatchProgBar.style.width = pct + '%';
    elBatchStatus.textContent  = batch.done
      ? `批量完成！共 ${total} 頁`
      : `進行中：${done} / ${total} 頁`;
    setFooter(`批量掃描 ${done}/${total}`);

    if (batch.done) {
      clearInterval(interval);
      resetBatchUI();
      setFooter(`批量完成，共 ${total} 頁，每頁已自動匯出`);
    }
  }, 1500);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await chrome.storage.sync.get('gct_cfg');
  cfg = { ...CFG_DEFAULTS, ...(stored.gct_cfg || {}) };
  applySettingsToUI();
}

function applySettingsToUI() {
  $('cfg-selector').value         = cfg.selector;
  $('cfg-roleAttr').value         = cfg.roleAttr;
  $('cfg-targetRoles').value      = cfg.targetRoles;
  $('cfg-scrollDelay').value      = cfg.scrollDelay;
  $('cfg-defaultSelection').value = cfg.defaultSelection;
  $('cfg-exportFormat').value     = cfg.exportFormat;
  $('cfg-exportFilename').value   = cfg.exportFilename;
  $('cfg-xlsDelim').value         = cfg.xlsDelim;
  $('cfg-xlsCleanTargets').value  = cfg.xlsCleanTargets;
  $('cfg-showIndex').checked      = cfg.showIndex;
}

function readSettingsFromUI() {
  return {
    selector:         $('cfg-selector').value.trim(),
    roleAttr:         $('cfg-roleAttr').value.trim(),
    targetRoles:      $('cfg-targetRoles').value.trim(),
    scrollDelay:      Number($('cfg-scrollDelay').value) || 600,
    defaultSelection: $('cfg-defaultSelection').value,
    exportFormat:     $('cfg-exportFormat').value,
    exportFilename:   $('cfg-exportFilename').value.trim(),
    xlsDelim:         $('cfg-xlsDelim').value || '|',
    xlsCleanTargets:  $('cfg-xlsCleanTargets').value.trim(),
    showIndex:        $('cfg-showIndex').checked,
  };
}

$('btn-save-cfg').addEventListener('click', async () => {
  cfg = readSettingsFromUI();
  await chrome.storage.sync.set({ gct_cfg: cfg });
  setFooter('設定已儲存');
});

$('btn-reset-cfg').addEventListener('click', async () => {
  cfg = { ...CFG_DEFAULTS };
  await chrome.storage.sync.set({ gct_cfg: cfg });
  applySettingsToUI();
  setFooter('設定已重置為預設值');
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Get current tab info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id;
    elPageTitle.textContent = tab?.title || '未知頁面';
    elPageTitle.title       = tab?.url || '';
  } catch {}

  // Load settings
  await loadSettings();

  // Restore tab state if previously scanned
  const state = await sendToBg({ type: 'GET_TAB_STATE' });
  if (state?.status === 'done' && state.summaries?.length) {
    summaries = state.summaries;
    renderMsgList();
    elScanStatus.textContent  = `上次掃描：${summaries.length} 則訊息`;
    elBtnSidebar.disabled     = false;
    setFooter(`已載入上次掃描結果（${summaries.length} 則）`);
  }

  // Check if batch is running
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

init();
