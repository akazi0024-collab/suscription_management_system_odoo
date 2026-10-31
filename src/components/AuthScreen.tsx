import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, Orbit, Sparkles } from "lucide-react";
import { isLocalDemoMode, isLocalDemoModeRequested, localDemoCredentials, requireSupabase } from "../lib/supabase";
import { useAuth } from "../state/auth";

type AuthMode = "login" | "register" | "reset" | "update";

export function AuthScreen({ initialMode = "login" }: { initialMode?: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { refreshProfile } = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const fullName = String(form.get("name") ?? "").trim();
    try {
      const client = requireSupabase();
      if (mode === "reset") {
        const { error: authError } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (authError) throw authError;
        setMessage("Password reset link sent. Check your inbox.");
      } else if (mode === "register") {
        if (password.length <= 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          throw new Error("Use at least 9 characters with an uppercase letter, a lowercase letter, and a special character.");
        }
        const { error: authError } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName, role: "customer" } } });
        if (authError) throw authError;
        setMessage("Account created. Verify your email to sign in.");
        setMode("login");
      } else if (mode === "update") {
        if (password.length <= 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          throw new Error("Use at least 9 characters with an uppercase letter, a lowercase letter, and a special character.");
        }
        const { error: authError } = await client.auth.updateUser({ password });
        if (authError) throw authError;
        window.history.replaceState({}, "", "/");
        setMessage("Password updated. Your account is ready.");
        setMode("login");
      } else {
        if (isLocalDemoModeRequested && !isLocalDemoMode) {
          throw new Error("Local demo sign-in is only available when Supabase runs on this computer.");
        }
        const credentials = isLocalDemoMode
          ? localDemoCredentials
          : { email, password };
        const { error: authError } = await client.auth.signInWithPassword(credentials);
        if (authError) throw authError;
        await refreshProfile();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <div className="brand-lockup brand-lockup--light"><div className="orbit-mark"><i /><b /></div><span>ORBIT</span></div>
        <div className="showcase-orbit"><div className="showcase-ring ring-one" /><div className="showcase-ring ring-two" /><div className="showcase-ring ring-three" /><div className="showcase-core"><Orbit size={31} strokeWidth={1.4} /></div><span className="orbit-node node-a" /><span className="orbit-node node-b" /><span className="orbit-node node-c" /></div>
        <div className="showcase-bottom"><span className="showcase-label"><Sparkles size={14} /> SUBSCRIPTION INTELLIGENCE</span><h2>Everything<br />in its orbit.</h2><p>One clear view of your recurring revenue, customer relationships and what comes next.</p><div className="showcase-dots"><i /><i /><i /></div></div>
      </section>
      <section className="auth-workspace">
        <div className="auth-topline"><span>Every subscription. One intelligent orbit.</span><span className="secure-label"><LockKeyhole size={13} /> SECURE WORKSPACE</span></div>
        <div className="auth-form-wrap">
          <div className="auth-kicker">WELCOME {mode === "register" ? "ABOARD" : "BACK"}</div>
          <h1>{mode === "login" ? "Sign in to ORBIT" : mode === "register" ? "Create your account" : mode === "update" ? "Choose a new password" : "Reset your password"}</h1>
          <p className="auth-subtitle">{mode === "login" ? "Your business, beautifully in sync." : mode === "register" ? "Start managing your subscriptions in one place." : mode === "update" ? "Set a new password to secure your account." : "We’ll send you a secure password reset link."}</p>
          <form onSubmit={submit} className="auth-form">
            {mode !== "update" && <label className="field"><span>Email address</span><div className="input-icon"><Mail size={17} /><input type="email" name="email" autoComplete="email" placeholder="you@company.com" defaultValue={mode === "login" && isLocalDemoMode ? localDemoCredentials.email : undefined} readOnly={mode === "login" && isLocalDemoMode} required /></div></label>}
            {mode !== "reset" && <label className="field"><span>{mode === "update" ? "New password" : "Password"}</span><div className="input-icon"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "update" ? "Choose a new password" : "Enter your password"} required minLength={mode === "register" || mode === "update" ? 9 : undefined} /><button type="button" className="icon-button password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{(mode === "register" || mode === "update") && <small>9+ characters, including uppercase, lowercase and a special character.</small>}</label>}
            {error && <div className="inline-alert inline-alert--error" role="alert">{error}</div>}
            {message && <div className="inline-alert inline-alert--success" role="status">{message}</div>}
            <button type="submit" className="button button--primary auth-submit" disabled={busy}>{busy ? <span className="spinner" /> : <>{mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "update" ? "Update password" : "Send reset link"}<ArrowRight size={16} /></>}</button>
          </form>
          <div className="auth-links">
            {mode === "login" && <button onClick={() => { setMessage(""); setError(""); setMode("reset"); }}>Forgot password?</button>}
            {mode === "reset" && <button onClick={() => { setMessage(""); setError(""); setMode("login"); }}>Back to sign in</button>}
            {mode === "login" && <p>New to ORBIT? <button onClick={() => { setMessage(""); setError(""); setMode("register"); }}>Create an account</button></p>}
            {mode === "register" && <p>Already have an account? <button onClick={() => { setMessage(""); setError(""); setMode("login"); }}>Sign in</button></p>}
          </div>
          {mode === "login" && isLocalDemoMode && <p className="customer-only-note">Local demo workspace: enter any non-empty password to continue.</p>}
          {mode === "register" && <p className="customer-only-note">New sign-ups start with a customer account. Staff accounts are created by an administrator.</p>}
        </div>
        <div className="auth-footer"><span>© 2026 ORBIT</span><span>Built for recurring relationships</span></div>
      </section>
    </main>
  );
}
