'use strict';

// ── Pinned-window detection ────────────────────────────────────────────────────
// When alwaysOnTop is enabled, popup.js opens a chrome.windows.create popup with
// ?pin=1 so we know NOT to pop out again on that second load.
const IS_PINNED = new URLSearchParams(location.search).get('pin') === '1';

// ── Default config ─────────────────────────────────────────────────────────────
const CFG_DEFAULTS = {
  selector:         '[data-message-author-role]',
  roleAttr:         'data-message-author-role',
  targetRoles:      'assistant,user',
  scrollDelay:      600,
  defaultSelection: 'assistant',  // index 0 of targetRoles
  exportFormat:     'xls',
  exportFilename:   '',
  xlsDelim:         '|',
  xlsCleanTargets:  '標題：',
  showIndex:        true,
  autoExport:       true,   // auto-download after scan
  alwaysOnTop:      true,   // open as persistent window by default
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
const elBatchUrls      = $('batch-urls');
const elBtnBatchStart  = $('btn-batch-start');
const elBtnBatchCancel = $('btn-batch-cancel');
const elBatchProgWrap  = $('batch-progress-wrap');
const elBatchProgBar   = $('batch-progress-bar');
const elBatchStatus    = $('batch-status');

// Footer
const elFooter = $('footer-bar');

// ── State ─────────────────────────────────────────────────────────────────────
let currentTabId = null;
let summaries    = [];   // [{ role, preview, index, selected }]
let scanning     = false;
let cfg          = { ...CFG_DEFAULTS };
let currentRoles = ['user', 'assistant'];  // kept in sync with cfg.targetRoles

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    autoExport:       cfg.autoExport !== false,
  };
}

// ── Role-aware UI refresh ─────────────────────────────────────────────────────
// Called whenever targetRoles changes. Updates:
//   • quick-select button labels
//   • defaultSelection dropdown options
function updateRoleUI(preserveSelection) {
  const roles = cfg.targetRoles.split(',').map(s => s.trim()).filter(Boolean);
  currentRoles = roles;

  // ── Quick-select buttons ──────────────────────────────────────────────────
  const btn0 = $('qs-role0');
  const btn1 = $('qs-role1');

  btn0.textContent = roles[0] ? `僅選 ${roles[0]}` : '僅選 role0';
  btn0.style.display = '';

  if (roles[1]) {
    btn1.textContent = `僅選 ${roles[1]}`;
    btn1.style.display = '';
  } else {
    btn1.style.display = 'none';
  }

  // ── defaultSelection dropdown ─────────────────────────────────────────────
  const sel   = $('cfg-defaultSelection');
  const prev  = preserveSelection !== undefined ? preserveSelection : sel.value;

  // Rebuild options: one per role + 全部 + 不選取
  sel.innerHTML = roles
    .map(r => `<option value="${r}">${r}</option>`)
    .join('')
    + '<option value="all">全部</option>'
    + '<option value="none">不選取</option>';

  // Restore previous selection if still valid
  const valid = [...sel.options].some(o => o.value === prev);
  sel.value = valid ? prev : (roles[0] || 'all');
}

