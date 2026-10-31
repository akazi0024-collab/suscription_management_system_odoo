import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, CircleAlert, Clock3, CreditCard, Download, LoaderCircle, Plus, RefreshCw, Sparkles, Users, WalletCards } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { callFunction } from "../lib/data";
import { requireSupabase } from "../lib/supabase";
import type { AppRole } from "../lib/supabase";

type DashboardData = {
  customers: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
};

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: value > 999999 ? "compact" : "standard", maximumFractionDigits: 0 }).format(value);

function monthStart(monthsAgo: number) {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  date.setMonth(date.getMonth() - monthsAgo);
  return date;
}

export function Dashboard({ role }: { role: AppRole }) {
  const [data, setData] = useState<DashboardData>({ customers: [], subscriptions: [], invoices: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(6);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const client = requireSupabase();
    const [customers, subscriptions, invoices, payments] = await Promise.all([
      client.from("customers").select("id,display_name,email,created_at").order("created_at", { ascending: false }).limit(50),
      client.from("subscriptions").select("id,number,status,total,billing_cycle,next_billing_date,created_at").order("created_at", { ascending: false }).limit(500),
      client.from("invoices").select("id,number,status,total,balance_due,due_date,created_at,customer_id,customers(display_name)").order("created_at", { ascending: false }).limit(500),
      client.from("payments").select("id,reference,amount,status,payment_date,invoice_id,customer_id,invoices(number),customers(display_name)").order("payment_date", { ascending: false }).limit(500),
    ]);
    const failure = customers.error ?? subscriptions.error ?? invoices.error ?? payments.error;
    if (failure) {
      setError(failure.message);
    } else {
      setData({ customers: customers.data ?? [], subscriptions: subscriptions.data ?? [], invoices: invoices.data ?? [], payments: payments.data ?? [] });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const calculated = useMemo(() => {
    const active = data.subscriptions.filter(item => item.status === "active");
    const mrr = active.reduce((sum, item) => {
      const amount = Number(item.total ?? 0);
      const cycle = String(item.billing_cycle ?? "monthly");
      return sum + (cycle === "yearly" ? amount / 12 : cycle === "weekly" ? amount * 4.345 : cycle === "daily" ? amount * 30 : amount);
    }, 0);
    const totalRevenue = data.payments.filter(item => item.status === "succeeded").reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const outstanding = data.invoices.filter(item => ["confirmed", "overdue"].includes(String(item.status))).reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0);
    const overdue = data.invoices.filter(item => item.status === "overdue" || (item.status === "confirmed" && item.due_date && new Date(String(item.due_date)) < new Date()));
    return { active, mrr, totalRevenue, outstanding, overdue, overdueAmount: overdue.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0) };
  }, [data]);

  const chartData = useMemo(() => {
    const start = monthStart(range - 1);
    const buckets = Array.from({ length: range }, (_, index) => {
      const date = monthStart(range - index - 1);
      return { key: `${date.getFullYear()}-${date.getMonth()}`, month: new Intl.DateTimeFormat("en", { month: "short" }).format(date), revenue: 0 };
    });
    const map = new Map(buckets.map(item => [item.key, item]));
    for (const payment of data.payments) {
      if (payment.status !== "succeeded" || !payment.payment_date) continue;
      const date = new Date(String(payment.payment_date));
      if (date < start) continue;
      const bucket = map.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (bucket) bucket.revenue += Number(payment.amount ?? 0);
    }
    return buckets;
  }, [data.payments, range]);

  async function triggerBilling() {
    setRunning(true);
    setNotice("");
    try {
      const result = await callFunction<{ generated?: number; message?: string }>("run-billing", { source: "dashboard" });
      setNotice(result.message ?? `${result.generated ?? 0} invoices generated`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Billing run failed.");
    } finally {
      setRunning(false);
      window.setTimeout(() => setNotice(""), 5000);
    }
  }

  const kpis = [
    { label: "Total collected", value: money(calculated.totalRevenue), note: "Across recorded payments", icon: WalletCards, color: "lavender" },
    { label: "Monthly recurring", value: money(calculated.mrr), note: "Normalized active plans", icon: RefreshCw, color: "mint" },
    { label: "Active subscriptions", value: calculated.active.length.toLocaleString("en-IN"), note: `${data.subscriptions.filter(item => item.status === "paused").length} currently paused`, icon: Activity, color: "blue" },
    { label: "Customers", value: data.customers.length.toLocaleString("en-IN"), note: "In your workspace", icon: Users, color: "orange" },
  ];

  return (
    <section className="page-content dashboard-page">
      <div className="page-heading dashboard-heading"><div><div className="eyebrow"><Sparkles size={12} /> YOUR BUSINESS, IN ORBIT</div><h1>Good morning<span className="heading-period">.</span></h1><p>Here’s what’s happening across your subscriptions today.</p></div><div className="heading-actions"><div className="date-range"><CalendarDays size={15} /><select aria-label="Revenue chart period" value={range} onChange={event => setRange(Number(event.target.value))}><option value={6}>Last 6 months</option><option value={3}>Last 3 months</option><option value={12}>Last 12 months</option></select></div>{role !== "customer" && <button className="button button--primary" onClick={triggerBilling} disabled={running}>{running ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{running ? "Running…" : "Run billing"}</button>}</div></div>
      {error && <div className="inline-alert inline-alert--error"><CircleAlert size={16} />{error}<button className="text-button" onClick={load}>Try again</button></div>}
      {notice && <div className="inline-alert inline-alert--success"><Check size={16} />{notice}</div>}
      <div className="kpi-grid">{kpis.map((item, index) => <article key={item.label} className={`kpi-card kpi-${item.color}`} style={{ animationDelay: `${index * 70}ms` }}><div className="kpi-top"><span>{item.label}</span><div className="kpi-icon"><item.icon size={16} strokeWidth={1.8} /></div></div><div className="kpi-value">{loading ? <span className="skeleton-line" /> : item.value}</div><div className="kpi-note"><span className="kpi-note-dot" />{item.note}</div></article>)}</div>
      <div className="dashboard-grid">
        <section className="panel revenue-panel"><div className="panel-heading"><div><div className="eyebrow">CASH FLOW</div><h2>Revenue over time</h2></div><button className="icon-button" aria-label="Reload revenue chart" onClick={load}><RefreshCw size={15} /></button></div><div className="chart-total">{money(chartData.reduce((sum, item) => sum + item.revenue, 0))}<span> collected in selected period</span></div>
          <div className="revenue-chart">{loading ? <div className="chart-loading"><span className="spinner" />Building your revenue picture…</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}><defs><linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7761ee" stopOpacity={0.19} /><stop offset="100%" stopColor="#7761ee" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#eeedf3" strokeDasharray="4 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9694a4" }} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9694a4" }} tickFormatter={value => value >= 1000 ? `₹${Math.round(value / 1000)}k` : `₹${value}`} /><Tooltip formatter={(value) => [money(Number(value)), "Collected"]} contentStyle={{ borderRadius: 12, border: "1px solid #eeedf3", boxShadow: "0 8px 24px #24203c12", fontSize: 12 }} labelStyle={{ color: "#777485", marginBottom: 4 }} /><Area type="monotone" dataKey="revenue" stroke="#7660e8" strokeWidth={2.5} fill="url(#revenueGradient)" activeDot={{ r: 5, fill: "#7660e8", stroke: "white", strokeWidth: 3 }} /></AreaChart></ResponsiveContainer>}</div>
          <div className="chart-legend"><span><i />Payments received</span><span className="chart-source">From recorded payments</span></div>
        </section>
        <section className="panel orbit-panel"><div className="panel-heading"><div><div className="eyebrow">SUBSCRIPTION HEALTH</div><h2>Your orbit</h2></div><button className="link-button" onClick={() => window.location.assign("/subscriptions")}>View all <ArrowRight size={14} /></button></div>
          <div className="orbit-visual"><div className="orbit-ring orbit-ring--outer" /><div className="orbit-ring orbit-ring--middle" /><div className="orbit-ring orbit-ring--inner" /><div className="orbit-point orbit-point--one" /><div className="orbit-point orbit-point--two" /><div className="orbit-point orbit-point--three" /><div className="orbit-center"><strong>{loading ? "—" : calculated.active.length}</strong><span>ACTIVE</span></div></div>
          <div className="orbit-legend"><div><span className="legend-dot dot-active" /><span>Active</span><strong>{loading ? "—" : calculated.active.length}</strong></div><div><span className="legend-dot dot-paused" /><span>Paused</span><strong>{loading ? "—" : data.subscriptions.filter(item => item.status === "paused").length}</strong></div><div><span className="legend-dot dot-cancelled" /><span>Cancelled</span><strong>{loading ? "—" : data.subscriptions.filter(item => item.status === "cancelled").length}</strong></div></div>
        </section>
      </div>
      <div className="dashboard-grid dashboard-grid--lower">
        <section className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>Latest payments</h2></div><a className="link-button" href="/payments">All payments <ArrowRight size={14} /></a></div>
          {loading ? <div className="list-loading"><span className="spinner" />Loading payment activity…</div> : data.payments.length === 0 ? <EmptyDashboard title="Your first payment is waiting" copy="Recorded payments will appear here as soon as they land." /> : <div className="activity-list">{data.payments.slice(0, 5).map(payment => {
            const customer = payment.customers as { display_name?: string } | null;
            const invoice = payment.invoices as { number?: string } | null;
            return <div className="activity-row" key={String(payment.id)}><div className="activity-avatar">{String(customer?.display_name ?? "O").slice(0, 1).toUpperCase()}</div><div className="activity-name"><strong>{customer?.display_name ?? "Customer payment"}</strong><span>{invoice?.number ?? String(payment.reference ?? "Invoice payment")}</span></div><div className="activity-date">{new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(String(payment.payment_date)))}</div><div className="activity-amount">{money(Number(payment.amount ?? 0))}</div><span className={`status-badge status-${String(payment.status ?? "pending")}`}><i />{String(payment.status ?? "pending")}</span></div>;
          })}</div>}
        </section>
        <section className="panel attention-panel"><div className="panel-heading"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Outstanding</h2></div><div className="attention-icon"><Clock3 size={16} /></div></div><div className="attention-total">{money(calculated.outstanding)}</div><p className="attention-caption">across {data.invoices.filter(item => ["confirmed", "overdue"].includes(String(item.status))).length} unpaid invoices</p>
          <div className="attention-divider" /><div className="attention-row"><span><span className="warning-dot" />Overdue invoices</span><strong className="attention-warning">{calculated.overdue.length}</strong></div><div className="attention-row"><span><span className="warning-dot warning-dot--soft" />Overdue amount</span><strong>{money(calculated.overdueAmount)}</strong></div>
          <a className="attention-link" href="/invoices">Review invoices <ArrowRight size={14} /></a>
        </section>
      </div>
      <div className="dashboard-bottom-note"><span><Download size={13} /> Your data, your database</span><span>Revenue reflects recorded successful payments · All figures use live workspace records</span></div>
    </section>
  );
}

function EmptyDashboard({ title, copy }: { title: string; copy: string }) {
  return <div className="dashboard-empty"><div className="empty-icon"><CreditCard size={17} /></div><strong>{title}</strong><span>{copy}</span></div>;
}
