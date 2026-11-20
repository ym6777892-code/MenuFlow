/* MenuFlow — public menu. All menu data is read from Supabase. */
(function () {
  'use strict';

  var CFG = window.MENUFLOW_CONFIG || {};
  var sb = window.sb;

  var I18N = {
    ar: {
      brandName: 'ليالي الشام', brandSub: 'LAYALI AL-SHAM', badge: 'قائمة الطعام',
      heroTitle: 'نكهة أصيلة، <span>وتجربة لا تُنسى</span>',
      heroText: 'أطباق شامية ومصرية محضّرة يوميًا من أجود المكوّنات الطازجة.',
      searchPh: 'ابحث في القائمة...', all: 'الكل', toggle: 'EN',
      footer: '© ليالي الشام — جميع الحقوق محفوظة. الأسعار بالجنيه المصري.',
      loading: 'جارٍ تحميل القائمة...',
      emptyTitle: 'لا توجد أطباق مطابقة', emptyText: 'جرّب كلمة بحث أخرى أو اختر قسمًا مختلفًا.',
      emptyMenuTitle: 'القائمة غير متاحة حاليًا', emptyMenuText: 'لم تتم إضافة أي أطباق بعد.',
      errTitle: 'تعذّر تحميل القائمة', errText: 'تحقّق من اتصالك بالإنترنت ثم حاول مجددًا.',
      retry: 'إعادة المحاولة',
      setupTitle: 'لم يتم ربط الموقع بقاعدة البيانات بعد',
      setupText: 'أضف رابط مشروع Supabase والمفتاح العام داخل الملف js/config.js (راجع README.md).',
      items: 'طبق'
    },
    en: {
      brandName: 'Layali Al-Sham', brandSub: 'ليالي الشام', badge: 'Our Menu',
      heroTitle: 'Authentic flavors, <span>unforgettable moments</span>',
      heroText: 'Levantine and Egyptian dishes prepared daily from the freshest ingredients.',
      searchPh: 'Search the menu...', all: 'All', toggle: 'عربي',
      footer: '© Layali Al-Sham — All rights reserved. Prices in Egyptian Pounds.',
      loading: 'Loading the menu...',
      emptyTitle: 'No matching dishes', emptyText: 'Try another search or pick a different category.',
      emptyMenuTitle: 'Menu is not available yet', emptyMenuText: 'No dishes have been added yet.',
      errTitle: 'Could not load the menu', errText: 'Check your internet connection and try again.',
      retry: 'Try again',
      setupTitle: 'The site is not connected to the database yet',
      setupText: 'Add your Supabase project URL and public key in js/config.js (see README.md).',
      items: 'items'
    }
  };

  var ICON_FORK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M5 3v6M17 21V3c-2 1-3 4-3 8 0 2 1 2 3 2"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

  var state = { lang: 'ar', categories: [], products: [], cat: 'all', query: '', status: 'loading' };
  var root = document.getElementById('menuRoot');
  var chipsEl = document.getElementById('chips');
  var searchEl = document.getElementById('searchInput');
  var observer = null;

  /* ---------- helpers ---------- */
  function t(key) { return I18N[state.lang][key]; }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function safeUrl(u) {
    try {
      var url = new URL(u, location.href);
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : '';
    } catch (e) { return ''; }
  }

  function pick(ar, en) {
    return state.lang === 'ar' ? (ar || en || '') : (en || ar || '');
  }

  function formatPrice(n) {
    var locale = state.lang === 'ar' ? 'ar-EG' : 'en-US';
    var num = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n));
    return num + ' ' + (state.lang === 'ar' ? CFG.CURRENCY_AR : CFG.CURRENCY_EN);
  }

  // Normalize text so Arabic search ignores diacritics and letter variants.
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .trim();
  }

  function safeStorage(op, key, val) {
    try { return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, val); } catch (e) { return null; }
  }

  /* ---------- language ---------- */
  function applyLang() {
    var lang = state.lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = lang === 'ar' ? 'ليالي الشام | قائمة الطعام' : 'Layali Al-Sham | Menu';
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.getElementById('langToggle').textContent = t('toggle');
    render();
  }

  /* ---------- data ---------- */
  function load() {
    if (!CFG.isConfigured || !sb) { state.status = 'setup'; render(); return Promise.resolve(); }
    state.status = 'loading'; render();

    var catsReq = sb.from('categories').select('*').eq('is_active', true)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
    var prodsReq = sb.from('products').select('*').eq('is_available', true)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true });

    return Promise.all([catsReq, prodsReq]).then(function (res) {
      if (res[0].error) throw res[0].error;
      if (res[1].error) throw res[1].error;
      state.categories = res[0].data || [];
      var ids = {};
      state.categories.forEach(function (c) { ids[c.id] = true; });
      state.products = (res[1].data || []).filter(function (p) { return ids[p.category_id]; });
      if (state.cat !== 'all' && !ids[state.cat]) state.cat = 'all';
      state.status = 'ready';
      render();
    }).catch(function (err) {
      console.error('MenuFlow load error:', err);
      state.status = 'error';
      render();
    });
  }

  /* ---------- rendering ---------- */
  function renderChips() {
    if (state.status !== 'ready' || !state.categories.length) { chipsEl.innerHTML = ''; return; }
    var html = '<button type="button" role="tab" class="chip' + (state.cat === 'all' ? ' active' : '') +
      '" data-cat="all" aria-selected="' + (state.cat === 'all') + '">' + esc(t('all')) + '</button>';
    state.categories.forEach(function (c) {
      var active = state.cat === c.id;
      html += '<button type="button" role="tab" class="chip' + (active ? ' active' : '') + '" data-cat="' + esc(c.id) +
        '" aria-selected="' + active + '">' + esc(pick(c.name_ar, c.name_en)) + '</button>';
    });
    chipsEl.innerHTML = html;
  }

  function card(p) {
    var img = p.image_url && safeUrl(p.image_url);
    var media = img
      ? '<img src="' + esc(img) + '" alt="' + esc(pick(p.name_ar, p.name_en)) + '" loading="lazy">'
      : '<div class="ph">' + ICON_FORK + '</div>';
    var desc = pick(p.description_ar, p.description_en);
    return '<article class="card reveal"><div class="card-media">' + media + '</div><div class="card-body">' +
      '<div class="card-top"><h3 class="card-name">' + esc(pick(p.name_ar, p.name_en)) + '</h3>' +
      '<span class="price">' + esc(formatPrice(p.price)) + '</span></div>' +
      (desc ? '<p class="card-desc">' + esc(desc) + '</p>' : '') + '</div></article>';
  }

  function messageState(icon, title, text, withRetry) {
    return '<div class="state">' + icon + '<h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' +
      (withRetry ? '<button type="button" class="btn btn-primary" data-action="retry">' + esc(t('retry')) + '</button>' : '') + '</div>';
  }

  function render() {
    renderChips();

    if (state.status === 'loading') {
      var sk = ''; for (var i = 0; i < 6; i++) sk += '<div class="skeleton"></div>';
      root.innerHTML = '<div class="skeleton-grid" aria-busy="true" aria-label="' + esc(t('loading')) + '">' + sk + '</div>';
      return;
    }
    if (state.status === 'setup') { root.innerHTML = messageState(ICON_WARN, t('setupTitle'), t('setupText'), false); return; }
    if (state.status === 'error') { root.innerHTML = messageState(ICON_WARN, t('errTitle'), t('errText'), true); return; }

    if (!state.products.length) { root.innerHTML = messageState(ICON_FORK, t('emptyMenuTitle'), t('emptyMenuText'), false); return; }

    var q = norm(state.query);
    var html = '';
    state.categories.forEach(function (c) {
      if (state.cat !== 'all' && state.cat !== c.id) return;
      var items = state.products.filter(function (p) {
        if (p.category_id !== c.id) return false;
        if (!q) return true;
        return norm([p.name_ar, p.name_en, p.description_ar, p.description_en].join(' ')).indexOf(q) !== -1;
      });
      if (!items.length) return;
      html += '<h2 class="section-title reveal">' + esc(pick(c.name_ar, c.name_en)) +
        ' <small>' + items.length + ' ' + esc(t('items')) + '</small></h2><div class="grid">' + items.map(card).join('') + '</div>';
    });

    root.innerHTML = html || messageState(ICON_FORK, t('emptyTitle'), t('emptyText'), false);
    observeReveals();
  }

  function observeReveals() {
    var els = root.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); observer.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -40px 0px' });
    }
    els.forEach(function (e) { observer.observe(e); });
  }

  /* ---------- events ---------- */
  chipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat;
    render();
  });

  var searchTimer;
  searchEl.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { state.query = searchEl.value; render(); }, 120);
  });

  root.addEventListener('click', function (e) {
    if (e.target.closest('[data-action="retry"]')) load();
  });

  // Broken image → neutral placeholder
  root.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el.tagName === 'IMG') {
      var ph = document.createElement('div');
      ph.className = 'ph'; ph.innerHTML = ICON_FORK;
      el.replaceWith(ph);
    }
  }, true);

  document.getElementById('langToggle').addEventListener('click', function () {
    state.lang = state.lang === 'ar' ? 'en' : 'ar';
    safeStorage('set', 'menuflow_lang', state.lang); // UI preference only, not menu data
    applyLang();
  });

  window.addEventListener('scroll', function () {
    document.getElementById('siteHeader').classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  /* ---------- init ---------- */
  var saved = safeStorage('get', 'menuflow_lang');
  state.lang = saved === 'en' ? 'en' : 'ar'; // Arabic is the default
  applyLang();
  load();
})();
