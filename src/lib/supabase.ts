import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null;

export type AppRole = "admin" | "staff" | "customer";

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  avatar_url: string | null;
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Connect a Supabase project to use ORBIT. Add the URL and anon key to .env.local.");
  }
  return supabase;
}
