(() => {
  const backend = window.geoBackend;
  const gate = document.querySelector('#dashboard-gate');
  const gateTitle = document.querySelector('#gate-title');
  const gateMessage = document.querySelector('#gate-message');
  const gateLink = document.querySelector('#gate-link');
  const main = document.querySelector('.dashboard-main');
  const list = document.querySelector('#request-list');
  const empty = document.querySelector('#empty-state');
  const search = document.querySelector('#request-search');
  const filter = document.querySelector('#status-filter');
  const panelTools = document.querySelector('.panel-tools');
  const metricGrid = document.querySelector('.metric-grid');
  const dialog = document.querySelector('#request-dialog');
  const dialogStatus = document.querySelector('#dialog-status');
  const dialogProgress = document.querySelector('#dialog-progress');
  const dialogPrice = document.querySelector('#dialog-price');
  const dialogDelivery = document.querySelector('#dialog-delivery');
  const dialogQuoteScope = document.querySelector('#dialog-quote-scope');
  const quoteScopeCount = document.querySelector('#quote-scope-count');
  const dialogAdminMessage = document.querySelector('#dialog-admin-message');
  const adminMessageCount = document.querySelector('#admin-message-count');
  const quoteAdminState = document.querySelector('#quote-admin-state');
  const sendQuoteButton = document.querySelector('#send-quote');
  const workflowMigrationNote = document.querySelector('#workflow-migration-note');
  const workflowExtraFields = [...document.querySelectorAll('.workflow-extra-field')];
  const quoteExtraFields = [...document.querySelectorAll('.quote-extra-field')];
  const adminControls = document.querySelector('#admin-dialog-controls');
  const exportButton = document.querySelector('#export-button');
  const exportCsvButton = document.querySelector('#export-csv-button');
  const refreshButton = document.querySelector('#refresh-button');
  const lastRefresh = document.querySelector('#last-refresh');
  const dashboardNotice = document.querySelector('#dashboard-notice');
  const signOutButton = document.querySelector('#dashboard-sign-out');
  const notificationsButton = document.querySelector('#notifications-button');
  const notificationsCount = document.querySelector('#notifications-count');
  const notificationsPanel = document.querySelector('#notifications-panel');
  const notificationsList = document.querySelector('#notifications-list');
  const markNotificationsReadButton = document.querySelector('#mark-notifications-read');
  const deliverableFile = document.querySelector('#deliverable-file');
  const deliverableVersion = document.querySelector('#deliverable-version');
  const deliverableNote = document.querySelector('#deliverable-note');
  const deliverableNoteCount = document.querySelector('#deliverable-note-count');
  const uploadDeliverableButton = document.querySelector('#upload-deliverable');
  let requests = [];
  let notifications = [];
  let selectedId = null;
  let profile = null;
  let noticeTimer = null;
  let notificationRefreshTimer = null;
  let communicationAvailable = true;

  if (metricGrid && !document.querySelector('#visible-count')) {
    metricGrid.insertAdjacentHTML('afterend', `
    <section class="ops-grid" aria-label="مؤشرات تشغيلية للطلبات">
      <article><small>الطلبات المعروضة</small><strong id="visible-count">0</strong><span id="filter-summary">كل الطلبات</span></article>
      <article><small>متوسط الإنجاز</small><strong id="average-progress">0%</strong><span>حسب النتائج الحالية</span></article>
      <article><small>تسليم خلال 7 أيام</small><strong id="due-soon-count">0</strong><span>طلبات تحتاج متابعة قريبة</span></article>
      <article><small>الملفات المرفقة</small><strong id="files-count">0</strong><span>ضمن الطلبات المعروضة</span></article>
    </section>`);
  }

  const opsGrid = document.querySelector('.ops-grid');
  if (opsGrid && !document.querySelector('#client-journey')) {
    opsGrid.insertAdjacentHTML('afterend', `
    <section class="client-journey" id="client-journey" aria-label="مسار متابعة الطلب" hidden>
      <div class="journey-copy">
        <span id="journey-kicker">مسار المتابعة</span>
        <h2 id="journey-title">متابعة حالة الطلب</h2>
        <p id="journey-summary">اختر طلباً أو راجع آخر طلب نشط لمعرفة المرحلة الحالية والخطوة القادمة.</p>
      </div>
      <div class="journey-track" id="journey-track"></div>
      <div class="journey-next" id="journey-next"></div>
    </section>`);
  }

  if (panelTools && !document.querySelector('#service-filter')) {
    panelTools.insertAdjacentHTML('beforeend', `
      <select id="service-filter" aria-label="تصفية حسب نوع الخدمة"><option value="all">جميع الخدمات</option></select>
      <select id="sort-filter" aria-label="ترتيب الطلبات">
        <option value="newest">الأحدث أولاً</option>
        <option value="oldest">الأقدم أولاً</option>
        <option value="progress-desc">الأعلى إنجازًا</option>
        <option value="progress-asc">الأقل إنجازًا</option>
        <option value="delivery-soon">الأقرب للتسليم</option>
      </select>
      <button class="tool-button" id="reset-filters" type="button">إعادة ضبط</button>`);
  }

  const serviceFilter = document.querySelector('#service-filter');
  const sortFilter = document.querySelector('#sort-filter');
  const resetFiltersButton = document.querySelector('#reset-filters');
  const visibleCount = document.querySelector('#visible-count');
  const averageProgress = document.querySelector('#average-progress');
  const dueSoonCount = document.querySelector('#due-soon-count');
  const filesCount = document.querySelector('#files-count');
  const filterSummaryText = document.querySelector('#filter-summary');
  const journeyPanel = document.querySelector('#client-journey');
  const journeyKicker = document.querySelector('#journey-kicker');
  const journeyTitle = document.querySelector('#journey-title');
  const journeySummary = document.querySelector('#journey-summary');
  const journeyTrack = document.querySelector('#journey-track');
  const journeyNext = document.querySelector('#journey-next');

  const statusLabels = {
    new: 'جديد',
    reviewing: 'قيد المراجعة',
    in_progress: 'قيد التنفيذ',
    completed: 'مكتمل'
  };

  const statusClasses = {
    new: 'status-new',
    reviewing: 'status-review',
    in_progress: 'status-active',
    completed: 'status-done'
  };

  const quoteStatusLabels = {
    not_sent: 'لم يُرسل',
    pending: 'بانتظار العميل',
    accepted: 'مقبول',
    rejected: 'مرفوض',
    withdrawn: 'مسحوب'
  };

  const quoteStatusClasses = {
    not_sent: 'quote-none',
    pending: 'quote-pending',
    accepted: 'quote-accepted',
    rejected: 'quote-rejected',
    withdrawn: 'quote-withdrawn'
  };

  const journeySteps = [
    { key: 'new', label: 'تم الاستلام', text: 'وصل الطلب إلى لوحة المتابعة وحُفظ داخل حسابك.' },
    { key: 'reviewing', label: 'قيد المراجعة', text: 'تجري قراءة الوصف والبيانات لتحديد المنهج المناسب.' },
    { key: 'in_progress', label: 'قيد التنفيذ', text: 'بدأ العمل على الخرائط أو التحليل أو تجهيز البيانات.' },
    { key: 'completed', label: 'مكتمل', text: 'اكتمل تنفيذ الطلب ويمكن مراجعة المخرجات النهائية.' }
  ];

  const journeyCopy = {
    new: {
      title: 'تم استلام الطلب وهو بانتظار المراجعة',
      summary: 'الطلب محفوظ بأمان. الخطوة التالية هي مراجعة الوصف والملفات لتحديد المنهج والمدة المناسبة.',
      next: 'انتظر تحديث المدير برسالة متابعة أو سعر مقترح أو موعد تسليم عند اكتمال المراجعة الأولية.'
    },
    reviewing: {
      title: 'الطلب قيد المراجعة العلمية والفنية',
      summary: 'تتم الآن قراءة تفاصيل منطقة الدراسة والبيانات المطلوبة لاختيار الطريقة الأنسب للتنفيذ.',
      next: 'قد تظهر رسالة متابعة من المدير إذا احتاج الطلب إلى توضيح إضافي أو بيانات مساعدة.'
    },
    in_progress: {
      title: 'بدأ تنفيذ الطلب',
      summary: 'انتقل الطلب إلى مرحلة العمل الفعلي على التحليل أو الخرائط أو تجهيز البيانات.',
      next: 'تابع نسبة الإنجاز وموعد التسليم المتوقع من هذه اللوحة حتى اكتمال المشروع.'
    },
    completed: {
      title: 'اكتمل تنفيذ الطلب',
      summary: 'تم إنهاء الطلب. راجع رسالة المتابعة والملفات أو التعليمات النهائية داخل التفاصيل.',
      next: 'إذا احتجت تعديلاً أو خدمة مرتبطة، يمكنك إنشاء طلب جديد مع الإشارة إلى رقم هذا الطلب.'
    }
  };

  const safe = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
    : '—';

  const dateTimeLabel = value => value
    ? new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
    : '—';

  const communicationFeatureMissing = error => /request_messages|request_deliverables|user_notifications|send_request_message|mark_notifications_read|admin_register_request_deliverable|PGRST202|42P01/i
    .test(`${error?.code || ''} ${error?.message || ''}`);

  const progressValue = value => Math.min(100, Math.max(0, Number(value) || 0));

  const deliveryDateValue = item => item.expected_delivery_date || item.deadline || '';

  const deliveryTimestamp = item => {
    const value = deliveryDateValue(item);
    if (!value) return Number.POSITIVE_INFINITY;
    const timestamp = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
  };

  const deliverySummary = item => {
    if (item.expected_delivery_date) return `التسليم المتوقع: ${dateLabel(item.expected_delivery_date)}`;
    if (item.deadline) return `الموعد المطلوب: ${dateLabel(item.deadline)}`;
    return 'لا يوجد موعد محدد';
  };

  const isDueSoon = item => {
    const timestamp = deliveryTimestamp(item);
    if (!Number.isFinite(timestamp) || item.status === 'completed') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAhead = today.getTime() + (7 * 24 * 60 * 60 * 1000);
    return timestamp >= today.getTime() && timestamp <= weekAhead;
  };

  const createdTimestamp = item => {
    const timestamp = new Date(item.created_at || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const priceLabel = value => value === null || value === undefined || value === ''
    ? 'لم يحدد بعد'
    : `${new Intl.NumberFormat('ar-IQ').format(Number(value))} د.ع.`;

  const quoteStatus = item => item.quote_status || 'not_sent';

  const quoteBadge = item => {
    const status = quoteStatus(item);
    return `<span class="quote-pill ${quoteStatusClasses[status] || 'quote-none'}">${quoteStatusLabels[status] || safe(status)}</span>`;
  };

  const quoteNextAction = item => {
    if (quoteStatus(item) === 'pending') {
      return profile?.role === 'admin'
        ? 'أُرسل عرض السعر وينتظر قبول العميل أو رفضه.'
        : 'راجع عرض السعر داخل تفاصيل الطلب ثم اختر القبول أو الرفض.';
    }
    if (quoteStatus(item) === 'accepted') return 'تم قبول عرض السعر ويمكن متابعة المشروع وفق النطاق والموعد المتفق عليهما.';
    if (quoteStatus(item) === 'rejected') return 'تم رفض العرض؛ يمكن للمدير مراجعته وإرسال عرض جديد عند الحاجة.';
    return null;
  };

  const journeyStageIndex = status => {
    const index = journeySteps.findIndex(step => step.key === status);
    return index >= 0 ? index : 0;
  };

  const journeyPercent = item => {
    const index = journeyStageIndex(item.status);
    return Math.round((index / (journeySteps.length - 1)) * 82);
  };

  const journeyStepsMarkup = item => {
    const activeIndex = journeyStageIndex(item.status);
    return `
      <ol class="journey-steps" style="--journey-progress:${journeyPercent(item)}%">
        ${journeySteps.map((step, index) => {
          const state = index < activeIndex ? 'done' : (index === activeIndex ? 'active' : 'pending');
          return `<li class="${state}"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${safe(step.label)}</strong><small>${safe(step.text)}</small></div></li>`;
        }).join('')}
      </ol>`;
  };

  const updateJourneyPanel = visible => {
    if (!journeyPanel) return;
    if (!visible.length) {
      journeyPanel.hidden = true;
      return;
    }

    const item = visible.find(request => request.status !== 'completed') || visible[0];
    const copy = journeyCopy[item.status] || journeyCopy.new;
    journeyPanel.hidden = false;
    journeyKicker.textContent = profile?.role === 'admin' ? 'المسار الزمني للطلب الأبرز' : 'مسار متابعة طلبك';
    journeyTitle.textContent = copy.title;
    journeySummary.textContent = copy.summary;
    journeyTrack.innerHTML = journeyStepsMarkup(item);
    journeyNext.innerHTML = `
      <article><small>رقم الطلب</small><strong class="request-id">${safe(item.request_number)}</strong></article>
      <article><small>الخدمة</small><strong>${safe(item.service)}</strong></article>
      <article><small>الحالة الحالية</small><strong><span class="status-pill ${statusClasses[item.status] || 'status-new'}">${statusLabels[item.status] || safe(item.status)}</span></strong></article>
      <article><small>التقدم</small><strong>${progressValue(item.progress_percent)}%</strong></article>
      <article class="wide"><small>الخطوة القادمة</small><p>${safe(quoteNextAction(item) || copy.next)}</p></article>
      <button class="journey-open" type="button" data-id="${safe(item.id)}">فتح تفاصيل الطلب</button>`;
  };

  const journeyDetailMarkup = item => {
    const copy = journeyCopy[item.status] || journeyCopy.new;
    return `
      <div class="detail-field full journey-detail">
        <small>مسار المتابعة</small>
        ${journeyStepsMarkup(item)}
        <p>${safe(quoteNextAction(item) || copy.next)}</p>
      </div>`;
  };

  const quoteCardMarkup = item => {
    if (item.quote_available === false) return '';
    const status = quoteStatus(item);
    const hasQuote = status !== 'not_sent' && item.quoted_price_iqd !== null && item.quoted_price_iqd !== undefined;

    if (!hasQuote) {
      return `
        <section class="detail-field full quote-card quote-card-empty">
          <div class="quote-card-heading"><div><small>عرض السعر</small><h3>لم يصدر عرض سعر بعد</h3></div>${quoteBadge(item)}</div>
          <p>${profile?.role === 'admin' ? 'أكمل السعر والموعد ونطاق العمل من قسم الإدارة ثم أرسل العرض.' : 'سيظهر هنا السعر ونطاق العمل والموعد بعد انتهاء المراجعة الأولية.'}</p>
        </section>`;
    }

    const clientActions = profile?.role !== 'admin' && status === 'pending'
      ? `<div class="quote-client-response">
          <label for="quote-client-note">ملاحظة اختيارية قبل القرار</label>
          <textarea id="quote-client-note" rows="3" maxlength="1000" placeholder="اكتب استفسارك أو سبب الرفض عند الحاجة..."></textarea>
          <small><span id="quote-client-note-count">0</span>/1000</small>
          <div><button class="quote-decision reject" type="button" data-id="${safe(item.id)}" data-decision="rejected">رفض العرض</button><button class="quote-decision accept" type="button" data-id="${safe(item.id)}" data-decision="accepted">قبول العرض</button></div>
          <p>القرار يُحفظ في حسابك مع التاريخ. راجع النطاق والسعر والموعد قبل التأكيد.</p>
        </div>`
      : '';

    return `
      <section class="detail-field full quote-card ${quoteStatusClasses[status] || ''}">
        <div class="quote-card-heading"><div><small>عرض السعر الرسمي</small><h3>${safe(item.service)}</h3></div>${quoteBadge(item)}</div>
        <div class="quote-summary-grid">
          <article><small>السعر</small><strong>${priceLabel(item.quoted_price_iqd)}</strong></article>
          <article><small>التسليم المتوقع</small><strong>${item.expected_delivery_date ? dateLabel(item.expected_delivery_date) : 'لم يحدد'}</strong></article>
          <article><small>تاريخ الإرسال</small><strong>${item.quote_sent_at ? dateLabel(item.quote_sent_at) : '—'}</strong></article>
        </div>
        <div class="quote-scope"><small>نطاق العمل المشمول</small><p>${safe(item.quote_scope || 'لم يُكتب نطاق العمل.')}</p></div>
        ${item.quote_client_note ? `<div class="quote-client-note"><small>ملاحظة العميل</small><p>${safe(item.quote_client_note)}</p></div>` : ''}
        ${item.quote_decided_at ? `<p class="quote-decision-date">سُجل القرار في ${dateLabel(item.quote_decided_at)}.</p>` : ''}
        ${clientActions}
      </section>`;
  };

  const requestWorkspaceMarkup = () => `
    <section class="detail-field full delivery-workspace" aria-labelledby="delivery-title">
      <div class="workspace-heading"><div><small>ملفات المشروع</small><h3 id="delivery-title">التسليمات الآمنة</h3></div><span>روابط مؤقتة</span></div>
      <div class="deliverables-list" id="deliverables-list"><p class="workspace-loading">جارٍ تحميل ملفات التسليم...</p></div>
    </section>
    <section class="detail-field full conversation-workspace" aria-labelledby="conversation-title">
      <div class="workspace-heading"><div><small>تواصل مرتبط بالطلب</small><h3 id="conversation-title">المحادثة</h3></div><span>محفوظة داخل الحساب</span></div>
      <div class="messages-list" id="messages-list" aria-live="polite"><p class="workspace-loading">جارٍ تحميل الرسائل...</p></div>
      <div class="message-composer">
        <label for="message-body">رسالة جديدة</label>
        <textarea id="message-body" rows="3" minlength="2" maxlength="3000" placeholder="اكتب استفسارك أو تحديثك المتعلق بهذا الطلب..."></textarea>
        <div><small><span id="message-count">0</span>/3000</small><button id="send-message" type="button">إرسال الرسالة</button></div>
      </div>
    </section>`;

  const renderMessages = messages => {
    const container = document.querySelector('#messages-list');
    if (!container) return;
    container.innerHTML = messages.length
      ? messages.map(message => {
          const own = message.sender_id === profile?.id;
          const roleLabel = own ? 'أنت' : (message.sender_role === 'admin' ? 'فريق جيو الرافدين' : 'العميل');
          return `<article class="message-bubble ${message.sender_role === 'admin' ? 'admin' : 'client'} ${own ? 'own' : ''}">
            <div><strong>${roleLabel}</strong><time datetime="${safe(message.created_at)}">${dateTimeLabel(message.created_at)}</time></div>
            <p>${safe(message.body)}</p>
          </article>`;
        }).join('')
      : '<p class="workspace-empty">لا توجد رسائل بعد. استخدم المحادثة للأسئلة والتحديثات المرتبطة بهذا الطلب فقط.</p>';
    container.scrollTop = container.scrollHeight;
  };

  const renderDeliverables = deliverables => {
    const container = document.querySelector('#deliverables-list');
    if (!container) return;
    container.innerHTML = deliverables.length
      ? deliverables.map(file => `<article class="deliverable-card">
          <div><span>✓</span><div><small>${safe(file.version_label)}</small><strong>${safe(file.original_name)}</strong><p>${safe(file.delivery_note || 'ملف تسليم مرتبط بالمشروع.')}</p></div></div>
          <footer><time datetime="${safe(file.created_at)}">${dateTimeLabel(file.created_at)}</time><span>${fileSize(file.size_bytes)}</span><button class="deliverable-open" type="button" data-path="${safe(file.object_path)}">فتح الملف</button></footer>
        </article>`).join('')
      : '<p class="workspace-empty">لا توجد ملفات تسليم بعد. ستظهر هنا الإصدارات النهائية أو المسودات التي يشاركها فريق جيو الرافدين.</p>';
  };

  const showWorkspaceUnavailable = () => {
    communicationAvailable = false;
    const message = profile?.role === 'admin'
      ? 'يلزم تطبيق تحديث المحادثات والتسليمات في قاعدة البيانات لتفعيل هذا القسم.'
      : 'سيُفعّل التواصل والتسليم الآمن لهذا الطلب قريباً.';
    ['#messages-list', '#deliverables-list'].forEach(selector => {
      const container = document.querySelector(selector);
      if (container) container.innerHTML = `<p class="workspace-empty">${message}</p>`;
    });
    const composer = document.querySelector('.message-composer');
    if (composer) composer.hidden = true;
  };

  const loadRequestWorkspace = async requestId => {
    try {
      const [messages, deliverables] = await Promise.all([
        backend.listRequestMessages(requestId),
        backend.listRequestDeliverables(requestId)
      ]);
      communicationAvailable = true;
      renderMessages(messages);
      renderDeliverables(deliverables);
      const composer = document.querySelector('.message-composer');
      if (composer) composer.hidden = false;
    } catch (error) {
      if (communicationFeatureMissing(error)) showWorkspaceUnavailable();
      else {
        const messageContainer = document.querySelector('#messages-list');
        const deliveryContainer = document.querySelector('#deliverables-list');
        if (messageContainer) messageContainer.innerHTML = '<p class="workspace-error">تعذر تحميل المحادثة. تحقق من الاتصال ثم أعد المحاولة.</p>';
        if (deliveryContainer) deliveryContainer.innerHTML = '<p class="workspace-error">تعذر تحميل ملفات التسليم.</p>';
      }
    }
  };

  const updateQuoteAdminControls = item => {
    if (profile?.role !== 'admin') return;
    const available = item.quote_available !== false;
    const status = quoteStatus(item);
    quoteExtraFields.forEach(field => { field.hidden = !available; });
    sendQuoteButton.hidden = !available;
    sendQuoteButton.disabled = status === 'accepted';
    sendQuoteButton.textContent = status === 'pending' ? 'تحديث وإعادة إرسال العرض'
      : status === 'rejected' ? 'تعديل وإعادة إرسال العرض'
        : status === 'accepted' ? 'تم قبول العرض' : 'إرسال عرض السعر';
    quoteAdminState.hidden = !available;
    if (available) {
      quoteAdminState.innerHTML = `<span>حالة العرض الحالية</span>${quoteBadge(item)}${item.quote_decided_at ? `<small>آخر قرار: ${dateLabel(item.quote_decided_at)}</small>` : ''}`;
    }
  };

  const fileSize = bytes => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const backendMessage = () => ({
    'not-configured': 'لم تُربط قاعدة البيانات بعد. أكمل الخطوات الموجودة في SETUP.md.',
    'requires-server': 'المصادقة لا تعمل بأمان عبر file://. شغّل Start-GeoRafidain.cmd ثم افتح اللوحة.',
    'library-missing': 'تعذر تحميل مكتبة الاتصال. تحقق من الإنترنت ثم حدّث الصفحة.'
  }[backend?.status] || 'تعذر الوصول إلى قاعدة البيانات.');

  const showGate = (title, message, href = 'index.html', linkText = 'العودة إلى المنصة') => {
    gate.hidden = false;
    main.hidden = true;
    gateTitle.textContent = title;
    gateMessage.textContent = message;
    gateLink.href = href;
    gateLink.textContent = linkText;
  };

  const showPanelError = message => {
    let element = document.querySelector('#dashboard-error');
    if (!element) {
      element = document.createElement('p');
      element.id = 'dashboard-error';
      element.className = 'dashboard-error';
      document.querySelector('.request-panel').append(element);
    }
    element.textContent = message;
  };

  const clearPanelError = () => document.querySelector('#dashboard-error')?.remove();

  const showNotice = (message, type = 'success') => {
    clearTimeout(noticeTimer);
    dashboardNotice.textContent = message;
    dashboardNotice.className = `dashboard-notice ${type}`;
    dashboardNotice.hidden = false;
    noticeTimer = setTimeout(() => { dashboardNotice.hidden = true; }, 6000);
  };

  const notificationTypeLabels = {
    message: 'رسالة',
    status: 'تحديث',
    quote: 'عرض سعر',
    delivery: 'تسليم'
  };

  const renderNotifications = () => {
    const unread = notifications.filter(item => !item.read_at).length;
    notificationsCount.textContent = unread;
    notificationsCount.hidden = unread === 0;
    notificationsButton.classList.toggle('has-unread', unread > 0);
    markNotificationsReadButton.disabled = unread === 0;
    notificationsList.innerHTML = notifications.length
      ? notifications.map(item => `<button class="notification-item ${item.read_at ? '' : 'unread'}" type="button" data-notification-id="${safe(item.id)}" data-request-id="${safe(item.request_id || '')}">
          <span>${safe(notificationTypeLabels[item.notification_type] || 'تنبيه')}</span>
          <div><strong>${safe(item.title)}</strong><p>${safe(item.body)}</p><time datetime="${safe(item.created_at)}">${dateTimeLabel(item.created_at)}</time></div>
        </button>`).join('')
      : '<p class="notifications-empty">لا توجد إشعارات حتى الآن.</p>';
  };

  const refreshNotifications = async (silent = false) => {
    try {
      notifications = await backend.listNotifications();
      communicationAvailable = true;
      notificationsButton.hidden = false;
      renderNotifications();
    } catch (error) {
      if (communicationFeatureMissing(error)) {
        communicationAvailable = false;
        notificationsButton.hidden = true;
        notificationsPanel.hidden = true;
      } else if (!silent) {
        showNotice('تعذر تحديث الإشعارات حالياً.', 'error');
      }
    }
  };

  const updateMetrics = data => {
    document.querySelector('#total-count').textContent = data.length;
    document.querySelector('#new-count').textContent = data.filter(item => item.status === 'new').length;
    document.querySelector('#active-count').textContent = data.filter(item => item.status === 'in_progress').length;
    document.querySelector('#done-count').textContent = data.filter(item => item.status === 'completed').length;
  };

  const updateServiceOptions = () => {
    if (!serviceFilter) return;
    const current = serviceFilter.value;
    const services = [...new Set(requests.map(item => item.service).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, 'ar'));
    serviceFilter.innerHTML = '<option value="all">جميع الخدمات</option>'
      + services.map(service => `<option value="${safe(service)}">${safe(service)}</option>`).join('');
    serviceFilter.value = services.includes(current) ? current : 'all';
  };

  const sortVisibleRequests = data => {
    const mode = sortFilter?.value || 'newest';
    return [...data].sort((first, second) => {
      if (mode === 'oldest') return createdTimestamp(first) - createdTimestamp(second);
      if (mode === 'progress-desc') return progressValue(second.progress_percent) - progressValue(first.progress_percent);
      if (mode === 'progress-asc') return progressValue(first.progress_percent) - progressValue(second.progress_percent);
      if (mode === 'delivery-soon') return deliveryTimestamp(first) - deliveryTimestamp(second);
      return createdTimestamp(second) - createdTimestamp(first);
    });
  };

  const filterSummary = () => {
    const parts = [];
    if (filter?.value && filter.value !== 'all') parts.push(statusLabels[filter.value] || filter.value);
    if (serviceFilter?.value && serviceFilter.value !== 'all') parts.push(serviceFilter.value);
    if (search?.value.trim()) parts.push('بحث نشط');
    return parts.join(' · ') || 'كل الطلبات';
  };

  const getVisibleRequests = () => {
    const term = search.value.trim().toLowerCase();
    const wantedStatus = filter.value;
    const wantedService = serviceFilter?.value || 'all';
    const visible = requests.filter(item => {
      const haystack = `${item.request_number} ${item.name} ${item.contact || ''} ${item.service} ${item.study_area || ''} ${item.admin_message || ''}`.toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      const matchesStatus = wantedStatus === 'all' || item.status === wantedStatus;
      const matchesService = wantedService === 'all' || item.service === wantedService;
      return matchesSearch && matchesStatus && matchesService;
    });
    return sortVisibleRequests(visible);
  };

  const updateOperationalInsights = visible => {
    if (!visibleCount) return;
    const totalProgress = visible.reduce((sum, item) => sum + progressValue(item.progress_percent), 0);
    const attachedFiles = visible.reduce((sum, item) => sum + (item.request_files?.length || 0), 0);
    visibleCount.textContent = visible.length;
    averageProgress.textContent = visible.length ? `${Math.round(totalProgress / visible.length)}%` : '0%';
    dueSoonCount.textContent = visible.filter(isDueSoon).length;
    filesCount.textContent = attachedFiles;
    filterSummaryText.textContent = filterSummary();
  };

  const render = () => {
    updateMetrics(requests);
    const visible = getVisibleRequests();
    updateOperationalInsights(visible);
    updateJourneyPanel(visible);

    list.innerHTML = visible.map(item => `
      <tr>
        <td><span class="request-id">${safe(item.request_number)}</span></td>
        <td class="client-cell"><strong>${safe(item.name)}</strong><span>${safe(item.service)}</span></td>
        <td class="area-cell">${safe(item.study_area || 'غير محددة')}</td>
        <td><div class="table-progress"><span style="width:${progressValue(item.progress_percent)}%"></span><small>${progressValue(item.progress_percent)}%</small></div></td>
        <td>${item.quote_available === false ? '<span class="quote-pill quote-none">غير مفعّل</span>' : quoteBadge(item)}</td>
        <td class="date-cell"><strong>${dateLabel(item.created_at)}</strong><span>${safe(deliverySummary(item))}</span></td>
        <td><span class="status-pill ${statusClasses[item.status] || 'status-new'}">${statusLabels[item.status] || safe(item.status)}</span></td>
        <td><button class="view-button" type="button" data-id="${safe(item.id)}">التفاصيل</button></td>
      </tr>`).join('');

    empty.classList.toggle('visible', visible.length === 0);
    document.querySelector('.request-table').style.display = visible.length ? 'table' : 'none';
  };

  const showRequest = id => {
    const item = requests.find(request => request.id === id);
    if (!item) return;
    selectedId = id;
    document.querySelector('#dialog-id').textContent = item.request_number;
    document.querySelector('#dialog-title').textContent = item.service;
    dialogStatus.value = item.status;
    adminControls.hidden = profile?.role !== 'admin';
    const workflowAvailable = item.workflow_available !== false;
    dialogProgress.value = progressValue(item.progress_percent);
    dialogPrice.value = item.quoted_price_iqd ?? '';
    dialogDelivery.value = item.expected_delivery_date || '';
    dialogQuoteScope.value = item.quote_scope || '';
    quoteScopeCount.textContent = dialogQuoteScope.value.length;
    dialogAdminMessage.value = item.admin_message || '';
    adminMessageCount.textContent = dialogAdminMessage.value.length;
    if (deliverableFile) deliverableFile.value = '';
    if (deliverableVersion) deliverableVersion.value = 'الإصدار النهائي 1';
    if (deliverableNote) deliverableNote.value = '';
    if (deliverableNoteCount) deliverableNoteCount.textContent = '0';
    workflowExtraFields.forEach(field => { field.hidden = !workflowAvailable; });
    workflowMigrationNote.hidden = workflowAvailable && item.quote_available !== false;
    updateQuoteAdminControls(item);

    const files = item.request_files?.length
      ? `<div class="file-list">${item.request_files.map(file => `
          <button class="file-open" type="button" data-path="${safe(file.object_path)}">
            <strong>${safe(file.original_name)}</strong><span>${fileSize(file.size_bytes)}</span>
          </button>`).join('')}</div>`
      : '<strong>لا توجد ملفات</strong>';

    document.querySelector('#dialog-content').innerHTML = `
      <div class="detail-field"><small>اسم العميل</small><strong>${safe(item.name)}</strong></div>
      <div class="detail-field"><small>وسيلة التواصل</small><strong>${safe(item.contact)}</strong></div>
      <div class="detail-field"><small>منطقة الدراسة</small><strong>${safe(item.study_area || 'غير محددة')}</strong></div>
      <div class="detail-field"><small>الموعد المطلوب</small><strong>${item.deadline ? dateLabel(item.deadline) : 'غير محدد'}</strong></div>
      ${journeyDetailMarkup(item)}
      ${quoteCardMarkup(item)}
      ${workflowAvailable ? `
      <div class="detail-field full progress-detail"><div><small>نسبة الإنجاز</small><strong>${progressValue(item.progress_percent)}%</strong></div><span><i style="width:${progressValue(item.progress_percent)}%"></i></span></div>
      <div class="detail-field full"><small>رسالة المتابعة</small><strong class="detail-description admin-message">${safe(item.admin_message || 'لا توجد رسالة متابعة بعد.')}</strong></div>` : ''}
      <div class="detail-field full"><small>وصف المشروع</small><strong class="detail-description">${safe(item.description)}</strong></div>
      <div class="detail-field full"><small>ملفات الطلب الأصلية</small>${files}</div>
      ${requestWorkspaceMarkup()}`;
    if (!dialog.open) dialog.showModal();
    loadRequestWorkspace(id);
  };

  const loadRequests = async (announce = false) => {
    refreshButton.disabled = true;
    const originalLabel = refreshButton.textContent;
    refreshButton.textContent = 'جارٍ التحديث...';
    try {
      requests = await backend.listRequests();
      updateServiceOptions();
      clearPanelError();
      render();
      await refreshNotifications(true);
      lastRefresh.textContent = `آخر تحديث: ${new Intl.DateTimeFormat('ar-IQ', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
      if (announce) showNotice('تم تحديث قائمة الطلبات.');
    } catch (error) {
      showPanelError('تعذر تحميل الطلبات. راجع سياسات قاعدة البيانات واتصال الإنترنت.');
      if (announce) showNotice('تعذر تحديث الطلبات. تحقق من الاتصال ثم حاول مجددًا.', 'error');
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = originalLabel;
    }
  };

  list.addEventListener('click', event => {
    const button = event.target.closest('.view-button');
    if (button) showRequest(button.dataset.id);
  });

  journeyPanel?.addEventListener('click', event => {
    const button = event.target.closest('.journey-open');
    if (button) showRequest(button.dataset.id);
  });

  document.querySelector('#dialog-content').addEventListener('click', async event => {
    const decisionButton = event.target.closest('.quote-decision');
    if (decisionButton) {
      const decision = decisionButton.dataset.decision;
      const decisionLabel = decision === 'accepted' ? 'قبول' : 'رفض';
      if (!window.confirm(`هل تؤكد ${decisionLabel} عرض السعر؟ سيُحفظ القرار في حسابك.`)) return;
      const buttons = [...document.querySelectorAll('.quote-decision')];
      buttons.forEach(button => { button.disabled = true; });
      try {
        const note = document.querySelector('#quote-client-note')?.value || '';
        const updated = await backend.respondToServiceQuote(decisionButton.dataset.id, decision, note);
        requests = requests.map(item => item.id === decisionButton.dataset.id ? { ...item, ...updated } : item);
        render();
        showRequest(decisionButton.dataset.id);
        showNotice(`تم ${decisionLabel} عرض السعر وحفظ القرار.`);
      } catch {
        showNotice('تعذر حفظ القرار. حدّث الطلب وتأكد أن العرض ما زال بانتظار ردك.', 'error');
        buttons.forEach(button => { button.disabled = false; });
      }
      return;
    }

    const messageButton = event.target.closest('#send-message');
    if (messageButton) {
      const bodyField = document.querySelector('#message-body');
      const body = bodyField?.value.trim() || '';
      if (body.length < 2) {
        bodyField?.focus();
        showNotice('اكتب رسالة من حرفين على الأقل.', 'error');
        return;
      }
      messageButton.disabled = true;
      messageButton.textContent = 'جارٍ الإرسال...';
      try {
        await backend.sendRequestMessage(selectedId, body);
        bodyField.value = '';
        const counter = document.querySelector('#message-count');
        if (counter) counter.textContent = '0';
        await loadRequestWorkspace(selectedId);
        showNotice('تم إرسال الرسالة وحفظها داخل الطلب.');
      } catch (error) {
        const message = /MESSAGE_RATE_LIMIT/i.test(`${error?.message || ''}`)
          ? 'تم بلوغ حد الرسائل المؤقت. انتظر قليلاً ثم حاول مجدداً.'
          : 'تعذر إرسال الرسالة. تحقق من الاتصال والجلسة ثم حاول مجدداً.';
        showNotice(message, 'error');
      } finally {
        messageButton.disabled = false;
        messageButton.textContent = 'إرسال الرسالة';
      }
      return;
    }

    const deliverableButton = event.target.closest('.deliverable-open');
    if (deliverableButton) {
      deliverableButton.disabled = true;
      try {
        const url = await backend.createDeliverableLink(deliverableButton.dataset.path);
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch {
        showNotice('تعذر فتح ملف التسليم أو انتهت صلاحية الجلسة.', 'error');
      } finally {
        deliverableButton.disabled = false;
      }
      return;
    }

    const button = event.target.closest('.file-open');
    if (!button) return;
    button.disabled = true;
    try {
      const url = await backend.createFileLink(button.dataset.path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      showPanelError('تعذر فتح الملف أو انتهت صلاحية الجلسة.');
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#dialog-content').addEventListener('input', event => {
    if (event.target.id === 'quote-client-note') {
      const counter = document.querySelector('#quote-client-note-count');
      if (counter) counter.textContent = event.target.value.length;
    }
    if (event.target.id === 'message-body') {
      const counter = document.querySelector('#message-count');
      if (counter) counter.textContent = event.target.value.length;
    }
  });

  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  serviceFilter?.addEventListener('change', render);
  sortFilter?.addEventListener('change', render);
  resetFiltersButton?.addEventListener('click', () => {
    search.value = '';
    filter.value = 'all';
    if (serviceFilter) serviceFilter.value = 'all';
    if (sortFilter) sortFilter.value = 'newest';
    render();
  });
  refreshButton.addEventListener('click', () => loadRequests(true));

  notificationsButton.addEventListener('click', () => {
    const willOpen = notificationsPanel.hidden;
    notificationsPanel.hidden = !willOpen;
    notificationsButton.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) refreshNotifications(true);
  });

  notificationsList.addEventListener('click', async event => {
    const item = event.target.closest('.notification-item');
    if (!item) return;
    const notificationId = item.dataset.notificationId;
    try {
      await backend.markNotificationsRead(notificationId);
      notifications = notifications.map(notification => notification.id === notificationId
        ? { ...notification, read_at: notification.read_at || new Date().toISOString() }
        : notification);
      renderNotifications();
    } catch {
      showNotice('تعذر تحديث حالة الإشعار.', 'error');
    }
    const requestId = item.dataset.requestId;
    if (requestId && requests.some(request => request.id === requestId)) {
      notificationsPanel.hidden = true;
      notificationsButton.setAttribute('aria-expanded', 'false');
      showRequest(requestId);
    }
  });

  markNotificationsReadButton.addEventListener('click', async () => {
    markNotificationsReadButton.disabled = true;
    try {
      await backend.markNotificationsRead(null);
      const readAt = new Date().toISOString();
      notifications = notifications.map(notification => ({ ...notification, read_at: notification.read_at || readAt }));
      renderNotifications();
    } catch {
      showNotice('تعذر تحديد الإشعارات كمقروءة.', 'error');
      markNotificationsReadButton.disabled = false;
    }
  });

  dialogStatus.addEventListener('change', () => {
    if (dialogStatus.value === 'completed') dialogProgress.value = '100';
  });

  dialogAdminMessage.addEventListener('input', () => {
    adminMessageCount.textContent = dialogAdminMessage.value.length;
  });

  dialogQuoteScope.addEventListener('input', () => {
    quoteScopeCount.textContent = dialogQuoteScope.value.length;
  });

  deliverableNote.addEventListener('input', () => {
    deliverableNoteCount.textContent = deliverableNote.value.length;
  });

  uploadDeliverableButton.addEventListener('click', async () => {
    if (profile?.role !== 'admin' || !selectedId) return;
    const selected = requests.find(item => item.id === selectedId);
    const file = deliverableFile.files?.[0];
    if (!file) {
      showNotice('اختر ملف التسليم أولاً.', 'error');
      deliverableFile.focus();
      return;
    }
    if (!deliverableVersion.checkValidity() || !deliverableNote.checkValidity()) {
      deliverableVersion.reportValidity();
      deliverableNote.reportValidity();
      return;
    }

    uploadDeliverableButton.disabled = true;
    const originalLabel = uploadDeliverableButton.textContent;
    uploadDeliverableButton.textContent = 'جارٍ رفع الملف بأمان...';
    try {
      await backend.uploadRequestDeliverable(selected, file, {
        versionLabel: deliverableVersion.value,
        deliveryNote: deliverableNote.value
      });
      deliverableFile.value = '';
      deliverableNote.value = '';
      deliverableNoteCount.textContent = '0';
      await loadRequestWorkspace(selectedId);
      showNotice('تم رفع ملف التسليم وإرسال إشعار إلى العميل.');
    } catch (error) {
      const details = `${error?.message || ''}`;
      const message = /FILE_TOO_LARGE/.test(details) ? 'حجم ملف التسليم يتجاوز 50MB.'
        : /FILE_TYPE_NOT_ALLOWED/.test(details) ? 'نوع ملف التسليم غير مسموح.'
          : /ADMIN_MFA_REQUIRED/.test(details) ? 'يلزم إكمال المصادقة الثنائية قبل رفع التسليم.'
            : 'تعذر رفع ملف التسليم. تحقق من الملف والاتصال ثم حاول مجدداً.';
      showNotice(message, 'error');
    } finally {
      uploadDeliverableButton.disabled = false;
      uploadDeliverableButton.textContent = originalLabel;
    }
  });

  document.querySelector('#save-status').addEventListener('click', async () => {
    if (profile?.role !== 'admin' || !selectedId) return;
    const button = document.querySelector('#save-status');
    const selected = requests.find(item => item.id === selectedId);
    const workflowAvailable = selected?.workflow_available !== false;
    if (workflowAvailable && (!dialogProgress.checkValidity() || !dialogAdminMessage.checkValidity())) {
      dialogProgress.reportValidity();
      dialogAdminMessage.reportValidity();
      return;
    }
    button.disabled = true;
    try {
      const updated = workflowAvailable
        ? await backend.updateRequestWorkflow(selectedId, {
            status: dialogStatus.value,
            progressPercent: dialogProgress.value,
            adminMessage: dialogAdminMessage.value
          })
        : await backend.updateRequestStatus(selectedId, dialogStatus.value);
      requests = requests.map(item => item.id === selectedId ? { ...item, ...updated } : item);
      dialog.close();
      clearPanelError();
      render();
      showNotice('تم حفظ تحديث الطلب وإتاحته للعميل.');
    } catch {
      showPanelError('تعذر حفظ التحديث. تحقق من القيم وصلاحية جلسة المدير ثم حاول مجدداً.');
    } finally {
      button.disabled = false;
    }
  });

  sendQuoteButton.addEventListener('click', async () => {
    if (profile?.role !== 'admin' || !selectedId) return;
    const selected = requests.find(item => item.id === selectedId);
    if (!selected || selected.quote_available === false) return;
    if (!dialogPrice.checkValidity() || !dialogDelivery.checkValidity() || !dialogQuoteScope.checkValidity() || !dialogAdminMessage.checkValidity()) {
      dialogPrice.reportValidity();
      dialogDelivery.reportValidity();
      dialogQuoteScope.reportValidity();
      dialogAdminMessage.reportValidity();
      return;
    }
    const deliveryDate = new Date(`${dialogDelivery.value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!dialogDelivery.value || deliveryDate < today) {
      showNotice('اختر موعد تسليم اليوم أو بعده قبل إرسال العرض.', 'error');
      return;
    }
    const actionText = quoteStatus(selected) === 'not_sent' ? 'إرسال' : 'إعادة إرسال';
    if (!window.confirm(`${actionText} عرض السعر بقيمة ${priceLabel(dialogPrice.value)} للعميل؟`)) return;

    sendQuoteButton.disabled = true;
    const originalLabel = sendQuoteButton.textContent;
    sendQuoteButton.textContent = 'جارٍ إرسال العرض...';
    try {
      const updated = await backend.sendServiceQuote(selectedId, {
        quotedPriceIqd: dialogPrice.value,
        expectedDeliveryDate: dialogDelivery.value,
        quoteScope: dialogQuoteScope.value,
        adminMessage: dialogAdminMessage.value
      });
      requests = requests.map(item => item.id === selectedId ? { ...item, ...updated, quote_available: true, workflow_available: true } : item);
      render();
      showRequest(selectedId);
      showNotice('تم إرسال عرض السعر للعميل وحفظ نسخة مؤرخة منه.');
    } catch {
      showNotice('تعذر إرسال العرض. تحقق من السعر والموعد ونطاق العمل وصلاحية جلسة المدير.', 'error');
      sendQuoteButton.disabled = false;
      sendQuoteButton.textContent = originalLabel;
    }
  });

  document.querySelector('#delete-request').addEventListener('click', async () => {
    if (profile?.role !== 'admin' || !selectedId) return;
    if (!window.confirm('سيُحذف الطلب وملفاته نهائياً. هل أنت متأكد؟')) return;
    try {
      await backend.deleteRequest(selectedId);
      requests = requests.filter(item => item.id !== selectedId);
      dialog.close();
      clearPanelError();
      render();
      showNotice('تم حذف الطلب وملفاته.');
    } catch {
      showPanelError('تعذر حذف الطلب. لم يُجرَ أي حذف إضافي.');
    }
  });

  exportButton.addEventListener('click', () => {
    if (profile?.role !== 'admin') return;
    const exportData = requests.map(({ request_files, ...request }) => ({
      ...request,
      files: (request_files || []).map(file => ({ name: file.original_name, size: file.size_bytes }))
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `geo-rafidain-requests-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice('تم تجهيز النسخة الاحتياطية بصيغة JSON.');
  });

  const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

  exportCsvButton.addEventListener('click', () => {
    if (profile?.role !== 'admin') return;
    const headers = ['رقم الطلب', 'الاسم', 'التواصل', 'الخدمة', 'منطقة الدراسة', 'الوصف', 'الحالة', 'الإنجاز %', 'السعر د.ع.', 'التسليم المتوقع', 'حالة العرض', 'نطاق العرض', 'قرار العميل', 'تاريخ الإنشاء'];
    const rows = requests.map(item => [
      item.request_number, item.name, item.contact, item.service, item.study_area || '', item.description,
      statusLabels[item.status] || item.status, progressValue(item.progress_percent), item.quoted_price_iqd ?? '',
      item.expected_delivery_date || '', quoteStatusLabels[quoteStatus(item)] || quoteStatus(item), item.quote_scope || '',
      item.quote_client_note || '', item.created_at
    ]);
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `geo-rafidain-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    showNotice('تم تجهيز ملف CSV لفتحه في Excel.');
  });

  signOutButton.addEventListener('click', async () => {
    try { await backend.signOut(); }
    finally { window.location.href = 'index.html'; }
  });

  const initialize = async () => {
    if (backend?.status !== 'ready') {
      showGate('يلزم إكمال الإعداد الآمن', backendMessage());
      return;
    }

    try {
      const user = await backend.getUser();
      if (!user) {
        showGate('تسجيل الدخول مطلوب', 'ارجع إلى المنصة وسجّل الدخول بالبريد، ثم افتح لوحة المتابعة.');
        return;
      }

      profile = await backend.getProfile();
      if (!profile) {
        showGate('تعذر قراءة ملف الحساب', 'راجع مشغل إنشاء الحساب في schema.sql.');
        return;
      }

      if (profile.role === 'admin') {
        document.querySelector('#security-link').hidden = false;
        const assurance = await backend.getMfaAssurance();
        if (assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2') {
          showGate(
            'يلزم رمز المصادقة الثنائية',
            'حساب المدير محمي. أدخل الرمز من تطبيق المصادقة لإكمال فتح لوحة الإدارة.',
            'security.html',
            'إكمال التحقق الآمن'
          );
          return;
        }
      }

      gate.hidden = true;
      main.hidden = false;
      document.querySelector('#account-email').textContent = user.email || '';
      document.querySelector('#welcome-text').textContent = profile.role === 'admin' ? 'مرحباً مصطفى،' : 'مرحباً بك،';
      document.querySelector('#dashboard-title').textContent = profile.role === 'admin' ? 'متابعة الطلبات' : 'طلباتي';
      exportButton.hidden = profile.role !== 'admin';
      exportCsvButton.hidden = profile.role !== 'admin';
      await loadRequests();
      clearInterval(notificationRefreshTimer);
      notificationRefreshTimer = setInterval(() => {
        if (!document.hidden) refreshNotifications(true);
      }, 60000);
    } catch {
      showGate('تعذر التحقق من الحساب', 'تحقق من الإنترنت وإعدادات قاعدة البيانات ثم أعد تحميل الصفحة.');
    }
  };

  backend?.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      clearInterval(notificationRefreshTimer);
      showGate('انتهت الجلسة', 'سجّل الدخول مرة أخرى من الصفحة الرئيسية.');
    }
  });

  initialize();
})();
