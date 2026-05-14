'use strict';
if (window.__GCT_injected) { /* already loaded */ } else {
window.__GCT_injected = true;

// ── Default config (overridden by popup settings) ──────────────────────────────
const CFG_DEFAULT = {
  selector:         '[data-message-author-role]',
  roleAttr:         'data-message-author-role',
  targetRoles:      ['assistant', 'user'],
  scrollDelay:      600,
  showIndex:        true,
  defaultSelection: 'assistant', // 'all' | <roleName> | 'none'
  exportFormat:     'xls',
  exportFilename:   '',
  xlsDelim:         '|',
  xlsCleanTargets:  ['標題：'],
  autoExport:       true,        // auto-download after scan completes
};

// ── Runtime state ──────────────────────────────────────────────────────────────
const STATE = {
  messages:     [],   // full message objects { role, text, preview, index, selected }
  captured:     [],   // subset chosen by user
  stopScan:     false,
  sidebarOpen:  false,
  cfg:          { ...CFG_DEFAULT },
};

// ── Utility helpers ────────────────────────────────────────────────────────────
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const escHtml = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function safeFilename(raw) {
  return (raw || document.title || 'capture').replace(/[\\/:*?"<>|]/g,'_').slice(0,80);
}
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
}
function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ── Scroll-container detection (from capture.js) ──────────────────────────────
function findScrollContainer(selector) {
  const first = document.querySelector(selector);
  if (first) {
    let el = first.parentElement;
    while (el && el !== document.documentElement) {
      const oy = window.getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 30) return el;
      el = el.parentElement;
    }
  }
  return null;
}
function makeScroller(container) {
  const win = !container;
  return {
    scrollTo: y  => win ? window.scrollTo(0, y) : (container.scrollTop = y),
    get scrollH() { return win ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) : container.scrollHeight; },
    get clientH() { return win ? window.innerHeight : container.clientHeight; },
  };
}

// ── Core scan logic ────────────────────────────────────────────────────────────
async function scrollAndScan(cfg, onProgress) {
  STATE.stopScan = false;

  // Initial render trigger
  window.scrollTo(0, 0);                        await sleep(400);
  window.scrollTo(0, window.innerHeight * 0.4); await sleep(600);
  window.scrollTo(0, 0);                        await sleep(400);

  const scroller = makeScroller(findScrollContainer(cfg.selector));
  scroller.scrollTo(0); await sleep(600);

  const seen = new Map();

  function harvest() {
    document.querySelectorAll(cfg.selector).forEach(node => {
      const role = node.getAttribute(cfg.roleAttr) || 'unknown';
      if (cfg.targetRoles.length && !cfg.targetRoles.includes(role)) return;
      const text = node.innerText?.trim() || '';
      if (!text) return;
      const key = role + '\x00' + text.slice(0, 120);
      if (!seen.has(key)) {
        seen.set(key, { role, text, preview: text.replace(/\s+/g,' ').slice(0,60), order: seen.size });
      }
    });
  }

  const step   = Math.max(200, Math.floor(scroller.clientH * 0.6));
  let pos = 0, stableRounds = 0, lastScrollH = 0;

  for (let i = 0; i < 800; i++) {
    if (STATE.stopScan) break;
    harvest();

    const totalH = scroller.scrollH;
    const pct    = totalH > 0 ? Math.min(100, Math.round((pos / totalH) * 100)) : 0;
    onProgress && onProgress(pct, seen.size);

    if (pos >= totalH) {
      if (totalH === lastScrollH) { if (++stableRounds >= 3) break; }
      else stableRounds = 0;
      lastScrollH = totalH;
    }
    pos += step;
    scroller.scrollTo(pos);
    await sleep(cfg.scrollDelay || 600);
  }

  harvest();
  scroller.scrollTo(0);

  STATE.messages = Array.from(seen.values())
    .sort((a, b) => a.order - b.order)
    .map((m, i) => ({
      ...m,
      index:    i + 1,
      selected: cfg.defaultSelection === 'all' ||
                cfg.defaultSelection === m.role,
    }));

  return STATE.messages;
}

// ── Export formatters ──────────────────────────────────────────────────────────
function formatTxt(messages, cfg) {
  const divider = '─'.repeat(40);
  const header  = [
    '=== 文字捕獲工具 ===',
    `網址：${location.href}`,
    `時間：${new Date().toLocaleString('zh-TW')}`,
    `訊息：${messages.length} 筆`,
    '='.repeat(40),
    '',
  ].join('\n');
  return header + messages.map(m => {
    const label = m.role === 'user' ? '[User]' : m.role === 'assistant' ? '[ChatGPT]' : `[${m.role}]`;
    const idx   = cfg.showIndex ? ` #${m.index}` : '';
    return `${label}${idx}\n${m.text}\n${divider}`;
  }).join('\n\n');
}

