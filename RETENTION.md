# الحذف التلقائي بعد 90 يوماً

الملف `supabase/functions/retention-cleanup/index.ts` دالة خادمية تحذف ملفات الطلب أولاً ثم سجل الطلب. لا تضع `SUPABASE_SERVICE_ROLE_KEY` أو `RETENTION_CRON_SECRET` في ملفات الموقع العامة.

## التفعيل بعد النشر

1. طبّق `supabase/security-hardening.sql`.
2. انشر الدالة باسم `retention-cleanup` من Supabase CLI أو لوحة المشروع.
3. أنشئ سراً طويلاً وعشوائياً باسم `RETENTION_CRON_SECRET` ضمن أسرار Edge Functions.
4. شغّل الدالة مرة يومياً بطلب `POST` يحتوي `Authorization: Bearer <secret>` من Supabase Cron أو مجدول موثوق.
5. راقب النتيجة أول أسبوع. تعالج كل مرة 100 طلب كحد أقصى، ويمكن تكرار التشغيل عند وجود دفعة أكبر.

لا تُفعّل الجدولة قبل أخذ نسخة احتياطية تجريبية والتحقق من تاريخ `delete_after` في العرض `admin_retention_queue`.
