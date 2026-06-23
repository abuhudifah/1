'use strict';

/**
 * services/PrintService.js — v2.0
 * خدمة الطباعة والمشاركة المشتركة لكل مكونات التطبيق
 * النهج: مودال داخل الصفحة + html2pdf لتوليد PDF حقيقي (بلا نوافذ منبثقة)
 */
const PrintService = (() => {

  /* ══════════════════════════════════════════════════════
     الثوابت والأدوات الداخلية
  ══════════════════════════════════════════════════════ */

  const _STYLE_ID  = 'ps-global-styles';
  const _MODAL_ID  = 'ps-overlay';
  const _PDF_CDNS  = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
    'https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js',
  ];

  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function _loadScript(url) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${url}"]`);
      if (existing) {
        if (existing.dataset.loadState === 'ok') { resolve(); return; }
        existing.remove(); // أزل script فاشل أو معلّق من محاولة سابقة
      }
      const s = document.createElement('script');
      s.src = url;
      s.onload  = () => { s.dataset.loadState = 'ok';   resolve(); };
      s.onerror = () => { s.dataset.loadState = 'fail'; reject(new Error('فشل تحميل المكتبة — تحقق من الاتصال')); };
      document.head.appendChild(s);
    });
  }

  /* يُحقن CSS مرة واحدة في <head> */
  function _injectStyles() {
    if (document.getElementById(_STYLE_ID)) return;

    const s = document.createElement('style');
    s.id = _STYLE_ID;
    s.textContent = `
/* ══ مودال المعاينة ══ */
#ps-overlay{
  position:fixed;inset:0;z-index:99990;
  background:rgba(0,0,0,.82);
  display:flex;flex-direction:column;
  font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;
  direction:rtl;
}
.ps-toolbar{
  display:flex;align-items:center;flex-wrap:wrap;gap:8px;
  padding:10px 16px;background:#0f172a;
  box-shadow:0 2px 10px rgba(0,0,0,.35);flex-shrink:0;
}
.ps-toolbar button{
  display:inline-flex;align-items:center;gap:6px;
  border:none;border-radius:9px;padding:9px 18px;
  font-size:13px;font-weight:700;cursor:pointer;
  font-family:inherit;transition:opacity .15s,transform .15s;
}
.ps-toolbar button:hover{opacity:.85;transform:translateY(-1px);}
.ps-btn-close {background:#334155;color:#e2e8f0;}
.ps-btn-print {background:#2563eb;color:#fff;}
.ps-btn-pdf   {background:#059669;color:#fff;}
.ps-btn-share {background:#25d366;color:#fff;}
.ps-tb-label{color:#94a3b8;font-size:12px;font-weight:600;
  display:inline-flex;align-items:center;gap:6px;}
.ps-tb-sel{
  border:1px solid #334155;border-radius:9px;
  background:#1e293b;color:#e2e8f0;
  padding:7px 10px;font-size:12px;font-weight:700;
  cursor:pointer;font-family:inherit;
}
.ps-tb-sep{width:1px;height:26px;background:#334155;flex-shrink:0;margin:0 2px;}
.ps-spin{
  width:20px;height:20px;border-radius:50%;display:none;flex-shrink:0;
  border:2.5px solid #334155;border-top-color:#10b981;
  animation:ps-spin .7s linear infinite;
}
@keyframes ps-spin{to{transform:rotate(360deg);}}

.ps-scroll{flex:1;overflow:auto;padding:24px 16px;background:#d1d9e6;}

/* ورقة A4 في المعاينة */
.ps-page{
  position:relative;overflow:hidden;
  width:210mm;min-height:297mm;
  margin:0 auto;background:#fff;
  padding:18mm 16mm 14mm;
  box-shadow:0 6px 30px rgba(0,0,0,.22);
  box-sizing:border-box;
}
.ps-page>*:not(.ps-watermark){position:relative;z-index:1;}
.ps-watermark{
  position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);
  width:64%;max-width:390px;height:auto;
  opacity:0.05;z-index:0;pointer-events:none;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}

/* ══ محتوى التقرير ══ */
.ps-report{
  font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;
  color:#0f172a;direction:rtl;
}
.ps-report .doc-header{
  display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:3px solid #0f172a;padding-bottom:14px;margin-bottom:22px;
}
.ps-report .doc-title  {font-size:20px;font-weight:800;line-height:1.2;color:#0f172a;}
.ps-report .doc-sub    {font-size:11.5px;color:#64748b;margin-top:3px;}
.ps-report .doc-acct   {font-size:10.5px;color:#94a3b8;margin-top:2px;}
.ps-report .doc-meta   {text-align:left;}
.ps-report .doc-logo   {height:80px;object-fit:contain;display:block;
  margin-bottom:8px;margin-inline-start:auto;}
.ps-report .doc-period {font-size:13px;font-weight:700;color:#0f172a;}
.ps-report .doc-user   {font-size:11px;color:#64748b;margin-top:3px;}
.ps-report .doc-footer {
  margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px;
  display:flex;justify-content:space-between;font-size:9.5px;color:#94a3b8;
}
.ps-report .doc-footer b{color:#64748b;}

/* الجدول */
.ps-report table{
  width:100%;border-collapse:collapse;
  font-size:12.5px;margin-bottom:0;
  border:1.5px solid #94a3b8;
}
.ps-report thead{
  background:#0f172a;color:#fff;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.ps-report th{
  padding:11px 9px;text-align:center;
  font-weight:800;font-size:11.5px;
  border-left:1px solid rgba(255,255,255,.18);
}
.ps-report th:last-child{border-left:none;}
.ps-report td{
  padding:8px 9px;text-align:center;vertical-align:middle;
  border-bottom:1px solid #dde3ea;border-left:1px solid #e8ecf0;
}
.ps-report td:last-child{border-left:none;}
.ps-report tbody tr:last-child td{border-bottom:none;}
.ps-report tr.ps-even td{
  background:#f7f9fc;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.ps-report .cl{color:#059669;font-weight:700;}
.ps-report .cd{color:#dc2626;font-weight:700;}
.ps-report .table-wrap{
  border:1.5px solid #94a3b8;border-radius:6px;
  overflow:hidden;margin-bottom:14px;page-break-inside:avoid;
}
.ps-report .table-wrap-page{
  page-break-inside:avoid;margin-bottom:12px;
}
.ps-report .totals{
  display:flex;flex-wrap:wrap;justify-content:flex-end;
  background:#f1f5f9;border:1.5px solid #94a3b8;border-top:none;
  font-size:12.5px;font-weight:700;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.ps-report .totals span{padding:10px 16px;border-right:1px solid #cbd5e1;}
.ps-report .totals span:last-child{border-right:none;}

/* كشف بنكي (BankAccountsComponent) */
.ps-report .bank-card-info{
  background:#f8fafc;border-radius:10px;padding:16px;
  display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.ps-report .bank-info-label{font-size:8pt;color:#64748b;display:block;margin-bottom:2px;}
.ps-report .bank-info-val  {font-size:10pt;font-weight:700;}
.ps-report .bank-progress-bar{
  height:8px;background:#e2e8f0;border-radius:4px;margin-top:6px;overflow:hidden;
}

/* ══ إخفاء شريط الأدوات عند الطباعة أو التقاط html2canvas ══ */
#ps-overlay.ps-capturing .ps-toolbar{display:none !important;}

/* ══ تأثير الخروج ══ */
#ps-overlay.is-closing{
  animation:psOverlayOut .22s ease forwards;
  pointer-events:none;
}
@keyframes psOverlayOut{
  from{opacity:1;}
  to  {opacity:0;}
}

/* ══ شريط الأدوات على الجوال ══ */
@media (max-width:600px){
  .ps-toolbar button{padding:9px 12px;font-size:12px;}
  .ps-tb-label{font-size:11px;}
  .ps-tb-sep{display:none;}
}

/* ══ صفحات PDF متعددة ══ */
.ps-multipage-wrap{
  display:flex;flex-direction:column;
  align-items:center;gap:20px;padding:20px 16px;
}
.pdf-page{
  width:210mm;min-height:297mm;
  background:#fff;
  box-shadow:0 6px 30px rgba(0,0,0,.22);
  box-sizing:border-box;
  padding:14mm 15mm 10mm;
  position:relative;
  display:flex;flex-direction:column;
  font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;
  color:#0f172a;direction:rtl;
  page-break-after:always;
}
.pdf-page:last-child{page-break-after:auto;}
.pdf-page>.ps-watermark{
  position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);
  width:60%;max-width:380px;
  opacity:0.05;z-index:0;pointer-events:none;
}
.pdf-page-header{
  display:flex;justify-content:space-between;align-items:flex-start;
  border-bottom:3px solid #0f172a;padding-bottom:10px;margin-bottom:14px;
  position:relative;z-index:1;
}
.pdf-page-meta{text-align:left;}
.pdf-page-num{font-size:9.5px;color:#64748b;margin-top:4px;font-weight:600;}
.pdf-page-body{flex:1;position:relative;z-index:1;}
.pdf-page-footer{
  margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;
  display:flex;justify-content:space-between;
  font-size:9px;color:#94a3b8;
  position:relative;z-index:1;
}
.pdf-page-footer b{color:#64748b;}

/* ══ طباعة ══ */
@media print{
  body.ps-printing > *:not(#ps-overlay){display:none !important;}
  body.ps-printing #ps-overlay{
    position:static !important;background:none !important;display:block !important;
  }
  body.ps-printing .ps-toolbar{display:none !important;}
  body.ps-printing .ps-scroll{
    overflow:visible !important;padding:0 !important;background:none !important;
  }
  body.ps-printing .ps-page{
    box-shadow:none !important;margin:0 !important;
    width:auto !important;min-height:auto !important;padding:0 !important;
  }
  body.ps-printing .ps-multipage-wrap{gap:0 !important;padding:0 !important;}
  body.ps-printing .pdf-page{
    box-shadow:none !important;margin:0 !important;
    width:100% !important;padding:12mm 10mm !important;
  }
  body.ps-printing .ps-report table{page-break-inside:auto;}
  body.ps-printing .ps-report tr{page-break-inside:avoid;page-break-after:auto;}
  body.ps-printing .ps-report thead{display:table-header-group;}
  body.ps-printing .ps-report tfoot{display:table-footer-group;}
  body.ps-printing .ps-report .bank-card-info{page-break-inside:avoid;}
  body.ps-printing .ps-report .doc-footer{page-break-after:avoid;}
  @page{size:A4;margin:12mm 10mm;}
}
    `;
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════
     _buildModal — ينشئ المودال في الصفحة ويربط الأزرار
     reportEl : عنصر DOM جاهز يحتوي محتوى التقرير
     config   : { title, logo, shareText, periodText, watermarkLogo }
  ══════════════════════════════════════════════════════ */
  function _buildModal(reportEl, config) {
    const {
      title = 'كشف', logo = '', shareText = '', periodText = '',
      multiPage = false,
    } = config || {};

    _injectStyles();

    // أزل أي مودال سابق
    const old = document.getElementById(_MODAL_ID);
    if (old) { old.remove(); document.body.classList.remove('ps-printing'); }

    /* إنشاء المودال */
    const overlay = document.createElement('div');
    overlay.id = _MODAL_ID;
    const scrollInner = multiPage
      ? `<div class="ps-multipage-wrap" id="ps-a4-page"></div>`
      : `<div class="ps-page" id="ps-a4-page">
           ${logo ? `<img class="ps-watermark" src="${logo}" alt="">` : ''}
           <div class="ps-report" id="ps-report-content"></div>
         </div>`;
    overlay.innerHTML = `
      <div class="ps-toolbar">
        <button class="ps-btn-close" id="ps-btn-close">✕ إغلاق</button>
        <button class="ps-btn-print" id="ps-btn-print">🖨️ طباعة</button>
        <button class="ps-btn-pdf"   id="ps-btn-pdf">📄 حفظ PDF</button>
        <button class="ps-btn-share" id="ps-btn-share">📲 مشاركة</button>
        <span class="ps-tb-sep"></span>
        <span class="ps-tb-label">الاتجاه:
          <select class="ps-tb-sel" id="ps-orient">
            <option value="portrait" selected>عمودي (A4)</option>
            <option value="landscape">أفقي (A4)</option>
          </select>
        </span>
        <span class="ps-tb-label">الهوامش:
          <select class="ps-tb-sel" id="ps-margin">
            <option value="6">ضيّق</option>
            <option value="12" selected>عادي</option>
            <option value="20">واسع</option>
          </select>
        </span>
        <span class="ps-spin" id="ps-spin"></span>
      </div>
      <div class="ps-scroll">${scrollInner}</div>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    /* أدخل محتوى التقرير */
    if (multiPage) {
      document.getElementById('ps-a4-page').appendChild(reportEl);
    } else {
      document.getElementById('ps-report-content').appendChild(reportEl);
    }

    const contentEl = document.getElementById('ps-report-content');
    const spinEl    = document.getElementById('ps-spin');
    const setSpin   = (on) => { spinEl.style.display = on ? 'inline-block' : 'none'; };

    /* اسم الملف — FIX: استبدال الرموز الخاصة ببدائل آمنة بدلاً من حذفها */
    const safeTitle = (title || 'تقرير')
      .replace(/[—–]/g, '-')                        // شرطة طويلة/متوسطة → -
      .replace(/[:：]/g, '_')                       // نقطتان → _
      .replace(/\s+/g, '_')                         // مسافات → _
      .replace(/[^a-zA-Z0-9_؀-ۿ-]/g, '') // احذف ما تبقى من رموز غير آمنة
      .replace(/_+/g, '_')                          // دمج underscores متعددة
      .replace(/^_+|_+$/g, '');                     // حذف _ من الطرفين
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const filename   = `${safeTitle || 'تقرير'}_${dateSuffix}.pdf`;

    /* بناء إعدادات html2pdf */
    const _pdfOpts = () => {
      const orient = document.getElementById('ps-orient').value;
      const base = {
        margin      : 0,
        filename,
        image       : { type: 'jpeg', quality: 0.97 },
        html2canvas : { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 },
        jsPDF       : { unit: 'mm', format: 'a4', orientation: orient },
      };
      if (multiPage) base.pagebreak = { mode: 'css', before: '.pdf-page' };
      return base;
    };

    /* توليد PDF من عنصر الصفحة: ينقله مؤقتاً خارج الـ overlay لتجنب تأثيرات position:fixed */
    const _genPdf = async (outputType = 'save') => {
      await _ensurePdfLib();
      const page   = document.getElementById('ps-a4-page');
      const parent = page.parentNode;
      const next   = page.nextSibling;
      document.body.appendChild(page);
      try {
        const gen = window.html2pdf().set(_pdfOpts()).from(page);
        return outputType === 'blob' ? gen.outputPdf('blob') : gen.save();
      } finally {
        if (next) parent.insertBefore(page, next);
        else      parent.appendChild(page);
      }
    };

    /* تحميل html2pdf — يجرب CDNs بالتسلسل */
    const _ensurePdfLib = async () => {
      if (window.html2pdf) return;
      let lastErr;
      for (const cdn of _PDF_CDNS) {
        try {
          await _loadScript(cdn);
          if (window.html2pdf) return; // نجح
        } catch (e) { lastErr = e; }
      }
      if (window.showToast) showToast('⚠️ تعذّر تحميل مكتبة PDF — تحقق من اتصال الإنترنت أو استخدم زر الطباعة كبديل', 'warning', 6000);
      throw lastErr || new Error('المكتبة لم تُحمَّل');
    };

    /* زر الإغلاق */
    const _close = () => {
      overlay.classList.add('is-closing');
      document.body.style.overflow = '';
      document.body.classList.remove('ps-printing');
      setTimeout(() => overlay.remove(), 230);
    };
    document.getElementById('ps-btn-close').addEventListener('click', _close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) _close(); });

    /* زر الطباعة */
    document.getElementById('ps-btn-print').addEventListener('click', () => {
      const orient = document.getElementById('ps-orient').value;
      const margin = document.getElementById('ps-margin').value;
      let dynStyle = document.getElementById('ps-print-dyn');
      if (!dynStyle) {
        dynStyle = document.createElement('style');
        dynStyle.id = 'ps-print-dyn';
        document.head.appendChild(dynStyle);
      }
      dynStyle.textContent = `@media print{@page{size:A4 ${orient};margin:${margin}mm;}}`;
      /* تعيين عنوان الصفحة مؤقتاً حتى يستخدمه المتصفح اسماً للملف عند "حفظ كـ PDF" */
      const origTitle = document.title;
      document.title  = safeTitle;
      document.body.classList.add('ps-printing');
      window.print();
      window.addEventListener('afterprint', () => {
        document.title = origTitle;
        document.body.classList.remove('ps-printing');
      }, { once: true });
    });

    /* زر حفظ PDF */
    document.getElementById('ps-btn-pdf').addEventListener('click', async () => {
      setSpin(true);
      try {
        await _genPdf('save');
        if (window.showToast) showToast('✅ تم حفظ ملف PDF بنجاح', 'success', 2500);
      } catch (e) {
        if (window.showToast) showToast('❌ خطأ في توليد PDF: ' + e.message, 'error');
        else console.error('PDF error:', e);
      }
      setSpin(false);
    });

    /* زر المشاركة */
    document.getElementById('ps-btn-share').addEventListener('click', async () => {
      setSpin(true);
      const txt = shareText || `${title}\n${periodText}`;

      const _textShare = async () => {
        if (navigator.share) {
          await navigator.share({ title, text: txt }).catch(() => {});
        } else {
          window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(txt), '_blank');
        }
      };

      try {
        /* حاول مشاركة PDF أولاً */
        let sharedAsPdf = false;
        try {
          const blob = await _genPdf('blob');
          const file = new File([blob], filename, { type: 'application/pdf' });
          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title, text: txt, files: [file] });
            sharedAsPdf = true;
          }
        } catch (pdfErr) {
          if (pdfErr.name === 'AbortError') throw pdfErr;
          /* CDN فاشل أو الجهاز لا يدعم مشاركة الملفات — تراجع للنص */
        }
        if (!sharedAsPdf) await _textShare();
      } catch (e) {
        if (e.name !== 'AbortError') {
          if (window.showToast) showToast('❌ خطأ في المشاركة: ' + e.message, 'error');
        }
      }
      setSpin(false);
    });

    /* تحديث حجم A4 عند تغيير الاتجاه */
    document.getElementById('ps-orient').addEventListener('change', (e) => {
      const isLandscape = e.target.value === 'landscape';
      if (multiPage) {
        document.querySelectorAll('.pdf-page').forEach(pg => {
          pg.style.width     = isLandscape ? '297mm' : '210mm';
          pg.style.minHeight = isLandscape ? '210mm' : '297mm';
        });
      } else {
        const page = document.getElementById('ps-a4-page');
        page.style.width     = isLandscape ? '297mm' : '210mm';
        page.style.minHeight = isLandscape ? '210mm' : '297mm';
      }
    });
  }

  /* ══════════════════════════════════════════════════════
     printStatementAdvanced — الكشوف المحاسبية
  ══════════════════════════════════════════════════════ */
  function printStatementAdvanced(config) {
    const {
      title = 'كشف حساب', subtitle = '', periodText = '', userName = '',
      logo = '', columns = [], rows = [], totalsLine = '', accountId = '',
      shareText = '',
    } = config || {};

    const ts = new Date().toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    const lakumIdx   = columns.findIndex(c => String(c).includes('لكم') && !String(c).includes('عليكم'));
    const alaykumIdx = columns.findIndex(c => String(c).includes('عليكم'));

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

    // تقسيم الصفوف (20 صف لكل صفحة — أقل من 22 لمنح مساحة للترويسة والتذييل)
    const rowsPerPage = 20;
    const totalPages  = Math.max(1, Math.ceil(rows.length / rowsPerPage));

    // الشعار/العلامة المائية
    const watermarkHTML = logo ? `<img class="ps-watermark" src="${logo}" alt="">` : '';

    // ترويسة الصفحة المدمجة
    const pageHeaderHTML = (pageNum) => `
      <div class="pdf-page-header">
        <div>
          <div class="doc-title" style="font-size:17px;">${_esc(title)}</div>
          ${subtitle  ? `<div class="doc-sub">${_esc(subtitle)}</div>`   : ''}
          ${accountId ? `<div class="doc-acct">معرف الحساب: ${_esc(accountId)}</div>` : ''}
        </div>
        <div class="pdf-page-meta">
          ${logo ? `<img class="doc-logo" src="${logo}" alt="شعار" style="height:50px;margin-bottom:4px;">` : ''}
          ${periodText ? `<div class="doc-period" style="font-size:11px;">${_esc(periodText)}</div>` : ''}
          ${userName   ? `<div class="doc-user">${_esc(userName)}</div>` : ''}
          <div class="pdf-page-num">صفحة ${pageNum} من ${totalPages}</div>
        </div>
      </div>`;

    // تذييل الصفحة الثابت
    const pageFooterHTML = (pageNum) => `
      <div class="pdf-page-footer">
        <span><b>نظام أبو حذيفة للصرافة والتحويلات</b></span>
        <span>صفحة ${pageNum} / ${totalPages} · طُبع: ${ts}</span>
      </div>`;

    // بناء الصفحات
    let pagesHTML = '';
    for (let p = 0; p < totalPages; p++) {
      const chunk      = rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
      const isLastPage = p === totalPages - 1;
      const tbodyHTML  = chunk.map((r, ri) => {
        const absIdx = p * rowsPerPage + ri;
        return `<tr class="${absIdx % 2 === 1 ? 'ps-even' : ''}">${
          r.map((c, ci) => `<td${getCellAttr(ci, c)}>${c ?? '—'}</td>`).join('')
        }</tr>`;
      }).join('');

      pagesHTML += `<div class="pdf-page">
        ${watermarkHTML}
        ${pageHeaderHTML(p + 1)}
        <div class="pdf-page-body">
          <div class="table-wrap">
            <table>
              <thead>${theadHTML}</thead>
              <tbody>${tbodyHTML}</tbody>
            </table>
            ${isLastPage && totalsLine ? `<div class="totals">${totalsLine}</div>` : ''}
          </div>
        </div>
        ${pageFooterHTML(p + 1)}
      </div>`;
    }

    const wrapEl = document.createElement('div');
    wrapEl.innerHTML = pagesHTML;

    _buildModal(wrapEl, { title, logo, shareText, periodText, multiPage: true });
  }

  /* ══════════════════════════════════════════════════════
     printHTML — طباعة محتوى HTML مخصص (كشف بنكي، إلخ)
  ══════════════════════════════════════════════════════ */
  function printHTML(contentHTML, { title = 'تقرير', logo = '', shareText = '', periodText = '' } = {}) {
    const reportEl = document.createElement('div');
    reportEl.innerHTML = contentHTML;
    _buildModal(reportEl, { title, logo, shareText, periodText });
  }

  /* ══════════════════════════════════════════════════════
     buildStatementPrintData — محوّل المعاملات الخام
  ══════════════════════════════════════════════════════ */
  function buildStatementPrintData(transactions, { date, userName, companies, banks, users } = {}) {
    const LAKUM_TYPES  = new Set(['deposit', 'delivery']);
    const TYPE_LABELS  = window.TRANSACTION_TYPE_LABELS || {};
    const fmt          = n => Math.abs(Math.round(n)).toLocaleString('en-US');

    const companiesMap = new Map((Array.isArray(companies) ? companies : []).map(c => [c.id, c.name]));
    const banksMap     = new Map((Array.isArray(banks)     ? banks     : []).map(b => [b.id, b.name]));
    const usersMap     = new Map((Array.isArray(users)     ? users     : []).map(u => [u.id, u.display_name]));

    const fmtTime = (tx) => {
      if (tx.created_at)
        return new Date(tx.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
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
        isLakum  ? amt.toLocaleString('en-US') : '0',
        !isLakum ? amt.toLocaleString('en-US') : '0',
        _describe(tx),
      ];
    });

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
     buildStatementPrintDataFromLedger — محوّل قيود دفتر الأستاذ
     entries : صفوف account_ledger { date, time, label, credit, debit, details }
  ══════════════════════════════════════════════════════ */
  function buildStatementPrintDataFromLedger(entries, { date, userName, accountId } = {}) {
    const fmt = n => Math.abs(Math.round(n)).toLocaleString('en-US');
    const list = Array.isArray(entries) ? entries : [];

    let totalLakum = 0, totalAlaykum = 0;

    const rows = list.map(e => {
      const credit = Math.round(parseFloat(e.credit || 0));
      const debit  = Math.round(parseFloat(e.debit  || 0));
      totalLakum   += credit;
      totalAlaykum += debit;
      return [
        e.date  || date || '—',
        e.time  ? String(e.time).substring(0, 5) : '—',
        e.label || '—',
        credit > 0 ? credit.toLocaleString('en-US') : '0',
        debit  > 0 ? debit.toLocaleString('en-US')  : '0',
        e.details || '—',
      ];
    });

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
      date      ? `📅 ${date}`        : '',
      userName  ? `👤 ${userName}`     : '',
      accountId ? `🔑 ${accountId}`   : '',
      '────────────────',
      `✅ لكم:    ${fmt(totalLakum)} ر.س`,
      `❌ عليكم:  ${fmt(totalAlaykum)} ر.س`,
      `💰 الصافي: ${fmt(net)} ${netSign} ر.س`,
      `📋 عدد القيود: ${list.length}`,
    ].filter(Boolean).join('\n');

    return {
      columns: ['التاريخ', 'الوقت', 'البيان', 'لكم (ر.س)', 'عليكم (ر.س)', 'التفاصيل'],
      rows, totalsLine, totalsText, shareText,
      totalLakum, totalAlaykum, net, netSign,
    };
  }

  /* ══════════════════════════════════════════════════════
     exportToExcel — SheetJS
  ══════════════════════════════════════════════════════ */
  async function exportToExcel(headers, rows, sheetName, filename) {
    if (!window.XLSX) {
      await _loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    }
    const XLSX = window.XLSX;
    if (!XLSX) throw new Error('مكتبة XLSX غير متاحة — تحقق من الاتصال بالإنترنت');

    const allRows = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    ws['!views']  = [{ rightToLeft: true }];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!cols']   = headers.map((h, ci) => {
      const maxLen = allRows.reduce((m, r) => Math.max(m, String(r[ci] ?? '').length), 0);
      return { wch: Math.min(35, Math.max(14, maxLen + 2)) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'تقرير').slice(0, 31));
    XLSX.writeFile(wb, `${filename}.xlsx`);
  }

  /* ══════════════════════════════════════════════════════
     الدوال العامة المتبقية (متوافقة مع الكود القديم)
  ══════════════════════════════════════════════════════ */

  /* مشاركة نص */
  function share(text, { title = 'مشاركة' } = {}) {
    if (navigator.share) { navigator.share({ title, text }).catch(() => {}); return; }
    window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
  }

  /* نسخ نص */
  async function copyText(text, successMsg = 'تم النسخ') {
    try {
      await navigator.clipboard.writeText(text);
      if (window.showToast) showToast('✅ ' + successMsg, 'success', 2000);
    } catch {
      if (window.showToast) showToast('❌ تعذّر النسخ — حاول يدوياً', 'error', 3000);
    }
  }

  /* بناء جدول HTML بسيط */
  function buildTable(headers, rows, footerRow) {
    return `<table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(row =>
          `<tr>${row.map((cell) => {
            const align = typeof cell === 'number' || (typeof cell === 'string' && /^\d/.test(cell.trim()))
              ? ' style="direction:ltr;text-align:left;"' : '';
            return `<td${align}>${cell ?? '—'}</td>`;
          }).join('')}</tr>`
        ).join('')}
      </tbody>
      ${footerRow ? `<tfoot><tr>${footerRow.map(c => `<td>${c ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
    </table>`;
  }

  /* print القديمة (تُبقي على التوافق مع أي كود قديم) */
  function print(config) {
    const {
      title = '', subtitle = '', date = '', userName = '', logo = '',
      statsCards = [], tableHTML = '', footerExtra = '',
    } = config || {};
    /* نبني HTML مؤقتاً ونعرضه في مودال */
    const ts = new Date().toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const statsHTML = statsCards.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px;">${
      statsCards.map(c => `<div style="background:#f8fafc;border-radius:10px;padding:12px 14px;border-right:3px solid ${c.color||'#0f172a'};">
        <div style="font-size:8pt;color:#64748b;margin-bottom:5px;">${c.label}</div>
        <div style="font-size:13pt;font-weight:800;color:${c.color||'#0f172a'};direction:ltr;text-align:right;">${c.value}</div>
      </div>`).join('')
    }</div>` : '';

    const el = document.createElement('div');
    el.innerHTML = `
      <div class="doc-header">
        <div>
          <div class="doc-title">${_esc(title)}</div>
          ${subtitle ? `<div class="doc-sub">${_esc(subtitle)}</div>` : ''}
        </div>
        <div class="doc-meta">
          ${logo ? `<img class="doc-logo" src="${logo}" alt="شعار">` : ''}
          ${date ? `<div class="doc-period">${_esc(date)}</div>` : ''}
          ${userName ? `<div class="doc-user">${_esc(userName)}</div>` : ''}
        </div>
      </div>
      ${statsHTML}
      ${tableHTML || ''}
      <div class="doc-footer">
        <span><b>نظام أبو حذيفة للصرافة والتحويلات</b></span>
        <span>${footerExtra ? footerExtra + ' | ' : ''}طُبع: ${ts}</span>
      </div>`;
    _buildModal(el, { title, logo });
  }

  return {
    print, share, copyText, buildTable,
    printStatementAdvanced, printHTML,
    exportToExcel, buildStatementPrintData, buildStatementPrintDataFromLedger,
  };
})();

window.PrintService = PrintService;
