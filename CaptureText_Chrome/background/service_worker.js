'use strict';

// ── Extension icon click → open / focus persistent popup window ───────────────
chrome.action.onClicked.addListener(async (tab) => {
  // Remember which tab was active so popup.js can communicate with it
  await chrome.storage.session.set({ gct_target_tab: tab.id });

  // Re-use existing popup window if still open
  const stored = await chrome.storage.session.get('gct_popup_win');
  if (stored.gct_popup_win) {
    try {
      await chrome.windows.update(stored.gct_popup_win, { focused: true, drawAttention: true });
      // Also refresh the target tab so popup reflects current page
      await chrome.runtime.sendMessage({ type: '_REFRESH_TARGET' }).catch(() => {});
      return;
    } catch { /* window was closed, fall through to create */ }
  }

  // screen is not available in service workers — get display info via API
  let leftPos = 1490; // safe default for 1920-wide screens
  try {
    const displays = await chrome.system.display.getInfo();
    const primary  = displays.find(d => d.isPrimary) || displays[0];
    if (primary) leftPos = Math.max(0, primary.workArea.width - 430);
  } catch { /* system.display not available or no display info */ }

  const win = await chrome.windows.create({
    url:    chrome.runtime.getURL('popup/popup.html'),
    type:   'popup',
    width:  400,
    height: 650,
    top:    60,
    left:   leftPos,
    focused: true,
  });
  await chrome.storage.session.set({ gct_popup_win: win.id });
});

// ── Clean up stored window ID when the popup window is closed ─────────────────
chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get('gct_popup_win');
  if (stored.gct_popup_win === windowId) {
    await chrome.storage.session.remove('gct_popup_win');
  }
});

// ── Storage helpers ────────────────────────────────────────────────────────────
const BATCH_KEY  = 'gct_batch';
const TAB_PREFIX = 'gct_tab_';

async function getBatch() {
  const r = await chrome.storage.local.get(BATCH_KEY);
  return r[BATCH_KEY] || null;
}
async function setBatch(data) {
  if (data) await chrome.storage.local.set({ [BATCH_KEY]: data });
  else       await chrome.storage.local.remove(BATCH_KEY);
}
async function getTabState(tabId) {
  const key = TAB_PREFIX + tabId;
  const r   = await chrome.storage.session.get(key);
  return r[key] || {};
}
async function setTabState(tabId, data) {
  await chrome.storage.session.set({ [TAB_PREFIX + tabId]: data });
}
async function clearTabState(tabId) {
  await chrome.storage.session.remove(TAB_PREFIX + tabId);
}

// ── Message dispatcher ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  (async () => {
    try   { sendResponse({ ok: true,  ...(await dispatch(msg, tabId)) }); }
    catch (e) { sendResponse({ ok: false, error: e.message }); }
  })();
  return true;
});

async function dispatch(msg, tabId) {
  switch (msg.type) {

    case 'SCAN_PROGRESS': {
      const prev = await getTabState(tabId);
      await setTabState(tabId, { ...prev, status: 'scanning', pct: msg.pct, count: msg.count });
      return {};
    }

    case 'SCAN_DONE': {
      await setTabState(tabId, {
        status:    'done',
        summaries: msg.summaries,
        url:       msg.url,
        title:     msg.title,
      });
      const batch = await getBatch();
      if (batch && !batch.done) await advanceBatch(tabId, batch);
      return {};
    }

    case 'START_BATCH': {
      const { urls, config } = msg;
      if (!urls?.length) throw new Error('No URLs provided');
      await setBatch({ queue: urls, doneIdx: 0, total: urls.length, config, done: false, scanSent: false });
      // Navigate the stored target tab (the page tab, not the popup window)
      const stored = await chrome.storage.session.get('gct_target_tab');
      const targetTabId = stored.gct_target_tab || (await getFirstNormalTab());
      await chrome.tabs.update(targetTabId, { url: urls[0] });
      return { total: urls.length };
    }

    case 'CANCEL_BATCH':
      await setBatch(null);
      return {};

    case 'GET_BATCH_STATE':
      return { batch: await getBatch() };

    // Popup passes explicit tabId so we don't rely on "active window" detection
    case 'GET_TAB_STATE': {
      const tid = msg.tabId || await getTargetTabId();
      return tid ? await getTabState(tid) : {};
    }

    case 'CLEAR_TAB_STATE': {
      const tid = msg.tabId || await getTargetTabId();
      if (tid) await clearTabState(tid);
      return {};
    }

    default: return {};
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function getTargetTabId() {
  const stored = await chrome.storage.session.get('gct_target_tab');
  return stored.gct_target_tab || null;
}

async function getFirstNormalTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return tab?.id || null;
}

// ── Advance batch: increment counter, navigate to next URL ─────────────────────
async function advanceBatch(tabId, batch) {
  batch.doneIdx++;
  batch.scanSent = false;

  if (batch.doneIdx < batch.total) {
    const nextUrl = batch.queue[batch.doneIdx];
    await setBatch(batch);
    setTimeout(async () => {
      try { await chrome.tabs.update(tabId, { url: nextUrl }); } catch {}
    }, 1500);
  } else {
    batch.done = true;
    await setBatch(batch);
  }
}

// ── Auto-trigger scan when a batch page finishes loading ──────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  const batch = await getBatch();
  if (!batch || batch.done) return;
  if (batch.scanSent) return;

  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }

  const expectedUrl = batch.queue[batch.doneIdx];
  if (!expectedUrl || !urlsMatch(tab.url, expectedUrl)) return;

  batch.scanSent = true;
  await setBatch(batch);

  setTimeout(async () => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type:      'DO_SCAN',
        config:    batch.config,
        batchMode: true,
      });
    } catch {}
  }, 1500);
});

// ── Loose URL comparison (hostname + pathname, ignore query & hash) ─────────────
function urlsMatch(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.hostname === ub.hostname &&
           ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
  } catch { return a === b; }
}
