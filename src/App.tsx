import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./state/auth";
import { isSupabaseConfigured } from "./lib/supabase";
import { AuthScreen } from "./components/AuthScreen";
import { OrbitApp } from "./components/OrbitApp";
import { SetupScreen } from "./components/SetupScreen";

export default function App() {
  const { user, loading } = useAuth();

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (loading) return <div className="boot-screen"><div className="orbit-mark orbit-mark--large"><i /><b /></div><span>Opening your orbit…</span></div>;
  if (window.location.pathname === "/reset-password") return <AuthScreen initialMode="update" />;
  if (!user) return <AuthScreen />;

  return (
    <Routes>
      <Route path="/*" element={<OrbitApp />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
