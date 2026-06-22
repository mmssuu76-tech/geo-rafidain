import { createClient } from 'npm:@supabase/supabase-js@2'

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
    .select('id,request_files(object_path)')
    .eq('status', 'completed')
    .lt('completed_at', cutoff)
    .limit(100)

  if (readError) return json({ error: 'read_failed', detail: readError.message }, 500)

  let deleted = 0
  for (const item of requests || []) {
    const paths = (item.request_files || []).map((file: { object_path: string }) => file.object_path)
    if (paths.length) {
      const { error: storageError } = await admin.storage.from('request-files').remove(paths)
      if (storageError) continue
    }
    const { error: deleteError } = await admin.from('service_requests').delete().eq('id', item.id)
    if (!deleteError) deleted += 1
  }

  return json({ scanned: requests?.length || 0, deleted, cutoff })
})

