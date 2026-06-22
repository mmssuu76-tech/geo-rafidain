# إعداد قاعدة البيانات الآمنة

هذه الخطوات مطلوبة مرة واحدة. لا تستخدم بيانات عملاء حقيقية قبل إكمالها كلها.

## 1. إنشاء المشروع

1. أنشئ مشروعاً في [Supabase](https://supabase.com/dashboard).
2. استخدم كلمة مرور قوية وفريدة للمشروع، ولا ترسلها لأي شخص.
3. من **SQL Editor** افتح استعلاماً جديداً.
4. انسخ محتوى [`supabase/schema.sql`](supabase/schema.sql) بالكامل وشغّله.
5. بعد نجاحه انسخ محتوى [`supabase/security-hardening.sql`](supabase/security-hardening.sql) وشغّله مرة واحدة.
6. شغّل [`supabase/admin-workflow.sql`](supabase/admin-workflow.sql) لإضافة السعر ونسبة الإنجاز وموعد التسليم ورسالة المتابعة.
7. شغّل [`supabase/gis-file-formats.sql`](supabase/gis-file-formats.sql) لتفعيل GeoJSON وGeoPackage وملف ZIP لمكونات الشيب فايل.
8. شغّل [`supabase/function-permissions-hardening.sql`](supabase/function-permissions-hardening.sql) أخيراً لنقل دوال الأمان الداخلية خارج مخطط API وإغلاق استدعائها المباشر.

ينشئ الملف الجداول وسياسات RLS وحاوية ملفات خاصة بحجم أقصى 10MB للملف.

## 2. إعداد رابط الدخول بالبريد

تستخدم المنصة رابط الدخول الافتراضي الآمن في Supabase، لذلك لا تحتاج إلى تعديل قالب البريد أو إعداد كلمة مرور للمستخدم.

من **Authentication → URL Configuration** ضع أثناء التشغيل المحلي:

- Site URL: `http://127.0.0.1:8765/`
- Redirect URL: `http://127.0.0.1:8765/**`

عند نشر المنصة، استبدل العنوان المحلي بنطاق HTTPS الحقيقي. يتطلب تخصيص نص الرسالة في الخطة المجانية ربط SMTP خاصاً.

## 3. ربط الواجهة

من **Project Settings → API Keys** انسخ:

- Project URL، مثل `https://xxxx.supabase.co`.
- Publishable key الذي يبدأ بـ `sb_publishable_`.

افتح [`backend-config.js`](backend-config.js) وضع القيمتين:

```js
window.GEO_RAFIDAIN_CONFIG = Object.freeze({
  supabaseUrl: 'https://xxxx.supabase.co',
  publishableKey: 'sb_publishable_xxxx',
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024
});
```

مفتاح Publishable مصمم للواجهة العامة، وتقيّد صلاحياته سياسات RLS. **لا تضع مطلقاً** مفتاحاً يبدأ بـ `sb_secret_` أو مفتاح `service_role` في ملفات المنصة.

## 4. إنشاء حساب المدير

1. انقر مرتين على [`Start-GeoRafidain.cmd`](Start-GeoRafidain.cmd).
2. سجل الدخول ببريدك من زر **تسجيل الدخول**.
3. ارجع إلى SQL Editor وشغّل، بعد استبدال البريد:

```sql
update public.profiles
set role = 'admin'
where email = 'your-email@example.com';
```

4. سجّل الخروج ثم ادخل مجدداً، وافتح لوحة المتابعة.
5. افتح **أمان المدير** من القائمة واربط تطبيق مصادقة TOTP. بعد الربط، تتطلب إجراءات المدير جلسة `aal2`.

## 5. حماية CAPTCHA قبل النشر العام

1. أنشئ Cloudflare Turnstile للمجال المنشور وانسخ **Site Key** و**Secret Key**.
2. في Supabase افتح **Authentication → Bot and Abuse Protection**، فعّل CAPTCHA واختر Turnstile وضع **Secret Key** هناك فقط.
3. ضع **Site Key العام** في `backend-config.js` داخل `captcha.siteKey`.
4. لا تضع Secret Key في أي ملف من ملفات الموقع.

## 6. اختبار الصلاحيات

- أرسل طلباً بحساب عادي وتأكد أنه لا يرى إلا طلبه.
- ادخل بحساب المدير وتأكد أنك ترى جميع الطلبات وتستطيع تغيير الحالة.
- حدّث السعر ونسبة الإنجاز ورسالة المتابعة، ثم افتح الطلب بحساب العميل وتأكد من ظهورها للقراءة فقط.
- فعّل TOTP، ثم تحقق أن لوحة المدير تطلب الرمز في جلسة جديدة.
- حاول إنشاء أكثر من خمسة طلبات في ساعة واحدة وتأكد أن قاعدة البيانات ترفض السادس.
- تحقق من `admin_retention_queue` قبل تفعيل مهمة الحذف الموصوفة في [`RETENTION.md`](RETENTION.md).
- تأكد أن فتح `dashboard.html` مباشرة عبر `file://` يعرض رسالة تمنع الاستخدام.
- لا تشارك بيانات حساسة قبل نشر الموقع عبر HTTPS وتحديد سياسة الخصوصية ومدة الاحتفاظ بالبيانات.

المراجع الرسمية: [سياسات RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)، [الدخول دون كلمة مرور](https://supabase.com/docs/guides/auth/auth-email-passwordless)، [أمان الملفات](https://supabase.com/docs/guides/storage/security/access-control)، [CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha)، [MFA](https://supabase.com/docs/guides/auth/auth-mfa)، [مفاتيح API](https://supabase.com/docs/guides/api/api-keys).
