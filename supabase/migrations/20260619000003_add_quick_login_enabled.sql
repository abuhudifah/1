-- ============================================================
-- Migration: add_quick_login_enabled
-- إضافة عمود boolean لحالة الدخول السريع
-- السبب: إخفاء quick_equation_hash عن طلبات الشبكة (AUTH-001)
--        الهاش لا يغادر الخادم للمدير — فقط حقل enabled/disabled
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS quick_login_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.users
  SET quick_login_enabled = (quick_equation_hash IS NOT NULL)
  WHERE quick_login_enabled = FALSE AND quick_equation_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_quick_login_enabled
  ON public.users (quick_login_enabled)
  WHERE quick_login_enabled = TRUE;
