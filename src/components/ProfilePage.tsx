import { FormEvent, useState } from "react";
import { Check, CircleAlert, KeyRound, LoaderCircle, Mail, Save, UserRound } from "lucide-react";
import { requireSupabase } from "../lib/supabase";
import { useAuth } from "../state/auth";

export function ProfilePage() {
  const { profile, user, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("full_name") ?? "").trim();
    const newPassword = String(form.get("password") ?? "");
    try {
      const client = requireSupabase();
      const { error: profileError } = await client.from("profiles").update({ full_name: fullName }).eq("id", user?.id);
      if (profileError) throw profileError;
      if (newPassword) {
        if (newPassword.length <= 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
          throw new Error("New password must be 9+ characters with uppercase, lowercase and a special character.");
        }
        const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
        if (passwordError) throw passwordError;
      }
      await refreshProfile();
      (event.currentTarget as HTMLFormElement).reset();
      setMessage("Profile updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update your profile.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="page-content profile-page"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Profile & settings</h1><p>Manage your personal information and account security.</p></div></div>
    <div className="profile-layout"><div className="profile-card panel"><div className="profile-card-heading"><div className="large-avatar">{(profile?.full_name || user?.email || "O").slice(0, 1).toUpperCase()}</div><div><h2>{profile?.full_name || "Your profile"}</h2><span className="profile-role">{profile?.role ?? "customer"}</span></div></div><form className="profile-form" onSubmit={save}><label className="field"><span>Full name</span><div className="input-icon"><UserRound size={16} /><input name="full_name" defaultValue={profile?.full_name ?? ""} placeholder="Your full name" required /></div></label><label className="field"><span>Email address</span><div className="input-icon input-readonly"><Mail size={16} /><input value={user?.email ?? ""} readOnly /><small>Managed by secure authentication</small></div></label><div className="profile-divider" /><div className="profile-security-label"><KeyRound size={15} /> UPDATE PASSWORD</div><label className="field"><span>New password</span><input type="password" name="password" autoComplete="new-password" minLength={9} placeholder="Leave blank to keep current password" /><small>9+ characters, uppercase, lowercase and special character.</small></label>
      {error && <div className="inline-alert inline-alert--error"><CircleAlert size={15} />{error}</div>}{message && <div className="inline-alert inline-alert--success"><Check size={15} />{message}</div>}<button className="button button--primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />} Save changes</button></form></div><div className="settings-note"><div className="settings-note-icon"><KeyRound size={17} /></div><h3>Your data stays yours.</h3><p>Your profile and business data are protected by Supabase authentication and row-level access policies in your database.</p></div></div>
  </section>;
}
