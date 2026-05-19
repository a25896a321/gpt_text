'use strict';
if (window.__GCT_injected) { /* already loaded */ } else {
window.__GCT_injected = true;

// ── Default config (overridden by popup settings) ──────────────────────────────
const CFG_DEFAULT = {
  selector:               '[data-message-author-role]',
  roleAttr:               'data-message-author-role',
  targetRoles:            ['assistant', 'user'],
  scrollDelay:            600,
  showIndex:              true,
  defaultSelection:       'assistant',
  exportFormat:           'xls',
  exportFilename:         '',           // supports $D $T $Ts $M $K tokens
  // XLS: first-column extraction by prefix/suffix
  xlsPrefix:              '|標題：',
  xlsSuffix:              '|',
  xlsSuffixNewline:       true,
  // XLS: remove exact substrings from cell content
  xlsCleanTargets:        ['標題：'],
  // XLS: remove entire lines containing these keywords
  xlsExcludeLines:        ['已思考','推理花了','好的','好的！','可以！以下',
                           '新的標題與內容','新的標題與知識','當然可以','http','標題：'],
  xlsMinCellCharsEnabled: true,
  xlsMinCellChars:        300,
  xlsKeepAnomalyMarker:   false,        // add marker column for processed cells
  exportRole:             false,        // include role column in output
  xlsPrefixTrimSpaces:    true,         // allow spaces between prefix/suffix chars
  xlsColNames:            ['標題', '內容'],
  downloadSubfolder:      '',           // subfolder under browser downloads
  autoExport:             true,
};

// ── Runtime state ──────────────────────────────────────────────────────────────
const STATE = {
  messages:    [],
  captured:    [],
  stopScan:    false,
  sidebarOpen: false,
  cfg:         { ...CFG_DEFAULT },
};

// ── Utility helpers ────────────────────────────────────────────────────────────
const sleep   = ms => new Promise(r => setTimeout(r, ms));
const escHtml = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function safeFilename(raw) {
  return (raw || document.title || 'capture').replace(/[\\/:*?"<>|]/g,'_').slice(0, 80);
}

// Resolve filename template tokens:
//   $D=yyyymmdd  $T=hhmm  $Ts=hhmmss  $M=total rows  $K=remaining rows
function resolveFilename(template, stats) {
  const d   = new Date();
  const pad = (n, l=2) => String(n).padStart(l, '0');
  const D   = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  const T   = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const Ts  = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const base = (template || document.title || 'capture')
    .replace(/\$Ts/g, Ts)   // must precede $T
    .replace(/\$T/g,  T)
    .replace(/\$D/g,  D)
    .replace(/\$M/g,  stats?.total     != null ? String(stats.total)     : '')
    .replace(/\$K/g,  stats?.remaining != null ? String(stats.remaining) : '');
  return safeFilename(base);
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

// ── Scroll-container detection ─────────────────────────────────────────────────
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
      selected: cfg.defaultSelection === 'all' || cfg.defaultSelection === m.role,
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
    '='.repeat(40), '',
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

// ── XLS cell processor ─────────────────────────────────────────────────────────
function processXlsMessage(text, cfg) {
  const notes   = [];
  let content   = text;
  let titleCell = null;

  // Step 1: prefix/suffix first-column extraction
  const prefix = (cfg.xlsPrefix || '').trim();
  const suffix = (cfg.xlsSuffix || '').trim();
  if (prefix || suffix) {
    // Build regex: if xlsPrefixTrimSpaces, allow optional \s* between each char
    const escChar = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexEsc = s => s.split('').map(escChar).join('\\s*');
    const strictEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pRe  = cfg.xlsPrefixTrimSpaces ? flexEsc(prefix) : strictEsc(prefix);
    const sRe  = cfg.xlsPrefixTrimSpaces ? flexEsc(suffix) : strictEsc(suffix);
    const nlRe = cfg.xlsSuffixNewline ? '\\n?' : '';
    const re   = new RegExp(pRe + '([\\s\\S]*?)' + sRe + nlRe);
    const m    = content.match(re);
    if (m) {
      titleCell = m[1].trim();
      content   = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
    } else {
      titleCell = '';  // no match: title column exists but is empty
    }
  }

  // Step 2: remove exact substrings from BOTH titleCell AND content (xlsCleanTargets)
  let cleanedCells     = 0;
  let excludedLinesCount = 0;
  const cleanTargets = (cfg.xlsCleanTargets || []).filter(Boolean);
  if (cleanTargets.length) {
    // Apply to titleCell too
    if (titleCell !== null) {
      cleanTargets.forEach(t => { titleCell = titleCell.split(t).join(''); });
      titleCell = titleCell.trim();
    }
    const before = content;
    cleanTargets.forEach(t => { content = content.split(t).join(''); });
    content = content.trim();
    if (content !== before.trim()) { notes.push('已清除字串'); cleanedCells = 1; }
  }

  // Step 3: remove lines containing any exclude keyword
  const excludeKws = (cfg.xlsExcludeLines || []).filter(Boolean);
  if (excludeKws.length && content) {
    const lines   = content.split('\n');
    const kept    = lines.filter(ln => !excludeKws.some(kw => ln.includes(kw)));
    const removed = lines.length - kept.length;
    if (removed > 0) {
      notes.push(`排除${removed}行`);
      content = kept.join('\n').trim();
      excludedLinesCount = removed;
    }
  }

  return { titleCell, content, notes, cleanedCells, excludedLinesCount };
}

function formatXls(messages, cfg) {
  const useExtraction = !!(cfg.xlsPrefix || '').trim() || !!(cfg.xlsSuffix || '').trim();
  const showRole      = cfg.exportRole !== false;
  const showMarker    = !!cfg.xlsKeepAnomalyMarker;
  const minEnabled    = !!cfg.xlsMinCellCharsEnabled;
  const minChars      = Number(cfg.xlsMinCellChars) || 0;
  const colNames      = cfg.xlsColNames || ['標題', '內容'];
  const colTitle      = colNames[0] || '標題';
  const colContent    = colNames[1] || '內容';

  const thCells = [];
  if (showRole)      thCells.push('<th>角色</th>');
  if (useExtraction) thCells.push(`<th>${escHtml(colTitle)}</th>`);
  thCells.push(`<th>${escHtml(colContent)}</th>`);
  if (showMarker)    thCells.push('<th>標記</th>');
  const header = `<tr>${thCells.join('')}</tr>\n`;

  let total = 0, remaining = 0, totalCleanedCells = 0, totalExcludedLines = 0, totalTooShort = 0;

  const dataRows = messages.map(m => {
    const { titleCell, content, notes, cleanedCells, excludedLinesCount } = processXlsMessage(m.text, cfg);
    total++;
    totalCleanedCells  += cleanedCells;
    totalExcludedLines += excludedLinesCount;

    let isTooShort = false;
    if (minEnabled && minChars > 0 && content.length < minChars) {
      isTooShort = true;
      totalTooShort++;
      notes.push(`字數不足(${content.length})`);
    }
    if (isTooShort && !showMarker) return '';  // skip row

    remaining++;
    const tdCells = [];
    if (showRole) {
      const lbl = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'ChatGPT' : m.role;
      tdCells.push(`<td>${escHtml(lbl)}</td>`);
    }
    // Preserve newlines in XLS via &#10; + white-space:pre-wrap
    if (useExtraction) tdCells.push(`<td style="white-space:pre-wrap;mso-data-placement:same-cell">${escHtml(titleCell || '').replace(/\n/g,'&#10;')}</td>`);
    const cellStyle = `white-space:pre-wrap;mso-data-placement:same-cell${isTooShort ? ';color:red' : ''}`;
    tdCells.push(`<td style="${cellStyle}">${escHtml(content).replace(/\n/g,'&#10;')}</td>`);
    if (showMarker) tdCells.push(`<td>${escHtml(notes.join('; '))}</td>`);
    return `<tr>${tdCells.join('')}</tr>`;
  }).filter(Boolean);

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>捕獲結果</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head><body><table border="1">${header}${dataRows.join('\n')}</table></body></html>`;

  return { html, total, remaining, cleanedCells: totalCleanedCells, excludedLines: totalExcludedLines, tooShortRows: totalTooShort };
}

// ── prepareExport: format but don't download ───────────────────────────────────
function prepareExport(messages, format, cfg) {
  if (format === 'txt') {
    return { content: formatTxt(messages, cfg), mime: 'text/plain;charset=utf-8', ext: '.txt', total: messages.length, remaining: messages.length };
  }
  if (format === 'html') {
    return { content: formatHtml(messages, cfg), mime: 'text/html;charset=utf-8', ext: '.html', total: messages.length, remaining: messages.length };
  }
  if (format === 'xls') {
    const { html, total, remaining, cleanedCells, excludedLines, tooShortRows } = formatXls(messages, cfg);
    return { content: html, mime: 'application/vnd.ms-excel;charset=utf-8', ext: '.xls', total, remaining, cleanedCells, excludedLines, tooShortRows };
  }
  if (format === 'clipboard') {
    return { content: formatTxt(messages, cfg), mime: '', ext: '' };
  }
  return null;
}

// ── exportMessages: for batch mode (triggers download in-page) ─────────────────
function exportMessages(messages, format, cfg) {
  const result = prepareExport(messages, format, cfg);
  if (!result) return { count: messages.length };

  if (format === 'clipboard') {
    navigator.clipboard.writeText(result.content).catch(() => {});
    return { count: messages.length };
  }

  const fname = resolveFilename(cfg.exportFilename, result) + result.ext;
  const subf  = (cfg.downloadSubfolder || '').trim().replace(/\/+$/, '');
  const full  = subf ? `${subf}/${fname}` : fname;

  if (subf) {
    // Delegate to service worker which can call chrome.downloads
    chrome.runtime.sendMessage({
      type: 'TRIGGER_DOWNLOAD', content: result.content, filename: full, mime: result.mime,
    }).catch(() => triggerDownload(result.content, fname, result.mime));
  } else {
    triggerDownload(result.content, fname, result.mime);
  }

  return { count: messages.length, total: result.total, remaining: result.remaining };
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
  sidebar.querySelector('#gct-sb-close').addEventListener('click', removeSidebar);

  sidebar.querySelector('#gct-sb-search').addEventListener('input', e => {
    const q     = e.target.value.trim().toLowerCase();
    const count = sidebar.querySelector('#gct-sb-count');
    let visible = 0;
    sidebar.querySelectorAll('.gct-msg').forEach(el => {
      const txt     = el.querySelector('.gct-msg-body').innerText.toLowerCase();
      const matched = !q || txt.includes(q);
      el.style.display = matched ? '' : 'none';
      if (matched) visible++;
      const bodyEl = el.querySelector('.gct-msg-body');
      if (q && matched) {
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        bodyEl.innerHTML = escHtml(bodyEl.innerText || bodyEl.textContent)
          .replace(re, '<mark class="gct-hl">$1</mark>');
      } else {
        bodyEl.innerHTML = escHtml(bodyEl.innerText || bodyEl.textContent);
      }
    });
    count.textContent = q ? `找到 ${visible} / ${messages.length} 則` : `共 ${messages.length} 則訊息`;
  });

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

          STATE.captured = messages.filter(m =>
            cfg.defaultSelection === 'all' || cfg.defaultSelection === m.role
          );

          const summaries = messages.map(m => ({
            role:     m.role,
            preview:  m.preview,
            index:    m.index,
            selected: STATE.captured.some(c => c.index === m.index),
          }));

          if (msg.batchMode && STATE.captured.length) {
            exportMessages(STATE.captured, cfg.exportFormat, cfg);
          }

          chrome.runtime.sendMessage({
            type: 'SCAN_DONE', summaries, url: location.href, title: document.title,
          }).catch(() => {});

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

        case 'SET_SELECTION':
          STATE.captured = STATE.messages.filter(m => msg.indices.includes(m.index));
          sendResponse({ ok: true, count: STATE.captured.length });
          break;

        case 'DO_EXPORT': {
          const msgs   = STATE.captured.length ? STATE.captured : STATE.messages;
          const result = prepareExport(msgs, msg.format, cfg);
          if (!result) { sendResponse({ ok: false, error: 'Unknown format' }); break; }

          if (msg.format === 'clipboard') {
            navigator.clipboard.writeText(result.content).catch(() => {});
            sendResponse({ ok: true, count: msgs.length });
          } else {
            const fname = resolveFilename(cfg.exportFilename, result) + result.ext;
            sendResponse({
              ok:           true,
              count:        msgs.length,
              content:      result.content,
              filename:     fname,
              mime:         result.mime,
              total:        result.total,
              remaining:    result.remaining,
              cleanedCells: result.cleanedCells,
              excludedLines: result.excludedLines,
              tooShortRows: result.tooShortRows,
              url:          location.href,
              title:        document.title,
            });
          }
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
  return true;
});

} // end guard
