(() => {
  const backend = window.geoBackend;
  const header = document.querySelector('.site-header');
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  const form = document.querySelector('#project-form');
  const serviceSelect = document.querySelector('#service-select');
  const formStatus = document.querySelector('#form-status');
  const description = form?.elements.description;
  const charCount = document.querySelector('#char-count');
  const fileInput = document.querySelector('#file-input');
  const fileLabel = document.querySelector('#file-label-text');
  const fileSelectionDetails = document.querySelector('#file-selection-details');
  const submitButton = form?.querySelector('.submit-button');
  const backendNotice = document.querySelector('#backend-notice');

  const authButton = document.querySelector('#auth-button');
  const authDialog = document.querySelector('#auth-dialog');
  const authClose = document.querySelector('#auth-close');
  const authConfigPanel = document.querySelector('#auth-config-panel');
  const authConfigText = document.querySelector('#auth-config-text');
  const signedOutPanel = document.querySelector('#auth-signed-out');
  const signedInPanel = document.querySelector('#auth-signed-in');
  const authEmail = document.querySelector('#auth-email');
  const sendMagicLinkButton = document.querySelector('#send-magic-link');
  const signOutButton = document.querySelector('#sign-out');
  const signedInEmail = document.querySelector('#signed-in-email');
  const adminSecurityLink = document.querySelector('#admin-security-link');
  const authStatus = document.querySelector('#auth-status');
  const captchaSlot = document.querySelector('#captcha-slot');
  let captchaToken = '';
  let captchaWidgetId = null;
  let captchaLoader = null;

  document.querySelector('#year').textContent = new Date().getFullYear();

  const backendMessage = () => ({
    'not-configured': 'قاعدة البيانات لم تُربط بعد. أكمل خطوات SETUP.md قبل استقبال بيانات حقيقية.',
    'requires-server': 'لأسباب أمنية، شغّل المنصة عبر Start-GeoRafidain.cmd بدلاً من فتح index.html مباشرة.',
    'library-missing': 'تعذر تحميل مكتبة الاتصال الآمن. تحقق من اتصال الإنترنت ثم حدّث الصفحة.'
  }[backend?.status] || '');

  const friendlyError = error => {
    const code = error?.message || '';
    if (code === 'BACKEND_NOT_CONFIGURED') return 'لم يتم ربط قاعدة البيانات بعد.';
    if (code === 'BACKEND_REQUIRES_SERVER') return 'يجب تشغيل المنصة من ملف Start-GeoRafidain.cmd.';
    if (code === 'BACKEND_LIBRARY_MISSING') return 'تعذر تحميل مكتبة الاتصال. تحقق من الإنترنت.';
    if (code === 'AUTH_REQUIRED') return 'سجّل الدخول أولاً لإرسال الطلب.';
    if (code === 'CAPTCHA_REQUIRED') return 'أكمل اختبار التحقق قبل إرسال رابط الدخول.';
    if (code === 'TOO_MANY_FILES') return 'الحد الأقصى هو خمسة ملفات.';
    if (code.startsWith('FILE_TOO_LARGE:')) return `الملف ${code.split(':')[1]} أكبر من 10MB.`;
    if (code.startsWith('FILE_TYPE_NOT_ALLOWED:')) return `نوع الملف ${code.split(':')[1]} غير مسموح.`;
    if (code.startsWith('FILE_EMPTY:')) return `الملف ${code.split(':')[1]} فارغ.`;
    if (code === 'DESCRIPTION_TOO_LONG') return 'تفاصيل الطلب طويلة جدًا. اختصر وصف المشروع قليلًا ثم أعد الإرسال.';
    if (/row-level security|42501/i.test(code)) return 'تعذر حفظ الطلب. قد تكون تجاوزت حد خمسة طلبات في الساعة أو لا تملك الصلاحية.';
    if (/token.*expired|invalid.*token|otp/i.test(code)) return 'رابط الدخول غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً.';
    if (/fetch|network/i.test(code)) return 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مجدداً.';
    return 'حدث خطأ غير متوقع. حاول مجدداً، وإذا استمر الخطأ راجع إعداد قاعدة البيانات.';
  };

  if (backendNotice) backendNotice.textContent = backendMessage();

  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
  });

  nav?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    document.body.classList.remove('menu-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  }));

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => revealObserver.observe(element));

  document.querySelectorAll('.filter-button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.filter-button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      const filter = button.dataset.filter;
      document.querySelectorAll('.data-card').forEach(card => {
        card.classList.toggle('hidden', filter !== 'all' && card.dataset.category !== filter);
      });
    });
  });

  const setSelectByText = (name, wantedText) => {
    const field = form?.elements[name];
    if (!field || !wantedText) return;
    const option = [...field.options].find(item => item.text === wantedText || item.value === wantedText);
    if (option) field.value = option.value || option.text;
  };

  const suggestIntakeDefaults = requested => {
    if (!requested) return;
    if (/Sentinel|Landsat|استشعار|مرئيات/i.test(requested)) {
      setSelectByText('dataType', 'مرئيات فضائية');
      setSelectByText('outputType', 'بيانات مكانية مجهزة للاستخدام');
    }
    if (/SRTM|DEM|ارتفاع/i.test(requested)) {
      setSelectByText('dataType', 'نموذج ارتفاعات DEM');
      setSelectByText('outputType', 'بيانات مكانية مجهزة للاستخدام');
    }
    if (/تحليل|التحليلات/i.test(requested)) {
      setSelectByText('outputType', 'تحليل جغرافي مع نتائج قابلة للتفسير');
    }
    if (/خريطة|خرائط|رسم/i.test(requested)) {
      setSelectByText('outputType', 'خريطة جاهزة للنشر أو الطباعة');
    }
    if (/استشارة|بحث/i.test(requested)) {
      setSelectByText('outputType', 'استشارة وتوجيه علمي');
      setSelectByText('deliveryFormat', 'Word / تقرير بحثي');
    }
  };

  document.querySelectorAll('.service-select').forEach(button => {
    button.addEventListener('click', () => {
      const requested = button.dataset.service;
      const selectedPackage = button.dataset.package;
      const option = [...serviceSelect.options].find(item => item.text === requested);
      if (option) serviceSelect.value = option.value || option.text;
      else {
        serviceSelect.value = 'تجهيز مجموعة بيانات محددة';
        form.elements.description.value = `أرغب في طلب: ${requested}. `;
        charCount.textContent = form.elements.description.value.length;
      }
      suggestIntakeDefaults(requested);
      if (selectedPackage) {
        const packageNote = `أرغب في اختيار ${selectedPackage}. `;
        const currentDescription = form.elements.description.value.trim();
        if (!currentDescription) form.elements.description.value = packageNote;
        else if (!currentDescription.includes(selectedPackage)) form.elements.description.value = `${packageNote}${currentDescription}`;
        charCount.textContent = form.elements.description.value.length;
      }
      document.querySelector('#request').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => serviceSelect.focus(), 500);
    });
  });

  description?.addEventListener('input', () => {
    charCount.textContent = description.value.length;
    description.classList.toggle('invalid', description.value.length > 0 && description.value.length < 20);
  });

  const formValue = (data, name) => String(data.get(name) || '').trim();

  const buildEnhancedDescription = data => {
    const baseDescription = formValue(data, 'description');
    const detailLines = [
      ['مستوى الأولوية', formValue(data, 'priority')],
      ['نوع المخرج المطلوب', formValue(data, 'outputType')],
      ['نوع البيانات المطلوبة/المتوفرة', formValue(data, 'dataType')],
      ['الفترة الزمنية للدراسة', formValue(data, 'timeRange')],
      ['صيغة التسليم المفضلة', formValue(data, 'deliveryFormat')],
      ['نظام الإحداثيات', formValue(data, 'coordinateSystem')],
      ['المحافظة المحددة من الخريطة', formValue(data, 'governorate')]
    ].filter(([, value]) => value && value !== 'غير محدد بعد');

    const enhanced = detailLines.length
      ? `${baseDescription}\n\nتفاصيل تنظيم الطلب:\n${detailLines.map(([label, value]) => `- ${label}: ${value}`).join('\n')}`
      : baseDescription;

    if (enhanced.length > 5000) throw new Error('DESCRIPTION_TOO_LONG');
    return enhanced;
  };

  const readableFileSize = bytes => bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`
    : `${(bytes / 1024 / 1024).toFixed(1)} ميغابايت`;

  fileInput?.addEventListener('change', () => {
    const count = fileInput.files.length;
    fileLabel.textContent = count
      ? (count === 1 ? fileInput.files[0].name : `${count} ملفات محددة`)
      : 'حتى 5 ملفات، 10MB لكل ملف';
    fileSelectionDetails.replaceChildren();
    [...fileInput.files].forEach(file => {
      const item = document.createElement('li');
      item.textContent = `${file.name} — ${readableFileSize(file.size)}`;
      fileSelectionDetails.append(item);
    });

    formStatus.textContent = '';
    formStatus.className = 'form-status';
    try {
      backend?.validateFiles?.([...fileInput.files]);
    } catch (error) {
      formStatus.textContent = friendlyError(error);
      formStatus.classList.add('error');
      fileInput.value = '';
      fileLabel.textContent = 'حتى 5 ملفات، 10MB لكل ملف';
      fileSelectionDetails.replaceChildren();
    }
  });

  const setAuthStatus = (message = '', type = '') => {
    authStatus.textContent = message;
    authStatus.className = `auth-status${type ? ` ${type}` : ''}`;
  };

  const initializeCaptcha = async () => {
    const captcha = backend?.config?.captcha;
    if (!captcha?.siteKey || !captchaSlot) return;
    captchaSlot.hidden = false;
    if (captcha.provider !== 'turnstile') throw new Error('CAPTCHA_PROVIDER_NOT_SUPPORTED');

    if (!window.turnstile) {
      captchaLoader ||= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('CAPTCHA_LOAD_FAILED'));
        document.head.appendChild(script);
      });
      await captchaLoader;
    }

    if (captchaWidgetId === null) {
      captchaWidgetId = window.turnstile.render(captchaSlot, {
        sitekey: captcha.siteKey,
        callback: token => { captchaToken = token; },
        'expired-callback': () => { captchaToken = ''; },
        'error-callback': () => { captchaToken = ''; }
      });
    }
  };

  const resetCaptcha = () => {
    captchaToken = '';
    if (window.turnstile && captchaWidgetId !== null) window.turnstile.reset(captchaWidgetId);
  };

  const refreshAuthUi = async () => {
    setAuthStatus();
    const ready = backend?.status === 'ready';
    authConfigPanel.hidden = ready;
    signedOutPanel.hidden = !ready;
    signedInPanel.hidden = true;

    if (!ready) {
      authButton.textContent = 'الإعداد مطلوب';
      authConfigText.textContent = backendMessage();
      return null;
    }

    try {
      const user = await backend.getUser();
      signedOutPanel.hidden = Boolean(user);
      signedInPanel.hidden = !user;
      authButton.textContent = user ? 'حسابي' : 'تسجيل الدخول';
      signedInEmail.textContent = user?.email || '';
      if (adminSecurityLink) {
        adminSecurityLink.hidden = true;
        if (user) {
          const profile = await backend.getProfile();
          adminSecurityLink.hidden = profile?.role !== 'admin';
        }
      }
      if (user && !form.elements.contact.value) form.elements.contact.value = user.email || '';
      backendNotice.textContent = user ? 'أنت مسجل الدخول؛ سيُحفظ الطلب في حسابك الخاص.' : 'سجّل الدخول بالبريد قبل إرسال الطلب.';
      return user;
    } catch (error) {
      authButton.textContent = 'تعذر الاتصال';
      backendNotice.textContent = friendlyError(error);
      return null;
    }
  };

  const openAuthDialog = async () => {
    document.body.classList.remove('menu-open');
    await refreshAuthUi();
    authDialog.showModal();
    try { if (!signedOutPanel.hidden) await initializeCaptcha(); }
    catch { setAuthStatus('تعذر تحميل اختبار التحقق. تحقق من الاتصال ثم أعد المحاولة.', 'error'); }
  };

  authButton?.addEventListener('click', openAuthDialog);
  authClose?.addEventListener('click', () => authDialog.close());

  sendMagicLinkButton?.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    if (!authEmail.checkValidity() || !email) {
      setAuthStatus('أدخل بريداً إلكترونياً صحيحاً.', 'error');
      authEmail.focus();
      return;
    }

    sendMagicLinkButton.disabled = true;
    setAuthStatus('جارٍ إرسال رابط الدخول...');
    try {
      await backend.sendMagicLink(email, captchaToken);
      setAuthStatus('أرسلنا رابط دخول آمناً إلى بريدك. افتحه في المتصفح نفسه لإكمال الدخول.', 'success');
    } catch (error) {
      setAuthStatus(friendlyError(error), 'error');
    } finally {
      resetCaptcha();
      sendMagicLinkButton.disabled = false;
    }
  });

  signOutButton?.addEventListener('click', async () => {
    try {
      await backend.signOut();
      await refreshAuthUi();
      setAuthStatus('تم تسجيل الخروج.', 'success');
    } catch (error) {
      setAuthStatus(friendlyError(error), 'error');
    }
  });

  backend?.onAuthStateChange(() => setTimeout(refreshAuthUi, 0));

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    formStatus.className = 'form-status';
    form.querySelectorAll('.invalid').forEach(element => element.classList.remove('invalid'));

    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      invalid?.classList.add('invalid');
      invalid?.focus();
      formStatus.textContent = 'يرجى إكمال الحقول المطلوبة والتأكد من صحة البيانات.';
      formStatus.classList.add('error');
      return;
    }

    if (backend?.status !== 'ready') {
      formStatus.textContent = backendMessage();
      formStatus.classList.add('error');
      await openAuthDialog();
      return;
    }

    try {
      const user = await backend.getUser();
      if (!user) {
        formStatus.textContent = 'سجّل الدخول أولاً لإرسال الطلب.';
        formStatus.classList.add('error');
        await openAuthDialog();
        return;
      }

      const data = new FormData(form);
      submitButton.disabled = true;
      submitButton.querySelector('span').textContent = 'جارٍ الحفظ والرفع...';

      const result = await backend.createRequest({
        name: formValue(data, 'name'),
        contact: formValue(data, 'contact'),
        service: formValue(data, 'service'),
        studyArea: formValue(data, 'studyArea'),
        description: buildEnhancedDescription(data),
        deadline: formValue(data, 'deadline')
      }, [...fileInput.files]);

      const warning = result.fileFailures.length
        ? ` تم حفظ الطلب، لكن تعذر رفع ${result.fileFailures.length} من الملفات.`
        : '';
      formStatus.replaceChildren();
      formStatus.append(document.createTextNode('تم حفظ الطلب بأمان. رقم الطلب: '));
      const requestNumber = document.createElement('strong');
      requestNumber.textContent = result.request.request_number;
      formStatus.append(requestNumber, document.createTextNode(`.${warning} `));
      const requestsLink = document.createElement('a');
      requestsLink.href = 'dashboard.html';
      requestsLink.textContent = 'عرض طلباتي';
      formStatus.append(requestsLink);
      formStatus.classList.add(result.fileFailures.length ? 'error' : 'success');
      form.reset();
      charCount.textContent = '0';
      fileLabel.textContent = 'حتى 5 ملفات، 10MB لكل ملف';
      fileSelectionDetails.replaceChildren();
      form.elements.contact.value = user.email || '';
    } catch (error) {
      formStatus.textContent = friendlyError(error);
      formStatus.classList.add('error');
    } finally {
      submitButton.disabled = false;
      submitButton.querySelector('span').textContent = 'إرسال الطلب بأمان';
    }
  });

  const deadlineInput = form?.elements.deadline;
  if (deadlineInput) deadlineInput.min = new Date().toISOString().slice(0, 10);

  refreshAuthUi();
})();
