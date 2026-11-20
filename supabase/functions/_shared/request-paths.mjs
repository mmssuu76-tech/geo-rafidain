/** Validate all stored references before a privileged operation uses either bucket. */
export function validRequestPaths(request) {
  const validRows = rows => Array.isArray(rows) && rows.every(row => {
    if (typeof row?.object_path !== 'string') return false;
    const [owner, requestId, file, ...extra] = row.object_path.split('/');
    return owner === request.user_id && requestId === request.id &&
      extra.length === 0 && /^[a-z0-9_-][a-z0-9._-]*$/i.test(file ?? '');
  });
  return Boolean(request.user_id && request.id) &&
    validRows(request.request_files) && validRows(request.request_deliverables);
}
