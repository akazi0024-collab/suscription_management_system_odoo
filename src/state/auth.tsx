import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, requireSupabase, type Profile } from "../lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const client = requireSupabase();
    const { data: { user } } = await client.auth.getUser();
    if (!user) {
      setProfile(null);
      return;
    }
    const { data, error } = await client.from("profiles").select("id, full_name, role, avatar_url").eq("id", user.id).single();
    if (error) throw error;
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const client = requireSupabase();
    client.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) {
        try {
          await refreshProfile();
        } catch (error) {
          console.error("Could not load the signed-in profile.", error);
        }
      }
      setLoading(false);
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setProfile(null);
      else queueMicrotask(() => void refreshProfile());
    });
    return () => subscription.unsubscribe();
  }, [refreshProfile]);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    refreshProfile,
    signOut: async () => {
      const { error } = await requireSupabase().auth.signOut();
      if (error) throw error;
    },
  }), [session, profile, loading, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
