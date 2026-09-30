(() => {
  const backend = window.geoBackend;
  const gate = document.querySelector('#admin-gate');
  const gateTitle = document.querySelector('#gate-title');
  const gateMessage = document.querySelector('#gate-message');
  const gateLink = document.querySelector('#gate-link');
  const main = document.querySelector('#admin-main');
  const status = document.querySelector('#admin-status');
  const list = document.querySelector('#admin-resource-list');
  const empty = document.querySelector('#admin-empty');
  const search = document.querySelector('#admin-search');
  const stateFilter = document.querySelector('#admin-state-filter');
  const editor = document.querySelector('#resource-editor');
  const form = document.querySelector('#resource-form');
  const saveButton = document.querySelector('#save-resource');
  let resources = [];

  const setStatus = (message = '', type = '') => {
    status.textContent = message;
    status.className = `admin-status${type ? ` ${type}` : ''}`;
  };

  const showGate = (title, message, href = '', label = '') => {
    gateTitle.textContent = title;
    gateMessage.textContent = message;
    gateLink.hidden = !href;
    if (href) { gateLink.href = href; gateLink.textContent = label; }
  };

  const friendlyError = error => {
    const message = String(error?.message || error || '');
    if (/geo_resources|schema cache|does not exist/i.test(message)) return 'لم يُطبّق ملف geo-resources.sql في قاعدة البيانات بعد.';
    if (/ADMIN_MFA_REQUIRED|42501|permission/i.test(message)) return 'انتهى تحقق المدير أو لا توجد صلاحية. أعد التحقق بالمصادقة الثنائية.';
    if (/INVALID_RESOURCE_SLUG/i.test(message)) return 'المعرّف المختصر يجب أن يحتوي حروفاً إنجليزية صغيرة وأرقاماً وشرطات فقط.';
    if (/HTTPS_URLS_REQUIRED/i.test(message)) return 'جميع روابط المصدر والوثائق والترخيص يجب أن تبدأ بـ https.';
    if (/RESOURCE_CONTENT_INCOMPLETE/i.test(message)) return 'أكمل عنواني المصدر ووصفه البحثي.';
    if (/duplicate|unique/i.test(message)) return 'المعرّف المختصر مستخدم لمصدر آخر.';
    if (/network|fetch/i.test(message)) return 'تعذر الاتصال بقاعدة البيانات. تحقق من الإنترنت.';
    return `تعذر إكمال العملية.${message ? ` (${message})` : ''}`;
  };

  const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ًٌٍَُِّْـ]/g, '');
  const text = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value || '—'; if (className) el.className = className; return el; };
  const splitList = value => String(value || '').split(/[,،]/).map(item => item.trim()).filter(Boolean);

  const updateMetrics = () => {
    document.querySelector('#all-count').textContent = resources.length;
    document.querySelector('#published-count').textContent = resources.filter(item => item.is_published).length;
    document.querySelector('#draft-count').textContent = resources.filter(item => !item.is_published).length;
    document.querySelector('#featured-count').textContent = resources.filter(item => item.featured).length;
  };

  const openEditor = resource => {
    form.reset();
    const value = resource || {};
    const fields = ['id','title_ar','title_en','slug','category','provider','description_ar','coverage','temporal_coverage','spatial_resolution','access_url','metadata_url','license_name','license_url','citation_text','source_checked_at'];
    fields.forEach(name => { if (form.elements[name]) form.elements[name].value = value[name] || ''; });
    form.elements.research_uses.value = (value.research_uses || []).join('، ');
    form.elements.formats.value = (value.formats || []).join('، ');
    form.elements.tags.value = (value.tags || []).join('، ');
    form.elements.featured.checked = Boolean(value.featured);
    form.elements.is_published.checked = Boolean(value.is_published);
    if (!resource) {
      form.elements.category.value = 'satellite';
      form.elements.source_checked_at.value = new Date().toISOString().slice(0, 10);
    }
    document.querySelector('#editor-kicker').textContent = resource ? 'تعديل مصدر موثق' : 'مورد جديد';
    document.querySelector('#editor-title').textContent = resource?.title_ar || 'بيانات المصدر';
    editor.showModal();
    setTimeout(() => form.elements.title_ar.focus(), 80);
  };

  const closeEditor = () => editor.close();

  const render = () => {
    const query = normalize(search.value.trim());
    const state = stateFilter.value;
    const visible = resources.filter(resource => {
      const stateMatch = state === 'all' || (state === 'published' ? resource.is_published : !resource.is_published);
      const textMatch = !query || normalize([resource.title_ar, resource.title_en, resource.provider, resource.category, ...(resource.tags || [])].join(' ')).includes(query);
      return stateMatch && textMatch;
    });

    list.replaceChildren();
    visible.forEach(resource => {
      const row = document.createElement('article');
      row.className = 'admin-resource-row';
      const identity = document.createElement('div');
      identity.append(text('h2', resource.title_ar), text('p', resource.title_en));
      const provider = document.createElement('div');
      provider.append(text('small', 'الجهة الناشرة'), text('strong', resource.provider));
      const badges = document.createElement('div');
      badges.className = 'state-badges';
      badges.append(text('span', resource.is_published ? 'منشور' : 'مسودة', resource.is_published ? 'state-published' : 'state-draft'));
      if (resource.featured) badges.append(text('span', 'مميز', 'state-featured'));
      const actions = document.createElement('div');
      actions.className = 'admin-row-actions';
      const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'تعديل'; edit.addEventListener('click', () => openEditor(resource));
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = resource.is_published ? 'إلغاء النشر' : 'نشر';
      toggle.addEventListener('click', () => togglePublished(resource, toggle));
      actions.append(edit, toggle);
      row.append(identity, provider, badges, actions);
      list.append(row);
    });
    empty.hidden = visible.length !== 0;
  };

  const loadResources = async (quiet = false) => {
    if (!quiet) setStatus('جارٍ تحميل المكتبة…');
    try {
      resources = await backend.listAdminResources();
      updateMetrics();
      render();
      setStatus(`تم تحميل ${resources.length} مورداً.`, 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    }
  };

  const togglePublished = async (resource, button) => {
    button.disabled = true;
    setStatus(resource.is_published ? 'جارٍ إلغاء النشر…' : 'جارٍ نشر المورد…');
    try {
      const saved = await backend.adminSetResourcePublished(resource.id, !resource.is_published);
      const index = resources.findIndex(item => item.id === resource.id);
      resources[index] = saved;
      updateMetrics();
      render();
      setStatus(saved.is_published ? 'تم نشر المورد للعامة.' : 'تم تحويل المورد إلى مسودة.', 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
      button.disabled = false;
    }
  };

  const saveResource = async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const payload = {
      id: String(data.get('id') || '') || null,
      title_ar: String(data.get('title_ar') || '').trim(),
      title_en: String(data.get('title_en') || '').trim(),
      slug: String(data.get('slug') || '').trim().toLowerCase(),
      category: String(data.get('category') || ''),
      provider: String(data.get('provider') || '').trim(),
      description_ar: String(data.get('description_ar') || '').trim(),
      research_uses: splitList(data.get('research_uses')),
      coverage: String(data.get('coverage') || '').trim(),
      temporal_coverage: String(data.get('temporal_coverage') || '').trim(),
      spatial_resolution: String(data.get('spatial_resolution') || '').trim(),
      formats: splitList(data.get('formats')),
      license_name: String(data.get('license_name') || '').trim(),
      license_url: String(data.get('license_url') || '').trim(),
      access_url: String(data.get('access_url') || '').trim(),
      metadata_url: String(data.get('metadata_url') || '').trim(),
      citation_text: String(data.get('citation_text') || '').trim(),
      tags: splitList(data.get('tags')),
      featured: form.elements.featured.checked,
      is_published: form.elements.is_published.checked,
      source_checked_at: String(data.get('source_checked_at') || '')
    };

    saveButton.disabled = true;
    saveButton.textContent = 'جارٍ الحفظ…';
    try {
      await backend.adminUpsertResource(payload);
      closeEditor();
      await loadResources(true);
      setStatus('تم حفظ المورد وتحديث المكتبة بنجاح.', 'success');
    } catch (error) {
      setStatus(friendlyError(error), 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'حفظ المورد';
    }
  };

  const initialize = async () => {
    if (backend?.status !== 'ready') {
      showGate('تعذر الاتصال', 'إعداد قاعدة البيانات غير جاهز أو مكتبة الاتصال لم تُحمّل.');
      return;
    }
    try {
      const user = await backend.getUser();
      if (!user) { showGate('تسجيل الدخول مطلوب', 'سجّل الدخول بحساب المدير من المنصة ثم عد إلى هذه الصفحة.', 'index.html', 'العودة إلى المنصة'); return; }
      const profile = await backend.getProfile();
      if (profile?.role !== 'admin') { showGate('وصول غير مصرح', 'هذه الصفحة مخصصة لمدير جيو الرافدين فقط.', 'dashboard.html', 'العودة إلى لوحة المتابعة'); return; }
      const assurance = await backend.getMfaAssurance();
      if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
        showGate('يلزم رمز المصادقة الثنائية', 'أكمل التحقق الآمن قبل إدارة المصادر المنشورة.', 'security.html', 'إكمال التحقق الآمن');
        return;
      }
      gate.hidden = true;
      main.hidden = false;
      await loadResources();
    } catch (error) {
      showGate('تعذر التحقق', friendlyError(error), 'security.html', 'فتح صفحة الأمان');
    }
  };

  document.querySelector('#new-resource').addEventListener('click', () => openEditor());
  document.querySelector('#refresh-resources').addEventListener('click', () => loadResources());
  document.querySelector('#editor-close').addEventListener('click', closeEditor);
  document.querySelector('#cancel-editor').addEventListener('click', closeEditor);
  form.addEventListener('submit', saveResource);
  search.addEventListener('input', render);
  stateFilter.addEventListener('change', render);
  editor.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });

  initialize();
})();
