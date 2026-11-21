import { createClient } from 'npm:@supabase/supabase-js@2'

import { validRequestPaths } from '../_shared/request-paths.mjs'

type StorageRow = { object_path: string }
type RetentionRequest = {
  id: string
  user_id: string
  request_files?: StorageRow[] | null
  request_deliverables?: StorageRow[] | null
}

type FailureStage = 'metadata' | 'request-deliverables' | 'request-files' | 'database'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
})

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const expectedSecret = Deno.env.get('RETENTION_CRON_SECRET')
  const suppliedSecret = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: 'unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'missing_server_configuration' }, 500)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const dryRun = new URL(request.url).searchParams.getAll('dry_run').includes('1')
  if (!dryRun) return json({ error: 'retention_maintenance' }, 503)
  let query = admin
    .from('service_requests')
    .select('id,user_id,request_files(object_path),request_deliverables(object_path)')
    .eq('status', 'completed')
    .lt('completed_at', cutoff)
    .order('completed_at', { ascending: true })
    .limit(100)
  if (!dryRun) query = query.or(`retention_lease_until.is.null,retention_lease_until.lt.${new Date().toISOString()}`)
  const { data: requests, error: readError } = await query

  if (readError) return json({ error: 'read_failed', detail: readError.message }, 500)

  const dueRequests = (requests || []) as RetentionRequest[]
  if (dryRun) {
    const countPaths = (rows: StorageRow[] | null | undefined) =>
      (rows || []).filter((row) => Boolean(row.object_path)).length

    return json({
      dry_run: true,
      invalid_metadata: dueRequests.filter(item => !validRequestPaths(item)).length,
      scanned: dueRequests.length,
      request_files: dueRequests.reduce((total, item) => total + countPaths(item.request_files), 0),
      request_deliverables: dueRequests.reduce((total, item) => total + countPaths(item.request_deliverables), 0),
      cutoff,
    })
  }

  const failures: Array<{ requestId: string; stage: FailureStage; detail: string }> = []
  let deleted = 0

  const removeStorageObjects = async (
    bucket: string,
    rows: StorageRow[] | null | undefined,
  ) => {
    const paths = (rows || []).map((row) => row.object_path).filter(Boolean)
    for (let offset = 0; offset < paths.length; offset += 500) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 500))
      if (error) return error
    }
    return null
  }

  for (const candidate of dueRequests) {
    const { data: item, error: claimError } = await admin.rpc('claim_retention_request', { p_id: candidate.id })
    if (claimError) {
      failures.push({ requestId: candidate.id, stage: 'database', detail: claimError.message })
      continue
    }
    if (!item) continue
    if (!validRequestPaths(item)) {
      failures.push({ requestId: item.id, stage: 'metadata', detail: 'invalid_storage_metadata' })
      continue
    }
    const deliverableError = await removeStorageObjects(
      'request-deliverables',
      item.request_deliverables,
    )
    if (deliverableError) {
      failures.push({
        requestId: item.id,
        stage: 'request-deliverables',
        detail: deliverableError.message,
      })
      continue
    }

    const requestFileError = await removeStorageObjects(
      'request-files',
      item.request_files,
    )
    if (requestFileError) {
      failures.push({
        requestId: item.id,
        stage: 'request-files',
        detail: requestFileError.message,
      })
      continue
    }

    const { data: finalized, error: deleteError } = await admin.rpc('finish_retention_request', {
      p_id: item.id, p_token: item.token,
    })

    if (deleteError) {
      failures.push({
        requestId: item.id,
        stage: 'database',
        detail: deleteError.message,
      })
      continue
    }

    if (finalized !== true) {
      failures.push({
        requestId: item.id,
        stage: 'database',
        detail: 'no_row_deleted',
      })
      continue
    }

    deleted += 1
  }

  return json({
    scanned: requests?.length || 0,
    deleted,
    failed: failures.length,
    failures,
    cutoff,
  })
})
