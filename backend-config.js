// إعدادات الاتصال العامة فقط. المفتاح القابل للنشر ليس مفتاحاً سرياً؛
// الحماية الفعلية تأتي من سياسات RLS الموجودة في supabase/schema.sql.
// لا تضع هنا أبداً sb_secret أو service_role.
window.GEO_RAFIDAIN_CONFIG = Object.freeze({
  supabaseUrl: 'https://nrvewrdwmonlzamsvdjm.supabase.co',
  publishableKey: 'sb_publishable_V5RIgqYhCYmQ78kv6DYpFg_P44XwS3D',
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024,
  // أضف Site Key العام هنا بعد تفعيل Cloudflare Turnstile في Supabase.
  // اتركه فارغاً أثناء التشغيل المحلي؛ المفتاح السري يبقى في Supabase فقط.
  captcha: Object.freeze({ provider: 'turnstile', siteKey: '' })
});
