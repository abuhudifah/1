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

    // كشف أعمدة لكم/عليكم لتلوينها تلقائياً
    const lakumIdx   = columns.findIndex(c => String(c).includes('لكم')  && !String(c).includes('عليكم'));
    const alaykumIdx = columns.findIndex(c => String(c).includes('عليكم'));

    // هل القيمة رقم أو تبدأ برقم؟ → direction:ltr لعرض صحيح
    const _isNum = (v) => /^[\d,\-−]/.test(String(v ?? '').trim());

    const getCellAttr = (ci, value) => {
      const v   = String(value ?? '');
      const ltr = _isNum(v) ? 'direction:ltr;' : '';
      if (ci === lakumIdx   && v !== '0' && v !== '—' && v !== '')
        return ltr ? ` class="cl" style="${ltr}"` : ' class="cl"';
      if (ci === alaykumIdx && v !== '0' && v !== '—' && v !== '')
        return ltr ? ` class="cd" style="${ltr}"` : ' class="cd"';
      return ltr ? ` style="${ltr}"` : '';
    };

    const theadHTML = `<tr>${columns.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const tbodyHTML = rows.map((r, ri) =>
      `<tr class="${ri % 2 === 1 ? 'even' : ''}">${r.map((c, ci) =>
        `<td${getCellAttr(ci, c)}>${c ?? '—'}</td>`
      ).join('')}</tr>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;}
  body{background:#e9edf3;color:#0f172a;direction:rtl;}

  /* ── شريط الأدوات ── */
  .toolbar{
    position:sticky;top:0;z-index:10;
    display:flex;gap:10px;justify-content:center;flex-wrap:wrap;align-items:center;
    padding:11px 16px;background:#0f172a;box-shadow:0 2px 12px rgba(0,0,0,.25);
  }
  .toolbar button{
    display:inline-flex;align-items:center;gap:6px;
    border:none;border-radius:10px;padding:9px 18px;
    font-size:13px;font-weight:700;cursor:pointer;transition:.15s;
  }
  .tb-print{background:#2563eb;color:#fff;}
  .tb-pdf  {background:#059669;color:#fff;}
  .tb-share{background:#25d366;color:#fff;}
  .tb-back {background:#334155;color:#e2e8f0;}
  .toolbar button:hover{opacity:.88;transform:translateY(-1px);}
  #pdf-tip{
    display:none;font-size:11px;color:#94a3b8;
    background:#1e293b;border:1px solid #334155;border-radius:8px;
    padding:6px 12px;line-height:1.5;text-align:center;max-width:220px;
  }

  /* ── ورقة A4 ── */
  .page{
    width:210mm;min-height:297mm;
    margin:20px auto;background:#fff;
    padding:18mm 16mm 14mm;
    box-shadow:0 6px 28px rgba(0,0,0,.14);
  }

  /* ── ترويسة ── */
  .doc-header{
    display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:3px solid #0f172a;padding-bottom:14px;margin-bottom:22px;
  }
  .doc-title  {font-size:20px;font-weight:800;line-height:1.2;}
  .doc-sub    {font-size:11.5px;color:#64748b;margin-top:3px;}
  .doc-acct   {font-size:10.5px;color:#94a3b8;margin-top:2px;}
  .doc-meta   {text-align:left;}
  .doc-logo   {height:52px;object-fit:contain;display:block;margin-bottom:6px;margin-inline-start:auto;}
  .doc-period {font-size:13px;font-weight:700;}
  .doc-user   {font-size:11px;color:#64748b;margin-top:3px;}

  /* ── الجدول الاحترافي ── */
  table{
    width:100%;border-collapse:collapse;
    font-size:11.5px;margin-bottom:0;
    border:1.5px solid #94a3b8;
    border-radius:2px;
  }
  thead{
    background:#0f172a;color:#fff;
    -webkit-print-color-adjust:exact;print-color-adjust:exact;
    display:table-header-group;
  }
  th{
    padding:10px 9px;text-align:center;
    font-weight:700;font-size:10.5px;letter-spacing:0.4px;
    border-left:1px solid rgba(255,255,255,0.18);
  }
  th:last-child{border-left:none;}
  td{
    padding:8px 9px;text-align:center;
    vertical-align:middle;
    border-bottom:1px solid #dde3ea;
    border-left:1px solid #e8ecf0;
  }
  td:last-child{border-left:none;}
  tbody tr:last-child td{border-bottom:none;}
  tr.even td{background:#f7f9fc;}
  tbody tr:hover td{background:#eff6ff;transition:background .12s;}

  /* ألوان أعمدة لكم / عليكم */
  .cl{color:#059669;font-weight:700;}
  .cd{color:#dc2626;font-weight:700;}

  /* ── غلاف الجدول (حد خارجي موحّد) ── */
  .table-wrap{border:1.5px solid #94a3b8;border-radius:6px;overflow:hidden;margin-bottom:14px;}

  /* ── شريط الإجماليات ── */
  .totals{
    display:flex;gap:0;flex-wrap:wrap;justify-content:flex-end;
    background:#f1f5f9;border:1.5px solid #94a3b8;border-top:none;
    font-size:12.5px;font-weight:700;
  }
  .totals span{
    padding:10px 16px;
    border-right:1px solid #cbd5e1;
  }
  .totals span:last-child{border-right:none;}

  /* ── تذييل ── */
  .doc-footer{
    margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px;
    display:flex;justify-content:space-between;
    font-size:9.5px;color:#94a3b8;
  }
  .doc-footer b{color:#64748b;}

  /* ── طباعة ── */
  @media print{
    body{background:#fff;}
    .toolbar{display:none !important;}
    #pdf-tip{display:none !important;}
    .page{
      width:auto;min-height:auto;margin:0;
      padding:8mm 10mm 8mm;box-shadow:none;
    }
    tr{page-break-inside:avoid;}
    table{border:1.5px solid #aab0bb;}
    th{border-left:1px solid rgba(255,255,255,0.2);}
    td{border-bottom:1px solid #cdd3da;border-left:1px solid #dde1e6;}
    tr.even td{background:#f7f9fc !important;}
    .cl{color:#059669 !important;}
    .cd{color:#dc2626 !important;}
    .totals{border:1.5px solid #aab0bb;border-top:none;}
    .totals span{border-right:1px solid #c8cfd8;}
  }
  @page{
    size:A4;margin:12mm 10mm;
    @bottom-center{
      content:"صفحة " counter(page) " من " counter(pages);
      font-size:8pt;color:#94a3b8;
    }
  }
</style></head>
<body>
  <div class="toolbar">
    <button class="tb-back"  onclick="window.close()">⬅ رجوع</button>
    <button class="tb-print" onclick="window.print()">🖨️ طباعة</button>
    <button class="tb-pdf"   onclick="doPdf()">📄 حفظ PDF</button>
    <button class="tb-share" id="tb-share">📲 مشاركة</button>
    <div id="pdf-tip">في نافذة الطباعة اختر<br><b>«حفظ كـ PDF»</b> كطابعة</div>
  </div>
  <div class="page">
    <div class="doc-header">
      <div>
        <div class="doc-title">${title}</div>
        ${subtitle  ? `<div class="doc-sub">${subtitle}</div>`   : ''}
        ${accountId ? `<div class="doc-acct">معرف الحساب: ${accountId}</div>` : ''}
      </div>
      <div class="doc-meta">
        ${logo       ? `<img class="doc-logo" src="${logo}" alt="شعار">` : ''}
        ${periodText ? `<div class="doc-period">${periodText}</div>`      : ''}
        ${userName   ? `<div class="doc-user">${userName}</div>`          : ''}
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>${theadHTML}</thead>
        <tbody>${tbodyHTML}</tbody>
      </table>
      ${totalsLine ? `<div class="totals">${totalsLine}</div>` : ''}
    </div>

    <div class="doc-footer">
      <span><b>نظام أبو حذيفة للصرافة والتحويلات</b></span>
      <span>طُبع: ${ts}</span>
    </div>
  </div>

  <script>
    function doPdf(){
      var tip=document.getElementById('pdf-tip');
      tip.style.display = tip.style.display==='block' ? 'none' : 'block';
      window.print();
    }
    (function(){
      var txt=${JSON.stringify(shareText || title+'\n'+periodText)};
      var btn=document.getElementById('tb-share');
      if(btn) btn.addEventListener('click',function(){
        if(navigator.share){navigator.share({title:${JSON.stringify(title)},text:txt}).catch(function(){});}
        else{window.open('https://api.whatsapp.com/send?text='+encodeURIComponent(txt),'_blank');}
      });
    })();
  <\/script>
</body></html>`;

    const w = window.open('', '_blank', 'width=960,height=780');
    if (!w) {
      if (window.showToast) showToast('يرجى السماح بالنوافذ المنبثقة لتفعيل الطباعة', 'warning');
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  /* ══════════════════════════════════════════════════════
     buildStatementPrintData — دالة مشتركة لتحويل المعاملات الخام
     إلى صفوف بنفس تنسيق كشف الحساب في إدارة الحسابات
     الأعمدة: التاريخ | الوقت | نوع العملية | لكم (ر.س) | عليكم (ر.س) | التفاصيل
  ══════════════════════════════════════════════════════ */
  function buildStatementPrintData(transactions, { date, userName, companies, banks, users } = {}) {
    // إيداع وحوالة واردة → لكم (دائن). الباقي → عليكم (مدين)
    const LAKUM_TYPES  = new Set(['deposit', 'delivery']);
    const TYPE_LABELS  = window.TRANSACTION_TYPE_LABELS || {};
    const fmt          = n => Math.abs(Math.round(n)).toLocaleString('en-US');

    const companiesMap = new Map((Array.isArray(companies) ? companies : []).map(c => [c.id, c.name]));
    const banksMap     = new Map((Array.isArray(banks)     ? banks     : []).map(b => [b.id, b.name]));
    const usersMap     = new Map((Array.isArray(users)     ? users     : []).map(u => [u.id, u.display_name]));

    const fmtTime = (tx) => {
      if (tx.created_at) {
        return new Date(tx.created_at).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
      }
      return tx.time ? String(tx.time).substring(0, 5) : '—';
    };

    const _describe = (tx) => {
      const extra = tx.details ? ` ${tx.details}` : '';
      switch (tx.type) {
        case 'collection': {
          const cn = tx.company_id ? (companiesMap.get(tx.company_id) || '—') : null;
          if (cn) return `عليكم تحصيل نقدي لصالح ${cn}${extra}`;
          return `عليكم تحصيل نقدي إلى حساب تسوية العملاء من ${tx.customer_name || '—'}${extra}`;
        }
        case 'deposit': {
          const bn = tx.bank_account_id ? (banksMap.get(tx.bank_account_id) || '—') : '—';
          return `لكم إيداع نقدي إلى حساب ${bn}${extra}`;
        }
        case 'bank_withdrawal': {
          const bn = tx.bank_account_id ? (banksMap.get(tx.bank_account_id) || '—') : '—';
          return `عليكم سحب نقدي من حساب ${bn}${extra}`;
        }
        case 'expense':
          return `مصروف ${tx.expense_type || 'عام'}${extra}`;
        case 'delivery': {
          const otherName = usersMap.get(tx.to_agent_id) || usersMap.get(tx.agent_id) || tx.customer_name || '—';
          return `لكم حوالة نقدية واردة من حساب ${otherName}${extra}`;
        }
        case 'receipt': {
          const otherName = usersMap.get(tx.from_agent_id) || usersMap.get(tx.to_agent_id) || tx.customer_name || '—';
          return `عليكم حوالة نقدية من حسابكم إلى حساب ${otherName}${extra}`;
        }
        default:
          return tx.customer_name || tx.details || 'قيد';
      }
    };

    let totalLakum = 0, totalAlaykum = 0;

    const rows = transactions.map(tx => {
      const amt     = Math.round(parseFloat(tx.amount || 0));
      const isLakum = LAKUM_TYPES.has(tx.type);
      if (isLakum) totalLakum += amt; else totalAlaykum += amt;
      return [
        tx.date || date || '—',
        fmtTime(tx),
        TYPE_LABELS[tx.type] || tx.type,
        isLakum  ? amt.toLocaleString('en-US') : '0',   // لكم
        !isLakum ? amt.toLocaleString('en-US') : '0',   // عليكم
        _describe(tx),                                    // التفاصيل — آخراً ككشف الحساب
      ];
    });

    // الصافي = عليكم − لكم: موجب → المندوب مدين (عليكم)، سالب → له رصيد (لكم)
    const net      = totalAlaykum - totalLakum;
    const netSign  = net >= 0 ? 'عليكم' : 'لكم';
    const netColor = net >= 0 ? '#dc2626' : '#059669';

    const totalsLine = [
      `<span>إجمالي لكم: <b style="color:#059669">${fmt(totalLakum)} ر.س</b></span>`,
      `<span>إجمالي عليكم: <b style="color:#dc2626">${fmt(totalAlaykum)} ر.س</b></span>`,
      `<span>صافي الحركة: <b style="color:${netColor}">${fmt(net)} ${netSign} ر.س</b></span>`,
    ].join('');

    const totalsText = `لكم: ${fmt(totalLakum)} | عليكم: ${fmt(totalAlaykum)} | الصافي: ${fmt(net)} ${netSign}`;

    const shareText = [
      date     ? `📅 ${date}`    : '',
      userName ? `👤 ${userName}` : '',
      '────────────────',
      `✅ لكم:    ${fmt(totalLakum)} ر.س`,
      `❌ عليكم:  ${fmt(totalAlaykum)} ر.س`,
      `💰 الصافي: ${fmt(net)} ${netSign} ر.س`,
      `📋 عدد العمليات: ${transactions.length}`,
    ].filter(Boolean).join('\n');

    return {
      columns: ['التاريخ', 'الوقت', 'نوع العملية', 'لكم (ر.س)', 'عليكم (ر.س)', 'التفاصيل'],
      rows, totalsLine, totalsText, shareText,
      totalLakum, totalAlaykum, net, netSign,
    };
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

    const allRows = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    // عرض الأعمدة: حد أدنى 14، حد أقصى 35
    ws['!cols'] = headers.map((h, ci) => {
      const maxLen = allRows.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), 0);
      return { wch: Math.min(35, Math.max(14, maxLen + 2)) };
    });

    // تنسيق صف العناوين (خط عريض، خلفية داكنة)
    const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: '0F172A' } }, alignment: { horizontal: 'center', readingOrder: 2 } };
    for (let ci = 0; ci < headers.length; ci++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (ws[cellRef]) ws[cellRef].s = headerStyle;
    }

    // تنسيق صف الإجماليات (آخر صف — خط عريض)
    if (rows.length > 0) {
      const lastR = rows.length; // 0-indexed after headers
      for (let ci = 0; ci < headers.length; ci++) {
        const cellRef = XLSX.utils.encode_cell({ r: lastR, c: ci });
        if (ws[cellRef]) ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'F1F5F9' } } };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'تقرير').slice(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  return { print, share, copyText, buildTable, printStatementAdvanced, exportToExcel, buildStatementPrintData };
})();

window.PrintService = PrintService;
