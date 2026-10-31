import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, BarChart3, CircleAlert, LoaderCircle, RefreshCw, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { requireSupabase } from "../lib/supabase";
import type { AppRole } from "../lib/supabase";

type Snapshot = {
  subscriptions: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  customers: Record<string, unknown>[];
};
const formatMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function AnalyticsPage({ role }: { role: AppRole }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ subscriptions: [], payments: [], invoices: [], customers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const client = requireSupabase();
    const [subscriptions, payments, invoices, customers] = await Promise.all([
      client.from("subscriptions").select("id,status,total,billing_cycle,created_at"),
      client.from("payments").select("amount,status,payment_date"),
      client.from("invoices").select("total,balance_due,status,due_date"),
      client.from("customers").select("id,created_at"),
    ]);
    const failure = subscriptions.error ?? payments.error ?? invoices.error ?? customers.error;
    if (failure) setError(failure.message);
    else setSnapshot({ subscriptions: subscriptions.data ?? [], payments: payments.data ?? [], invoices: invoices.data ?? [], customers: customers.data ?? [] });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const values = useMemo(() => {
    const active = snapshot.subscriptions.filter(item => item.status === "active");
    const mrr = active.reduce((sum, item) => {
      const amount = Number(item.total ?? 0);
      const billing = String(item.billing_cycle ?? "monthly");
      return sum + (billing === "yearly" ? amount / 12 : billing === "weekly" ? amount * 4.345 : billing === "daily" ? amount * 30 : amount);
    }, 0);
    const collected = snapshot.payments.filter(item => item.status === "succeeded").reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
    const open = snapshot.invoices.filter(item => ["confirmed", "overdue"].includes(String(item.status)));
    const outstanding = open.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0);
    const overdue = open.filter(item => item.status === "overdue" || (item.due_date && new Date(String(item.due_date)) < new Date()));
    return { mrr, arr: mrr * 12, collected, outstanding, overdue: overdue.reduce((sum, item) => sum + Number(item.balance_due ?? 0), 0), churn: snapshot.subscriptions.length ? snapshot.subscriptions.filter(item => item.status === "cancelled").length / snapshot.subscriptions.length * 100 : 0 };
  }, [snapshot]);

  const trend = useMemo(() => {
    const dates = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - (5 - index));
      return { key: `${date.getFullYear()}-${date.getMonth()}`, month: new Intl.DateTimeFormat("en", { month: "short" }).format(date), collected: 0, customers: 0 };
    });
    const byKey = new Map(dates.map(item => [item.key, item]));
    for (const payment of snapshot.payments) {
      if (payment.status !== "succeeded" || !payment.payment_date) continue;
      const date = new Date(String(payment.payment_date));
      byKey.get(`${date.getFullYear()}-${date.getMonth()}`)!.collected += Number(payment.amount ?? 0);
    }
    for (const customer of snapshot.customers) {
      if (!customer.created_at) continue;
      const date = new Date(String(customer.created_at));
      const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
      if (bucket) bucket.customers += 1;
    }
    return dates;
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
      ["Total customers", snapshot.customers.length],
      ["Active subscriptions", snapshot.subscriptions.filter(item => item.status === "active").length],
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
        <div className="health-line"><span>Active subscriptions</span><strong>{loading ? "—" : snapshot.subscriptions.filter(item => item.status === "active").length}</strong></div><div className="health-line"><span>Paused</span><strong>{loading ? "—" : snapshot.subscriptions.filter(item => item.status === "paused").length}</strong></div><div className="health-line"><span>Cancelled</span><strong className="muted-value">{loading ? "—" : snapshot.subscriptions.filter(item => item.status === "cancelled").length}</strong></div>
      </section>
    </div>
    <div className="analytics-footnote"><BarChart3 size={15} /> Revenue is calculated from successful payment records. Subscription revenue is normalized to a monthly equivalent. <span>Role: {role}</span></div>
  </section>;
}
