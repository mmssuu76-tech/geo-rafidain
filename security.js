(() => {
  const backend = window.geoBackend;
  const loading = document.querySelector('#security-loading');
  const enrollPanel = document.querySelector('#security-enroll');
  const challengePanel = document.querySelector('#security-challenge');
  const completePanel = document.querySelector('#security-complete');
  const enrollDetails = document.querySelector('#enroll-details');
  const status = document.querySelector('#security-status');
  const qrImage = document.querySelector('#totp-qr');
  const manualHelp = document.querySelector('#totp-manual');
  const secretOutput = document.querySelector('#totp-secret');
  const beginButton = document.querySelector('#begin-enroll');
  let activeFactorId = '';
  let enrollmentRunning = false;

  const setStatus = (message = '', type = '') => {
    status.textContent = message;
    status.className = `security-status${type ? ` ${type}` : ''}`;
  };

  const clearEnrollmentSecrets = () => {
    qrImage.removeAttribute('src');
    qrImage.hidden = true;
    secretOutput.textContent = '';
    secretOutput.hidden = true;
    manualHelp.hidden = true;
    enrollDetails.hidden = true;
    document.querySelector('#enroll-code').value = '';
    document.querySelector('#challenge-code').value = '';
  };

  const validCode = input => /^[0-9]{6}$/.test(input.value.trim());

  const verify = async (input, button) => {
    if (!validCode(input)) {
      setStatus('أدخل رمزاً صحيحاً مكوّناً من 6 أرقام.', 'error');
      input.focus();
      return;
    }
    button.disabled = true;
    setStatus('جارٍ التحقق...');
    try {
      await backend.verifyTotp(activeFactorId, input.value.trim());
      clearEnrollmentSecrets();
      activeFactorId = '';
      enrollPanel.hidden = true;
      challengePanel.hidden = true;
      completePanel.hidden = true;
      try {
        const state = await backend.getAdminMfaState();
        if (!state.ready) throw new Error('ADMIN_MFA_NOT_READY');
        setStatus('تم التحقق بنجاح.', 'success');
        completePanel.hidden = false;
      } catch {
        setStatus('تم قبول الرمز، لكن تعذر تأكيد الجلسة الآمنة. أعد تحميل الصفحة قبل المتابعة.', 'error');
      }
    } catch {
      setStatus('الرمز غير صحيح أو انتهت صلاحيته. انتظر رمزاً جديداً وحاول مرة أخرى.', 'error');
    } finally {
      button.disabled = false;
    }
  };

  const startEnrollment = async () => {
    if (enrollmentRunning) return;
    enrollmentRunning = true;
    const button = beginButton;
    button.disabled = true;
    setStatus('جارٍ إنشاء رمز الربط...');
    try {
      const state = await backend.getAdminMfaState();
      if (state.verifiedFactors.length || state.assurance?.currentLevel !== 'aal1'
          || state.assurance?.nextLevel !== 'aal1') {
        setStatus('تعذر بدء تفعيل جديد. أعد تحميل الصفحة أو أكمل التحقق من العامل الموجود.', 'error');
        button.disabled = false;
        return;
      }
      // Do not delete factors automatically; a failed/racing enrollment may require recovery.
      clearEnrollmentSecrets();
      const factor = await backend.enrollTotp();
      if (!factor?.id || !factor?.totp?.qr_code) throw new Error('TOTP_QR_MISSING');
      activeFactorId = factor.id;
      qrImage.src = factor.totp.qr_code;
      qrImage.hidden = false;
      if (factor.totp.secret) {
        secretOutput.textContent = factor.totp.secret;
        secretOutput.hidden = false;
        manualHelp.hidden = false;
      }
      enrollDetails.hidden = false;
      setStatus('امسح الرمز ثم أدخل الرقم الظاهر في التطبيق.', 'success');
      document.querySelector('#enroll-code').focus();
    } catch (error) {
      const details = String(error?.message || error || '');
      const message = /disabled|not enabled|mfa.*off/i.test(details)
        ? 'المصادقة بتطبيق TOTP غير مفعّلة في مشروع Supabase. فعّلها من إعدادات Authentication ثم أعد تحميل الصفحة.'
        : /already exists|factor.*exist/i.test(details)
        ? 'يوجد عامل مصادقة سابق. أعد تحميل الصفحة أو اطلب استعادة الوصول بطريقة آمنة.'
        : /network|fetch/i.test(details)
          ? 'تعذر الاتصال بخدمة المصادقة. تحقق من الإنترنت ثم حاول مجدداً.'
          : 'تعذر إنشاء رمز الربط. أعد تحميل الصفحة وحاول مجدداً.';
      setStatus(message, 'error');
      button.disabled = false;
    } finally {
      enrollmentRunning = false;
    }
  };

  beginButton.addEventListener('click', startEnrollment);

  document.querySelector('#confirm-enroll').addEventListener('click', event =>
    verify(document.querySelector('#enroll-code'), event.currentTarget));
  document.querySelector('#confirm-challenge').addEventListener('click', event =>
    verify(document.querySelector('#challenge-code'), event.currentTarget));

  const initialize = async () => {
    try {
      const user = await backend.getUser();
      if (!user) { window.location.replace('index.html'); return; }
      const profile = await backend.getProfile();
      if (profile?.role !== 'admin') { window.location.replace('dashboard.html'); return; }

      const state = await backend.getAdminMfaState();
      loading.hidden = true;
      const verifiedTotp = state.verifiedFactors.find(factor => factor.factor_type === 'totp');

      if (state.ready) {
        completePanel.hidden = false;
      } else if (verifiedTotp && state.assurance?.currentLevel === 'aal1'
          && state.assurance?.nextLevel === 'aal2') {
        activeFactorId = verifiedTotp.id;
        challengePanel.hidden = false;
      } else if (!state.verifiedFactors.length && state.assurance?.currentLevel === 'aal1'
          && state.assurance?.nextLevel === 'aal1') {
        enrollPanel.hidden = false;
        // Explicit user action starts enrollment; no automatic factor creation.
      } else {
        setStatus('الجلسة غير جاهزة أو عامل المصادقة غير مدعوم في هذه الصفحة. سجّل الخروج ثم الدخول من جديد، أو اطلب استعادة الوصول.', 'error');
      }
    } catch {
      loading.innerHTML = '<h2>تعذر التحقق</h2><p>تحقق من الاتصال ثم أعد تحميل الصفحة.</p>';
    }
  };

  initialize();
})();