function formatHtml(messages, cfg) {
  const rows = messages.map(m => {
    const cls   = m.role === 'user' ? 'user' : 'assistant';
    const label = m.role === 'user' ? 'User' : 'ChatGPT';
    const idx   = cfg.showIndex ? ` <span class="idx">#${m.index}</span>` : '';
    return `<div class="msg ${cls}"><div class="role">${label}${idx}</div><div class="body">${escHtml(m.text)}</div></div>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="utf-8"><title>${escHtml(document.title)}</title>
<style>body{font-family:sans-serif;max-width:820px;margin:0 auto;padding:24px;background:#f5f5f5}
.msg{margin:12px 0;padding:14px 18px;border-radius:8px;line-height:1.7}
.user{background:#e8f4ff;border-left:4px solid #2563eb}
.assistant{background:#f0fdf4;border-left:4px solid #10a37f}
.role{font-weight:700;font-size:.82em;margin-bottom:6px;opacity:.7}
.idx{font-weight:400;color:#aaa}.body{white-space:pre-wrap}</style></head>
<body><h2>${escHtml(document.title)}</h2><p style="color:#888;font-size:.85em">網址：${escHtml(location.href)}</p>
${rows}</body></html>`;
}

function formatXls(messages, cfg) {
  const delim        = cfg.xlsDelim || '|';
  const cleanTargets = (cfg.xlsCleanTargets || []).filter(Boolean);
  const header       = `<tr><th>角色</th><th>訊息</th></tr>\n`;

  const dataRows = messages.map(m => {
    let parts = m.text.split(delim).map(p => p.trim()).filter(p => p.length > 0);
    if (cleanTargets.length) {
      parts = parts.map(p => {
        let v = p;
        cleanTargets.forEach(t => { if (t) v = v.split(t).join(''); });
        return v.trim();
      }).filter(p => p.length > 0);
    }
    const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
    const cells     = parts.length > 0 ? parts.map(p => `<td>${escHtml(p)}</td>`).join('') : `<td>${escHtml(m.text)}</td>`;
    return `<tr><td>${escHtml(roleLabel)}</td>${cells}</tr>`;
  }).join('\n');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>捕獲結果</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body><table border="1">${header}${dataRows}</table></body></html>`;
}

// ── Trigger file download ──────────────────────────────────────────────────────
function exportMessages(messages, format, cfg) {
  const base = safeFilename(cfg.exportFilename || document.title) + '_' + nowStr();
  if (format === 'txt') {
    triggerDownload(formatTxt(messages, cfg), base + '.txt', 'text/plain;charset=utf-8');
  } else if (format === 'html') {
    triggerDownload(formatHtml(messages, cfg), base + '.html', 'text/html;charset=utf-8');
  } else if (format === 'xls') {
    triggerDownload(formatXls(messages, cfg), base + '.xls', 'application/vnd.ms-excel;charset=utf-8');
  } else if (format === 'clipboard') {
    navigator.clipboard.writeText(formatTxt(messages, cfg)).catch(() => {});
  }
}

// ── Sidebar reading mode ───────────────────────────────────────────────────────
function buildSidebar(messages, cfg) {
  removeSidebar();

  const sidebar = document.createElement('div');
  sidebar.id = 'gct-sidebar';

  const items = messages.map(m => {
    const cls   = m.role === 'user' ? 'gct-msg-user' : 'gct-msg-assistant';
    const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
    const idx   = cfg.showIndex ? ` <span class="gct-idx">#${m.index}</span>` : '';
    return `<div class="gct-msg ${cls}" data-idx="${m.index}">
      <div class="gct-msg-role">${escHtml(label)}${idx}</div>
      <div class="gct-msg-body">${escHtml(m.text)}</div>
    </div>`;
  }).join('');

  sidebar.innerHTML = `
    <div class="gct-sb-header">
      <span class="gct-sb-title">📖 側邊閱讀模式</span>
      <div class="gct-sb-tools">
        <input id="gct-sb-search" type="text" placeholder="搜尋…" autocomplete="off">
        <button id="gct-sb-font-sm" title="縮小字體">A−</button>
        <button id="gct-sb-font-lg" title="放大字體">A+</button>
        <button id="gct-sb-close" title="關閉">✕</button>
      </div>
    </div>
    <div id="gct-sb-count" class="gct-sb-count">共 ${messages.length} 則訊息</div>
    <div id="gct-sb-body" class="gct-sb-body">${items}</div>
  `;

  document.documentElement.appendChild(sidebar);
  document.documentElement.classList.add('gct-sidebar-open');
  STATE.sidebarOpen = true;

  // Font size control
  let fontSize = 14;
  const body   = sidebar.querySelector('#gct-sb-body');
  sidebar.querySelector('#gct-sb-font-sm').addEventListener('click', () => {
    fontSize = Math.max(10, fontSize - 1);
    body.style.fontSize = fontSize + 'px';
  });
  sidebar.querySelector('#gct-sb-font-lg').addEventListener('click', () => {
    fontSize = Math.min(22, fontSize + 1);
    body.style.fontSize = fontSize + 'px';
  });

  // Close
  sidebar.querySelector('#gct-sb-close').addEventListener('click', removeSidebar);

  // Live search / highlight
  sidebar.querySelector('#gct-sb-search').addEventListener('input', e => {
    const q      = e.target.value.trim().toLowerCase();
    const count  = sidebar.querySelector('#gct-sb-count');
    let visible  = 0;
    sidebar.querySelectorAll('.gct-msg').forEach(el => {
      const txt     = el.querySelector('.gct-msg-body').innerText.toLowerCase();
      const matched = !q || txt.includes(q);
      el.style.display = matched ? '' : 'none';
      if (matched) visible++;
      // Highlight
      const bodyEl  = el.querySelector('.gct-msg-body');
      if (q && matched) {
        const re   = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        bodyEl.innerHTML = escHtml(bodyEl.innerText || bodyEl.textContent)
          .replace(re, '<mark class="gct-hl">$1</mark>');
      } else {
        bodyEl.innerHTML = escHtml(bodyEl.innerText || bodyEl.textContent);
      }
    });
    count.textContent = q ? `找到 ${visible} / ${messages.length} 則` : `共 ${messages.length} 則訊息`;
  });

  // Animate in
  requestAnimationFrame(() => sidebar.classList.add('gct-sb-visible'));
}

