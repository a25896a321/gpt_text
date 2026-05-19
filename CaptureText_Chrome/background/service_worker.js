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
  return true;
});

async function dispatch(msg, senderTabId) {
  switch (msg.type) {

    case 'SCAN_PROGRESS': {
      const prev = await getTabState(senderTabId);
      await setTabState(senderTabId, { ...prev, status: 'scanning', pct: msg.pct, count: msg.count });
      return {};
    }

    case 'SCAN_DONE': {
      await setTabState(senderTabId, {
        status:      'done',
        summaries:   msg.summaries,
        url:         msg.url,
        title:       msg.title,
        exportStats: msg.exportStats || {},
      });
      let batch = await getBatch();
      if (batch && !batch.done) {
        batch = {
          ...batch,
          completedPages: [...(batch.completedPages || []), {
            pageNum:     batch.doneIdx + 1,
            url:         msg.url,
            title:       msg.title,
            exportStats: msg.exportStats || {},
          }],
        };
        await advanceBatch(senderTabId, batch);
      }
      return {};
    }

    case 'START_BATCH': {
      const { urls, config, tabId } = msg;
      if (!urls?.length) throw new Error('No URLs provided');
      if (!tabId)        throw new Error('No target tabId provided');
      await setBatch({ queue: urls, doneIdx: 0, total: urls.length, config, tabId, done: false, scanSent: false });
      await chrome.tabs.update(tabId, { url: urls[0] });
      return { total: urls.length };
    }

    case 'CANCEL_BATCH':
      await setBatch(null);
      return {};

    case 'GET_BATCH_STATE':
      return { batch: await getBatch() };

    // popup.js always passes explicit tabId
    case 'GET_TAB_STATE': {
      const tid = msg.tabId;
      return tid ? await getTabState(tid) : {};
    }

    case 'CLEAR_TAB_STATE': {
      const tid = msg.tabId;
      if (tid) await clearTabState(tid);
      return {};
    }

    // Batch-mode export with subfolder: content.js can't use chrome.downloads directly,
    // so it delegates here. Encodes content as a data-URL (works up to ~2 MB).
    case 'TRIGGER_DOWNLOAD': {
      const { content, filename, mime } = msg;
      try {
        const dataUrl = 'data:' + mime + ',' + encodeURIComponent(content);
        await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
      } catch { /* data too large or permission error – silently ignore */ }
      return {};
    }

    default: return {};
  }
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

  // Only act on the tab we're batch-processing
  if (batch.tabId && batch.tabId !== tabId) return;

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
