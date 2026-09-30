(() => {
  'use strict';

  const form = document.querySelector('#research-planner-form');
  if (!form) return;

  const storageKey = 'geoRafidain.researchPlanner.v1';
  const steps = [...form.querySelectorAll('.planner-step')];
  const progressSteps = [...document.querySelectorAll('[data-progress-step]')];
  const progressBar = document.querySelector('#progress-bar');
  const progressPercent = document.querySelector('#progress-percent');
  const backButton = document.querySelector('#planner-back');
  const nextButton = document.querySelector('#planner-next');
  const generateButton = document.querySelector('#planner-generate');
  const errorBox = document.querySelector('#planner-error');
  const resultSection = document.querySelector('#research-brief');
  const briefContent = document.querySelector('#brief-content');
  const briefDate = document.querySelector('#brief-date');
  const recommendationsBox = document.querySelector('#recommended-resources');
  const libraryLink = document.querySelector('#brief-library-link');
  const requestLink = document.querySelector('#brief-request-link');
  const notice = document.querySelector('#brief-notice');
  const menuToggle = document.querySelector('.menu-toggle');
  const mainNav = document.querySelector('#main-nav');

  const domainLabels = {
    environment: 'تغيرات بيئية ومناخية',
    urban: 'جغرافية حضرية واستعمالات الأرض',
    agriculture: 'زراعة وغطاء نباتي',
    water: 'مياه وهيدرولوجيا',
    population: 'سكان وخدمات',
    terrain: 'تضاريس وجيومورفولوجيا'
  };

  const resourceLabels = {
    'sentinel-2-l2a': 'Sentinel-2 Level-2A',
    'landsat-collection-2-l2': 'Landsat Collection 2 Level-2',
    'era5-single-levels': 'ERA5 للمتغيرات المناخية',
    'chirps-v3': 'CHIRPS للأمطار',
    'nasadem-hgt': 'NASADEM للارتفاعات',
    'soilgrids-250m': 'SoilGrids لخصائص التربة',
    'hydrosheds-core-v1-1': 'HydroSHEDS للأحواض وشبكات التصريف',
    'worldpop-global2': 'WorldPop للسكان',
    'jrc-global-surface-water': 'JRC Global Surface Water',
    'fao-wapor-v3': 'FAO WaPOR لإنتاجية المياه والزراعة',
    'openstreetmap-iraq-geofabrik': 'OpenStreetMap للعراق'
  };

  const domainResources = {
    environment: ['sentinel-2-l2a', 'landsat-collection-2-l2', 'era5-single-levels', 'chirps-v3', 'jrc-global-surface-water'],
    urban: ['sentinel-2-l2a', 'landsat-collection-2-l2', 'openstreetmap-iraq-geofabrik', 'worldpop-global2'],
    agriculture: ['sentinel-2-l2a', 'chirps-v3', 'soilgrids-250m', 'fao-wapor-v3'],
    water: ['jrc-global-surface-water', 'hydrosheds-core-v1-1', 'chirps-v3', 'nasadem-hgt'],
    population: ['worldpop-global2', 'openstreetmap-iraq-geofabrik'],
    terrain: ['nasadem-hgt', 'hydrosheds-core-v1-1', 'landsat-collection-2-l2']
  };

  const domainServices = {
    environment: 'تحليل التغيرات البيئية والمناخية',
    urban: 'التحليلات الجغرافية',
    agriculture: 'توفير بيانات الاستشعار عن بُعد',
    water: 'التحليلات الجغرافية',
    population: 'التحليلات الجغرافية',
    terrain: 'التحليلات الجغرافية'
  };

  let currentStep = 0;
  let generatedBrief = '';
  let recommendedSlugs = [];

  const selectedLabels = name => [...form.querySelectorAll(`[name="${name}"]:checked`)]
    .map(input => input.dataset.label || input.value);

  const selectedValues = name => [...form.querySelectorAll(`[name="${name}"]:checked`)]
    .map(input => input.value);

  const fieldText = name => {
    const field = form.elements[name];
    if (!field) return '';
    if (field instanceof HTMLSelectElement) return field.selectedOptions[0]?.textContent?.trim() || '';
    return String(field.value || '').trim();
  };

  const collectData = () => ({
    title: fieldText('title'),
    question: fieldText('question'),
    level: fieldText('level'),
    domain: form.elements.domain.value,
    domainLabel: domainLabels[form.elements.domain.value] || fieldText('domain'),
    scope: fieldText('scope'),
    governorate: fieldText('governorate') === 'غير محددة' ? '' : fieldText('governorate'),
    studyArea: fieldText('studyArea'),
    periodStart: fieldText('periodStart'),
    periodEnd: fieldText('periodEnd'),
    scale: fieldText('scale'),
    datasetLabels: selectedLabels('datasets'),
    datasetValues: selectedValues('datasets'),
    methods: selectedLabels('methods'),
    outputs: selectedLabels('outputs'),
    deadline: fieldText('deadline'),
    crs: fieldText('crs'),
    notes: fieldText('notes')
  });

  const serializeForm = () => {
    const values = {};
    [...form.elements].forEach(field => {
      if (!field.name || field.type === 'submit' || field.type === 'button') return;
      if (field.type === 'checkbox') {
        if (!Array.isArray(values[field.name])) values[field.name] = [];
        if (field.checked) values[field.name].push(field.value);
      } else {
        values[field.name] = String(field.value || '').slice(0, 5000);
      }
    });
    return values;
  };

  const persistDraft = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ values: serializeForm(), currentStep }));
    } catch {
      // The planner remains usable when private browsing blocks local storage.
    }
  };

  const restoreDraft = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved || typeof saved.values !== 'object') return;
      Object.entries(saved.values).forEach(([name, value]) => {
        const fields = [...form.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
        fields.forEach(field => {
          if (field.type === 'checkbox') field.checked = Array.isArray(value) && value.includes(field.value);
          else if (typeof value === 'string') field.value = value;
        });
      });
      if (Number.isInteger(saved.currentStep)) currentStep = Math.min(Math.max(saved.currentStep, 0), steps.length - 1);
    } catch {
      localStorage.removeItem(storageKey);
    }
  };

  const setError = (message, field) => {
    errorBox.textContent = message;
    if (field) {
      field.focus({ preventScroll: true });
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const validateStep = stepIndex => {
    errorBox.textContent = '';
    const step = steps[stepIndex];
    const invalidField = [...step.querySelectorAll('input, select, textarea')]
      .find(field => !field.checkValidity());
    if (invalidField) {
      const label = invalidField.closest('label')?.childNodes[0]?.textContent?.trim() || 'هذا الحقل';
      setError(`يرجى إكمال «${label}» بصورة صحيحة قبل المتابعة.`, invalidField);
      return false;
    }

    if (stepIndex === 1) {
      const start = Number(form.elements.periodStart.value);
      const end = Number(form.elements.periodEnd.value);
      if (start && end && start > end) {
        setError('يجب أن تكون بداية الفترة أقدم من نهايتها أو مساوية لها.', form.elements.periodStart);
        return false;
      }
    }

    if (stepIndex === 2 && !selectedValues('datasets').length) {
      setError('اختر مصدراً أو نوع بيانات واحداً على الأقل.', step.querySelector('[name="datasets"]'));
      return false;
    }
    if (stepIndex === 2 && !selectedValues('methods').length) {
      setError('اختر تحليلاً متوقعاً واحداً على الأقل.', step.querySelector('[name="methods"]'));
      return false;
    }
    if (stepIndex === 3 && !selectedValues('outputs').length) {
      setError('اختر مخرجاً مطلوباً واحداً على الأقل.', step.querySelector('[name="outputs"]'));
      return false;
    }
    return true;
  };

  const showStep = stepIndex => {
    currentStep = Math.min(Math.max(stepIndex, 0), steps.length - 1);
    steps.forEach((step, index) => {
      const active = index === currentStep;
      step.hidden = !active;
      step.classList.toggle('active', active);
    });
    progressSteps.forEach((item, index) => {
      item.classList.toggle('active', index === currentStep);
      item.classList.toggle('complete', index < currentStep);
      item.setAttribute('aria-current', index === currentStep ? 'step' : 'false');
    });
    const percent = Math.round(((currentStep + 1) / steps.length) * 100);
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    backButton.disabled = currentStep === 0;
    nextButton.hidden = currentStep === steps.length - 1;
    generateButton.hidden = currentStep !== steps.length - 1;
    errorBox.textContent = '';
    persistDraft();
  };

  const recommendResources = data => {
    const merged = [
      ...data.datasetValues.filter(slug => slug !== 'other'),
      ...(domainResources[data.domain] || [])
    ];
    return [...new Set(merged)].filter(slug => resourceLabels[slug]).slice(0, 8);
  };

  const readablePeriod = data => {
    if (data.periodStart && data.periodEnd) return `${data.periodStart}–${data.periodEnd}`;
    if (data.periodStart) return `من ${data.periodStart}`;
    if (data.periodEnd) return `حتى ${data.periodEnd}`;
    return 'غير محددة بعد';
  };

  const readableDeadline = value => {
    if (!value) return 'غير محدد';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  const buildBriefText = data => {
    const recommendations = recommendedSlugs.map(slug => resourceLabels[slug]);
    return [
      'موجز دراسة جغرافية — جيو الرافدين',
      `تاريخ الإنشاء: ${new Date().toLocaleDateString('ar-IQ')}`,
      '',
      `العنوان المبدئي: ${data.title}`,
      `سؤال البحث: ${data.question}`,
      `المستوى الأكاديمي: ${data.level}`,
      `المجال: ${data.domainLabel}`,
      '',
      `نطاق الدراسة: ${data.scope}`,
      `المحافظة الرئيسة: ${data.governorate || 'غير محددة'}`,
      `منطقة الدراسة: ${data.studyArea}`,
      `الفترة الزمنية: ${readablePeriod(data)}`,
      `الدقة أو الوحدة المكانية: ${data.scale}`,
      '',
      `البيانات المتوقعة: ${data.datasetLabels.join('، ')}`,
      `المصادر المقترحة: ${recommendations.join('، ')}`,
      `التحليلات المتوقعة: ${data.methods.join('، ')}`,
      `المخرجات المطلوبة: ${data.outputs.join('، ')}`,
      '',
      `موعد التسليم التقريبي: ${readableDeadline(data.deadline)}`,
      `نظام الإحداثيات: ${data.crs}`,
      `ملاحظات وقيود: ${data.notes || 'لا توجد ملاحظات إضافية.'}`,
      '',
      'تنبيه منهجي: هذا الموجز نقطة بداية إرشادية. يجب التحقق من ملاءمة الدقة والفترة والمنهج وتوافر البيانات مع المشرف أو المتخصص قبل اعتماد الدراسة.'
    ].join('\n');
  };

  const createBlock = (title, entries) => {
    const block = document.createElement('section');
    block.className = 'brief-block';
    const heading = document.createElement('h3');
    heading.textContent = title;
    block.append(heading);
    entries.forEach(([label, value]) => {
      const row = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = label;
      const span = document.createElement('span');
      span.textContent = value || 'غير محدد';
      row.append(strong, span);
      block.append(row);
    });
    return block;
  };

  const renderBrief = data => {
    recommendedSlugs = recommendResources(data);
    generatedBrief = buildBriefText(data);
    briefDate.textContent = new Date().toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long', day: 'numeric' });
    briefContent.replaceChildren(
      createBlock('تعريف الدراسة', [
        ['العنوان', data.title],
        ['السؤال', data.question],
        ['المستوى', data.level],
        ['المجال', data.domainLabel]
      ]),
      createBlock('النطاق المكاني والزمني', [
        ['النطاق', data.scope],
        ['المحافظة', data.governorate || 'غير محددة'],
        ['منطقة الدراسة', data.studyArea],
        ['الفترة', readablePeriod(data)],
        ['الدقة', data.scale]
      ]),
      createBlock('البيانات والمنهج', [
        ['البيانات', data.datasetLabels.join('، ')],
        ['التحليلات', data.methods.join('، ')]
      ]),
      createBlock('المخرجات والقيود', [
        ['المخرجات', data.outputs.join('، ')],
        ['الموعد', readableDeadline(data.deadline)],
        ['الإحداثيات', data.crs],
        ['الملاحظات', data.notes || 'لا توجد ملاحظات إضافية.']
      ])
    );

    recommendationsBox.replaceChildren(...recommendedSlugs.map(slug => {
      const item = document.createElement('span');
      item.textContent = resourceLabels[slug];
      return item;
    }));

    const collection = new URLSearchParams({ collection: recommendedSlugs.join(',') });
    libraryLink.href = `data-library.html?${collection.toString()}#catalog`;
    const requestParams = new URLSearchParams({
      service: domainServices[data.domain] || 'التحليلات الجغرافية',
      project: data.title,
      brief: generatedBrief.slice(0, 3800)
    });
    requestLink.href = `index.html?${requestParams.toString()}#request`;
    resultSection.hidden = false;
    notice.textContent = '';
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copyBrief = async () => {
    if (!generatedBrief) return;
    try {
      await navigator.clipboard.writeText(generatedBrief);
    } catch {
      const area = document.createElement('textarea');
      area.value = generatedBrief;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    notice.textContent = 'تم نسخ الموجز إلى الحافظة.';
  };

  const downloadBrief = () => {
    if (!generatedBrief) return;
    const title = collectData().title || 'دراسة-جغرافية';
    const safeName = title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 70);
    const blob = new Blob([`\ufeff${generatedBrief}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `موجز-${safeName}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notice.textContent = 'تم تجهيز ملف الموجز النصي.';
  };

  backButton.addEventListener('click', () => showStep(currentStep - 1));
  nextButton.addEventListener('click', () => {
    if (validateStep(currentStep)) showStep(currentStep + 1);
  });

  form.addEventListener('input', persistDraft);
  form.addEventListener('change', persistDraft);
  form.addEventListener('submit', event => {
    event.preventDefault();
    for (let index = 0; index < steps.length; index += 1) {
      if (!validateStep(index)) {
        showStep(index);
        validateStep(index);
        return;
      }
    }
    renderBrief(collectData());
  });

  document.querySelector('#brief-copy')?.addEventListener('click', copyBrief);
  document.querySelector('#brief-download')?.addEventListener('click', downloadBrief);
  document.querySelector('#brief-print')?.addEventListener('click', () => window.print());
  document.querySelector('#planner-reset')?.addEventListener('click', () => {
    if (!window.confirm('هل تريد حذف مسودة المخطط الحالية والبدء من جديد؟')) return;
    form.reset();
    localStorage.removeItem(storageKey);
    generatedBrief = '';
    recommendedSlugs = [];
    resultSection.hidden = true;
    showStep(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(open));
  });
  mainNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    document.body.classList.remove('menu-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();
  restoreDraft();
  showStep(currentStep);
})();
