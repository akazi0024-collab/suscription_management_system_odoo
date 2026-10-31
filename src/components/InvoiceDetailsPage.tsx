import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, CircleAlert, Download, LoaderCircle, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { requireSupabase } from "../lib/supabase";

type Invoice = {
  id: string;
  number: string;
  status: string;
  subtotal: number;
  tax_total: number;
  discount_total: number;
  total: number;
  balance_due: number;
  issue_date: string;
  due_date: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  notes: string | null;
  customers: { display_name: string; email: string; company: string | null } | null;
  invoice_lines: { id: string; description: string; quantity: number; unit_price: number; tax_rate: number; tax_amount: number; discount_amount: number; line_total: number }[];
};
type Payment = { id: string; reference: string; amount: number; payment_method: string; payment_date: string; status: string };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const formatDate = (date: string | null) => date ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date)) : "—";

export function InvoiceDetailsPage() {
  const { invoiceId } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceId) return;
    let active = true;
    const client = requireSupabase();
    Promise.all([
      client.from("invoices").select("*,customers(display_name,email,company),invoice_lines(id,description,quantity,unit_price,tax_rate,tax_amount,discount_amount,line_total)").eq("id", invoiceId).single(),
      client.from("payments").select("id,reference,amount,payment_method,payment_date,status").eq("invoice_id", invoiceId).order("payment_date", { ascending: false }),
    ]).then(([invoiceResult, paymentResult]) => {
      if (!active) return;
      if (invoiceResult.error) setError(invoiceResult.error.message);
      else setInvoice(invoiceResult.data as Invoice);
      if (paymentResult.error) setError(paymentResult.error.message);
      else setPayments((paymentResult.data ?? []) as Payment[]);
      setLoading(false);
    }).catch(caught => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Could not load this invoice.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [invoiceId]);

  if (loading) return <div className="page-content"><div className="table-loading"><LoaderCircle className="spin" size={18} /> Loading invoice…</div></div>;
  if (error || !invoice) return <div className="page-content"><div className="inline-alert inline-alert--error"><CircleAlert size={16} />{error || "Invoice not found."}</div><Link className="back-link" to="/invoices"><ArrowLeft size={14} /> Back to invoices</Link></div>;
  const paid = Math.max(0, Number(invoice.total) - Number(invoice.balance_due));

  return <section className="page-content invoice-detail-page">
    <div className="page-heading invoice-page-heading"><div><Link className="back-link" to="/invoices"><ArrowLeft size={14} /> All invoices</Link><div className="eyebrow">INVOICE DETAILS</div><h1>{invoice.number}</h1><p>Issued {formatDate(invoice.issue_date)} · Due {formatDate(invoice.due_date)}</p></div><div className="heading-actions"><button className="button button--secondary print-action" onClick={() => window.print()}><Printer size={15} /> Print / save PDF</button></div></div>
    <article className="invoice-paper">
      <header className="invoice-paper-header"><div><div className="invoice-brand"><span className="invoice-logo"><i /></span> ORBIT</div><span className="invoice-brand-caption">Every subscription. One intelligent orbit.</span></div><div className="invoice-total-label"><span>INVOICE</span><strong>{invoice.number}</strong><span className={`status-badge status-${invoice.status}`}><i />{invoice.status}</span></div></header>
      <div className="invoice-parties"><div><span className="eyebrow">BILLED TO</span><strong>{invoice.customers?.display_name ?? "Customer"}</strong>{invoice.customers?.company && <span>{invoice.customers.company}</span>}<span>{invoice.customers?.email}</span></div><div><span className="eyebrow">INVOICE DETAILS</span><span>Issued on <strong>{formatDate(invoice.issue_date)}</strong></span><span>Due by <strong>{formatDate(invoice.due_date)}</strong></span>{invoice.billing_period_start && <span>Billing period <strong>{formatDate(invoice.billing_period_start)} – {formatDate(invoice.billing_period_end)}</strong></span>}</div></div>
      <div className="invoice-lines-scroll"><table className="invoice-lines"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Tax</th><th>Amount</th></tr></thead><tbody>{invoice.invoice_lines.map(line => <tr key={line.id}><td><strong>{line.description}</strong>{line.discount_amount > 0 && <small>Discount {money(Number(line.discount_amount))}</small>}</td><td>{Number(line.quantity).toLocaleString("en-IN")}</td><td>{money(Number(line.unit_price))}</td><td>{Number(line.tax_rate)}% <small>{money(Number(line.tax_amount))}</small></td><td>{money(Number(line.line_total))}</td></tr>)}</tbody></table></div>
      <div className="invoice-total-section"><div className="invoice-note">{invoice.notes && <><span className="eyebrow">NOTE</span><p>{invoice.notes}</p></>}</div><div className="invoice-totals"><div><span>Subtotal</span><strong>{money(Number(invoice.subtotal))}</strong></div><div><span>Tax</span><strong>{money(Number(invoice.tax_total))}</strong></div>{Number(invoice.discount_total) > 0 && <div><span>Discount</span><strong>−{money(Number(invoice.discount_total))}</strong></div>}<div className="invoice-grand-total"><span>Total</span><strong>{money(Number(invoice.total))}</strong></div><div><span>Paid</span><strong>{money(paid)}</strong></div><div className="invoice-balance"><span>Balance due</span><strong>{money(Number(invoice.balance_due))}</strong></div></div></div>
      <footer className="invoice-paper-footer"><span>Thank you for your business.</span><span>Payment is recorded by your ORBIT workspace administrator.</span></footer>
    </article>
    {payments.length > 0 && <section className="panel invoice-payment-history"><div className="panel-heading"><div><div className="eyebrow">PAYMENT HISTORY</div><h2>Payments against this invoice</h2></div></div>{payments.map(payment => <div key={payment.id} className="invoice-payment-row"><div><strong>{payment.reference}</strong><span>{formatDate(payment.payment_date)} · {payment.payment_method.replaceAll("_", " ")}</span></div><strong>{money(Number(payment.amount))}</strong><span className={`status-badge status-${payment.status}`}><i />{payment.status}</span></div>)}</section>}
    <div className="invoice-detail-foot"><span><Download size={13} /> Use “Print / save PDF” to download a copy.</span><Link to="/payments">Payment ledger <ArrowUpRight size={13} /></Link></div>
  </section>;
}
