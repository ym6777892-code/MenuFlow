/* MenuFlow — admin dashboard. Every operation talks to Supabase. */
(function () {
  'use strict';

  var CFG = window.MENUFLOW_CONFIG || {};
  var sb = window.sb;
  var BUCKET = CFG.STORAGE_BUCKET || 'product-images';
  var MAX_IMAGE = 3 * 1024 * 1024;
  var ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M5 3v6M17 21V3c-2 1-3 4-3 8 0 2 1 2 3 2"/></svg>';

  var state = {
    user: null, categories: [], products: [],
    editingProduct: null, editingCategory: null,
    pendingFile: null, removeImage: false,
    filterQ: '', filterCat: 'all', handlingSession: false
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- helpers ---------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) {
    try { var x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; }
  }
  function money(n) {
    return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(n)) + ' ' + (CFG.CURRENCY_AR || '');
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
  }
  function catName(id) {
    var c = state.categories.find(function (x) { return x.id === id; });
    return c ? c.name_ar : '—';
  }

  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'success');
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, type === 'error' ? 5000 : 3000);
    setTimeout(function () { el.remove(); }, type === 'error' ? 5400 : 3400);
  }

  function friendlyError(err) {
    var msg = (err && err.message) || '';
    var code = err && err.code;
    if (/invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    if (/email not confirmed/i.test(msg)) return 'لم يتم تأكيد البريد الإلكتروني لهذا الحساب بعد.';
    if (code === '23503') return 'لا يمكن حذف قسم يحتوي على أطباق. انقل الأطباق أو احذفها أولًا.';
    if (code === '42501' || /row-level security|permission denied|not authorized/i.test(msg)) return 'ليست لديك صلاحية تنفيذ هذه العملية.';
    if (/failed to fetch|networkerror|network request/i.test(msg)) return 'تعذّر الاتصال. تحقّق من الإنترنت وحاول مجددًا.';
    if (/payload too large|exceeded the maximum/i.test(msg)) return 'حجم الصورة أكبر من المسموح.';
    return 'حدث خطأ غير متوقع' + (msg ? ': ' + msg : '.');
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> ' + esc(label || 'جارٍ التنفيذ...');
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || btn.textContent;
    }
  }

  function showView(name) {
    ['config', 'login', 'denied', 'app'].forEach(function (v) { $('#view-' + v).hidden = v !== name; });
  }

  function openModal(id) { $('#' + id).hidden = false; document.body.classList.add('modal-open'); }
  function closeModal(id) {
    $('#' + id).hidden = true;
    if (!document.querySelector('.modal-backdrop:not([hidden])')) document.body.classList.remove('modal-open');
  }

  function confirmDialog(text) {
    return new Promise(function (resolve) {
      $('#confirmText').textContent = text;
      openModal('confirmModal');
      var ok = $('#confirmOk');
      function done(v) {
        ok.removeEventListener('click', onOk);
        $('#confirmModal').removeEventListener('click', onClose);
        closeModal('confirmModal');
        resolve(v);
      }
      function onOk() { done(true); }
      function onClose(e) { if (e.target.closest('[data-close]') || e.target.id === 'confirmModal') done(false); }
      ok.addEventListener('click', onOk);
      $('#confirmModal').addEventListener('click', onClose);
    });
  }

  /* ---------- auth ---------- */
  async function handleSession(session) {
    if (state.handlingSession) return;
    state.handlingSession = true;
    try {
      if (!session) { state.user = null; showView('login'); return; }
      state.user = session.user;
      var res = await sb.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
      if (res.error) throw res.error;
      if (!res.data) { showView('denied'); return; }
      $('#adminEmail').textContent = session.user.email || '';
      showView('app');
      await loadData();
    } catch (err) {
      console.error(err);
      showView('login');
      $('#loginError').textContent = friendlyError(err);
    } finally {
      state.handlingSession = false;
    }
  }

  $('#loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = $('#loginEmail').value.trim();
    var password = $('#loginPassword').value;
    var errEl = $('#loginError');
    errEl.textContent = '';
    if (!email || !password) { errEl.textContent = 'أدخل البريد الإلكتروني وكلمة المرور.'; return; }
    var btn = $('#loginBtn');
    setBusy(btn, true, 'جارٍ الدخول...');
    var res = await sb.auth.signInWithPassword({ email: email, password: password });
    setBusy(btn, false);
    if (res.error) { errEl.textContent = friendlyError(res.error); return; }
    $('#loginPassword').value = '';
    // onAuthStateChange will route to the dashboard.
  });

  async function logout() {
    var res = await sb.auth.signOut();
    if (res.error) { toast(friendlyError(res.error), 'error'); return; }
    state.categories = []; state.products = [];
    showView('login');
  }

  /* ---------- data ---------- */
  async function loadData() {
    $('#productList').innerHTML = '<div class="state"><span class="spinner"></span></div>';
    $('#categoryList').innerHTML = '<div class="state"><span class="spinner"></span></div>';
    var res = await Promise.all([
      sb.from('categories').select('*').order('sort_order').order('created_at'),
      sb.from('products').select('*').order('sort_order').order('created_at')
    ]);
    if (res[0].error || res[1].error) {
      var err = res[0].error || res[1].error;
      toast(friendlyError(err), 'error');
      var retry = '<div class="state"><h3>تعذّر تحميل البيانات</h3><button class="btn btn-primary" data-action="reload" type="button">إعادة المحاولة</button></div>';
      $('#productList').innerHTML = retry; $('#categoryList').innerHTML = retry;
      return;
    }
    state.categories = res[0].data || [];
    state.products = res[1].data || [];
    renderAll();
  }

  /* ---------- rendering ---------- */
  function renderAll() { renderCatFilter(); renderCategories(); renderProducts(); }

  function renderCatFilter() {
    var sel = $('#productCatFilter');
    var html = '<option value="all">كل الأقسام</option>' + state.categories.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name_ar) + '</option>';
    }).join('');
    sel.innerHTML = html;
    if (state.filterCat !== 'all' && !state.categories.some(function (c) { return c.id === state.filterCat; })) state.filterCat = 'all';
    sel.value = state.filterCat;
  }

  function renderProducts() {
    var list = $('#productList');
    if (!state.categories.length) {
      list.innerHTML = '<div class="state">' + ICON + '<h3>أضف قسمًا أولًا</h3><p>تحتاج إلى قسم واحد على الأقل قبل إضافة الأطباق.</p></div>';
      return;
    }
    var q = norm(state.filterQ);
    var items = state.products.filter(function (p) {
      if (state.filterCat !== 'all' && p.category_id !== state.filterCat) return false;
      return !q || norm([p.name_ar, p.name_en, p.description_ar, p.description_en].join(' ')).indexOf(q) !== -1;
    });
    if (!items.length) {
      list.innerHTML = '<div class="state">' + ICON + '<h3>لا توجد أطباق</h3><p>' +
        (state.products.length ? 'لا توجد نتائج مطابقة.' : 'اضغط «إضافة طبق جديد» للبدء.') + '</p></div>';
      return;
    }
    list.innerHTML = items.map(function (p) {
      var img = p.image_url && safeUrl(p.image_url);
      var thumb = img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<div class="ph">' + ICON + '</div>';
      return '<div class="item" data-id="' + esc(p.id) + '">' +
        '<div class="thumb">' + thumb + '</div>' +
        '<div class="item-info"><p class="item-title">' + esc(p.name_ar) + '</p>' +
        '<div class="item-meta"><span>' + esc(catName(p.category_id)) + '</span><span class="price">' + esc(money(p.price)) + '</span>' +
        '<span class="badge ' + (p.is_available ? 'on' : 'off') + '">' + (p.is_available ? 'ظاهر' : 'مخفي') + '</span></div></div>' +
        '<div class="item-actions">' +
        '<label class="switch" title="إظهار / إخفاء"><input type="checkbox" data-action="toggle-product" ' + (p.is_available ? 'checked' : '') + '><span class="track"></span><span>ظاهر</span></label>' +
        '<button class="btn btn-sm" data-action="edit-product" type="button">تعديل</button>' +
        '<button class="btn btn-sm btn-danger" data-action="delete-product" type="button">حذف</button>' +
        '</div></div>';
    }).join('');
  }

  function renderCategories() {
    var list = $('#categoryList');
    if (!state.categories.length) {
      list.innerHTML = '<div class="state">' + ICON + '<h3>لا توجد أقسام</h3><p>اضغط «إضافة قسم جديد» للبدء.</p></div>';
      return;
    }
    list.innerHTML = state.categories.map(function (c) {
      var count = state.products.filter(function (p) { return p.category_id === c.id; }).length;
      return '<div class="item cat" data-id="' + esc(c.id) + '">' +
        '<div class="item-info"><p class="item-title">' + esc(c.name_ar) + (c.name_en ? ' — ' + esc(c.name_en) : '') + '</p>' +
        '<div class="item-meta"><span>' + count + ' طبق</span><span class="badge ' + (c.is_active ? 'on' : 'off') + '">' + (c.is_active ? 'ظاهر' : 'مخفي') + '</span></div></div>' +
        '<div class="item-actions">' +
        '<label class="switch" title="إظهار / إخفاء"><input type="checkbox" data-action="toggle-category" ' + (c.is_active ? 'checked' : '') + '><span class="track"></span><span>ظاهر</span></label>' +
        '<button class="btn btn-sm" data-action="edit-category" type="button">تعديل</button>' +
        '<button class="btn btn-sm btn-danger" data-action="delete-category" type="button">حذف</button>' +
        '</div></div>';
    }).join('');
  }

  /* ---------- storage ---------- */
  async function uploadImage(file) {
    var ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    var path = 'products/' + id + '.' + ext;
    var up = await sb.storage.from(BUCKET).upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type });
    if (up.error) throw up.error;
    var pub = sb.storage.from(BUCKET).getPublicUrl(path);
    return { path: path, url: pub.data.publicUrl };
  }
  async function removeImage(path) {
    if (!path) return;
    var res = await sb.storage.from(BUCKET).remove([path]);
    if (res.error) console.warn('Could not delete old image:', res.error);
  }

  /* ---------- product modal ---------- */
  function setPreview(url) {
    var box = $('#pImgPreview');
    box.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '<div class="ph">' + ICON + '</div>';
    $('#pImgRemove').hidden = !url;
  }

  function openProductModal(product) {
    if (!state.categories.length) { toast('أضف قسمًا أولًا قبل إضافة الأطباق.', 'error'); return; }
    state.editingProduct = product || null;
    state.pendingFile = null; state.removeImage = false;
    $('#productModalTitle').textContent = product ? 'تعديل الطبق' : 'إضافة طبق جديد';
    $('#pCategory').innerHTML = state.categories.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name_ar) + '</option>';
    }).join('');
    $('#pCategory').value = product ? product.category_id : (state.filterCat !== 'all' ? state.filterCat : state.categories[0].id);
    $('#pNameAr').value = product ? product.name_ar : '';
    $('#pNameEn').value = product ? (product.name_en || '') : '';
    $('#pDescAr').value = product ? (product.description_ar || '') : '';
    $('#pDescEn').value = product ? (product.description_en || '') : '';
    $('#pPrice').value = product ? product.price : '';
    $('#pSort').value = product ? product.sort_order : 0;
    $('#pAvailable').checked = product ? product.is_available : true;
    $('#pImage').value = '';
    $('#productError').textContent = '';
    setPreview(product && product.image_url ? safeUrl(product.image_url) : '');
    openModal('productModal');
    $('#pNameAr').focus();
  }

  $('#pImage').addEventListener('change', function (e) {
    var file = e.target.files[0];
    var errEl = $('#productError');
    errEl.textContent = '';
    if (!file) return;
    if (ALLOWED.indexOf(file.type) === -1) { errEl.textContent = 'نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.'; e.target.value = ''; return; }
    if (file.size > MAX_IMAGE) { errEl.textContent = 'حجم الصورة أكبر من 3 ميجابايت.'; e.target.value = ''; return; }
    state.pendingFile = file; state.removeImage = false;
    var reader = new FileReader();
    reader.onload = function () { setPreview(reader.result); };
    reader.readAsDataURL(file);
  });

  $('#pImgRemove').addEventListener('click', function () {
    state.pendingFile = null; state.removeImage = true;
    $('#pImage').value = '';
    setPreview('');
  });

  $('#productForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = $('#productError');
    errEl.textContent = '';

    var nameAr = $('#pNameAr').value.trim();
    var priceRaw = $('#pPrice').value.trim();
    var price = Number(priceRaw);
    if (!nameAr) { errEl.textContent = 'اسم الطبق بالعربي مطلوب.'; return; }
    if (priceRaw === '' || !isFinite(price) || price < 0) { errEl.textContent = 'أدخل سعرًا صحيحًا (رقم 0 أو أكبر).'; return; }

    var editing = state.editingProduct;
    var btn = $('#productSaveBtn');
    setBusy(btn, true, 'جارٍ الحفظ...');

    var uploaded = null;
    try {
      var image_url = editing ? editing.image_url : null;
      var image_path = editing ? editing.image_path : null;
      var oldPath = image_path;

      if (state.pendingFile) {
        uploaded = await uploadImage(state.pendingFile);
        image_url = uploaded.url; image_path = uploaded.path;
      } else if (state.removeImage) {
        image_url = null; image_path = null;
      }

      var payload = {
        category_id: $('#pCategory').value,
        name_ar: nameAr,
        name_en: $('#pNameEn').value.trim() || null,
        description_ar: $('#pDescAr').value.trim() || null,
        description_en: $('#pDescEn').value.trim() || null,
        price: Math.round(price * 100) / 100,
        sort_order: parseInt($('#pSort').value, 10) || 0,
        is_available: $('#pAvailable').checked,
        image_url: image_url,
        image_path: image_path
      };

      var res = editing
        ? await sb.from('products').update(payload).eq('id', editing.id).select().single()
        : await sb.from('products').insert(payload).select().single();
      if (res.error) throw res.error;

      if (oldPath && oldPath !== image_path) await removeImage(oldPath);

      closeModal('productModal');
      toast(editing ? 'تم حفظ التعديلات بنجاح.' : 'تمت إضافة الطبق بنجاح.');
      await loadData();
    } catch (err) {
      console.error(err);
      if (uploaded) await removeImage(uploaded.path); // do not leave orphan uploads
      errEl.textContent = friendlyError(err);
      toast(friendlyError(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  /* ---------- category modal ---------- */
  function openCategoryModal(cat) {
    state.editingCategory = cat || null;
    $('#categoryModalTitle').textContent = cat ? 'تعديل القسم' : 'إضافة قسم جديد';
    $('#cNameAr').value = cat ? cat.name_ar : '';
    $('#cNameEn').value = cat ? (cat.name_en || '') : '';
    $('#cSort').value = cat ? cat.sort_order : (state.categories.length + 1);
    $('#cActive').checked = cat ? cat.is_active : true;
    $('#categoryError').textContent = '';
    openModal('categoryModal');
    $('#cNameAr').focus();
  }

  $('#categoryForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var errEl = $('#categoryError');
    errEl.textContent = '';
    var nameAr = $('#cNameAr').value.trim();
    if (!nameAr) { errEl.textContent = 'اسم القسم بالعربي مطلوب.'; return; }
    var payload = {
      name_ar: nameAr,
      name_en: $('#cNameEn').value.trim() || null,
      sort_order: parseInt($('#cSort').value, 10) || 0,
      is_active: $('#cActive').checked
    };
    var editing = state.editingCategory;
    var btn = $('#categorySaveBtn');
    setBusy(btn, true, 'جارٍ الحفظ...');
    try {
      var res = editing
        ? await sb.from('categories').update(payload).eq('id', editing.id).select().single()
        : await sb.from('categories').insert(payload).select().single();
      if (res.error) throw res.error;
      closeModal('categoryModal');
      toast(editing ? 'تم حفظ القسم بنجاح.' : 'تمت إضافة القسم بنجاح.');
      await loadData();
    } catch (err) {
      console.error(err);
      errEl.textContent = friendlyError(err);
      toast(friendlyError(err), 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  /* ---------- row actions ---------- */
  async function toggleProduct(id, value, checkbox) {
    checkbox.disabled = true;
    var res = await sb.from('products').update({ is_available: value }).eq('id', id);
    if (res.error) {
      checkbox.checked = !value; checkbox.disabled = false;
      toast(friendlyError(res.error), 'error'); return;
    }
    var p = state.products.find(function (x) { return x.id === id; });
    if (p) p.is_available = value;
    toast(value ? 'الطبق الآن ظاهر للزبائن.' : 'تم إخفاء الطبق عن الزبائن.');
    renderProducts();
  }

  async function toggleCategory(id, value, checkbox) {
    checkbox.disabled = true;
    var res = await sb.from('categories').update({ is_active: value }).eq('id', id);
    if (res.error) {
      checkbox.checked = !value; checkbox.disabled = false;
      toast(friendlyError(res.error), 'error'); return;
    }
    var c = state.categories.find(function (x) { return x.id === id; });
    if (c) c.is_active = value;
    toast(value ? 'القسم الآن ظاهر للزبائن.' : 'تم إخفاء القسم عن الزبائن.');
    renderCategories();
  }

  async function deleteProduct(p) {
    var ok = await confirmDialog('هل تريد حذف الطبق «' + p.name_ar + '» نهائيًا؟ لا يمكن التراجع عن ذلك.');
    if (!ok) return;
    var res = await sb.from('products').delete().eq('id', p.id);
    if (res.error) { toast(friendlyError(res.error), 'error'); return; }
    await removeImage(p.image_path);
    toast('تم حذف الطبق.');
    await loadData();
  }

  async function deleteCategory(c) {
    var count = state.products.filter(function (p) { return p.category_id === c.id; }).length;
    if (count > 0) { toast('لا يمكن حذف قسم يحتوي على ' + count + ' طبق. احذف الأطباق أو انقلها أولًا.', 'error'); return; }
    var ok = await confirmDialog('هل تريد حذف القسم «' + c.name_ar + '» نهائيًا؟');
    if (!ok) return;
    var res = await sb.from('categories').delete().eq('id', c.id);
    if (res.error) { toast(friendlyError(res.error), 'error'); return; }
    toast('تم حذف القسم.');
    await loadData();
  }

  /* ---------- global events ---------- */
  document.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn && closeBtn.dataset.close !== 'confirmModal') { closeModal(closeBtn.dataset.close); return; }
    if (e.target.classList && e.target.classList.contains('modal-backdrop') && e.target.id !== 'confirmModal') { closeModal(e.target.id); return; }

    var tab = e.target.closest('[data-tab]');
    if (tab) {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === tab); });
      $('#tab-products').hidden = tab.dataset.tab !== 'products';
      $('#tab-categories').hidden = tab.dataset.tab !== 'categories';
      return;
    }

    var act = e.target.closest('[data-action]');
    if (!act) return;
    var row = act.closest('[data-id]');
    var id = row && row.dataset.id;

    switch (act.dataset.action) {
      case 'logout': logout(); break;
      case 'reload': loadData(); break;
      case 'new-product': openProductModal(null); break;
      case 'new-category': openCategoryModal(null); break;
      case 'edit-product': openProductModal(state.products.find(function (p) { return p.id === id; })); break;
      case 'edit-category': openCategoryModal(state.categories.find(function (c) { return c.id === id; })); break;
      case 'delete-product': deleteProduct(state.products.find(function (p) { return p.id === id; })); break;
      case 'delete-category': deleteCategory(state.categories.find(function (c) { return c.id === id; })); break;
    }
  });

  document.addEventListener('change', function (e) {
    var act = e.target.closest('[data-action]');
    if (!act) return;
    var row = act.closest('[data-id]');
    if (!row) return;
    if (act.dataset.action === 'toggle-product') toggleProduct(row.dataset.id, act.checked, act);
    if (act.dataset.action === 'toggle-category') toggleCategory(row.dataset.id, act.checked, act);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.modal-backdrop:not([hidden])');
    if (open) {
      if (open.id === 'confirmModal') { var c = open.querySelector('[data-close]'); if (c) c.click(); }
      else closeModal(open.id);
    }
  });

  $('#productSearch').addEventListener('input', function (e) { state.filterQ = e.target.value; renderProducts(); });
  $('#productCatFilter').addEventListener('change', function (e) { state.filterCat = e.target.value; renderProducts(); });

  /* ---------- init ---------- */
  if (!CFG.isConfigured || !sb) {
    showView('config');
  } else {
    // Do not await Supabase calls inside this callback (SDK deadlock); defer instead.
    sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'TOKEN_REFRESHED') return;
      setTimeout(function () { handleSession(session); }, 0);
    });
  }
})();