// Live preview: update role UI whenever the targetRoles input changes
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
    // Badge colour: first role = blue, second = green, others = yellow
    const ri  = currentRoles.indexOf(m.role);
    const cls = ri === 0 ? 'badge-user' : ri === 1 ? 'badge-asst' : 'badge-other';
    const chk = m.selected ? 'checked' : '';
    return `<div class="msg-item${m.selected ? ' selected' : ''}" data-idx="${m.index}">
      <input type="checkbox" ${chk} data-idx="${m.index}">
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
// Use currentRoles[] so they always reflect the live setting
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

  // Auto-export for regular (non-batch) scans when setting is enabled
  if (cfg.autoExport && summaries.length) {
    autoExportCapture();
  }
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
  // Update UI to reflect confirmed selection
  summaries.forEach(m => m.selected = indices.includes(m.index));
  renderMsgList();

  const r2 = await sendToContent({ type: 'DO_EXPORT', format: cfg.exportFormat });
  if (r2?.ok) {
    elExportRow.classList.remove('hidden');
    elBtnSidebar.disabled = false;
    setFooter(`已自動匯出 ${r2.count} 則（${cfg.exportFormat.toUpperCase()}）`);
  }
}

// ── Confirm selection (capture) ───────────────────────────────────────────────
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
    elBtnSidebar.textContent            = open ? '📕' : '📖';
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

  const res = await sendToBg({ type: 'START_BATCH', urls, config: buildConfig(), tabId: currentTabId });
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
      return;
    }

    // Also fetch current scan progress from the active tab
    const tabRes    = await sendToBg({ type: 'GET_TAB_STATE', tabId: currentTabId });
    const tabStatus = tabRes?.status;
    const currentPage = done + 1;

    if (tabStatus === 'scanning') {
      const scanPct   = tabRes.pct   || 0;
      const scanCount = tabRes.count || 0;
      // Combined progress: completed pages + fraction of current scan
      const combinedPct = Math.round(((done + scanPct / 100) / total) * 100);
      elBatchProgBar.style.width = combinedPct + '%';
      elBatchStatus.textContent  =
        `掃描中… ${scanPct}%（已找到 ${scanCount} 則）進行第 ${currentPage} 頁 / 共 ${total} 頁`;
      setFooter(`第 ${currentPage}/${total} 頁  掃描 ${scanPct}%`);
    } else if (tabStatus === 'done') {
      const overallPct = Math.round((done / total) * 100);
      elBatchProgBar.style.width = overallPct + '%';
      elBatchStatus.textContent  =
        `第 ${done} 頁完成，等待跳轉至第 ${currentPage} 頁…（${done}/${total}）`;
      setFooter(`已完成 ${done}/${total} 頁，準備跳轉…`);
    } else {
      const overallPct = Math.round((done / total) * 100);
      elBatchProgBar.style.width = overallPct + '%';
      elBatchStatus.textContent  =
        `正在載入第 ${currentPage} 頁…（${done}/${total} 頁已完成）`;
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
  $('cfg-selector').value        = cfg.selector;
  $('cfg-roleAttr').value        = cfg.roleAttr;
  $('cfg-targetRoles').value     = cfg.targetRoles;
  $('cfg-scrollDelay').value     = cfg.scrollDelay;
  $('cfg-exportFormat').value    = cfg.exportFormat;
  $('cfg-exportFilename').value  = cfg.exportFilename;
  $('cfg-xlsDelim').value        = cfg.xlsDelim;
  $('cfg-xlsCleanTargets').value = cfg.xlsCleanTargets;
  $('cfg-showIndex').checked     = cfg.showIndex;
  $('cfg-autoExport').checked    = cfg.autoExport !== false;
  $('cfg-alwaysOnTop').checked   = cfg.alwaysOnTop !== false;

  // Rebuild role-dependent UI elements, passing saved defaultSelection to preserve it
  updateRoleUI(cfg.defaultSelection);
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
    autoExport:       $('cfg-autoExport').checked,
    alwaysOnTop:      $('cfg-alwaysOnTop').checked,
  };
}

$('btn-save-cfg').addEventListener('click', async () => {
  cfg = readSettingsFromUI();
  await chrome.storage.sync.set({ gct_cfg: cfg });
  updateRoleUI(cfg.defaultSelection); // refresh buttons after explicit save
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
  await loadSettings();

  // ── Auto-popout if alwaysOnTop is on and we're in the normal popup ─────────
  // IS_PINNED = false  →  standard default_popup; check / create persistent window.
  // IS_PINNED = true   →  already the persistent window; skip.
  if (cfg.alwaysOnTop && !IS_PINNED) {
    // ① Capture the active tab before this popup closes
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.storage.session.set({ gct_target_tab: tab.id });
    } catch {}

    // ② Singleton: re-focus the existing pinned window if still open
    const stored = await chrome.storage.session.get('gct_popup_win').catch(() => ({}));
    if (stored.gct_popup_win) {
      try {
        await chrome.windows.update(stored.gct_popup_win, { focused: true, drawAttention: true });
        window.close();
        return;            // existing window found and focused → done
      } catch {
        // window was closed externally; fall through to create a new one
      }
    }

    // ③ Create a new persistent popup (screen is available here in popup context)
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

  // ── Pinned window: show 📌, hide close btn ────────────────────────────────
  if (IS_PINNED) {
    const pinEl  = $('pin-indicator');
    const closeEl = $('btn-close-panel');
    if (pinEl)   pinEl.classList.remove('hidden');
    if (closeEl) closeEl.style.display = 'none';

    // Clean up singleton record when this window is closed
    window.addEventListener('beforeunload', () => {
      chrome.storage.session.remove('gct_popup_win').catch(() => {});
    });
  }

  // ── Resolve target tab ─────────────────────────────────────────────────────
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

  // ── Restore previous scan state ────────────────────────────────────────────
  const state = await sendToBg({ type: 'GET_TAB_STATE', tabId: currentTabId });
  if (state?.status === 'done' && state.summaries?.length) {
    summaries = state.summaries;
    renderMsgList();
    elScanStatus.textContent = `上次掃描：${summaries.length} 則訊息`;
    elBtnSidebar.disabled    = false;
    setFooter(`已載入上次掃描結果（${summaries.length} 則）`);
  }

  // ── Resume batch UI if still running ──────────────────────────────────────
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
document.getElementById('btn-close-panel')?.addEventListener('click', () => {
  window.close();
});

init();
