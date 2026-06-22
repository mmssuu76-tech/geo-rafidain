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
  const dialog = document.querySelector('#request-dialog');
  const dialogStatus = document.querySelector('#dialog-status');
  const dialogProgress = document.querySelector('#dialog-progress');
  const dialogPrice = document.querySelector('#dialog-price');
  const dialogDelivery = document.querySelector('#dialog-delivery');
  const dialogAdminMessage = document.querySelector('#dialog-admin-message');
  const adminMessageCount = document.querySelector('#admin-message-count');
  const workflowMigrationNote = document.querySelector('#workflow-migration-note');
  const workflowExtraFields = [...document.querySelectorAll('.workflow-extra-field')];
  const adminControls = document.querySelector('#admin-dialog-controls');
  const exportButton = document.querySelector('#export-button');
  const exportCsvButton = document.querySelector('#export-csv-button');
  const refreshButton = document.querySelector('#refresh-button');
  const lastRefresh = document.querySelector('#last-refresh');
  const dashboardNotice = document.querySelector('#dashboard-notice');
  const signOutButton = document.querySelector('#dashboard-sign-out');
  let requests = [];
  let selectedId = null;
  let profile = null;
  let noticeTimer = null;

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

  const safe = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  const dateLabel = value => value
    ? new Intl.DateTimeFormat('ar-IQ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
    : '—';

  const progressValue = value => Math.min(100, Math.max(0, Number(value) || 0));

  const priceLabel = value => value === null || value === undefined || value === ''
    ? 'لم يحدد بعد'
    : `${new Intl.NumberFormat('ar-IQ').format(Number(value))} د.ع.`;

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

  const updateMetrics = data => {
    document.querySelector('#total-count').textContent = data.length;
    document.querySelector('#new-count').textContent = data.filter(item => item.status === 'new').length;
    document.querySelector('#active-count').textContent = data.filter(item => item.status === 'in_progress').length;
    document.querySelector('#done-count').textContent = data.filter(item => item.status === 'completed').length;
  };

  const render = () => {
    updateMetrics(requests);
    const term = search.value.trim().toLowerCase();
    const wantedStatus = filter.value;
    const visible = requests.filter(item => {
      const haystack = `${item.request_number} ${item.name} ${item.service} ${item.study_area || ''}`.toLowerCase();
      return (!term || haystack.includes(term)) && (wantedStatus === 'all' || item.status === wantedStatus);
    });

    list.innerHTML = visible.map(item => `
      <tr>
        <td><span class="request-id">${safe(item.request_number)}</span></td>
        <td class="client-cell"><strong>${safe(item.name)}</strong><span>${safe(item.service)}</span></td>
        <td class="area-cell">${safe(item.study_area || 'غير محددة')}</td>
        <td><div class="table-progress"><span style="width:${progressValue(item.progress_percent)}%"></span><small>${progressValue(item.progress_percent)}%</small></div></td>
        <td class="date-cell">${dateLabel(item.created_at)}</td>
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
    dialogAdminMessage.value = item.admin_message || '';
    adminMessageCount.textContent = dialogAdminMessage.value.length;
    workflowExtraFields.forEach(field => { field.hidden = !workflowAvailable; });
    workflowMigrationNote.hidden = workflowAvailable;

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
      ${workflowAvailable ? `
      <div class="detail-field"><small>السعر المقترح</small><strong>${priceLabel(item.quoted_price_iqd)}</strong></div>
      <div class="detail-field"><small>التسليم المتوقع</small><strong>${item.expected_delivery_date ? dateLabel(item.expected_delivery_date) : 'لم يحدد بعد'}</strong></div>
      <div class="detail-field full progress-detail"><div><small>نسبة الإنجاز</small><strong>${progressValue(item.progress_percent)}%</strong></div><span><i style="width:${progressValue(item.progress_percent)}%"></i></span></div>
      <div class="detail-field full"><small>رسالة المتابعة</small><strong class="detail-description admin-message">${safe(item.admin_message || 'لا توجد رسالة متابعة بعد.')}</strong></div>` : ''}
      <div class="detail-field full"><small>وصف المشروع</small><strong class="detail-description">${safe(item.description)}</strong></div>
      <div class="detail-field full"><small>الملفات الخاصة</small>${files}</div>`;
    dialog.showModal();
  };

  const loadRequests = async (announce = false) => {
    refreshButton.disabled = true;
    const originalLabel = refreshButton.textContent;
    refreshButton.textContent = 'جارٍ التحديث...';
    try {
      requests = await backend.listRequests();
      clearPanelError();
      render();
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

  document.querySelector('#dialog-content').addEventListener('click', async event => {
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

  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  refreshButton.addEventListener('click', () => loadRequests(true));

  dialogStatus.addEventListener('change', () => {
    if (dialogStatus.value === 'completed') dialogProgress.value = '100';
  });

  dialogAdminMessage.addEventListener('input', () => {
    adminMessageCount.textContent = dialogAdminMessage.value.length;
  });

  document.querySelector('#save-status').addEventListener('click', async () => {
    if (profile?.role !== 'admin' || !selectedId) return;
    const button = document.querySelector('#save-status');
    const selected = requests.find(item => item.id === selectedId);
    const workflowAvailable = selected?.workflow_available !== false;
    if (workflowAvailable && (!dialogProgress.checkValidity() || !dialogPrice.checkValidity() || !dialogDelivery.checkValidity())) {
      dialogProgress.reportValidity();
      dialogPrice.reportValidity();
      dialogDelivery.reportValidity();
      return;
    }
    button.disabled = true;
    try {
      const updated = workflowAvailable
        ? await backend.updateRequestWorkflow(selectedId, {
            status: dialogStatus.value,
            progressPercent: dialogProgress.value,
            quotedPriceIqd: dialogPrice.value,
            expectedDeliveryDate: dialogDelivery.value,
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
    const headers = ['رقم الطلب', 'الاسم', 'التواصل', 'الخدمة', 'منطقة الدراسة', 'الوصف', 'الحالة', 'الإنجاز %', 'السعر د.ع.', 'التسليم المتوقع', 'تاريخ الإنشاء'];
    const rows = requests.map(item => [
      item.request_number, item.name, item.contact, item.service, item.study_area || '', item.description,
      statusLabels[item.status] || item.status, progressValue(item.progress_percent), item.quoted_price_iqd ?? '',
      item.expected_delivery_date || '', item.created_at
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
    } catch {
      showGate('تعذر التحقق من الحساب', 'تحقق من الإنترنت وإعدادات قاعدة البيانات ثم أعد تحميل الصفحة.');
    }
  };

  backend?.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') showGate('انتهت الجلسة', 'سجّل الدخول مرة أخرى من الصفحة الرئيسية.');
  });

  initialize();
})();
