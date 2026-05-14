'use strict';

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
  return true; // async response
});

async function dispatch(msg, tabId) {
  switch (msg.type) {

    // ── Progress update from content script ──
    case 'SCAN_PROGRESS': {
      const prev = await getTabState(tabId);
      await setTabState(tabId, { ...prev, status: 'scanning', pct: msg.pct, count: msg.count });
      return {};
    }

    // ── Scan completed from content script ──
    case 'SCAN_DONE': {
      await setTabState(tabId, {
        status: 'done',
        summaries: msg.summaries,   // [{ role, preview, index, selected }]
        url:       msg.url,
        title:     msg.title,
      });
      // Auto-advance batch if active
      const batch = await getBatch();
      if (batch && !batch.done) await advanceBatch(tabId, msg.summaries, batch);
      return {};
    }

    // ── Start batch from popup ──
    case 'START_BATCH': {
      const { urls, config } = msg;
      if (!urls?.length) throw new Error('No URLs provided');
      // No results array needed — each page exports its own file on completion
      await setBatch({ queue: urls, doneIdx: 0, total: urls.length, config, done: false });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.update(tab.id, { url: urls[0] });
      return { total: urls.length };
    }

    case 'CANCEL_BATCH':
      await setBatch(null);
      return {};

    case 'GET_BATCH_STATE':
      return { batch: await getBatch() };

    // ── Popup queries current tab state ──
    case 'GET_TAB_STATE': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return await getTabState(tab.id);
    }

    case 'CLEAR_TAB_STATE': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await clearTabState(tab.id);
      return {};
    }

    // ── Relay message to active tab's content script ──
    case 'RELAY_TO_CONTENT': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = await chrome.tabs.sendMessage(tab.id, msg.payload);
      return { result };
    }

    default: return {};
  }
}

// ── Advance batch after a page finishes scanning ───────────────────────────────
// Each page exports its own file independently via content.js; no results collected here.
async function advanceBatch(tabId, summaries, batch) {
  batch.doneIdx++;

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

  // Verify this tab is on the expected URL
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const expectedUrl = batch.queue[batch.doneIdx];
  if (!expectedUrl || !urlsMatch(tab.url, expectedUrl)) return;

  // Auto-scan after settle
  setTimeout(async () => {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type:      'DO_SCAN',
        config:    batch.config,
        batchMode: true,
      });
    } catch { /* page not ready yet */ }
  }, 1500);
});

// ── Loose URL comparison (ignore trailing slash, hash) ─────────────────────────
function urlsMatch(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.hostname === ub.hostname &&
           ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
  } catch { return a === b; }
}
