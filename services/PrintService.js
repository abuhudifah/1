'use strict';

/**
 * services/PrintService.js — v1.0
 * خدمة الطباعة والمشاركة المشتركة لكل مكونات التطبيق
 */
const PrintService = (() => {

  /* ── قالب HTML الرئيسي المشترك ── */
  function _baseTemplate({ title, subtitle, date, userName, logo, statsCards, tableHTML, footerExtra }) {
    const ts = new Date().toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const statsHTML = statsCards?.length ? `
      <div class="stats">
        ${statsCards.map(c => `
          <div class="sc" style="border-right-color:${c.color||'#0f172a'};">
            <label>${c.label}</label>
            <div class="v" style="color:${c.color||'#0f172a'};">${c.value}</div>
          </div>`).join('')}
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{
    font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;
    padding:28px 32px;color:#0f172a;direction:rtl;font-size:12pt;
    background:#fff;
  }
  /* ── الهيدر ── */
  .doc-header{
    display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:22px;
  }
  .doc-header-left{text-align:left;}
  .doc-title{font-size:17pt;font-weight:800;color:#0f172a;line-height:1.2;}
  .doc-subtitle{font-size:9pt;color:#64748b;margin-top:3px;}
  .doc-logo{height:52px;object-fit:contain;display:block;margin-bottom:6px;}
  .doc-date{font-size:11pt;font-weight:700;color:#0f172a;}
  .doc-user{font-size:9pt;color:#64748b;margin-top:2px;}
  /* ── بطاقات الإحصائيات ── */
  .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px;}
  .sc{
    background:#f8fafc;border-radius:10px;padding:12px 14px;
    border-right:3px solid #0f172a;
  }
  .sc label{font-size:8pt;color:#64748b;display:block;margin-bottom:5px;}
  .sc .v{font-size:13pt;font-weight:800;direction:ltr;text-align:right;}
  /* ── الجدول ── */
  table{width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:20px;}
  thead{background:#0f172a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  th{padding:9px 10px;text-align:right;font-weight:700;font-size:9pt;}
  td{padding:8px 10px;text-align:right;border-bottom:1px solid #e2e8f0;}
  tr:nth-child(even) td{background:#f8fafc;}
  tfoot td{font-weight:800;background:#f1f5f9;border-top:2px solid #0f172a;}
  /* ── الفوتر ── */
  .doc-footer{
    margin-top:18px;border-top:1px solid #e2e8f0;padding-top:12px;
    display:flex;justify-content:space-between;align-items:center;
    font-size:8pt;color:#94a3b8;
  }
  .doc-footer-brand{font-weight:700;color:#64748b;}
  /* ── طباعة ── */
  @media print{
    body{padding:12px 16px;}
    .stats{grid-template-columns:repeat(3,1fr);}
    @page{margin:1.5cm;size:A4;}
  }
</style>
</head>
<body>
  <div class="doc-header">
    <div>
      <div class="doc-title">${title}</div>
      ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
    </div>
    <div class="doc-header-left">
      ${logo ? `<img class="doc-logo" src="${logo}" alt="شعار">` : ''}
      ${date ? `<div class="doc-date">${date}</div>` : ''}
      ${userName ? `<div class="doc-user">${userName}</div>` : ''}
    </div>
  </div>

  ${statsHTML}
  ${tableHTML || ''}

  <div class="doc-footer">
    <span class="doc-footer-brand">نظام أبو حذيفة للصرافة والتحويلات</span>
    <span>${footerExtra ? footerExtra + ' &nbsp;|&nbsp; ' : ''}طُبع: ${ts}</span>
  </div>
  <script>window.onload = () => window.print();<\/script>
</body>
</html>`;
  }

  /* ── فتح نافذة الطباعة ── */
  function print(config) {
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) {
      if (window.showToast) showToast('يرجى السماح بالنوافذ المنبثقة لتفعيل الطباعة', 'warning');
      return;
    }
    w.document.write(_baseTemplate(config));
    w.document.close();
  }

  /* ── مشاركة النص ── */
  function share(text, { title = 'مشاركة', toast = true } = {}) {
    /* Web Share API (موبايل/متصفح داعم) */
    if (navigator.share) {
      navigator.share({ title, text }).catch(() => {});
      return;
    }
    /* فتح واتساب كبديل */
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }

  /* ── نسخ النص ── */
  async function copyText(text, successMsg = 'تم النسخ') {
    try {
      await navigator.clipboard.writeText(text);
      if (window.showToast) showToast('✅ ' + successMsg, 'success', 2000);
    } catch {
      if (window.showToast) showToast('✅ ' + text.slice(0, 60) + '…', 'info', 3000);
    }
  }

  /* ── بناء جدول HTML قياسي ── */
  function buildTable(headers, rows, footerRow) {
    return `
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(row =>
          `<tr>${row.map((cell, i) => {
            const align = typeof cell === 'number' || (typeof cell === 'string' && /^\d/.test(cell.trim()))
              ? ' style="direction:ltr;text-align:left;"' : '';
            return `<td${align}>${cell ?? '—'}</td>`;
          }).join('')}</tr>`
        ).join('')}
      </tbody>
      ${footerRow ? `<tfoot><tr>${footerRow.map(c => `<td>${c ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
    </table>`;
  }

  /* ── نافذة طباعة احترافية للكشوف (A4 + شريط أدوات: رجوع/طباعة/مشاركة/PDF) ── */
  function printStatementAdvanced(config) {
    const {
      title = 'كشف حساب', subtitle = '', periodText = '', userName = '',
      logo = '', columns = [], rows = [], totalsLine = '', accountId = '',
      shareText = '',
    } = config || {};

    const ts = new Date().toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const isNum = (c) => typeof c === 'number' || (typeof c === 'string' && /^[−\-\d]/.test(String(c).trim()));
    const theadHTML = `<tr>${columns.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const tbodyHTML = rows.map(r =>
      `<tr>${r.map(c => `<td${isNum(c) ? ' style="direction:ltr;text-align:left;"' : ''}>${(c ?? '—')}</td>`).join('')}</tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;}
  body{background:#e9edf3;color:#0f172a;direction:rtl;}
  /* شريط الأدوات (يختفي عند الطباعة) */
  .toolbar{position:sticky;top:0;z-index:10;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;
    padding:12px;background:#0f172a;box-shadow:0 2px 10px rgba(0,0,0,.2);}
  .toolbar button{display:inline-flex;align-items:center;gap:6px;border:none;border-radius:10px;
    padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;transition:.15s;}
  .tb-print{background:#2563eb;color:#fff;} .tb-pdf{background:#059669;color:#fff;}
  .tb-share{background:#25d366;color:#fff;} .tb-back{background:#e2e8f0;color:#0f172a;}
  .toolbar button:hover{opacity:.9;transform:translateY(-1px);}
  /* ورقة A4 */
  .page{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:18mm 16mm;
    box-shadow:0 6px 24px rgba(0,0,0,.15);}
  .doc-header{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:3px solid #0f172a;padding-bottom:14px;margin-bottom:20px;}
  .doc-title{font-size:20px;font-weight:800;line-height:1.2;}
  .doc-subtitle{font-size:12px;color:#64748b;margin-top:3px;}
  .doc-meta{text-align:left;}
  .doc-logo{height:54px;object-fit:contain;display:block;margin-bottom:6px;margin-inline-start:auto;}
  .doc-period{font-size:13px;font-weight:700;}
  .doc-user{font-size:11px;color:#64748b;margin-top:2px;}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;}
  thead{background:#0f172a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  th{padding:9px 8px;text-align:right;font-weight:700;font-size:11px;}
  td{padding:7px 8px;text-align:right;border-bottom:1px solid #e2e8f0;}
  tr:nth-child(even) td{background:#f8fafc;}
  .totals{display:flex;gap:20px;flex-wrap:wrap;justify-content:flex-end;
    padding:12px 14px;background:#f1f5f9;border-radius:10px;border:1px solid #e2e8f0;
    font-size:13px;font-weight:700;}
  .doc-footer{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:12px;
    display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;}
  .doc-footer b{color:#64748b;}
  @page{size:A4;margin:16mm;}
  @media print{
    body{background:#fff;} .toolbar{display:none!important;}
    .page{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none;}
  }
</style></head>
<body>
  <div class="toolbar">
    <button class="tb-back"  onclick="window.close()">⬅ رجوع</button>
    <button class="tb-print" onclick="window.print()">🖨️ طباعة</button>
    <button class="tb-pdf"   onclick="window.print()">📄 حفظ PDF</button>
    <button class="tb-share" id="tb-share">📲 مشاركة</button>
  </div>
  <div class="page">
    <div class="doc-header">
      <div>
        <div class="doc-title">${title}</div>
        ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
        ${accountId ? `<div class="doc-subtitle">معرف الحساب: ${accountId}</div>` : ''}
      </div>
      <div class="doc-meta">
        ${logo ? `<img class="doc-logo" src="${logo}" alt="شعار">` : ''}
        ${periodText ? `<div class="doc-period">${periodText}</div>` : ''}
        ${userName ? `<div class="doc-user">${userName}</div>` : ''}
      </div>
    </div>
    <table><thead>${theadHTML}</thead><tbody>${tbodyHTML}</tbody></table>
    ${totalsLine ? `<div class="totals">${totalsLine}</div>` : ''}
    <div class="doc-footer">
      <span><b>نظام أبو حذيفة للصرافة والتحويلات</b></span>
      <span>طُبع: ${ts}</span>
    </div>
  </div>
  <script>
    (function(){
      var shareText = ${JSON.stringify(shareText || `${title}\n${periodText}`)};
      var btn = document.getElementById('tb-share');
      if (btn) btn.addEventListener('click', function(){
        if (navigator.share) { navigator.share({ title: ${JSON.stringify(title)}, text: shareText }).catch(function(){}); }
        else { window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(shareText), '_blank'); }
      });
    })();
  <\/script>
</body></html>`;

    const w = window.open('', '_blank', 'width=920,height=760');
    if (!w) {
      if (window.showToast) showToast('يرجى السماح بالنوافذ المنبثقة لتفعيل الطباعة', 'warning');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  /* ══════════════════════════════════════════════════════
     تصدير Excel — يحمّل مكتبة SheetJS من CDN عند الحاجة
  ══════════════════════════════════════════════════════ */

  function _loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('فشل تحميل مكتبة التصدير — تحقق من الاتصال بالإنترنت'));
      document.head.appendChild(s);
    });
  }

  async function exportToExcel(headers, rows, sheetName, filename) {
    await _loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const XLSX = window.XLSX;
    if (!XLSX) throw new Error('مكتبة XLSX غير متاحة');

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // عرض تلقائي للأعمدة
    ws['!cols'] = headers.map(() => ({ wch: 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'تقرير').slice(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  return { print, share, copyText, buildTable, printStatementAdvanced, exportToExcel };
})();

window.PrintService = PrintService;
