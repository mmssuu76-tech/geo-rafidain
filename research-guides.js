(() => {
  'use strict';

  const guides = [
    {
      id: 'spatial-question', number: '01', category: 'planning', categoryLabel: 'التخطيط',
      title: 'صياغة سؤال بحث مكاني قابل للتحليل',
      summary: 'حوّل الفكرة العامة إلى سؤال يحدد الظاهرة والمكان والفترة والعلاقة التي يمكن قياسها مكانياً.',
      audience: 'بداية البحث ومقترح الدراسة', duration: '6 دقائق', outcome: 'سؤال واضح ومتغيرات قابلة للقياس', related: 'research-planner.html', relatedLabel: 'فتح مخطط الدراسة',
      steps: [
        'اكتب الظاهرة أو المشكلة بصياغة محايدة، من دون افتراض النتيجة مسبقاً.',
        'حدّد منطقة الدراسة والفترة الزمنية ووحدة التحليل التي ستُقارن أو تُقاس.',
        'عرّف المتغير المكاني أو الزمني الرئيس والمتغيرات المفسّرة المتوقعة.',
        'اختبر السؤال: هل يمكن الإجابة عنه ببيانات متاحة ومنهج يمكن تكراره؟'
      ],
      checklist: ['يذكر السؤال المكان والفترة.', 'المتغيرات قابلة للقياس.', 'لا يفترض السؤال النتيجة.', 'النطاق مناسب للوقت والموارد.']
    },
    {
      id: 'study-area-scale', number: '02', category: 'planning', categoryLabel: 'التخطيط',
      title: 'تحديد منطقة الدراسة ومقياس التحليل',
      summary: 'اختر حدوداً ومقياساً ودقة تتوافق مع سؤال البحث، لا مع البيانات الأسهل في التنزيل فقط.',
      audience: 'قبل جمع البيانات', duration: '7 دقائق', outcome: 'حدود دراسة مبررة ودقة مناسبة', related: 'research-planner.html', relatedLabel: 'تحديد النطاق في المخطط',
      steps: [
        'حدّد سبب اختيار المنطقة: إداري، بيئي، هيدرولوجي، حضري أو مرتبط بظاهرة محددة.',
        'اختر وحدة التحليل المناسبة مثل البكسل أو الحي أو القضاء أو الحوض المائي.',
        'قارن أصغر ظاهرة تريد رصدها بالدقة المكانية الفعلية للبيانات.',
        'سجّل نظام الإحداثيات وحدود المنطقة ومصدرها وتاريخها وأي تعديل أُجري عليها.'
      ],
      checklist: ['سبب اختيار المنطقة موثق.', 'وحدة التحليل محددة.', 'الدقة تكشف الظاهرة المطلوبة.', 'الإسقاط مناسب للموقع والتحليل.']
    },
    {
      id: 'data-fitness', number: '03', category: 'data', categoryLabel: 'البيانات',
      title: 'تقييم ملاءمة مصدر البيانات',
      summary: 'افحص الدقة والفترة والإصدار والترخيص ومنهج الإنتاج قبل اعتماد أي مرئية أو طبقة.',
      audience: 'جمع البيانات ومراجعة المصادر', duration: '8 دقائق', outcome: 'قائمة بيانات قابلة للدفاع العلمي', related: 'data-library.html', relatedLabel: 'فتح مكتبة البيانات',
      steps: [
        'ابدأ من الجهة الناشرة أو المستودع الرسمي واقرأ وصف المنتج والإصدار.',
        'قارن الدقة المكانية والزمنية والطيفية بمتطلبات سؤال البحث.',
        'افحص التغطية والفجوات والغيوم والقيم المفقودة ومنهج إنتاج المتغير.',
        'سجّل الرابط والترخيص والاقتباس المقترح وتاريخ الوصول قبل بدء المعالجة.'
      ],
      checklist: ['المصدر الرسمي معروف.', 'الإصدار والفترة موثقان.', 'الدقة ملائمة للسؤال.', 'الترخيص والاقتباس محفوظان.']
    },
    {
      id: 'processing-workflow', number: '04', category: 'analysis', categoryLabel: 'التحليل والتحقق',
      title: 'توثيق مسار المعالجة الجغرافية',
      summary: 'أنشئ سجلاً يمكن من خلاله إعادة تنفيذ العمل ومعرفة المدخلات والأدوات والمعلمات والمخرجات.',
      audience: 'مرحلة التجهيز والتحليل', duration: '9 دقائق', outcome: 'سجل معالجة قابل للتكرار والمراجعة', related: '#templates', relatedLabel: 'تنزيل سجل المعالجة',
      steps: [
        'امنح كل ملف مدخل اسماً ثابتاً وسجّل مصدره وإصداره قبل أي تعديل.',
        'سجّل كل خطوة بترتيبها مع اسم الأداة والبرنامج والإصدار والمعلمات.',
        'ميّز الملفات الوسيطة عن المخرجات النهائية ولا تستبدل البيانات الأصلية.',
        'وثّق أي قرار يدوي أو استثناء أو قيمة حدية لأنه يصعب استنتاجه لاحقاً.'
      ],
      checklist: ['الأصل محفوظ دون تعديل.', 'المعلمات مسجلة.', 'أسماء الملفات واضحة.', 'يمكن لباحث آخر إعادة الخطوات.']
    },
    {
      id: 'accuracy-uncertainty', number: '05', category: 'analysis', categoryLabel: 'التحليل والتحقق',
      title: 'التحقق من الدقة والتعبير عن عدم اليقين',
      summary: 'فرّق بين جودة البيانات ودقة النموذج، واستخدم تحققاً مستقلاً يناسب نوع المخرج.',
      audience: 'بعد التحليل وقبل تفسير النتائج', duration: '10 دقائق', outcome: 'نتائج موثقة بحدودها ومؤشرات تحققها', related: 'index.html#request', relatedLabel: 'طلب مراجعة تحليلية',
      steps: [
        'عرّف ما تعنيه الدقة في دراستك: تصنيف، موضع، قيمة مستمرة أو توافق زمني.',
        'استخدم مرجعاً مستقلاً أو عينات تحقق لم تدخل في بناء التصنيف أو النموذج.',
        'اعرض المؤشر المناسب مثل مصفوفة الالتباس أو RMSE مع حجم العينة وتوزيعها.',
        'اشرح مصادر الخطأ وحدود التعميم ولا تحول المؤشر الإحصائي إلى يقين مطلق.'
      ],
      checklist: ['مرجع التحقق مستقل.', 'حجم العينة موضح.', 'المؤشر ملائم لنوع الناتج.', 'القيود مذكورة مع النتائج.']
    },
    {
      id: 'publication-map', number: '06', category: 'cartography', categoryLabel: 'الخرائط',
      title: 'إخراج خريطة بحثية قابلة للنشر',
      summary: 'راجع التسلسل البصري والرموز والعناصر المرجعية والمصادر حتى تخدم الخريطة الحجة العلمية بوضوح.',
      audience: 'الإخراج النهائي والطباعة', duration: '8 دقائق', outcome: 'خريطة واضحة وموثقة وجاهزة للمراجعة', related: 'cartography.html', relatedLabel: 'استعراض خدمة الخرائط',
      steps: [
        'حدّد رسالة واحدة للخريطة واجعل المتغير الرئيس أوضح عناصرها بصرياً.',
        'اختر تصنيفاً ورموزاً وألواناً مناسبة لطبيعة البيانات ولإمكانية التمييز.',
        'أضف العنوان والمفتاح والمقياس والاتجاه والإحداثيات عند الحاجة ومصدر البيانات.',
        'اختبر الخريطة بحجم النشر النهائي وتحقق من الخطوط والتباين وعدم ازدحام العناصر.'
      ],
      checklist: ['العنوان يصف المحتوى.', 'المفتاح مطابق للرموز.', 'المصدر والإسقاط مذكوران.', 'الخريطة مقروءة بالحجم النهائي.']
    },
    {
      id: 'methods-writing', number: '07', category: 'writing', categoryLabel: 'الكتابة والتوثيق',
      title: 'كتابة قسم البيانات والمنهجية',
      summary: 'اكتب وصفاً دقيقاً يسمح للقارئ بفهم سبب اختيار البيانات وإعادة تنفيذ خطوات التحليل.',
      audience: 'الرسالة أو الأطروحة أو البحث', duration: '9 دقائق', outcome: 'منهجية مترابطة وقابلة للمراجعة', related: '#templates', relatedLabel: 'تنزيل هيكل المنهجية',
      steps: [
        'ابدأ بمنطقة الدراسة والفترة ثم عرّف كل مصدر بيانات وإصداره ودقته.',
        'برر الاختيار علمياً بدل الاكتفاء بذكر اسم القمر أو البرنامج.',
        'صف المعالجة والتحليل بترتيب منطقي مع الأدوات والمعلمات وقواعد القرار.',
        'اختم بطريقة التحقق والقيود والأثر المتوقع لها على تفسير النتائج.'
      ],
      checklist: ['كل مصدر موثق.', 'سبب الاختيار مبرر.', 'الخطوات مرتبة وقابلة للتكرار.', 'التحقق والقيود موضحان.']
    }
  ];

  const storageKey = 'geoRafidain.savedGuides.v1';
  const grid = document.querySelector('#guides-grid');
  const emptyState = document.querySelector('#guides-empty');
  const searchInput = document.querySelector('#guide-search');
  const categorySelect = document.querySelector('#guide-category');
  const savedFilter = document.querySelector('#saved-filter');
  const savedCount = document.querySelector('#saved-count');
  const resultCount = document.querySelector('#guide-result-count');
  const dialog = document.querySelector('#guide-dialog');
  const templateStatus = document.querySelector('#template-status');
  let savedOnly = false;
  let activeGuideId = '';

  const normalize = value => String(value || '')
    .normalize('NFKD')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim();

  const loadSaved = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (!Array.isArray(value)) return new Set();
      const validIds = new Set(guides.map(guide => guide.id));
      return new Set(value.filter(id => validIds.has(id)));
    } catch {
      return new Set();
    }
  };

  let savedGuides = loadSaved();

  const persistSaved = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...savedGuides]));
    } catch {
      // Saving is optional; the guides remain fully usable without storage.
    }
  };

  const updateSavedCount = () => {
    savedCount.textContent = savedGuides.size;
  };

  const toggleSaved = id => {
    if (savedGuides.has(id)) savedGuides.delete(id);
    else savedGuides.add(id);
    persistSaved();
    updateSavedCount();
    renderGuides();
    if (activeGuideId === id) updateDialogSaveButton(id);
  };

  const makeElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const createGuideCard = guide => {
    const card = makeElement('article', 'guide-card');
    card.dataset.guideId = guide.id;

    const header = document.createElement('header');
    const number = makeElement('span', 'guide-number', guide.number);
    const category = makeElement('span', 'guide-category', guide.categoryLabel);
    const save = makeElement('button', 'guide-save', savedGuides.has(guide.id) ? '★' : '☆');
    save.type = 'button';
    save.dataset.saveGuide = guide.id;
    save.setAttribute('aria-pressed', String(savedGuides.has(guide.id)));
    save.setAttribute('aria-label', savedGuides.has(guide.id) ? `إزالة ${guide.title} من المحفوظة` : `حفظ ${guide.title}`);
    save.addEventListener('click', () => toggleSaved(guide.id));
    header.append(number, category, save);

    const body = makeElement('div', 'guide-card-body');
    const title = makeElement('h3', '', guide.title);
    const summary = makeElement('p', '', guide.summary);
    const meta = makeElement('div', 'guide-meta');
    meta.append(makeElement('span', '', guide.audience), makeElement('span', '', guide.duration));
    body.append(title, summary, meta);

    const footer = document.createElement('footer');
    const details = makeElement('button', '', 'فتح الدليل');
    details.type = 'button';
    details.dataset.openGuide = guide.id;
    details.addEventListener('click', () => openGuide(guide.id));
    footer.append(details, makeElement('span', '', guide.outcome));
    card.append(header, body, footer);
    return card;
  };

  const filteredGuides = () => {
    const term = normalize(searchInput.value);
    const category = categorySelect.value;
    return guides.filter(guide => {
      if (category !== 'all' && guide.category !== category) return false;
      if (savedOnly && !savedGuides.has(guide.id)) return false;
      if (!term) return true;
      const haystack = normalize([guide.title, guide.summary, guide.categoryLabel, guide.audience, guide.outcome, ...guide.steps, ...guide.checklist].join(' '));
      return haystack.includes(term);
    });
  };

  function renderGuides() {
    const matches = filteredGuides();
    grid.replaceChildren(...matches.map(createGuideCard));
    emptyState.hidden = matches.length > 0;
    grid.hidden = matches.length === 0;
    resultCount.textContent = matches.length === 1 ? 'دليل واحد متاح' : `${matches.length} أدلة متاحة`;
  }

  const updateDialogSaveButton = id => {
    const button = document.querySelector('#guide-dialog-save');
    const saved = savedGuides.has(id);
    button.textContent = saved ? 'إزالة من الأدلة المحفوظة' : 'حفظ الدليل على هذا الجهاز';
    button.setAttribute('aria-pressed', String(saved));
  };

  const updateGuideUrl = id => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('guide', id);
    else url.searchParams.delete('guide');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${id ? '#guides' : window.location.hash}`);
  };

  const openGuide = id => {
    const guide = guides.find(item => item.id === id);
    if (!guide) return;
    activeGuideId = guide.id;
    document.querySelector('#guide-dialog-category').textContent = `${guide.number} · ${guide.categoryLabel}`;
    document.querySelector('#guide-dialog-title').textContent = guide.title;
    document.querySelector('#guide-dialog-summary').textContent = guide.summary;
    document.querySelector('#guide-dialog-outcome').textContent = guide.outcome;
    document.querySelector('#guide-dialog-audience').textContent = guide.audience;
    document.querySelector('#guide-dialog-duration').textContent = guide.duration;
    document.querySelector('#guide-dialog-steps').replaceChildren(...guide.steps.map(step => makeElement('li', '', step)));
    document.querySelector('#guide-dialog-checklist').replaceChildren(...guide.checklist.map(item => makeElement('li', '', item)));
    const related = document.querySelector('#guide-dialog-related');
    related.href = guide.related;
    related.textContent = `${guide.relatedLabel} ←`;
    updateDialogSaveButton(guide.id);
    updateGuideUrl(guide.id);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      dialog.classList.add('fallback-open');
      document.body.classList.add('guide-dialog-open');
    }
  };

  const closeGuide = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.classList.remove('fallback-open');
      document.body.classList.remove('guide-dialog-open');
    }
    activeGuideId = '';
    updateGuideUrl('');
  };

  const csvCell = value => `"${String(value).replace(/"/g, '""')}"`;
  const csv = rows => `\ufeff${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}`;
  const today = () => new Date().toISOString().slice(0, 10);
  const templates = {
    'data-inventory': {
      filename: 'geo-rafidain-data-inventory.csv', type: 'text/csv;charset=utf-8',
      content: () => csv([
        ['معرف المصدر','اسم البيانات','الجهة الناشرة','الإصدار أو المنتج','الرابط الرسمي','الدقة المكانية','الدقة الزمنية','فترة التغطية','نظام الإحداثيات','الترخيص','الاقتباس المقترح','تاريخ الوصول','قيود أو ملاحظات'],
        ['D-01','','','','','','','','','','',today(),'']
      ])
    },
    'processing-log': {
      filename: 'geo-rafidain-processing-log.csv', type: 'text/csv;charset=utf-8',
      content: () => csv([
        ['رقم الخطوة','التاريخ','الهدف','ملف أو طبقة الإدخال','الأداة أو الخوارزمية','البرنامج والإصدار','المعلمات','ملف الإخراج','فحص الجودة','ملاحظات وقرارات'],
        ['1',today(),'','','','','','','','']
      ])
    },
    'map-quality': {
      filename: 'geo-rafidain-map-quality-checklist.txt', type: 'text/plain;charset=utf-8',
      content: () => `\ufeffقائمة فحص الخريطة البحثية — جيو الرافدين\nتاريخ المراجعة: ${today()}\n\n[ ] عنوان الخريطة دقيق ويصف المكان والموضوع والفترة عند الحاجة.\n[ ] التسلسل البصري يبرز المتغير الرئيس من دون ازدحام.\n[ ] المفتاح يطابق جميع الرموز والفئات الظاهرة.\n[ ] الألوان ملائمة لطبيعة البيانات ويمكن تمييزها.\n[ ] مقياس الرسم مناسب ودقيق بالنسبة لحجم الإخراج.\n[ ] اتجاه الشمال والإحداثيات موجودان عند الحاجة.\n[ ] نظام الإحداثيات أو الإسقاط موثق.\n[ ] مصدر البيانات والإصدار وتاريخها مذكورة.\n[ ] الخطوط والأرقام مقروءة بحجم الطباعة النهائي.\n[ ] لا توحي الخريطة بدقة أعلى من دقة البيانات.\n[ ] جرى تدقيق الأسماء الجغرافية والحدود.\n[ ] جرى تصدير نسخة نهائية عالية الدقة وفحصها.\n\nملاحظات المراجع:\n`
    },
    'imagery-log': {
      filename: 'geo-rafidain-satellite-imagery-log.csv', type: 'text/csv;charset=utf-8',
      content: () => csv([
        ['معرف المشهد','القمر أو المستشعر','المنتج أو المستوى','تاريخ الالتقاط','المسار أو البلاطة','نسبة الغيوم','مصدر التنزيل','تاريخ التنزيل','المعالجة المطبقة','الإسقاط','حالة الجودة','ملاحظات'],
        ['IMG-01','','','','','','',today(),'','','','']
      ])
    },
    'methodology-outline': {
      filename: 'geo-rafidain-methodology-outline.txt', type: 'text/plain;charset=utf-8',
      content: () => `\ufeffهيكل إرشادي لقسم البيانات والمنهجية — جيو الرافدين\n\n1. منطقة الدراسة\n- الموقع والحدود والمساحة\n- سبب اختيار المنطقة\n- الخصائص ذات الصلة بسؤال البحث\n- نظام الإحداثيات ومصدر الحدود\n\n2. مصادر البيانات\n- اسم كل مصدر والجهة الناشرة\n- المنتج أو الإصدار والفترة\n- الدقة المكانية والزمنية والطيفية\n- سبب ملاءمته لسؤال البحث\n- الترخيص وتاريخ الوصول\n\n3. المعالجة المسبقة\n- تنظيم الملفات وضبط الجودة\n- التصحيح أو إعادة الإسقاط أو القص\n- معالجة الغيوم والقيم المفقودة\n- البرامج والأدوات والمعلمات\n\n4. منهج التحليل\n- المتغيرات ووحدات القياس\n- تسلسل الخطوات والخوارزميات\n- قواعد التصنيف أو الأوزان أو القيم الحدية\n- المخرجات الوسيطة والنهائية\n\n5. التحقق\n- بيانات أو عينات التحقق\n- طريقة اختيار العينة وحجمها\n- مؤشرات الدقة أو الخطأ المستخدمة\n\n6. القيود وعدم اليقين\n- حدود البيانات والمنهج\n- مصادر الخطأ المحتملة\n- أثر القيود على تفسير النتائج\n\nتنبيه: عدّل هذا الهيكل وفق تعليمات الجامعة والمشرف وطبيعة الدراسة.`
    }
  };

  const downloadTemplate = id => {
    const template = templates[id];
    if (!template) return;
    const blob = new Blob([template.content()], { type: template.type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = template.filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    templateStatus.textContent = 'تم تجهيز القالب على جهازك. لا تُرسل محتوياته إلى المنصة.';
  };

  const clearFilters = () => {
    searchInput.value = '';
    categorySelect.value = 'all';
    savedOnly = false;
    savedFilter.setAttribute('aria-pressed', 'false');
    renderGuides();
  };

  searchInput.addEventListener('input', renderGuides);
  categorySelect.addEventListener('change', renderGuides);
  savedFilter.addEventListener('click', () => {
    savedOnly = !savedOnly;
    savedFilter.setAttribute('aria-pressed', String(savedOnly));
    renderGuides();
  });
  document.querySelector('#guide-clear').addEventListener('click', clearFilters);
  document.querySelector('#empty-clear').addEventListener('click', clearFilters);
  document.querySelector('#guide-dialog-close').addEventListener('click', closeGuide);
  document.querySelector('#guide-dialog-save').addEventListener('click', () => toggleSaved(activeGuideId));
  document.querySelector('#guide-dialog-related').addEventListener('click', event => {
    const target = event.currentTarget.getAttribute('href');
    if (!target?.startsWith('#')) return;
    event.preventDefault();
    if (typeof dialog.close === 'function') dialog.close();
    else {
      dialog.removeAttribute('open');
      dialog.classList.remove('fallback-open');
      document.body.classList.remove('guide-dialog-open');
    }
    activeGuideId = '';
    updateGuideUrl('');
    window.location.hash = target;
    document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeGuide();
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeGuide();
  });
  document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => downloadTemplate(button.dataset.template)));

  const menuToggle = document.querySelector('.menu-toggle');
  const mainNav = document.querySelector('#main-nav');
  menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  mainNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    document.body.classList.remove('menu-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

  document.querySelector('#year').textContent = new Date().getFullYear();
  document.querySelector('#hero-guides-count').textContent = guides.length;
  updateSavedCount();
  renderGuides();
  const requestedGuide = new URLSearchParams(window.location.search).get('guide');
  if (guides.some(guide => guide.id === requestedGuide)) openGuide(requestedGuide);
})();
