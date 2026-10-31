import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, BarChart3, CircleAlert, LoaderCircle, RefreshCw, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { requireSupabase } from "../lib/supabase";
import type { AppRole } from "../lib/supabase";

type Snapshot = {
  mrr: number;
  total_collected: number;
  outstanding: number;
  overdue_amount: number;
  active_count: number;
  paused_count: number;
  cancelled_count: number;
  subscription_count: number;
  customer_count: number;
  monthly_revenue: { month: string; revenue: number }[];
  monthly_customers: { month: string; customers: number }[];
};
const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function AnalyticsPage({ role }: { role: AppRole }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: summaryError } = await requireSupabase().rpc("dashboard_summary", { p_months: 6 });
      if (summaryError) setError(summaryError.message);
      else setSnapshot(data as Snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const values = useMemo(() => {
    const mrr = Number(snapshot?.mrr ?? 0);
    const subscriptionCount = Number(snapshot?.subscription_count ?? 0);
    const cancelled = Number(snapshot?.cancelled_count ?? 0);
    return {
      mrr,
      arr: mrr * 12,
      collected: Number(snapshot?.total_collected ?? 0),
      outstanding: Number(snapshot?.outstanding ?? 0),
      overdue: Number(snapshot?.overdue_amount ?? 0),
      churn: subscriptionCount ? cancelled / subscriptionCount * 100 : 0,
    };
  }, [snapshot]);

  const trend = useMemo(() => {
    return (snapshot?.monthly_revenue ?? []).map((month, index) => ({
      month: month.month,
      collected: Number(month.revenue),
      customers: Number(snapshot?.monthly_customers[index]?.customers ?? 0),
    }));
  }, [snapshot]);

  function exportReport() {
    const rows = [
      ["Metric", "Value"],
      ["Monthly recurring revenue", values.mrr],
      ["Yearly recurring revenue", values.arr],
      ["Collected payments", values.collected],
      ["Outstanding invoices", values.outstanding],
      ["Overdue invoice amount", values.overdue],
      ["Cancelled subscription rate (%)", values.churn.toFixed(1)],
      ["Total customers", Number(snapshot?.customer_count ?? 0)],
      ["Active subscriptions", Number(snapshot?.active_count ?? 0)],
    ].map(row => row.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([rows], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "orbit-finance-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="page-content analytics-page">
    <div className="page-heading"><div><div className="eyebrow">THE BIGGER PICTURE</div><h1>Analytics & reports</h1><p>Real-time insight from your subscriptions, invoices and recorded payments.</p></div><div className="heading-actions"><button className="button button--secondary" onClick={load}><RefreshCw size={15} /> Refresh</button><button className="button button--primary" onClick={exportReport}><ArrowDownToLine size={15} /> Export report</button></div></div>
    {error && <div className="inline-alert inline-alert--error"><CircleAlert size={16} />{error}</div>}
    <div className="analytics-kpis">{[
      { label: "Monthly recurring revenue", value: formatMoney(values.mrr), sub: "Normalized active subscriptions", color: "lavender" },
      { label: "Annual run rate", value: formatMoney(values.arr), sub: "MRR × 12", color: "mint" },
      { label: "Payments collected", value: formatMoney(values.collected), sub: "Successful recorded payments", color: "blue" },
      { label: "Outstanding revenue", value: formatMoney(values.outstanding), sub: `${formatMoney(values.overdue)} overdue`, color: "orange" },
    ].map(item => <article className={`analytics-stat analytics-${item.color}`} key={item.label}><span>{item.label}</span><strong>{loading ? "—" : item.value}</strong><small>{item.sub}</small></article>)}</div>
    <div className="analytics-grid">
      <section className="panel analytics-chart-panel"><div className="panel-heading"><div><div className="eyebrow">GROWTH</div><h2>Revenue & customer growth</h2></div><div className="chart-key"><span><i className="key-revenue" />Revenue collected</span><span><i className="key-customer" />New customers</span></div></div>
        <div className="analytics-chart">{loading ? <div className="chart-loading"><LoaderCircle className="spin" />Loading reports…</div> : <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}><defs><linearGradient id="analyticsRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7761ee" stopOpacity={0.17} /><stop offset="100%" stopColor="#7761ee" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#eeedf3" strokeDasharray="4 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#9694a4" }} /><YAxis yAxisId="money" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9694a4" }} tickFormatter={value => `₹${Math.round(value / 1000)}k`} /><YAxis yAxisId="customers" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#9694a4" }} /><Tooltip formatter={(value, name) => [name === "collected" ? formatMoney(Number(value)) : value, name === "collected" ? "Collected" : "Customers"]} contentStyle={{ borderRadius: 12, border: "1px solid #eeedf3", fontSize: 12 }} /><Area yAxisId="money" type="monotone" dataKey="collected" stroke="#7660e8" strokeWidth={2.5} fill="url(#analyticsRevenue)" /><Area yAxisId="customers" type="monotone" dataKey="customers" stroke="#47b995" strokeWidth={2} fill="transparent" /></AreaChart></ResponsiveContainer>}</div>
      </section>
      <section className="panel health-panel"><div className="panel-heading"><div><div className="eyebrow">RETENTION</div><h2>Subscription health</h2></div><div className="health-icon"><TrendingUp size={16} /></div></div>
        <div className="health-rate">{loading ? "—" : `${(100 - values.churn).toFixed(1)}%`}<span>active retention</span></div><div className="health-meter"><i style={{ width: `${loading ? 0 : Math.max(0, 100 - values.churn)}%` }} /></div>
        <div className="health-line"><span>Active subscriptions</span><strong>{loading ? "—" : Number(snapshot?.active_count ?? 0)}</strong></div><div className="health-line"><span>Paused</span><strong>{loading ? "—" : Number(snapshot?.paused_count ?? 0)}</strong></div><div className="health-line"><span>Cancelled</span><strong className="muted-value">{loading ? "—" : Number(snapshot?.cancelled_count ?? 0)}</strong></div>
      </section>
    </div>
    <div className="analytics-footnote"><BarChart3 size={15} /> Revenue is calculated from successful payment records. Subscription revenue is normalized to a monthly equivalent. <span>Role: {role}</span></div>
  </section>;
}
