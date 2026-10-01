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
    const quoteFields = 'quote_status,quote_scope,quote_sent_at,quote_decided_at,quote_client_note';
    let { data, error } = await client
      .from('service_requests')
      .select(`${baseFields},${workflowFields},${quoteFields}`)
      .order('created_at', { ascending: false });

    if (error && /quote_status|quote_scope|quote_sent_at|quote_decided_at|quote_client_note|column.*does not exist/i.test(`${error.code || ''} ${error.message || ''}`)) {
      const workflowFallback = await client
        .from('service_requests')
        .select(`${baseFields},${workflowFields}`)
        .order('created_at', { ascending: false });

      if (!workflowFallback.error) {
        data = (workflowFallback.data || []).map(item => ({
          ...item,
          quote_status: 'not_sent',
          quote_scope: null,
          quote_sent_at: null,
          quote_decided_at: null,
          quote_client_note: null,
          workflow_available: true,
          quote_available: false
        }));
        error = null;
      } else {
        error = workflowFallback.error;
      }
    }

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
        quote_status: 'not_sent',
        quote_scope: null,
        quote_sent_at: null,
        quote_decided_at: null,
        quote_client_note: null,
        workflow_available: false,
        quote_available: false
      }));
      error = fallback.error;
    } else if (!error) {
      data = (data || []).map(item => ({
        ...item,
        workflow_available: item.workflow_available !== false,
        quote_available: item.quote_available !== false
      }));
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
    const message = String(values.adminMessage || '').trim() || null;

    if (!allowedStatuses.has(requestStatus)) throw new Error('INVALID_STATUS');
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error('INVALID_PROGRESS');
    if (message && message.length > 2000) throw new Error('ADMIN_MESSAGE_TOO_LONG');

    const { data, error } = await client
      .from('service_requests')
      .update({
        status: requestStatus,
        progress_percent: progress,
        admin_message: message
      })
      .eq('id', id)
      .select('id,status,progress_percent,admin_message,updated_at')
      .single();
    if (error) throw error;
    return data;
  };

  const sendServiceQuote = async (id, values) => {
    const profile = await getProfile();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');

    const price = Number(values.quotedPriceIqd);
    const expectedDelivery = String(values.expectedDeliveryDate || '').trim();
    const scope = String(values.quoteScope || '').trim();
    const message = String(values.adminMessage || '').trim() || null;

    if (!Number.isInteger(price) || price < 1000 || price > 1000000000) throw new Error('INVALID_QUOTE_PRICE');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDelivery)) throw new Error('INVALID_QUOTE_DELIVERY_DATE');
    if (scope.length < 20 || scope.length > 4000) throw new Error('INVALID_QUOTE_SCOPE');
    if (message && message.length > 2000) throw new Error('ADMIN_MESSAGE_TOO_LONG');

    const { data, error } = await client.rpc('admin_send_service_quote', {
      p_request_id: id,
      p_price_iqd: price,
      p_delivery_date: expectedDelivery,
      p_scope: scope,
      p_admin_message: message
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  };

  const respondToServiceQuote = async (id, decision, note = '') => {
    await requireUser();
    if (!['accepted', 'rejected'].includes(decision)) throw new Error('INVALID_QUOTE_DECISION');
    const cleanNote = String(note || '').trim();
    if (cleanNote.length > 1000) throw new Error('CLIENT_NOTE_TOO_LONG');

    const { data, error } = await client.rpc('respond_to_service_quote', {
      p_request_id: id,
      p_decision: decision,
      p_note: cleanNote || null
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  };

  const listRequestMessages = async requestId => {
    await requireUser();
    const { data, error } = await client
      .from('request_messages')
      .select('id,request_id,sender_id,sender_role,body,created_at')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    return data || [];
  };

  const sendRequestMessage = async (requestId, body) => {
    await requireUser();
    const cleanBody = String(body || '').trim();
    if (cleanBody.length < 2 || cleanBody.length > 3000) throw new Error('INVALID_MESSAGE_BODY');
    const { data, error } = await client.rpc('send_request_message', {
      p_request_id: requestId,
      p_body: cleanBody
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  };

  const listRequestDeliverables = async requestId => {
    await requireUser();
    const { data, error } = await client
      .from('request_deliverables')
      .select('id,request_id,uploaded_by,object_path,original_name,size_bytes,mime_type,version_label,delivery_note,created_at')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  };

  const listNotifications = async (limit = 30) => {
    await requireUser();
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 30));
    const { data, error } = await client
      .from('user_notifications')
      .select('id,request_id,notification_type,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(safeLimit);
    if (error) throw error;
    return data || [];
  };

  const markNotificationsRead = async notificationId => {
    await requireUser();
    const { data, error } = await client.rpc('mark_notifications_read', {
      p_notification_id: notificationId || null
    });
    if (error) throw error;
    return Number(data) || 0;
  };

  const validateDeliverable = file => {
    if (!file) throw new Error('DELIVERABLE_REQUIRED');
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!allowedFileTypes[extension]) throw new Error(`FILE_TYPE_NOT_ALLOWED:${file.name}`);
    if (file.size > 50 * 1024 * 1024) throw new Error(`FILE_TOO_LARGE:${file.name}`);
    if (file.size === 0) throw new Error(`FILE_EMPTY:${file.name}`);
    return { extension, mimeType: allowedFileTypes[extension] };
  };

  const uploadRequestDeliverable = async (request, file, values = {}) => {
    const profile = await getProfile();
    if (profile?.role !== 'admin') throw new Error('ADMIN_REQUIRED');
    if (!request?.id || !request?.user_id) throw new Error('INVALID_REQUEST');

    const { extension, mimeType } = validateDeliverable(file);
    const versionLabel = String(values.versionLabel || '').trim();
    const deliveryNote = String(values.deliveryNote || '').trim() || null;
    if (versionLabel.length < 2 || versionLabel.length > 80) throw new Error('INVALID_VERSION_LABEL');
    if (deliveryNote && deliveryNote.length > 1200) throw new Error('DELIVERY_NOTE_TOO_LONG');

    const objectPath = `${request.user_id}/${request.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage
      .from('request-deliverables')
      .upload(objectPath, file, { cacheControl: '3600', upsert: false, contentType: mimeType });
    if (uploadError) throw uploadError;

    const { data, error } = await client.rpc('admin_register_request_deliverable', {
      p_request_id: request.id,
      p_object_path: objectPath,
      p_original_name: file.name,
      p_size_bytes: file.size,
      p_mime_type: mimeType,
      p_version_label: versionLabel,
      p_delivery_note: deliveryNote
    });

    if (error) {
      await client.storage.from('request-deliverables').remove([objectPath]);
      throw error;
    }
    return Array.isArray(data) ? data[0] : data;
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

  const createDeliverableLink = async objectPath => {
    await requireUser();
    const { data, error } = await client.storage
      .from('request-deliverables')
      .createSignedUrl(objectPath, 60);
    if (error) throw error;
    return data.signedUrl;
  };

  const listPublishedResources = async () => {
    assertReady();
    const { data, error } = await client
      .from('geo_resources')
      .select('id,slug,title_ar,title_en,category,provider,description_ar,research_uses,coverage,temporal_coverage,spatial_resolution,formats,license_name,license_url,access_url,metadata_url,citation_text,tags,featured,is_published,source_checked_at,updated_at')
      .eq('is_published', true)
      .order('featured', { ascending: false })
      .order('title_ar', { ascending: true });
    if (error) throw error;
    return data || [];
  };

  const researchStages = new Set(['idea', 'planning', 'data_collection', 'analysis', 'writing', 'review', 'completed']);

  const validateResearchProject = values => {
    const title = String(values.title || '').trim();
    const summary = String(values.summary || '').trim() || null;
    const studyArea = String(values.studyArea || '').trim() || null;
    const stage = String(values.stage || 'planning');
    const workspaceData = values.workspaceData && typeof values.workspaceData === 'object' && !Array.isArray(values.workspaceData)
      ? values.workspaceData
      : {};
    if (title.length < 3 || title.length > 160) throw new Error('INVALID_RESEARCH_PROJECT_TITLE');
    if (summary && summary.length > 1200) throw new Error('RESEARCH_PROJECT_SUMMARY_TOO_LONG');
    if (studyArea && studyArea.length > 240) throw new Error('RESEARCH_PROJECT_STUDY_AREA_TOO_LONG');
    if (!researchStages.has(stage)) throw new Error('INVALID_RESEARCH_PROJECT_STAGE');
    if (new Blob([JSON.stringify(workspaceData)]).size > 900000) throw new Error('RESEARCH_PROJECT_DATA_TOO_LARGE');
    return { title, summary, study_area: studyArea, stage, workspace_data: workspaceData };
  };

  const listResearchProjects = async () => {
    await requireUser();
    const { data, error } = await client
      .from('research_projects')
      .select('id,user_id,title,summary,study_area,stage,workspace_data,version,created_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  };

  const createResearchProject = async values => {
    const user = await requireUser();
    const project = validateResearchProject(values);
    const { data, error } = await client
      .from('research_projects')
      .insert({ ...project, user_id: user.id })
      .select('id,user_id,title,summary,study_area,stage,workspace_data,version,created_at,updated_at')
      .single();
    if (error) throw error;
    return data;
  };

  const updateResearchProject = async (id, values, expectedVersion) => {
    await requireUser();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('INVALID_RESEARCH_PROJECT_ID');
    const version = Number(expectedVersion);
    if (!Number.isInteger(version) || version < 1) throw new Error('INVALID_RESEARCH_PROJECT_VERSION');
    const project = validateResearchProject(values);
    const { data, error } = await client
      .from('research_projects')
      .update(project)
      .eq('id', id)
      .eq('version', version)
      .select('id,user_id,title,summary,study_area,stage,workspace_data,version,created_at,updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('RESEARCH_PROJECT_CONFLICT');
    return data;
  };

  const listAdminResources = async () => {
    await requireUser();
    const { data, error } = await client
      .from('geo_resources')
      .select('*')
      .order('is_published', { ascending: false })
      .order('featured', { ascending: false })
      .order('title_ar', { ascending: true });
    if (error) throw error;
    return data || [];
  };

  const adminUpsertResource = async resource => {
    await requireUser();
    const { data, error } = await client.rpc('admin_upsert_geo_resource', {
      p_resource: resource
    });
    if (error) throw error;
    return data;
  };

  const adminSetResourcePublished = async (resourceId, published) => {
    await requireUser();
    const { data, error } = await client.rpc('admin_set_geo_resource_published', {
      p_resource_id: resourceId,
      p_published: Boolean(published)
    });
    if (error) throw error;
    return data;
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
    sendServiceQuote,
    respondToServiceQuote,
    listRequestMessages,
    sendRequestMessage,
    listRequestDeliverables,
    listNotifications,
    markNotificationsRead,
    uploadRequestDeliverable,
    deleteRequest,
    createFileLink,
    createDeliverableLink,
    listResearchProjects,
    createResearchProject,
    updateResearchProject,
    listPublishedResources,
    listAdminResources,
    adminUpsertResource,
    adminSetResourcePublished,
    getMfaAssurance,
    listMfaFactors,
    enrollTotp,
    verifyTotp,
    removeMfaFactor
  });
})();
