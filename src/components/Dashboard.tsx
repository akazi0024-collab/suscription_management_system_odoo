import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, CalendarDays, Check, CircleAlert, Clock3, CreditCard, Download, LoaderCircle, RefreshCw, Sparkles, Users, WalletCards } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { callFunction } from "../lib/data";
import { requireSupabase } from "../lib/supabase";
import type { AppRole } from "../lib/supabase";

type DashboardSummary = {
  total_collected: number;
  mrr: number;
  active_count: number;
  paused_count: number;
  cancelled_count: number;
  subscription_count: number;
  customer_count: number;
  outstanding: number;
  outstanding_count: number;
  overdue_count: number;
  overdue_amount: number;
  monthly_revenue: { month: string; revenue: number }[];
  recent_payments: { id: string; reference: string; amount: number; status: string; payment_date: string; customer_name: string | null; invoice_number: string | null }[];
};

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: value > 999999 ? "compact" : "standard", maximumFractionDigits: 0 }).format(value);

export function Dashboard({ role }: { role: AppRole }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(6);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: summary, error: summaryError } = await requireSupabase().rpc("dashboard_summary", { p_months: range });
      if (summaryError) setError(summaryError.message);
      else setData(summary as DashboardSummary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const calculated = useMemo(() => {
    return {
      activeCount: Number(data?.active_count ?? 0),
      pausedCount: Number(data?.paused_count ?? 0),
      cancelledCount: Number(data?.cancelled_count ?? 0),
      totalCollected: Number(data?.total_collected ?? 0),
      mrr: Number(data?.mrr ?? 0),
      outstanding: Number(data?.outstanding ?? 0),
      outstandingCount: Number(data?.outstanding_count ?? 0),
      overdueCount: Number(data?.overdue_count ?? 0),
      overdueAmount: Number(data?.overdue_amount ?? 0),
      customerCount: Number(data?.customer_count ?? 0),
      subscriptionCount: Number(data?.subscription_count ?? 0),
    };
  }, [data]);

  const chartData = data?.monthly_revenue ?? [];

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
    { label: "Total collected", value: money(calculated.totalCollected), note: "Across recorded payments", icon: WalletCards, color: "lavender" },
    { label: "Monthly recurring", value: money(calculated.mrr), note: "Normalized active plans", icon: RefreshCw, color: "mint" },
    { label: "Active subscriptions", value: calculated.activeCount.toLocaleString("en-IN"), note: `${calculated.pausedCount} currently paused`, icon: Activity, color: "blue" },
    { label: "Customers", value: calculated.customerCount.toLocaleString("en-IN"), note: "In your workspace", icon: Users, color: "orange" },
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
        <section className="panel orbit-panel"><div className="panel-heading"><div><div className="eyebrow">SUBSCRIPTION HEALTH</div><h2>Your orbit</h2></div><Link className="link-button" to="/subscriptions">View all <ArrowRight size={14} /></Link></div>
          <div className="orbit-visual"><div className="orbit-ring orbit-ring--outer" /><div className="orbit-ring orbit-ring--middle" /><div className="orbit-ring orbit-ring--inner" /><div className="orbit-point orbit-point--one" /><div className="orbit-point orbit-point--two" /><div className="orbit-point orbit-point--three" /><div className="orbit-center"><strong>{loading ? "—" : calculated.activeCount}</strong><span>ACTIVE</span></div></div>
          <div className="orbit-legend"><div><span className="legend-dot dot-active" /><span>Active</span><strong>{loading ? "—" : calculated.activeCount}</strong></div><div><span className="legend-dot dot-paused" /><span>Paused</span><strong>{loading ? "—" : calculated.pausedCount}</strong></div><div><span className="legend-dot dot-cancelled" /><span>Cancelled</span><strong>{loading ? "—" : calculated.cancelledCount}</strong></div></div>
        </section>
      </div>
      <div className="dashboard-grid dashboard-grid--lower">
        <section className="panel activity-panel"><div className="panel-heading"><div><div className="eyebrow">RECENT ACTIVITY</div><h2>Latest payments</h2></div><Link className="link-button" to="/payments">All payments <ArrowRight size={14} /></Link></div>
          {loading ? <div className="list-loading"><span className="spinner" />Loading payment activity…</div> : !data?.recent_payments.length ? <EmptyDashboard title="Your first payment is waiting" copy="Recorded payments will appear here as soon as they land." /> : <div className="activity-list">{data.recent_payments.map(payment => <div className="activity-row" key={payment.id}><div className="activity-avatar">{String(payment.customer_name ?? "O").slice(0, 1).toUpperCase()}</div><div className="activity-name"><strong>{payment.customer_name ?? "Customer payment"}</strong><span>{payment.invoice_number ?? payment.reference}</span></div><div className="activity-date">{new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(payment.payment_date))}</div><div className="activity-amount">{money(Number(payment.amount ?? 0))}</div><span className={`status-badge status-${payment.status}`}><i />{payment.status}</span></div>)}</div>}
        </section>
        <section className="panel attention-panel"><div className="panel-heading"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Outstanding</h2></div><div className="attention-icon"><Clock3 size={16} /></div></div><div className="attention-total">{money(calculated.outstanding)}</div><p className="attention-caption">across {calculated.outstandingCount} unpaid invoices</p>
          <div className="attention-divider" /><div className="attention-row"><span><span className="warning-dot" />Overdue invoices</span><strong className="attention-warning">{calculated.overdueCount}</strong></div><div className="attention-row"><span><span className="warning-dot warning-dot--soft" />Overdue amount</span><strong>{money(calculated.overdueAmount)}</strong></div>
          <Link className="attention-link" to="/invoices">Review invoices <ArrowRight size={14} /></Link>
        </section>
      </div>
      <div className="dashboard-bottom-note"><span><Download size={13} /> Your data, your database</span><span>Revenue reflects recorded successful payments · All figures use live workspace records</span></div>
    </section>
  );
}

function EmptyDashboard({ title, copy }: { title: string; copy: string }) {
  return <div className="dashboard-empty"><div className="empty-icon"><CreditCard size={17} /></div><strong>{title}</strong><span>{copy}</span></div>;
}