function removeSidebar() {
  const sb = document.getElementById('gct-sidebar');
  if (sb) sb.remove();
  document.documentElement.classList.remove('gct-sidebar-open');
  STATE.sidebarOpen = false;
}

function toggleSidebar(cfg) {
  if (STATE.sidebarOpen) {
    removeSidebar();
  } else {
    const msgs = STATE.captured.length ? STATE.captured : STATE.messages;
    if (msgs.length) buildSidebar(msgs, cfg);
  }
}

// ── Message listener ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const cfg = { ...CFG_DEFAULT, ...(msg.config || {}) };

      switch (msg.type) {

        case 'DO_SCAN': {
          const messages = await scrollAndScan(cfg, (pct, count) => {
            chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', pct, count }).catch(() => {});
          });

          // Apply default capture selection
          STATE.captured = messages.filter(m =>
            cfg.defaultSelection === 'all' ||
            cfg.defaultSelection === m.role
          );

          const summaries = messages.map(m => ({
            role:     m.role,
            preview:  m.preview,
            index:    m.index,
            selected: STATE.captured.some(c => c.index === m.index),
          }));

          // Report completion to background
          chrome.runtime.sendMessage({
            type:      'SCAN_DONE',
            summaries,
            url:       location.href,
            title:     document.title,
          }).catch(() => {});

          // In batch mode: auto-export if autoExport is enabled (default true)
          if (msg.batchMode && STATE.captured.length && cfg.autoExport !== false) {
            exportMessages(STATE.captured, cfg.exportFormat, cfg);
          }

          sendResponse({ ok: true, count: messages.length });
          break;
        }

        case 'STOP_SCAN':
          STATE.stopScan = true;
          sendResponse({ ok: true });
          break;

        case 'GET_MESSAGES':
          sendResponse({
            summaries: STATE.messages.map(m => ({
              role:     m.role,
              preview:  m.preview,
              index:    m.index,
              selected: STATE.captured.some(c => c.index === m.index),
            })),
          });
          break;

        case 'SET_SELECTION': {
          // msg.indices: array of indices to mark as captured
          STATE.captured = STATE.messages.filter(m => msg.indices.includes(m.index));
          sendResponse({ ok: true, count: STATE.captured.length });
          break;
        }

        case 'DO_EXPORT': {
          const msgs = STATE.captured.length ? STATE.captured : STATE.messages;
          exportMessages(msgs, msg.format, cfg);
          sendResponse({ ok: true, count: msgs.length });
          break;
        }

        case 'TOGGLE_SIDEBAR':
          toggleSidebar(cfg);
          sendResponse({ sidebarOpen: STATE.sidebarOpen });
          break;

        default:
          sendResponse({ ok: false, error: 'Unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});

} // end guard
