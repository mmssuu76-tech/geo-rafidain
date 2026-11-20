create or replace function private.admin_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  -- يشترط جلسة AAL2 دائماً: لا يُسمح لمدير بلا TOTP مؤكد بتجاوز الشرط.
  select coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2';
$function$;
