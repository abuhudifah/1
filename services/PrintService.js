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

  return { print, share, copyText, buildTable };
})();
