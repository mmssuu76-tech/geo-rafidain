(() => {
  const backend = window.geoBackend;
  const grid = document.querySelector('#resource-grid');
  const emptyState = document.querySelector('#catalog-empty');
  const searchInput = document.querySelector('#library-search');
  const categoryFilter = document.querySelector('#category-filter');
  const sortFilter = document.querySelector('#sort-filter');
  const clearButton = document.querySelector('#clear-filters');
  const emptyClearButton = document.querySelector('#empty-clear');
  const summary = document.querySelector('#results-summary');
  const sourceLabel = document.querySelector('#catalog-source');
  const heroCount = document.querySelector('#hero-resource-count');
  const dialog = document.querySelector('#resource-dialog');
  const dialogClose = document.querySelector('#resource-dialog-close');
  const dialogTitle = document.querySelector('#resource-dialog-title');
  const dialogEnglish = document.querySelector('#resource-dialog-en');
  const dialogCategory = document.querySelector('#resource-dialog-category');
  const dialogBody = document.querySelector('#resource-dialog-body');
  const accessLink = document.querySelector('#resource-access-link');
  const requestLink = document.querySelector('#resource-request-link');
  const resourceSaveButton = document.querySelector('#resource-save-button');
  const openWorkspaceButton = document.querySelector('#open-workspace');
  const workspaceCount = document.querySelector('#workspace-count');
  const workspaceDialog = document.querySelector('#workspace-dialog');
  const workspaceClose = document.querySelector('#workspace-close');
  const workspaceTitle = document.querySelector('#workspace-title');
  const workspaceList = document.querySelector('#workspace-list');
  const workspaceEmpty = document.querySelector('#workspace-empty');
  const workspaceSummary = document.querySelector('#workspace-selection-summary');
  const workspaceClear = document.querySelector('#workspace-clear');
  const workspaceNotice = document.querySelector('#workspace-notice');
  const workspaceExportCsv = document.querySelector('#workspace-export-csv');
  const workspaceExportCitations = document.querySelector('#workspace-export-citations');
  const workspaceShare = document.querySelector('#workspace-share');
  const workspaceRequest = document.querySelector('#workspace-request');

  const categoryLabels = Object.freeze({
    satellite: 'مرئيات فضائية',
    climate: 'مناخ وأمطار',
    terrain: 'تضاريس وارتفاعات',
    soil: 'تربة',
    water: 'مياه وهيدرولوجيا',
    population: 'سكان',
    agriculture: 'زراعة وري',
    vector: 'بيانات متجهة'
  });

  const workspaceStorageKey = 'geoRafidain.researchWorkspace.v1';
  const workspaceLimit = 12;
  let resources = [];
  let activeResource = null;
  let workspaceState = { title: '', slugs: [] };
  let selectedSlugs = new Set();

  const normalizeArabic = value => String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .trim();

  const asArray = value => Array.isArray(value) ? value.filter(Boolean) : [];

  const normalizeResource = item => ({
    ...item,
    research_uses: asArray(item.research_uses),
    formats: asArray(item.formats),
    tags: asArray(item.tags),
    featured: Boolean(item.featured),
    is_published: item.is_published !== false
  });

  const loadWorkspaceState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(workspaceStorageKey) || '{}');
      workspaceState = {
        title: typeof saved.title === 'string' ? saved.title.slice(0, 120) : '',
        slugs: Array.isArray(saved.slugs)
          ? [...new Set(saved.slugs.filter(slug => typeof slug === 'string'))].slice(0, workspaceLimit)
          : []
      };
    } catch {
      workspaceState = { title: '', slugs: [] };
    }
    selectedSlugs = new Set(workspaceState.slugs);
    workspaceTitle.value = workspaceState.title;
  };

  const persistWorkspace = () => {
    workspaceState = {
      title: workspaceTitle.value.trim().slice(0, 120),
      slugs: [...selectedSlugs].slice(0, workspaceLimit)
    };
    try {
      localStorage.setItem(workspaceStorageKey, JSON.stringify(workspaceState));
    } catch {
      setWorkspaceNotice('تعذر الحفظ الدائم في هذا المتصفح؛ ستبقى القائمة متاحة حتى إغلاق الصفحة.', 'error');
    }
  };

  const selectedResources = () => [...selectedSlugs]
    .map(slug => resources.find(resource => resource.slug === slug))
    .filter(Boolean);

  const setWorkspaceNotice = (message, tone = '') => {
    workspaceNotice.textContent = message;
    workspaceNotice.dataset.tone = tone;
  };

  const downloadText = (content, type, filename) => {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  };

  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const safeFilename = value => String(value || 'research-resources')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 70) || 'research-resources';

  const workspaceRequestUrl = items => {
    const titles = items.map(item => item.title_ar).join('، ');
    const params = new URLSearchParams({
      service: 'تجهيز مجموعة بيانات محددة',
      resource: titles,
      source: items.map(item => item.slug).join(',')
    });
    const projectTitle = workspaceTitle.value.trim();
    if (projectTitle) params.set('project', projectTitle);
    return `index.html?${params.toString()}#request`;
  };

  const text = (tag, value, className = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = value || '—';
    return element;
  };

  const createFact = (label, value) => {
    const fact = document.createElement('div');
    fact.append(text('small', label), text('strong', value));
    return fact;
  };

  const requestUrlFor = resource => {
    const params = new URLSearchParams({
      service: 'تجهيز مجموعة بيانات محددة',
      resource: resource.title_ar,
      source: resource.slug
    });
    return `index.html?${params.toString()}#request`;
  };

  const createSaveButton = (resource, compact = false) => {
    const saved = selectedSlugs.has(resource.slug);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = compact ? 'resource-save-toggle compact' : 'resource-save-toggle';
    button.setAttribute('aria-pressed', String(saved));
    button.setAttribute('aria-label', saved ? `إزالة ${resource.title_ar} من ملف البحث` : `إضافة ${resource.title_ar} إلى ملف البحث`);
    button.innerHTML = `<span aria-hidden="true">${saved ? '✓' : '+'}</span>${compact ? '' : (saved ? 'مضاف' : 'إضافة لملف البحث')}`;
    button.addEventListener('click', () => toggleWorkspaceResource(resource));
    return button;
  };

  const createCard = resource => {
    const article = document.createElement('article');
    article.className = 'resource-card';
    article.dataset.category = resource.category;

    const accent = document.createElement('div');
    accent.className = 'resource-accent';
    accent.setAttribute('aria-hidden', 'true');

    const inner = document.createElement('div');
    inner.className = 'resource-card-inner';
    const top = document.createElement('div');
    top.className = 'resource-card-top';
    const labels = document.createElement('div');
    labels.className = 'resource-card-labels';
    labels.append(
      text('span', categoryLabels[resource.category] || 'بيانات جغرافية', 'resource-category'),
      text('span', `✓ تحقق ${resource.source_checked_at || 'حديثاً'}`, 'resource-verified')
    );
    top.append(labels, createSaveButton(resource, true));

    const facts = document.createElement('div');
    facts.className = 'resource-facts';
    facts.append(
      createFact('الدقة المكانية', resource.spatial_resolution),
      createFact('التغطية الزمنية', resource.temporal_coverage)
    );

    const actions = document.createElement('div');
    actions.className = 'resource-card-actions';
    const details = document.createElement('button');
    details.type = 'button';
    details.textContent = 'عرض التفاصيل';
    details.addEventListener('click', () => openResource(resource));
    const official = document.createElement('a');
    official.href = resource.access_url;
    official.target = '_blank';
    official.rel = 'noopener noreferrer';
    official.textContent = 'المصدر الرسمي ↗';
    actions.append(details, official);

    inner.append(
      top,
      text('h3', resource.title_ar),
      text('p', resource.title_en, 'resource-en'),
      text('p', resource.description_ar, 'resource-description'),
      facts,
      text('p', `الجهة: ${resource.provider}`, 'resource-provider'),
      actions
    );
    article.append(accent, inner);
    return article;
  };

  const appendTags = (container, items, className) => {
    const wrap = document.createElement('div');
    wrap.className = className;
    items.forEach(item => wrap.append(text('span', item)));
    container.append(wrap);
  };

  const appendDialogSection = (title, items, className) => {
    const section = document.createElement('section');
    section.className = 'dialog-section';
    section.append(text('h3', title));
    appendTags(section, items, className);
    dialogBody.append(section);
  };

  const createWorkspaceItem = resource => {
    const item = document.createElement('article');
    item.className = 'workspace-item';
    item.dataset.category = resource.category;
    const content = document.createElement('div');
    content.append(
      text('small', categoryLabels[resource.category] || 'بيانات جغرافية'),
      text('h3', resource.title_ar),
      text('p', `${resource.provider} · ${resource.spatial_resolution}`)
    );
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'إزالة';
    remove.setAttribute('aria-label', `إزالة ${resource.title_ar} من ملف البحث`);
    remove.addEventListener('click', () => toggleWorkspaceResource(resource));
    item.append(content, remove);
    return item;
  };

  const updateResourceSaveButton = resource => {
    if (activeResource?.slug !== resource.slug) return;
    const saved = selectedSlugs.has(resource.slug);
    resourceSaveButton.textContent = saved ? 'تمت الإضافة ✓' : 'أضف إلى ملف البحث';
    resourceSaveButton.setAttribute('aria-pressed', String(saved));
  };

  const refreshWorkspace = () => {
    const items = selectedResources();
    workspaceCount.textContent = items.length;
    workspaceList.replaceChildren(...items.map(createWorkspaceItem));
    workspaceList.hidden = items.length === 0;
    workspaceEmpty.hidden = items.length !== 0;
    workspaceSummary.textContent = items.length
      ? `${items.length} ${items.length === 1 ? 'مصدر مختار' : 'مصادر مختارة'} من أصل ${resources.length}`
      : 'لم تختر أي مصدر بعد';

    [workspaceClear, workspaceExportCsv, workspaceExportCitations, workspaceShare]
      .forEach(control => { control.disabled = items.length === 0; });
    workspaceRequest.setAttribute('aria-disabled', String(items.length === 0));
    workspaceRequest.href = items.length ? workspaceRequestUrl(items) : 'index.html#request';
    openWorkspaceButton.classList.toggle('has-items', items.length > 0);
  };

  const toggleWorkspaceResource = resource => {
    if (selectedSlugs.has(resource.slug)) {
      selectedSlugs.delete(resource.slug);
      setWorkspaceNotice(`أُزيل «${resource.title_ar}» من ملف البحث.`);
    } else {
      if (selectedSlugs.size >= workspaceLimit) {
        setWorkspaceNotice(`الحد الأقصى ${workspaceLimit} مصدراً في ملف البحث الواحد.`, 'error');
        if (!workspaceDialog.open) workspaceDialog.showModal();
        return;
      }
      selectedSlugs.add(resource.slug);
      setWorkspaceNotice(`أُضيف «${resource.title_ar}» إلى ملف البحث.`, 'success');
    }
    persistWorkspace();
    updateResourceSaveButton(resource);
    render();
    refreshWorkspace();
  };

  const exportWorkspaceCsv = () => {
    const items = selectedResources();
    if (!items.length) return;
    const headers = ['الاسم العربي','الاسم الإنجليزي','التصنيف','الجهة','التغطية المكانية','التغطية الزمنية','الدقة المكانية','الصيغ','الترخيص','رابط المصدر','رابط الوثائق','الاقتباس المقترح'];
    const rows = items.map(item => [
      item.title_ar, item.title_en, categoryLabels[item.category] || item.category, item.provider,
      item.coverage, item.temporal_coverage, item.spatial_resolution, item.formats.join(' | '),
      item.license_name, item.access_url, item.metadata_url, item.citation_text
    ]);
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    downloadText(csv, 'text/csv;charset=utf-8', `${safeFilename(workspaceTitle.value)}-${new Date().toISOString().slice(0, 10)}.csv`);
    setWorkspaceNotice('تم تجهيز جدول CSV متوافق مع Excel.', 'success');
  };

  const exportWorkspaceCitations = () => {
    const items = selectedResources();
    if (!items.length) return;
    const heading = workspaceTitle.value.trim() || 'قائمة مصادر البحث';
    const lines = [heading, '='.repeat(Math.min(heading.length, 60)), `تاريخ التصدير: ${new Date().toLocaleDateString('ar-IQ')}`, ''];
    items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.citation_text}`, `   المصدر الرسمي: ${item.access_url}`, '');
    });
    lines.push('ملاحظة: راجع صيغة الاقتباس والترخيص في صفحة المنتج الرسمية قبل النشر الأكاديمي.');
    downloadText(`\uFEFF${lines.join('\r\n')}`, 'text/plain;charset=utf-8', `${safeFilename(heading)}-citations.txt`);
    setWorkspaceNotice('تم تجهيز ملف المراجع النصي.', 'success');
  };

  const copyWorkspaceLink = async () => {
    const items = selectedResources();
    if (!items.length) return;
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = 'catalog';
    url.searchParams.set('collection', items.map(item => item.slug).join(','));
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      const area = document.createElement('textarea');
      area.value = url.toString();
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setWorkspaceNotice('نُسخ رابط القائمة. لا يتضمن عنوان البحث أو أي بيانات شخصية.', 'success');
  };

  const importSharedCollection = () => {
    const collection = new URLSearchParams(window.location.search).get('collection');
    if (!collection) return;
    const validSlugs = new Set(resources.map(resource => resource.slug));
    const imported = collection.split(',').map(value => value.trim()).filter(slug => validSlugs.has(slug)).slice(0, workspaceLimit);
    if (!imported.length) return;
    selectedSlugs = new Set(imported);
    persistWorkspace();
    setWorkspaceNotice(`تم تحميل قائمة مشتركة تضم ${imported.length} مصدراً.`, 'success');
  };

  const copyCitation = async (citation, button) => {
    try {
      await navigator.clipboard.writeText(citation);
      button.textContent = 'تم النسخ ✓';
    } catch {
      const area = document.createElement('textarea');
      area.value = citation;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      button.textContent = 'تم النسخ ✓';
    }
    setTimeout(() => { button.textContent = 'نسخ الاقتباس'; }, 1800);
  };

  const openResource = resource => {
    activeResource = resource;
    dialogTitle.textContent = resource.title_ar;
    dialogEnglish.textContent = resource.title_en;
    dialogCategory.textContent = categoryLabels[resource.category] || 'بيانات جغرافية';
    accessLink.href = resource.access_url;
    requestLink.href = requestUrlFor(resource);
    updateResourceSaveButton(resource);
    dialogBody.replaceChildren();
    dialogBody.append(text('p', resource.description_ar, 'resource-dialog-description'));

    const facts = document.createElement('div');
    facts.className = 'dialog-facts';
    facts.append(
      createFact('الجهة الناشرة', resource.provider),
      createFact('التغطية المكانية', resource.coverage),
      createFact('التغطية الزمنية', resource.temporal_coverage),
      createFact('الدقة المكانية', resource.spatial_resolution),
      createFact('الترخيص', resource.license_name),
      createFact('آخر تحقق من الرابط', resource.source_checked_at)
    );
    dialogBody.append(facts);
    appendDialogSection('استخدامات بحثية مناسبة', resource.research_uses, 'use-tags');
    appendDialogSection('الصيغ وطرق الوصول', resource.formats, 'format-tags');

    const citationSection = document.createElement('section');
    citationSection.className = 'dialog-section';
    citationSection.append(text('h3', 'صيغة اقتباس مقترحة'));
    const citationBox = document.createElement('div');
    citationBox.className = 'citation-box';
    const citationText = text('p', resource.citation_text);
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = 'نسخ الاقتباس';
    copyButton.addEventListener('click', () => copyCitation(resource.citation_text, copyButton));
    citationBox.append(citationText, copyButton);
    citationSection.append(citationBox);
    dialogBody.append(citationSection);

    const metadataSection = document.createElement('section');
    metadataSection.className = 'dialog-section dialog-links';
    metadataSection.append(text('h3', 'الوثائق والترخيص'));
    const metadataLink = document.createElement('a');
    metadataLink.href = resource.metadata_url;
    metadataLink.target = '_blank';
    metadataLink.rel = 'noopener noreferrer';
    metadataLink.textContent = 'فتح وثائق المنتج ↗';
    const licenseLink = document.createElement('a');
    licenseLink.href = resource.license_url;
    licenseLink.target = '_blank';
    licenseLink.rel = 'noopener noreferrer';
    licenseLink.textContent = 'مراجعة الترخيص ↗';
    const links = document.createElement('div');
    links.className = 'format-tags';
    links.append(metadataLink, licenseLink);
    metadataSection.append(links);
    dialogBody.append(metadataSection);
    dialogBody.append(text('p', 'راجع دائماً وثائق الإصدار الفعلي قبل التحليل أو النشر؛ بعض المنتجات تتغير دورياً وقد تختلف دقتها أو شروطها بين الطبقات.', 'dialog-note'));

    const url = new URL(window.location.href);
    url.searchParams.set('resource', resource.slug);
    history.replaceState({}, '', url);
    dialog.showModal();
  };

  const closeDialog = () => {
    dialog.close();
    activeResource = null;
    const url = new URL(window.location.href);
    url.searchParams.delete('resource');
    history.replaceState({}, '', url);
  };

  const matchesSearch = (resource, query) => {
    if (!query) return true;
    const haystack = normalizeArabic([
      resource.title_ar,
      resource.title_en,
      resource.provider,
      resource.description_ar,
      resource.coverage,
      resource.spatial_resolution,
      ...resource.research_uses,
      ...resource.tags
    ].join(' '));
    return query.split(/\s+/).every(term => haystack.includes(term));
  };

  const render = () => {
    const query = normalizeArabic(searchInput.value);
    const category = categoryFilter.value;
    const sort = sortFilter.value;
    const visible = resources
      .filter(resource => (category === 'all' || resource.category === category) && matchesSearch(resource, query))
      .sort((a, b) => {
        if (sort === 'title') return a.title_ar.localeCompare(b.title_ar, 'ar');
        if (sort === 'checked') return String(b.source_checked_at).localeCompare(String(a.source_checked_at));
        return Number(b.featured) - Number(a.featured) || a.title_ar.localeCompare(b.title_ar, 'ar');
      });

    grid.replaceChildren(...visible.map(createCard));
    grid.hidden = visible.length === 0;
    emptyState.hidden = visible.length !== 0;
    summary.textContent = visible.length === resources.length
      ? `${resources.length} مصدراً موثقاً متاحاً للباحثين`
      : `${visible.length} نتيجة من أصل ${resources.length} مصدراً`;
  };

  const clearFilters = () => {
    searchInput.value = '';
    categoryFilter.value = 'all';
    sortFilter.value = 'featured';
    render();
    searchInput.focus();
  };

  const loadFallback = async () => {
    const response = await fetch('data/resources.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('RESOURCE_FALLBACK_FAILED');
    return response.json();
  };

  const loadResources = async () => {
    let loaded;
    let source = 'النسخة الموثقة المضمنة في المنصة';
    try {
      if (backend?.status !== 'ready' || typeof backend.listPublishedResources !== 'function') throw new Error('BACKEND_UNAVAILABLE');
      loaded = await backend.listPublishedResources();
      if (!loaded?.length) throw new Error('EMPTY_RESOURCE_TABLE');
      source = 'متزامنة مع قاعدة بيانات جيو الرافدين';
    } catch {
      loaded = await loadFallback();
    }

    resources = loaded.filter(item => item?.is_published !== false).map(normalizeResource);
    importSharedCollection();
    heroCount.textContent = resources.length;
    sourceLabel.textContent = source;
    grid.setAttribute('aria-busy', 'false');
    render();
    refreshWorkspace();

    const requestedSlug = new URLSearchParams(window.location.search).get('resource');
    const requested = resources.find(item => item.slug === requestedSlug);
    if (requested) setTimeout(() => openResource(requested), 100);
  };

  document.querySelector('#year').textContent = new Date().getFullYear();
  document.querySelector('.menu-toggle')?.addEventListener('click', event => {
    const open = document.body.classList.toggle('menu-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.main-nav a').forEach(link => link.addEventListener('click', () => document.body.classList.remove('menu-open')));
  searchInput.addEventListener('input', render);
  categoryFilter.addEventListener('change', render);
  sortFilter.addEventListener('change', render);
  clearButton.addEventListener('click', clearFilters);
  emptyClearButton.addEventListener('click', clearFilters);
  dialogClose.addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  resourceSaveButton.addEventListener('click', () => { if (activeResource) toggleWorkspaceResource(activeResource); });
  openWorkspaceButton.addEventListener('click', () => {
    setWorkspaceNotice('');
    refreshWorkspace();
    workspaceDialog.showModal();
    workspaceTitle.focus();
  });
  workspaceClose.addEventListener('click', () => workspaceDialog.close());
  workspaceDialog.addEventListener('click', event => { if (event.target === workspaceDialog) workspaceDialog.close(); });
  workspaceDialog.addEventListener('cancel', event => { event.preventDefault(); workspaceDialog.close(); });
  workspaceTitle.addEventListener('input', () => {
    persistWorkspace();
    const items = selectedResources();
    if (items.length) workspaceRequest.href = workspaceRequestUrl(items);
  });
  workspaceClear.addEventListener('click', () => {
    if (!selectedSlugs.size || !window.confirm('هل تريد إفراغ ملف البحث من جميع المصادر المختارة؟')) return;
    selectedSlugs.clear();
    persistWorkspace();
    render();
    refreshWorkspace();
    setWorkspaceNotice('أُفرغ ملف البحث. بقي عنوان المشروع محفوظاً.', 'success');
  });
  workspaceExportCsv.addEventListener('click', exportWorkspaceCsv);
  workspaceExportCitations.addEventListener('click', exportWorkspaceCitations);
  workspaceShare.addEventListener('click', copyWorkspaceLink);
  workspaceRequest.addEventListener('click', event => {
    if (!selectedSlugs.size) event.preventDefault();
  });

  loadWorkspaceState();
  loadResources().catch(() => {
    grid.setAttribute('aria-busy', 'false');
    grid.hidden = true;
    emptyState.hidden = false;
    summary.textContent = 'تعذر تحميل المكتبة حالياً. حدّث الصفحة أو تحقق من اتصال الإنترنت.';
    sourceLabel.textContent = '';
  });
})();
