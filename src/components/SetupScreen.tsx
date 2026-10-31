import { ArrowUpRight, CircleCheck, CircleDot, Database, KeyRound, ShieldCheck } from "lucide-react";

export function SetupScreen() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand-lockup"><div className="orbit-mark"><i /><b /></div><span>ORBIT</span></div>
        <div className="setup-eyebrow"><CircleDot size={13} /> YOUR WORKSPACE IS READY</div>
        <h1>Connect your orbit.</h1>
        <p className="setup-copy">ORBIT runs on your Supabase project, so your customer, subscription and billing data stays in your own database.</p>
        <div className="setup-steps">
          <div className="setup-step"><span className="step-number">01</span><div><strong>Create a Supabase project</strong><small>Use the project URL and anon key from Project Settings → API.</small></div><Database size={18} /></div>
          <div className="setup-step"><span className="step-number">02</span><div><strong>Add your environment keys</strong><small>Copy <code>.env.example</code> to <code>.env.local</code> and fill in both values.</small></div><KeyRound size={18} /></div>
          <div className="setup-step"><span className="step-number">03</span><div><strong>Apply the database migration</strong><small>Run <code>supabase/migrations/20261031000000_orbit.sql</code> in the Supabase SQL editor.</small></div><ShieldCheck size={18} /></div>
        </div>
        <div className="setup-foot"><CircleCheck size={16} /><span>Your app is ready to connect. No demo records or secret keys are bundled.</span></div>
        <a className="setup-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard <ArrowUpRight size={15} /></a>
      </div>
      <span className="setup-tagline">Every subscription. One intelligent orbit.</span>
    </main>
  );
}
