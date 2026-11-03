import { createClient } from '@supabase/supabase-js';

// service role 키를 쓰므로 서버(API 라우트, 워커)에서만 import 하세요.
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}
