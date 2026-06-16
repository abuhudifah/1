-- ============================================================
-- Cleanup: Legacy Offline-Session Auth Artifacts (Phase 6 DB)
-- ============================================================
-- بعد المرحلة 2 (هجرة PIN/المعادلة/البصمة إلى SessionVault المشفّر محليّاً)
-- والمرحلة 6 (تنظيف الكود)، لم يَعُد أي كود JavaScript نشط يشير إلى نظام
-- جلسات الأوفلاين القديم المعتمد على الخادم (offline_sessions + hashing + RPC).
-- المصدر الوحيد لمصادقة الأوفلاين الآن هو SessionVault.
--
-- التحقق المسبق (Pre-flight) — تم قبل كتابة هذا الملف:
--   • offline_sessions موجود.
--   • لا مفاتيح أجنبية واردة (incoming FKs) تشير إليه.
--   • لا Views تعتمد عليه.
--   • Trigger وحيد trg_offline_sessions_updated_at يستدعي الدالة المشتركة
--     handle_updated_at — يُحذف تلقائياً مع DROP TABLE ... CASCADE، بينما تبقى
--     الدالة المشتركة handle_updated_at سليمة (تستخدمها جداول حيّة أخرى).
--
-- ⚠️ خارج النطاق عمداً (لا تُحذف هنا — لا تزال مستخدمة في كود JS نشط):
--   • العمود  users.quick_equation_hash      ← يُقرأ في _fetchUserProfile (كل تسجيل دخول)
--   • الجداول quick_login_tokens / quick_login_temp_passwords / quick_login_rate_limit
--   • الدوال create_quick_login_token / quick_login_with_token / quick_login_restore_password
--   هذه تخدم مسار الدخول السريع بالتوكن (احتياطي للأجهزة غير المُهاجَرة /
--   المتصفّحات بلا WebCrypto). تُحذف لاحقاً بعد إزالة مساراتها من الكود.
--
-- جميع الأوامر Idempotent عبر IF EXISTS.
-- ============================================================

BEGIN;

-- 1) دوال RPC الخاصة بجلسات الأوفلاين القديمة (التوقيعات مطابقة لما في قاعدة البيانات)
DROP FUNCTION IF EXISTS public.create_offline_session(p_user_id uuid, p_device_id text, p_pin_hash text);
DROP FUNCTION IF EXISTS public.verify_offline_session(p_user_id uuid, p_device_id text, p_pin_hash text);
DROP FUNCTION IF EXISTS public.end_offline_session(p_user_id uuid, p_device_id text);

-- 2) جدول جلسات الأوفلاين القديم
--    CASCADE يُزيل سياسات RLS + الفهارس + الـ trigger الخاص بالجدول فقط.
DROP TABLE IF EXISTS public.offline_sessions CASCADE;

COMMIT;

-- ============================================================
-- تحقق ما بعد التنفيذ (يدوي — يجب أن تعود النتائج فارغة):
--   SELECT tablename FROM pg_tables
--     WHERE schemaname='public' AND tablename='offline_sessions';
--   SELECT routine_name FROM information_schema.routines
--     WHERE routine_schema='public'
--       AND routine_name IN ('create_offline_session','verify_offline_session','end_offline_session');
-- ============================================================
