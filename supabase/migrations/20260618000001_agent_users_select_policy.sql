-- FIX: المندوب لا يرى المستخدمين في قائمة التحويل وطلب الأموال
-- السبب: سياسات RLS على جدول users كانت تسمح للمندوب برؤية سجله فقط
--        (users_select_own)، فيُعيد AppStore.getState('users') مصفوفة
--        بمستخدم واحد، وتبقى قائمة التحويل فارغة رغم وجود allowed_users.
--
-- مقارنة السياسات قبل الإصلاح:
--   bank_accounts → agent_select_all (يرى الكل → JS يفلتر بـ allowed_banks) ✅
--   companies     → qual:true (يرى الكل → JS يفلتر بـ allowed_companies)    ✅
--   users         → select_own فقط (يرى نفسه فقط → قائمة التحويل فارغة)    ❌

-- دالة SECURITY DEFINER لتجنب التعاود (recursive RLS)
CREATE OR REPLACE FUNCTION agent_can_see_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users me
    WHERE me.id = auth.uid()
      AND me.role = 'agent'
      AND me.is_active = true
      AND (
        me.allowed_users IS NULL                      -- لا قيد → يرى الجميع
        OR target_user_id::text = ANY(me.allowed_users)  -- في قائمة المسموحين
      )
  );
$$;

DROP POLICY IF EXISTS users_select_agent_allowed ON public.users;

CREATE POLICY users_select_agent_allowed
ON public.users
FOR SELECT
USING (
  agent_can_see_user(id)
);
