(() => {
  'use strict';

  const STORAGE_KEY = 'geoRafidain.researchQuality.v1';
  const dimensions = [
    {
      id: 'design', number: '01', title: 'تصميم الدراسة وسؤال البحث', description: 'وضوح المشكلة والنطاق والمنطق الذي يربط السؤال بالمنهج.',
      criteria: [
        ['question', 'سؤال البحث محدد وقابل للقياس مكانيًا', 'يذكر الظاهرة والمكان والفترة أو العلاقة التي ستُختبر.', 'صغ سؤالاً يحدد الظاهرة ومنطقة الدراسة والفترة والمتغيرات.'],
        ['objectives', 'الأهداف مترابطة مع السؤال والمخرجات', 'لكل هدف إجراء أو تحليل ومخرج يمكن التحقق منه.', 'اربط كل هدف بتحليل محدد ومخرج قابل للمراجعة.'],
        ['scope', 'حدود الدراسة ومقياس التحليل مبرران', 'اختيار المنطقة والوحدة المكانية والدقة مدعوم بسبب علمي.', 'وثّق سبب اختيار المنطقة ووحدة التحليل والدقة.'],
        ['time', 'الفترة الزمنية مناسبة للظاهرة', 'تواتر البيانات وطول السلسلة يسمحان برصد التغير المطلوب.', 'راجع التغطية الزمنية وتواتر الرصد مقارنة بطبيعة الظاهرة.'],
        ['limitations', 'الافتراضات والقيود محددة منذ البداية', 'تظهر حدود التعميم والبيانات والوقت والموارد بوضوح.', 'أنشئ فقرة مبكرة للقيود والافتراضات وحدود التعميم.']
      ]
    },
    {
      id: 'data', number: '02', title: 'البيانات والمصادر', description: 'ملاءمة البيانات وإمكانية تتبع مصدرها واستخدامها بصورة مسؤولة.',
      criteria: [
        ['provenance', 'مصدر كل طبقة أو مرئية موثق', 'الجهة والرابط والإصدار وتاريخ الوصول مسجلة.', 'أنشئ جرداً يضم الجهة والإصدار والرابط وتاريخ الوصول لكل مصدر.'],
        ['fitness', 'الدقة المكانية والزمنية ملائمة للسؤال', 'لا تتجاوز الاستنتاجات مستوى التفاصيل الذي تسمح به البيانات.', 'قارن أصغر ظاهرة تريد رصدها بالدقة الفعلية للبيانات.'],
        ['coverage', 'التغطية والفجوات والقيم المفقودة مفحوصة', 'تمت مراجعة الاكتمال والغيوم والفترات أو المناطق الناقصة.', 'افحص التغطية والغيوم والقيم المفقودة وسجل أثرها المتوقع.'],
        ['license', 'الترخيص وشروط الاستخدام والاقتباس محفوظة', 'يمكن إثبات حق الاستخدام ونسب المصدر بصورة صحيحة.', 'احفظ نص الترخيص والاقتباس المطلوب مع البيانات قبل المعالجة.'],
        ['versions', 'الإصدارات والنسخ الأصلية محفوظة دون تعديل', 'يمكن الرجوع إلى المدخلات الأصلية ومطابقة كل نسخة مشتقة بها.', 'افصل البيانات الأصلية عن الملفات الوسيطة والنهائية بأسماء ثابتة.']
      ]
    },
    {
      id: 'workflow', number: '03', title: 'المعالجة وقابلية التكرار', description: 'قدرة باحث آخر على فهم خطوات العمل وإعادة تنفيذها.',
      criteria: [
        ['sequence', 'خطوات المعالجة مرتبة وموثقة', 'تسلسل المدخلات والأدوات والمخرجات واضح من البداية إلى النهاية.', 'أنشئ سجلاً زمنياً لكل خطوة ومدخلاتها ومخرجاتها.'],
        ['parameters', 'الأدوات والإصدارات والمعلمات مسجلة', 'يشمل السجل اسم البرنامج والأداة والإصدار والقيم المستخدمة.', 'سجل البرنامج والإصدار والمعلمات والوحدات لكل عملية.'],
        ['crs', 'نظم الإحداثيات والتحويلات موثقة', 'الإسقاط مناسب للتحليل وأي إعادة إسقاط قابلة للتتبع.', 'اذكر CRS لكل مدخل ومخرج وسبب أي تحويل أو إعادة إسقاط.'],
        ['decisions', 'القرارات اليدوية والقيم الحدية مبررة', 'لا توجد اختيارات مؤثرة يصعب استنتاجها من السجل.', 'وثّق أسباب العتبات والاستبعادات والتعديلات اليدوية.'],
        ['organization', 'بنية الملفات والتسمية تدعم إعادة التنفيذ', 'المجلدات والأسماء تميز الأصل والوسيط والنهائي بوضوح.', 'اعتمد بنية مجلدات وتسمية موحدة مع سجل للنسخ.']
      ]
    },
    {
      id: 'validation', number: '04', title: 'التحقق وعدم اليقين', description: 'قوة الدليل الذي يدعم النتائج وشفافية حدود الثقة بها.',
      criteria: [
        ['reference', 'بيانات التحقق مستقلة وملائمة', 'مصدر المرجع وطريقة العينة يتناسبان مع نوع النتيجة.', 'اختر مرجعاً مستقلاً واشرح زمنه ودقته وطريقة اختيار العينة.'],
        ['metrics', 'مقاييس الدقة مناسبة لنوع المخرج', 'المؤشرات المختارة تفسر جودة التصنيف أو النموذج أو التقدير.', 'استخدم مقاييس مناسبة وفسر معناها بدلاً من عرض رقم منفرد.'],
        ['sampling', 'حجم العينة وتوزيعها المكاني مبرران', 'العينات تغطي الفئات والمناطق ولا تترك انحيازاً واضحاً.', 'راجع حجم العينة وتوازن الفئات وتوزيعها المكاني.'],
        ['uncertainty', 'عدم اليقين والقيود مذكورة مع النتائج', 'تُعرض الحدود بجانب الاستنتاجات لا في نهاية البحث فقط.', 'أضف عدم اليقين وحدود الدقة إلى تفسير كل نتيجة رئيسية.'],
        ['sensitivity', 'تم فحص أثر المعلمات أو البدائل المهمة', 'النتيجة لا تعتمد دون نقاش على عتبة أو إعداد واحد.', 'اختبر إعداداً بديلاً واحداً على الأقل للمعلمات الأكثر تأثيراً.']
      ]
    },
    {
      id: 'communication', number: '05', title: 'الخرائط والكتابة العلمية', description: 'وضوح عرض النتائج وإسنادها إلى المنهج والمصادر.',
      criteria: [
        ['map-purpose', 'لكل خريطة رسالة واضحة مرتبطة بنتيجة', 'العنوان والتسلسل البصري يوجهان القارئ إلى الفكرة الرئيسة.', 'حدد الرسالة الرئيسة لكل خريطة واحذف العناصر التي لا تخدمها.'],
        ['map-elements', 'العناصر الكارتوغرافية والمصادر مكتملة', 'المفتاح والمقياس والإسقاط والمصدر والدقة موجودة عند الحاجة.', 'راجع العنوان والمفتاح والمقياس والإسقاط والمصدر والحجم النهائي.'],
        ['symbology', 'الرموز والألوان والتصنيف ملائمة للبيانات', 'الاختيار يراعي نوع المتغير وقابلية القراءة والمقارنة.', 'طابق طريقة التصنيف والألوان مع نوع البيانات وغرض المقارنة.'],
        ['methods', 'قسم المنهجية يسمح بفهم العمل وتكراره', 'يشرح اختيار البيانات والخطوات والمعلمات والتحقق والقيود.', 'اكتب المنهجية بترتيب التنفيذ مع سبب كل قرار رئيسي.'],
        ['claims', 'الاستنتاجات لا تتجاوز ما تدعمه النتائج', 'تُفصل الملاحظة عن التفسير والسببية عن الارتباط.', 'راجع كل استنتاج واربطه بنتيجة وحدّ من ادعاءات السببية غير المثبتة.']
      ]
    }
  ];

  const form = document.getElementById('quality-form');
  const sectionsRoot = document.getElementById('quality-sections');
  const titleInput = document.getElementById('audit-title');
  const stageSelect = document.getElementById('audit-stage');
  const answeredCount = document.getElementById('answered-count');
  const answeredBar = document.getElementById('answered-bar');
  const autosaveNote = document.getElementById('autosave-note');
  const report = document.getElementById('report');
  const reportStatus = document.getElementById('report-status');
  let state = loadState();

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { title: stored.title || '', stage: stored.stage || 'proposal', answers: stored.answers && typeof stored.answers === 'object' ? stored.answers : {} };
    } catch (_) {
      return { title: '', stage: 'proposal', answers: {} };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      autosaveNote.classList.remove('saved');
      void autosaveNote.offsetWidth;
      autosaveNote.classList.add('saved');
    } catch (_) {
      autosaveNote.querySelector('small').textContent = 'تعذر الحفظ المحلي في هذا المتصفح.';
    }
  }

  function criterionName(dimensionId, criterionId) { return `quality-${dimensionId}-${criterionId}`; }

  function renderSections() {
    let globalIndex = 0;
    sectionsRoot.innerHTML = dimensions.map(dimension => {
      const criteriaHtml = dimension.criteria.map(criterion => {
        globalIndex += 1;
        const [id, title, help] = criterion;
        const key = `${dimension.id}.${id}`;
        const selected = state.answers[key];
        const option = (value, label) => `<label data-value="${value}"><input type="radio" name="${criterionName(dimension.id, id)}" value="${value}" data-key="${key}" ${Number(selected) === value ? 'checked' : ''}><span>${label}</span></label>`;
        return `<div class="criterion"><div class="criterion-copy"><span class="criterion-index">${String(globalIndex).padStart(2, '0')}</span><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(help)}</p></div></div><div class="criterion-options" role="radiogroup" aria-label="تقييم: ${escapeHtml(title)}">${option(0, 'غير متحقق')}${option(1, 'جزئي')}${option(2, 'مكتمل')}</div></div>`;
      }).join('');
      return `<section class="quality-section" data-dimension="${dimension.id}"><header><span class="quality-section-number">${dimension.number}</span><div><h3>${escapeHtml(dimension.title)}</h3><p>${escapeHtml(dimension.description)}</p></div><strong class="section-score" id="section-score-${dimension.id}">0 / 10</strong></header>${criteriaHtml}</section>`;
    }).join('');
  }

  function allCriteria() {
    return dimensions.flatMap(dimension => dimension.criteria.map(criterion => ({ dimension, criterion, key: `${dimension.id}.${criterion[0]}` })));
  }

  function calculate() {
    const criteria = allCriteria();
    const answered = criteria.filter(item => Number.isFinite(Number(state.answers[item.key]))).length;
    const points = criteria.reduce((sum, item) => sum + (Number.isFinite(Number(state.answers[item.key])) ? Number(state.answers[item.key]) : 0), 0);
    const maximum = criteria.length * 2;
    const score = Math.round((points / maximum) * 100);
    const dimensionResults = dimensions.map(dimension => {
      const items = dimension.criteria.map(criterion => state.answers[`${dimension.id}.${criterion[0]}`]);
      const dimensionPoints = items.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
      return { id: dimension.id, title: dimension.title, points: dimensionPoints, max: items.length * 2, score: Math.round(dimensionPoints / (items.length * 2) * 100) };
    });
    return { answered, total: criteria.length, points, maximum, score, dimensionResults };
  }

  function updateProgress() {
    const result = calculate();
    answeredCount.textContent = `${result.answered} من ${result.total}`;
    answeredBar.style.width = `${Math.round(result.answered / result.total * 100)}%`;
    result.dimensionResults.forEach(item => {
      const element = document.getElementById(`section-score-${item.id}`);
      if (element) element.textContent = `${item.points} / ${item.max}`;
    });
  }

  function readiness(score, answered, total) {
    if (!answered) return ['لم يبدأ التدقيق', 'ابدأ بتقييم المعايير لتكوين صورة أولية عن جاهزية الدراسة.'];
    if (answered < total) return ['التقييم غير مكتمل', `أجبت عن ${answered} من ${total} معيارًا. أكمل التدقيق قبل اعتماد النتيجة.`];
    if (score < 40) return ['تحتاج إلى تأسيس', 'توجد فجوات جوهرية؛ عالج تصميم الدراسة والبيانات قبل توسيع التحليل.'];
    if (score < 65) return ['تحتاج إلى تحسين مركز', 'الأساس موجود، لكن عدة عناصر تحتاج توثيقًا أو تحققًا أقوى قبل المراجعة.'];
    if (score < 80) return ['جيدة مع فجوات', 'الدراسة متقدمة، ورفع المعايير ذات الأولوية سيحسن قابليتها للمراجعة والتكرار.'];
    if (score < 90) return ['جاهزة للمراجعة', 'الجوانب الرئيسة موثقة بدرجة جيدة؛ راجع الفجوات المتبقية وتعليمات الجهة الأكاديمية.'];
    return ['جاهزية قوية', 'تظهر الدراسة مستوى توثيق مرتفعًا؛ نفذ مراجعة نهائية مستقلة قبل التسليم أو النشر.'];
  }

  function recommendations() {
    const items = allCriteria().map(item => ({ ...item, value: Number.isFinite(Number(state.answers[item.key])) ? Number(state.answers[item.key]) : -1 }));
    const priority = value => value === 0 ? 0 : value === 1 ? 1 : 2;
    return items.filter(item => item.value < 2).sort((a, b) => priority(a.value) - priority(b.value)).slice(0, 7);
  }

  function renderReport(scroll = true) {
    const result = calculate();
    const [label, summary] = readiness(result.score, result.answered, result.total);
    document.getElementById('total-score').textContent = `${result.score}%`;
    document.getElementById('score-ring').style.setProperty('--score', result.score);
    document.getElementById('score-ring').setAttribute('aria-label', `درجة الجاهزية ${result.score} بالمئة`);
    document.getElementById('readiness-label').textContent = label;
    document.getElementById('readiness-summary').textContent = summary;
    document.getElementById('report-completeness').textContent = `اكتمل تقييم ${result.answered} من ${result.total} معيارًا. الدرجة لا تعوّض مراجعة المشرف أو متطلبات الجامعة أو المجلة.`;
    document.getElementById('dimension-scores').innerHTML = result.dimensionResults.map(item => `<div class="dimension-row"><span>${escapeHtml(item.title)}</span><div class="dimension-bar" aria-hidden="true"><i style="width:${item.score}%"></i></div><strong>${item.score}%</strong></div>`).join('');
    const recs = recommendations();
    document.getElementById('recommendations').innerHTML = recs.length
      ? recs.map(item => `<li><strong>${escapeHtml(item.criterion[1])}</strong>${escapeHtml(item.criterion[3])}</li>`).join('')
      : '<li><strong>لا توجد فجوات مسجلة</strong>نفّذ مراجعة مستقلة وتحقق من تعليمات الجامعة أو المجلة قبل التسليم.</li>';
    report.hidden = false;
    if (scroll) report.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    return result;
  }

  function reportText() {
    const result = calculate();
    const [label] = readiness(result.score, result.answered, result.total);
    const stageLabel = stageSelect.options[stageSelect.selectedIndex].text;
    const lines = [
      'جيو الرافدين — تقرير تدقيق جودة الدراسة الجغرافية',
      '=================================================',
      `عنوان الدراسة: ${titleInput.value.trim() || 'غير محدد'}`,
      `مرحلة العمل: ${stageLabel}`,
      `تاريخ التقرير: ${new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'long' }).format(new Date())}`,
      `اكتمال التقييم: ${result.answered} من ${result.total}`,
      `درجة الجاهزية: ${result.score}% — ${label}`,
      '',
      'النتيجة حسب المحور:',
      ...result.dimensionResults.map(item => `- ${item.title}: ${item.score}% (${item.points}/${item.max})`),
      '',
      'أولويات التحسين:'
    ];
    const recs = recommendations();
    if (recs.length) recs.forEach((item, index) => lines.push(`${index + 1}. ${item.criterion[1]} — ${item.criterion[3]}`));
    else lines.push('- لا توجد فجوات مسجلة؛ يوصى بمراجعة مستقلة نهائية.');
    lines.push('', 'تنبيه: هذا فحص ذاتي إرشادي ولا يمثل قبولاً أكاديمياً أو تحكيماً علمياً. تُقدّم تعليمات الجامعة والمشرف والمجلة على هذا التقرير.', 'https://mmssuu76-tech.github.io/geo-rafidain/research-quality.html');
    return lines.join('\n');
  }

  function downloadReport() {
    renderReport(false);
    const blob = new Blob(['\ufeff', reportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geo-rafidain-quality-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    reportStatus.textContent = 'تم تجهيز التقرير على جهازك. راجعه قبل مشاركته أو اعتماده.';
  }

  function resetAudit() {
    if (!window.confirm('هل تريد حذف مسودة التدقيق المحفوظة على هذا المتصفح والبدء من جديد؟')) return;
    state = { title: '', stage: 'proposal', answers: {} };
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    titleInput.value = '';
    stageSelect.value = 'proposal';
    form.reset();
    report.hidden = true;
    renderSections();
    bindAnswerEvents();
    updateProgress();
    document.getElementById('audit').scrollIntoView({ behavior: 'smooth' });
  }

  function bindAnswerEvents() {
    sectionsRoot.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', event => {
      state.answers[event.target.dataset.key] = Number(event.target.value);
      saveState();
      updateProgress();
      if (!report.hidden) renderReport(false);
    }));
  }

  titleInput.value = state.title;
  stageSelect.value = state.stage;
  renderSections();
  bindAnswerEvents();
  updateProgress();

  titleInput.addEventListener('input', () => { state.title = titleInput.value; saveState(); });
  stageSelect.addEventListener('change', () => { state.stage = stageSelect.value; saveState(); });
  document.getElementById('show-report').addEventListener('click', () => renderReport(true));
  document.getElementById('audit-reset').addEventListener('click', resetAudit);
  document.getElementById('report-download').addEventListener('click', downloadReport);
  document.getElementById('report-print').addEventListener('click', () => { renderReport(false); window.print(); });

  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');
  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      document.body.classList.remove('menu-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'فتح القائمة');
    }));
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
