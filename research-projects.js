(() => {
  'use strict';

  const backend = window.geoBackend;
  const KEYS = Object.freeze({
    planner: 'geoRafidain.researchPlanner.v1',
    resources: 'geoRafidain.researchWorkspace.v1',
    guides: 'geoRafidain.savedGuides.v1',
    quality: 'geoRafidain.researchQuality.v1',
    active: 'geoRafidain.activeResearchProject.v1'
  });
  const stageLabels = Object.freeze({ idea: 'الفكرة', planning: 'التخطيط', data_collection: 'جمع البيانات', analysis: 'التحليل', writing: 'الكتابة', review: 'المراجعة', completed: 'مكتملة' });
  const accountGate = document.getElementById('account-gate');
  const migrationGate = document.getElementById('migration-gate');
  const account = document.getElementById('projects-account');
  const status = document.getElementById('projects-status');
  const projectList = document.getElementById('projects-list');
  const loginForm = document.getElementById('projects-login-form');
  const createForm = document.getElementById('create-project-form');
  let projects = [];
  let localSnapshot = null;
  let currentUser = null;
  let statusTimer = null;
  const savingProjects = new Set();

  const readJSON = (key, fallback = null) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };
  const safe = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const dateLabel = value => value ? new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const migrationMissing = error => /research_projects|42P01|PGRST205|schema cache/i.test(`${error?.code || ''} ${error?.message || ''}`);

  function buildLocalSnapshot() {
    const planner = readJSON(KEYS.planner, null);
    const resources = readJSON(KEYS.resources, null);
    const guides = readJSON(KEYS.guides, []);
    const quality = readJSON(KEYS.quality, null);
    const plannerValues = planner?.values && typeof planner.values === 'object' ? planner.values : {};
    const plannerStarted = Object.values(plannerValues).some(value => Array.isArray(value) ? value.length : String(value || '').trim());
    const plannerProgress = plannerStarted ? (Math.min(3, Math.max(0, Number(planner.currentStep) || 0)) + 1) * 25 : 0;
    const resourceCount = Array.isArray(resources?.slugs) ? new Set(resources.slugs).size : 0;
    const guideCount = Array.isArray(guides) ? new Set(guides).size : 0;
    const answerValues = quality?.answers && typeof quality.answers === 'object' ? Object.values(quality.answers) : [];
    const qualityProgress = Math.round(Math.min(answerValues.length, 25) / 25 * 100);
    const progress = Math.round((plannerProgress + Math.min(resourceCount / 3, 1) * 100 + Math.min(guideCount / 3, 1) * 100 + qualityProgress) / 4);
    const title = [plannerValues.title, resources?.title, quality?.title].find(value => typeof value === 'string' && value.trim()) || 'مشروع بحثي جديد';
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      title,
      progress,
      planner,
      resources,
      guides: Array.isArray(guides) ? guides : [],
      quality
    };
  }

  function refreshLocalSummary() {
    localSnapshot = buildLocalSnapshot();
    document.getElementById('local-project-title').textContent = localSnapshot.title;
    document.getElementById('local-progress').textContent = `${localSnapshot.progress}%`;
    const resourceCount = Array.isArray(localSnapshot.resources?.slugs) ? localSnapshot.resources.slugs.length : 0;
    const guideCount = Array.isArray(localSnapshot.guides) ? localSnapshot.guides.length : 0;
    document.getElementById('local-project-detail').textContent = `نسخة محلية: ${resourceCount} مصادر، ${guideCount} أدلة، وتقدم إجمالي ${localSnapshot.progress}%.`;
    const titleInput = document.getElementById('new-project-title');
    if (!titleInput.value && localSnapshot.title !== 'مشروع بحثي جديد') titleInput.value = localSnapshot.title;
  }

  function showStatus(message, isError = false) {
    window.clearTimeout(statusTimer);
    status.textContent = message;
    status.classList.toggle('error', isError);
    status.classList.remove('visible');
    void status.offsetWidth;
    status.classList.add('visible');
    statusTimer = window.setTimeout(() => status.classList.remove('visible'), isError ? 10000 : 6500);
  }

  function setBusy(button, busy, label = '') {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label || 'جارٍ الحفظ...';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function activeProject() {
    const active = readJSON(KEYS.active, {});
    return active && typeof active === 'object' ? active : {};
  }

  function projectWorkspaceSummary(project) {
    const workspace = project.workspace_data || {};
    const sources = Array.isArray(workspace.resources?.slugs) ? workspace.resources.slugs.length : 0;
    const guides = Array.isArray(workspace.guides) ? workspace.guides.length : 0;
    const answers = workspace.quality?.answers && typeof workspace.quality.answers === 'object' ? Object.keys(workspace.quality.answers).length : 0;
    return { sources, guides, answers, progress: Math.min(100, Math.max(0, Number(workspace.progress) || 0)) };
  }

  function renderProjects() {
    const active = activeProject();
    document.getElementById('projects-count').textContent = projects.length === 1 ? 'مشروع واحد' : projects.length === 2 ? 'مشروعان' : `${projects.length} مشاريع`;
    if (!projects.length) {
      projectList.innerHTML = '<div class="projects-empty"><strong>لا توجد مشاريع سحابية بعد</strong><p>أنشئ أول مساحة من النموذج، ويمكنك تضمين بيانات هذا الجهاز.</p></div>';
      return;
    }
    projectList.innerHTML = projects.map(project => {
      const summary = projectWorkspaceSummary(project);
      const activeClass = active.id === project.id ? ' active' : '';
      return `<article class="project-card${activeClass}" data-project-id="${safe(project.id)}">
        <div><header><span class="project-stage">${safe(stageLabels[project.stage] || project.stage)}</span><span class="project-version">الإصدار ${safe(project.version)}</span></header><h3>${safe(project.title)}</h3><p>${safe(project.summary || project.study_area || 'لا يوجد وصف مختصر لهذا المشروع.')}</p><dl><div><dt>آخر حفظ</dt><dd>${safe(dateLabel(project.updated_at))}</dd></div><div><dt>التقدم</dt><dd>${summary.progress}%</dd></div><div><dt>المصادر</dt><dd>${summary.sources}</dd></div><div><dt>التدقيق</dt><dd>${summary.answers}/25</dd></div></dl></div>
        <div class="project-actions"><button class="primary" type="button" data-action="save">حفظ نسخة الجهاز</button><button type="button" data-action="open">فتح على هذا الجهاز</button><button type="button" data-action="backup">تنزيل نسخة JSON</button></div>
      </article>`;
    }).join('');
  }

  async function loadProjects() {
    projectList.innerHTML = '<div class="projects-loading"><span></span><p>جارٍ تحميل المشاريع...</p></div>';
    try {
      projects = await backend.listResearchProjects();
      migrationGate.hidden = true;
      renderProjects();
      showStatus(projects.length ? `تم تحميل ${projects.length} من المشاريع الخاصة بحسابك.` : 'حسابك جاهز. أنشئ أول مشروع بحثي سحابي.');
    } catch (error) {
      if (migrationMissing(error)) {
        account.hidden = true;
        migrationGate.hidden = false;
        showStatus('لم يُفعّل جدول المشاريع في قاعدة البيانات بعد.', true);
        return;
      }
      projectList.innerHTML = '<div class="projects-empty"><strong>تعذر تحميل المشاريع</strong><p>تحقق من الاتصال ثم حاول مرة أخرى.</p></div>';
      showStatus('تعذر الاتصال بمساحة المشاريع. حاول مجددًا.', true);
    }
  }

  async function refreshAccount() {
    if (!backend || backend.status !== 'ready') {
      accountGate.hidden = false;
      showStatus('يلزم تشغيل المنصة عبر رابط ويب آمن لاستخدام الحساب.', true);
      return;
    }
    try {
      currentUser = await backend.getUser();
      if (!currentUser) {
        accountGate.hidden = false;
        account.hidden = true;
        migrationGate.hidden = true;
        showStatus('سجّل الدخول للوصول إلى مشاريعك الخاصة.');
        return;
      }
      accountGate.hidden = true;
      account.hidden = false;
      document.getElementById('projects-account-email').textContent = currentUser.email || '';
      await loadProjects();
    } catch (_) {
      showStatus('تعذر التحقق من جلسة الحساب. أعد تحميل الصفحة.', true);
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const email = document.getElementById('projects-email');
    const button = loginForm.querySelector('button');
    if (!email.checkValidity()) {
      email.reportValidity();
      return;
    }
    setBusy(button, true, 'جارٍ الإرسال...');
    try {
      await backend.sendMagicLink(email.value);
      showStatus('تم إرسال رابط الدخول. افتح بريدك ثم ارجع إلى هذه الصفحة.');
      email.value = '';
    } catch (_) {
      showStatus('تعذر إرسال رابط الدخول. تحقق من البريد والاتصال ثم حاول مرة أخرى.', true);
    } finally {
      setBusy(button, false);
    }
  });

  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    const title = document.getElementById('new-project-title');
    if (!title.checkValidity()) {
      title.reportValidity();
      return;
    }
    const button = createForm.querySelector('.create-project-button');
    setBusy(button, true, 'جارٍ إنشاء المشروع...');
    try {
      refreshLocalSummary();
      const includeLocal = document.getElementById('include-local-workspace').checked;
      const project = await backend.createResearchProject({
        title: title.value,
        stage: document.getElementById('new-project-stage').value,
        studyArea: document.getElementById('new-project-area').value,
        summary: document.getElementById('new-project-summary').value,
        workspaceData: includeLocal ? localSnapshot : { schemaVersion: 1, savedAt: new Date().toISOString(), title: title.value.trim(), progress: 0 }
      });
      localStorage.setItem(KEYS.active, JSON.stringify({ id: project.id, title: project.title, version: project.version, updatedAt: project.updated_at }));
      projects.unshift(project);
      createForm.reset();
      document.getElementById('include-local-workspace').checked = true;
      renderProjects();
      showStatus('تم إنشاء المشروع وحفظ نسخته الأولى بأمان.');
    } catch (error) {
      showStatus(error?.message === 'RESEARCH_PROJECT_DATA_TOO_LARGE' ? 'حجم بيانات المشروع أكبر من الحد المسموح.' : 'تعذر إنشاء المشروع. حاول مجددًا.', true);
    } finally {
      setBusy(button, false);
    }
  });

  projectList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    const card = event.target.closest('[data-project-id]');
    if (!button || !card) return;
    const project = projects.find(item => item.id === card.dataset.projectId);
    if (!project) return;
    const action = button.dataset.action;

    if (action === 'backup') {
      const blob = new Blob(['\ufeff', JSON.stringify({ exportedAt: new Date().toISOString(), project }, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `geo-rafidain-project-${project.id.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showStatus('تم تجهيز نسخة JSON احتياطية للمشروع.');
      return;
    }

    if (action === 'open') {
      const approved = window.confirm(`سيتم استبدال بيانات أدوات الباحث على هذا الجهاز بنسخة «${project.title}». هل تريد المتابعة؟`);
      if (!approved) return;
      const workspace = project.workspace_data || {};
      [KEYS.planner, KEYS.resources, KEYS.guides, KEYS.quality].forEach(key => localStorage.removeItem(key));
      if (workspace.planner) localStorage.setItem(KEYS.planner, JSON.stringify(workspace.planner));
      if (workspace.resources) localStorage.setItem(KEYS.resources, JSON.stringify(workspace.resources));
      if (Array.isArray(workspace.guides)) localStorage.setItem(KEYS.guides, JSON.stringify(workspace.guides));
      if (workspace.quality) localStorage.setItem(KEYS.quality, JSON.stringify(workspace.quality));
      localStorage.setItem(KEYS.active, JSON.stringify({ id: project.id, title: project.title, version: project.version, updatedAt: project.updated_at }));
      window.location.href = 'research-hub.html';
      return;
    }

    if (action === 'save') {
      if (savingProjects.has(project.id) || button.dataset.saving === 'true') return;
      savingProjects.add(project.id);
      button.dataset.saving = 'true';
      setBusy(button, true, 'جارٍ الحفظ...');
      try {
        refreshLocalSummary();
        const updated = await backend.updateResearchProject(project.id, {
          title: project.title,
          summary: project.summary || '',
          studyArea: project.study_area || '',
          stage: project.stage,
          workspaceData: localSnapshot
        }, project.version);
        projects = projects.map(item => item.id === updated.id ? updated : item);
        renderProjects();
        try {
          localStorage.setItem(KEYS.active, JSON.stringify({ id: updated.id, title: updated.title, version: updated.version, updatedAt: updated.updated_at }));
        } catch (_) {}
        showStatus(`تم الحفظ بنجاح في «${updated.title}» — الإصدار ${updated.version}.`);
      } catch (error) {
        if (error?.message === 'RESEARCH_PROJECT_CONFLICT') {
          showStatus('توجد نسخة أحدث من جهاز آخر. حدّث القائمة قبل الحفظ لتجنب فقدانها.', true);
          await loadProjects();
        } else {
          console.error('Research project save failed:', error);
          showStatus('تعذر حفظ النسخة السحابية. حاول مرة أخرى.', true);
        }
      } finally {
        savingProjects.delete(project.id);
        delete button.dataset.saving;
        if (button.isConnected) setBusy(button, false);
      }
    }
  });

  document.getElementById('projects-refresh').addEventListener('click', async () => { refreshLocalSummary(); await loadProjects(); });
  document.getElementById('projects-sign-out').addEventListener('click', async () => {
    try { await backend.signOut(); } catch (_) {}
    currentUser = null;
    projects = [];
    await refreshAccount();
  });

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
  refreshLocalSummary();
  refreshAccount();
  backend?.onAuthStateChange(() => refreshAccount());
  window.addEventListener('pageshow', refreshLocalSummary);
  window.addEventListener('storage', refreshLocalSummary);
})();
