(() => {
  const config = window.GEO_RAFIDAIN_CONFIG || {};
  const hasProjectConfig = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl || '')
    && /^(sb_publishable_|eyJ)/.test(config.publishableKey || '');
  const servedSafely = ['http:', 'https:'].includes(window.location.protocol);
  const libraryAvailable = Boolean(window.supabase?.createClient);

  let status = 'ready';
  if (!hasProjectConfig) status = 'not-configured';
  else if (!servedSafely) status = 'requires-server';
  else if (!libraryAvailable) status = 'library-missing';

  const client = status === 'ready'
    ? window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

  const allowedFileTypes = Object.freeze({
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    geojson: 'application/geo+json',
    json: 'application/json',
    gpkg: 'application/geopackage+sqlite3',
    zip: 'application/zip',
    kml: 'application/vnd.google-earth.kml+xml',
    kmz: 'application/vnd.google-earth.kmz'
  });

  const assertReady = () => {
    if (status === 'not-configured') throw new Error('BACKEND_NOT_CONFIGURED');
    if (status === 'requires-server') throw new Error('BACKEND_REQUIRES_SERVER');
    if (status === 'library-missing') throw new Error('BACKEND_LIBRARY_MISSING');
  };

  const getUser = async () => {
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    return data?.user || null;
  };

  const requireUser = async () => {
    assertReady();
    const user = await getUser();
    if (!user) throw new Error('AUTH_REQUIRED');
    return user;
  };

  const getProfile = async () => {
    const user = await getUser();
    if (!user) return null;
    const { data, error } = await client
      .from('profiles')
      .select('id,email,role,created_at')
      .eq('id', user.id)
      .single();
    if (error) throw error;
    return data;
  };

  const sendMagicLink = async (email, captchaToken = '') => {
    assertReady();
    if (config.captcha?.siteKey && !captchaToken) throw new Error('CAPTCHA_REQUIRED');
    const { error } = await client.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        ...(captchaToken ? { captchaToken } : {})
      }
    });
    if (error) throw error;
  };

  const signOut = async () => {
    assertReady();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
  };

  const validateFiles = files => {
    const maxFiles = Number(config.maxFiles) || 5;
    const maxSize = Number(config.maxFileSizeBytes) || 10 * 1024 * 1024;
    if (files.length > maxFiles) throw new Error('TOO_MANY_FILES');
    files.forEach(file => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      if (!allowedFileTypes[extension]) throw new Error(`FILE_TYPE_NOT_ALLOWED:${file.name}`);
      if (file.size > maxSize) throw new Error(`FILE_TOO_LARGE:${file.name}`);
      if (file.size === 0) throw new Error(`FILE_EMPTY:${file.name}`);
    });
  };

  const uploadRequestFiles = async (user, request, files) => {
    validateFiles(files);
    const failures = [];

    for (const file of files) {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      const safeMimeType = allowedFileTypes[extension];
      const objectPath = `${user.id}/${request.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await client.storage
        .from('request-files')
        .upload(objectPath, file, { cacheControl: '3600', upsert: false, contentType: safeMimeType });

      if (uploadError) {
        failures.push({ name: file.name, reason: uploadError.message });
        continue;
      }

      const { error: metadataError } = await client.from('request_files').insert({
        request_id: request.id,
        owner_id: user.id,
        object_path: objectPath,
        original_name: file.name,
        size_bytes: file.size,
        mime_type: safeMimeType
      });

      if (metadataError) {
        await client.storage.from('request-files').remove([objectPath]);
        failures.push({ name: file.name, reason: metadataError.message });
      }
    }

    return failures;
  };

  const createRequest = async (values, files = []) => {
    const user = await requireUser();
    const requestId = crypto.randomUUID();
    validateFiles(files);

    const { data: request, error } = await client
      .from('service_requests')
      .insert({
        id: requestId,
        user_id: user.id,
        name: values.name,
        contact: values.contact,
        service: values.service,
        study_area: values.studyArea || null,
        description: values.description,
        deadline: values.deadline || null
      })
      .select('id,request_number,status,created_at')
      .single();

    if (error) throw error;
    const fileFailures = await uploadRequestFiles(user, request, files);
    return { request, fileFailures };
  };

  const listRequests = async () => {
    await requireUser();
    const baseFields = 'id,request_number,user_id,name,contact,service,study_area,description,deadline,status,created_at,updated_at,request_files(id,original_name,object_path,size_bytes,mime_type)';
    const workflowFields = 'quoted_price_iqd,progress_percent,expected_delivery_date,admin_message';
    let { data, error } = await client
      .from('service_requests')
      .select(`${baseFields},${workflowFields}`)
      .order('created_at', { ascending: false });

    if (error && /quoted_price_iqd|progress_percent|expected_delivery_date|admin_message|column.*does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) {
      const fallback = await client
        .from('service_requests')
        .select(baseFields)
        .order('created_at', { ascending: false });
      data = (fallback.data || []).map(item => ({
        ...item,
        quoted_price_iqd: null,
        progress_percent: 0,
        expected_delivery_date: null,
        admin_message: null,
        workflow_available: false
      }));
      error = fallback.error;
    } else if (!error) {
      data = (data || []).map(item => ({ ...item, workflow_available: true }));
    }

    if (error) throw error;
    return data || [];
  };

  const updateRequestStatus = async (id, requestStatus) => {
    const profile = await getProfile();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');
    const { data, error } = await client
      .from('service_requests')
      .update({ status: requestStatus })
      .eq('id', id)
      .select('id,status,updated_at')
      .single();
    if (error) throw error;
    return data;
  };

  const updateRequestWorkflow = async (id, values) => {
    const profile = await getProfile();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

    const allowedStatuses = new Set(['new', 'reviewing', 'in_progress', 'completed']);
    const requestStatus = String(values.status || '');
    const progress = Number(values.progressPercent);
    const priceText = String(values.quotedPriceIqd ?? '').trim();
    const price = priceText === '' ? null : Number(priceText);
    const expectedDelivery = String(values.expectedDeliveryDate || '').trim() || null;
    const message = String(values.adminMessage || '').trim() || null;

    if (!allowedStatuses.has(requestStatus)) throw new Error('INVALID_STATUS');
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('INVALID_PROGRESS');
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1000000000)) throw new Error('INVALID_PRICE');
    if (expectedDelivery && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDelivery)) throw new Error('INVALID_DELIVERY_DATE');
    if (message && message.length > 2000) throw new Error('ADMIN_MESSAGE_TOO_LONG');

    const { data, error } = await client
      .from('service_requests')
      .update({
        status: requestStatus,
        quoted_price_iqd: price,
        progress_percent: progress,
        expected_delivery_date: expectedDelivery,
        admin_message: message
      })
      .eq('id', id)
      .select('id,status,quoted_price_iqd,progress_percent,expected_delivery_date,admin_message,updated_at')
      .single();
    if (error) throw error;
    return data;
  };

  const deleteRequest = async id => {
    const profile = await getProfile();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

    const { data: fileRows, error: fileError } = await client
      .from('request_files')
      .select('object_path')
      .eq('request_id', id);
    if (fileError) throw fileError;

    const paths = (fileRows || []).map(item => item.object_path);
    if (paths.length) {
      const { error: storageError } = await client.storage.from('request-files').remove(paths);
      if (storageError) throw storageError;
    }

    const { error } = await client.from('service_requests').delete().eq('id', id);
    if (error) throw error;
  };

  const createFileLink = async objectPath => {
    await requireUser();
    const { data, error } = await client.storage
      .from('request-files')
      .createSignedUrl(objectPath, 60);
    if (error) throw error;
    return data.signedUrl;
  };

  const getMfaAssurance = async () => {
    assertReady();
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  };

  const listMfaFactors = async () => {
    assertReady();
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return data;
  };

  const enrollTotp = async () => {
    await requireUser();
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'GeoRafidain Admin'
    });
    if (error) throw error;
    return data;
  };

  const verifyTotp = async (factorId, code) => {
    await requireUser();
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { data, error } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: String(code).trim()
    });
    if (error) throw error;
    return data;
  };

  const removeMfaFactor = async factorId => {
    await requireUser();
    const { data, error } = await client.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
  };

  const onAuthStateChange = callback => {
    if (!client) return { unsubscribe() {} };
    const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
    return data.subscription;
  };

  window.geoBackend = Object.freeze({
    status,
    client,
    config,
    getUser,
    getProfile,
    sendMagicLink,
    signOut,
    onAuthStateChange,
    createRequest,
    validateFiles,
    listRequests,
    updateRequestStatus,
    updateRequestWorkflow,
    deleteRequest,
    createFileLink,
    getMfaAssurance,
    listMfaFactors,
    enrollTotp,
    verifyTotp,
    removeMfaFactor
  });
})();
