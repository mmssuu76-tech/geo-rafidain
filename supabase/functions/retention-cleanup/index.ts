import { createClient } from 'npm:@supabase/supabase-js@2'

type StorageRow = { object_path: string }
type RetentionRequest = {
  id: string
  request_files?: StorageRow[] | null
  request_deliverables?: StorageRow[] | null
}

type FailureStage = 'request-deliverables' | 'request-files' | 'database'

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
  const { data: requests, error: readError } = await admin
    .from('service_requests')
    .select('id,request_files(object_path),request_deliverables(object_path)')
    .eq('status', 'completed')
    .lt('completed_at', cutoff)
    .limit(100)

  if (readError) return json({ error: 'read_failed', detail: readError.message }, 500)

  const dueRequests = (requests || []) as RetentionRequest[]
  if (new URL(request.url).searchParams.getAll('dry_run').includes('1')) {
    const countPaths = (rows: StorageRow[] | null | undefined) =>
      (rows || []).filter((row) => Boolean(row.object_path)).length

    return json({
      dry_run: true,
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
    if (!paths.length) return null
    const { error } = await admin.storage.from(bucket).remove(paths)
    return error
  }

  for (const item of dueRequests) {
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

    const { error: deleteError } = await admin
      .from('service_requests')
      .delete()
      .eq('id', item.id)

    if (deleteError) {
      failures.push({
        requestId: item.id,
        stage: 'database',
        detail: deleteError.message,
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
