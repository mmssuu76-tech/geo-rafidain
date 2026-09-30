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

  let resources = [];

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
    top.append(
      text('span', categoryLabels[resource.category] || 'بيانات جغرافية', 'resource-category'),
      text('span', `✓ تحقق ${resource.source_checked_at || 'حديثاً'}`, 'resource-verified')
    );

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
    dialogTitle.textContent = resource.title_ar;
    dialogEnglish.textContent = resource.title_en;
    dialogCategory.textContent = categoryLabels[resource.category] || 'بيانات جغرافية';
    accessLink.href = resource.access_url;
    requestLink.href = requestUrlFor(resource);
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
    heroCount.textContent = resources.length;
    sourceLabel.textContent = source;
    grid.setAttribute('aria-busy', 'false');
    render();

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

  loadResources().catch(() => {
    grid.setAttribute('aria-busy', 'false');
    grid.hidden = true;
    emptyState.hidden = false;
    summary.textContent = 'تعذر تحميل المكتبة حالياً. حدّث الصفحة أو تحقق من اتصال الإنترنت.';
    sourceLabel.textContent = '';
  });
})();
