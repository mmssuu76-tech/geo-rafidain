(() => {
  'use strict';

  const KEYS = Object.freeze({
    planner: 'geoRafidain.researchPlanner.v1',
    resources: 'geoRafidain.researchWorkspace.v1',
    guides: 'geoRafidain.savedGuides.v1',
    quality: 'geoRafidain.researchQuality.v1'
  });
  const hubStatus = document.getElementById('hub-status');
  let snapshot = null;

  const readJSON = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  };

  const hasContent = values => values && typeof values === 'object' && Object.values(values).some(value => Array.isArray(value) ? value.length : String(value || '').trim().length);
  const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
  const sourceCountText = count => count === 1 ? 'مصدرًا واحدًا' : count === 2 ? 'مصدرين' : `${count} مصادر`;
  const guideCountText = count => count === 1 ? 'دليلاً واحدًا' : count === 2 ? 'دليلين' : `${count} أدلة`;
  const criterionCountText = count => count === 1 ? 'معيار واحد' : count === 2 ? 'معيارين' : `${count} معايير`;

  function buildSnapshot() {
    const plannerRaw = readJSON(KEYS.planner, {});
    const plannerValues = plannerRaw && typeof plannerRaw.values === 'object' ? plannerRaw.values : {};
    const plannerStarted = hasContent(plannerValues);
    const plannerStep = Number.isInteger(plannerRaw.currentStep) ? clamp(plannerRaw.currentStep, 0, 3) : 0;
    const plannerProgress = plannerStarted ? (plannerStep + 1) * 25 : 0;

    const resourcesRaw = readJSON(KEYS.resources, {});
    const resourceSlugs = Array.isArray(resourcesRaw.slugs) ? [...new Set(resourcesRaw.slugs.filter(item => typeof item === 'string'))].slice(0, 12) : [];
    const resourcesProgress = Math.round(Math.min(resourceSlugs.length / 3, 1) * 100);

    const guideRaw = readJSON(KEYS.guides, []);
    const guides = Array.isArray(guideRaw) ? [...new Set(guideRaw.filter(item => typeof item === 'string'))].slice(0, 7) : [];
    const guidesProgress = Math.round(Math.min(guides.length / 3, 1) * 100);

    const qualityRaw = readJSON(KEYS.quality, {});
    const answers = qualityRaw.answers && typeof qualityRaw.answers === 'object' ? qualityRaw.answers : {};
    const answerValues = Object.values(answers).map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= 2).slice(0, 25);
    const qualityAnswered = answerValues.length;
    const qualityScore = Math.round(answerValues.reduce((sum, value) => sum + value, 0) / 50 * 100);
    const qualityProgress = Math.round(qualityAnswered / 25 * 100);

    const projectName = [plannerValues.title, resourcesRaw.title, qualityRaw.title].find(value => typeof value === 'string' && value.trim()) || 'مشروع بحثي جديد';
    const overall = Math.round((plannerProgress + resourcesProgress + guidesProgress + qualityProgress) / 4);
    return { plannerValues, plannerStarted, plannerStep, plannerProgress, resourceSlugs, resourcesProgress, guides, guidesProgress, qualityAnswered, qualityScore, qualityProgress, projectName, overall };
  }

  function setStateBadge(id, text, tone = '') {
    const element = document.getElementById(id);
    element.textContent = text;
    element.className = `tool-state${tone ? ` ${tone}` : ''}`;
  }

  function nextAction(data) {
    if (!data.plannerStarted) return { title: 'ابدأ بتعريف الدراسة', description: 'نظّم سؤال البحث والنطاق والمنهج والمخرجات قبل اختيار البيانات.', label: 'فتح مخطط الدراسة', href: 'research-planner.html' };
    if (data.plannerProgress < 100) return { title: 'أكمل مخطط الدراسة', description: `المسودة عند المرحلة ${data.plannerStep + 1} من 4؛ أكملها للحصول على موجز منظم.`, label: 'متابعة المخطط', href: 'research-planner.html' };
    if (!data.resourceSlugs.length) return { title: 'أنشئ ملف المصادر', description: 'اختر البيانات والمرئيات الملائمة بعد تثبيت سؤال الدراسة ونطاقها.', label: 'استكشاف المصادر', href: 'data-library.html' };
    if (!data.guides.length) return { title: 'احفظ أدلة مرحلتك', description: 'اختر الإرشادات والقوالب التي تساعدك على توثيق المعالجة والمنهجية.', label: 'فتح الأدلة', href: 'research-guides.html' };
    if (data.qualityAnswered < 25) return { title: 'دقّق جاهزية الدراسة', description: `راجعت ${data.qualityAnswered} من 25 معيارًا؛ أكمل التقييم لكشف فجوات الجودة.`, label: 'متابعة التدقيق', href: 'research-quality.html' };
    if (data.qualityScore < 80) return { title: 'عالج أولويات الجودة', description: `درجة الجاهزية الحالية ${data.qualityScore}%. راجع توصيات التدقيق والأدلة المرتبطة.`, label: 'مراجعة التقرير', href: 'research-quality.html#report' };
    return { title: 'جهّز الدراسة للمراجعة', description: 'المسار المحلي مكتمل بدرجة جيدة؛ راجع تعليمات الجامعة أو اطلب دعماً متخصصاً عند الحاجة.', label: 'طلب دعم بحثي', href: 'index.html#request' };
  }

  function render() {
    snapshot = buildSnapshot();
    const data = snapshot;
    document.getElementById('project-name').textContent = data.projectName;
    document.getElementById('overall-progress').textContent = `${data.overall}%`;
    const ring = document.getElementById('hub-ring');
    ring.style.setProperty('--progress', data.overall);
    ring.setAttribute('aria-label', `التقدم العام ${data.overall} بالمئة`);
    document.getElementById('project-summary').textContent = data.overall ? 'تظهر المؤشرات تقدمك عبر أدوات الباحث المحفوظة في هذا المتصفح.' : 'ابدأ بمخطط الدراسة لبناء مسار بحثي منظم.';
    document.getElementById('metric-planner').textContent = `${data.plannerProgress}%`;
    document.getElementById('metric-resources').textContent = data.resourceSlugs.length;
    document.getElementById('metric-guides').textContent = data.guides.length;
    document.getElementById('metric-quality').textContent = `${data.qualityAnswered}/25`;

    document.getElementById('planner-bar').style.width = `${data.plannerProgress}%`;
    document.getElementById('planner-progress-label').textContent = `${data.plannerProgress}%`;
    document.getElementById('planner-detail').textContent = data.plannerStarted ? `المسودة محفوظة عند المرحلة ${data.plannerStep + 1} من 4.` : 'لا توجد مسودة محفوظة.';
    document.getElementById('planner-link').textContent = data.plannerStarted ? 'متابعة المخطط ←' : 'فتح المخطط ←';
    setStateBadge('planner-state', !data.plannerStarted ? 'لم يبدأ' : data.plannerProgress === 100 ? 'الموجز قريب من الاكتمال' : 'قيد العمل', data.plannerProgress === 100 ? 'complete' : data.plannerStarted ? 'active' : '');

    document.getElementById('resources-bar').style.width = `${data.resourcesProgress}%`;
    document.getElementById('resources-progress-label').textContent = `${data.resourcesProgress}%`;
    document.getElementById('resources-detail').textContent = data.resourceSlugs.length ? `يحتوي ملف البحث على ${sourceCountText(data.resourceSlugs.length)}.` : 'لم تُحفظ مصادر بعد.';
    setStateBadge('resources-state', data.resourceSlugs.length ? 'نشط' : 'فارغ', data.resourceSlugs.length ? 'active' : '');

    document.getElementById('guides-bar').style.width = `${data.guidesProgress}%`;
    document.getElementById('guides-progress-label').textContent = `${data.guidesProgress}%`;
    document.getElementById('guides-detail').textContent = data.guides.length ? `حفظت ${guideCountText(data.guides.length)} للاستخدام لاحقًا.` : 'لم تُحفظ أدلة مفضلة.';
    setStateBadge('guides-state', data.guides.length ? 'مخصص' : 'غير مخصص', data.guides.length ? 'active' : '');

    document.getElementById('quality-bar').style.width = `${data.qualityProgress}%`;
    document.getElementById('quality-progress-label').textContent = `${data.qualityAnswered}/25`;
    document.getElementById('quality-detail').textContent = data.qualityAnswered ? `درجة الجاهزية ${data.qualityScore}% بعد ${criterionCountText(data.qualityAnswered)}.` : 'لا توجد إجابات محفوظة.';
    setStateBadge('quality-state', !data.qualityAnswered ? 'لم يبدأ' : data.qualityAnswered === 25 ? 'مكتمل' : 'قيد التدقيق', data.qualityAnswered === 25 ? 'complete' : data.qualityAnswered ? 'active' : '');

    const next = nextAction(data);
    document.getElementById('next-title').textContent = next.title;
    document.getElementById('next-description').textContent = next.description;
    const nextLink = document.getElementById('next-link');
    nextLink.href = next.href;
    nextLink.innerHTML = `${next.label} <span>←</span>`;
  }

  function progressText() {
    const data = snapshot || buildSnapshot();
    return [
      'جيو الرافدين — ملخص تقدم الباحث',
      '=================================',
      `المشروع: ${data.projectName}`,
      `التاريخ: ${new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'long' }).format(new Date())}`,
      `التقدم العام: ${data.overall}%`,
      '',
      `مخطط الدراسة: ${data.plannerProgress}% — ${data.plannerStarted ? `المرحلة ${data.plannerStep + 1} من 4` : 'لم يبدأ'}`,
      `المصادر المحفوظة: ${data.resourceSlugs.length} من 12`,
      `الأدلة المفضلة: ${data.guides.length} من 7`,
      `تدقيق الجودة: ${data.qualityAnswered} من 25 — درجة الجاهزية ${data.qualityScore}%`,
      '',
      `الخطوة المقترحة: ${nextAction(data).title}`,
      '',
      'تنبيه: هذا الملخص شخصي وإرشادي، ويُنشأ من بيانات محفوظة محلياً في المتصفح.',
      'https://mmssuu76-tech.github.io/geo-rafidain/research-hub.html'
    ].join('\n');
  }

  function downloadSummary() {
    const blob = new Blob(['\ufeff', progressText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geo-rafidain-progress-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    hubStatus.textContent = 'تم تجهيز ملخص التقدم على جهازك.';
  }

  render();
  document.getElementById('hub-refresh').addEventListener('click', () => { render(); hubStatus.textContent = 'تم تحديث المؤشرات من البيانات المحلية الحالية.'; });
  document.getElementById('hub-download').addEventListener('click', downloadSummary);
  window.addEventListener('pageshow', render);
  window.addEventListener('storage', render);

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
