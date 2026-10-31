import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowDownToLine, ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, MoreHorizontal, Pause, Play, Plus, Search, X } from "lucide-react";
import { archiveRow, callFunction, createRow, fetchRows, updateRow, type Row } from "../lib/data";
import { requireSupabase } from "../lib/supabase";
import type { AppRole } from "../lib/supabase";

type Field = {
  key: string;
  label: string;
  type?: "text" | "email" | "number" | "date" | "textarea" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
  source?: string;
  placeholder?: string;
};

interface ModuleDefinition {
  table: string;
  title: string;
  eyebrow: string;
  description: string;
  singular: string;
  fields: Field[];
  columns: { key: string; label: string; format?: "currency" | "date" | "status" | "relation" }[];
  adminOnly?: boolean;
}

const definitions: Record<string, ModuleDefinition> = {
  products: { table: "products", title: "Products", eyebrow: "CATALOG", description: "Manage the products and services at the heart of your plans.", singular: "product", adminOnly: true, fields: [
    { key: "name", label: "Product name", required: true }, { key: "product_type", label: "Product type", type: "select", options: ["service", "goods", "subscription"], required: true }, { key: "price", label: "Sales price (₹)", type: "number", required: true }, { key: "cost_price", label: "Cost price (₹)", type: "number" }, { key: "description", label: "Description", type: "textarea" },
  ], columns: [{ key: "name", label: "Product" }, { key: "product_type", label: "Type" }, { key: "price", label: "Price", format: "currency" }, { key: "created_at", label: "Created", format: "date" }] },
  plans: { table: "subscription_plans", title: "Subscription plans", eyebrow: "OFFERINGS", description: "Shape recurring experiences around the way your customers work.", singular: "plan", adminOnly: true, fields: [
    { key: "name", label: "Plan name", required: true }, { key: "product_id", label: "Product", type: "select", source: "products", required: true }, { key: "billing_cycle", label: "Billing cycle", type: "select", options: ["daily", "weekly", "monthly", "yearly"], required: true }, { key: "price", label: "Price per cycle (₹)", type: "number", required: true }, { key: "minimum_quantity", label: "Minimum quantity", type: "number" }, { key: "allow_pause", label: "Allow pause", type: "checkbox" }, { key: "allow_early_cancel", label: "Allow early cancellation", type: "checkbox" }, { key: "allow_renewal", label: "Allow renewal", type: "checkbox" },
  ], columns: [{ key: "name", label: "Plan" }, { key: "product_id", label: "Product", format: "relation" }, { key: "billing_cycle", label: "Billing cycle" }, { key: "price", label: "Price", format: "currency" }, { key: "is_active", label: "Status", format: "status" }] },
  customers: { table: "customers", title: "Customers", eyebrow: "RELATIONSHIPS", description: "Every customer relationship, all in one place.", singular: "customer", fields: [
    { key: "display_name", label: "Customer name", required: true }, { key: "email", label: "Email address", type: "email", required: true }, { key: "phone", label: "Phone" }, { key: "company", label: "Company" }, { key: "notes", label: "Notes", type: "textarea" },
  ], columns: [{ key: "display_name", label: "Customer" }, { key: "email", label: "Email" }, { key: "company", label: "Company" }, { key: "created_at", label: "Joined", format: "date" }] },
  quotations: { table: "quotations", title: "Quotations", eyebrow: "SALES", description: "Turn a thoughtful proposal into a lasting customer relationship.", singular: "quotation", fields: [
    { key: "customer_id", label: "Customer", type: "select", source: "customers", required: true }, { key: "valid_until", label: "Valid until", type: "date" }, { key: "notes", label: "Notes", type: "textarea" },
  ], columns: [{ key: "number", label: "Reference" }, { key: "customer_id", label: "Customer", format: "relation" }, { key: "total", label: "Total", format: "currency" }, { key: "status", label: "Status", format: "status" }, { key: "created_at", label: "Created", format: "date" }] },
  subscriptions: { table: "subscriptions", title: "Subscriptions", eyebrow: "RECURRING", description: "Keep every subscription moving in the right direction.", singular: "subscription", fields: [
    { key: "customer_id", label: "Customer", type: "select", source: "customers", required: true }, { key: "plan_id", label: "Plan", type: "select", source: "subscription_plans", required: true }, { key: "start_date", label: "Start date", type: "date", required: true }, { key: "next_billing_date", label: "Next billing date", type: "date", required: true },
  ], columns: [{ key: "number", label: "Reference" }, { key: "customer_id", label: "Customer", format: "relation" }, { key: "plan_id", label: "Plan", format: "relation" }, { key: "next_billing_date", label: "Next billing", format: "date" }, { key: "status", label: "Status", format: "status" }] },
  invoices: { table: "invoices", title: "Invoices", eyebrow: "BILLING", description: "A clear record of what’s due, what’s paid, and what’s next.", singular: "invoice", fields: [
    { key: "customer_id", label: "Customer", type: "select", source: "customers", required: true }, { key: "due_date", label: "Due date", type: "date", required: true }, { key: "notes", label: "Notes", type: "textarea" },
  ], columns: [{ key: "number", label: "Invoice" }, { key: "customer_id", label: "Customer", format: "relation" }, { key: "total", label: "Total", format: "currency" }, { key: "balance_due", label: "Balance", format: "currency" }, { key: "due_date", label: "Due date", format: "date" }, { key: "status", label: "Status", format: "status" }] },
  payments: { table: "payments", title: "Payments", eyebrow: "CASH FLOW", description: "Record and reconcile payments against customer invoices.", singular: "payment", fields: [
    { key: "invoice_id", label: "Invoice", type: "select", source: "invoices", required: true }, { key: "amount", label: "Amount received (₹)", type: "number", required: true }, { key: "payment_method", label: "Payment method", type: "select", options: ["cash", "bank_transfer", "upi", "card", "other"], required: true }, { key: "payment_date", label: "Payment date", type: "date", required: true }, { key: "notes", label: "Notes", type: "textarea" },
  ], columns: [{ key: "reference", label: "Reference" }, { key: "invoice_id", label: "Invoice", format: "relation" }, { key: "amount", label: "Amount", format: "currency" }, { key: "payment_method", label: "Method" }, { key: "payment_date", label: "Date", format: "date" }, { key: "status", label: "Status", format: "status" }] },
  discounts: { table: "discount_rules", title: "Discounts", eyebrow: "PRICING", description: "Build incentives that reward the right customer relationships.", singular: "discount", adminOnly: true, fields: [
    { key: "name", label: "Discount name", required: true }, { key: "discount_type", label: "Discount type", type: "select", options: ["percentage", "fixed"], required: true }, { key: "value", label: "Value", type: "number", required: true }, { key: "minimum_purchase", label: "Minimum purchase (₹)", type: "number" }, { key: "starts_at", label: "Starts on", type: "date" }, { key: "expires_at", label: "Expires on", type: "date" }, { key: "max_uses", label: "Maximum uses", type: "number" },
  ], columns: [{ key: "name", label: "Discount" }, { key: "discount_type", label: "Type" }, { key: "value", label: "Value" }, { key: "expires_at", label: "Expires", format: "date" }, { key: "is_active", label: "Status", format: "status" }] },
  taxes: { table: "tax_rules", title: "Tax settings", eyebrow: "FINANCE", description: "Keep tax rates and rules consistent across your billing.", singular: "tax rule", adminOnly: true, fields: [
    { key: "name", label: "Tax name", required: true }, { key: "rate", label: "Tax rate (%)", type: "number", required: true }, { key: "tax_type", label: "Tax type", type: "select", options: ["exclusive", "inclusive"], required: true },
  ], columns: [{ key: "name", label: "Tax" }, { key: "rate", label: "Rate" }, { key: "tax_type", label: "Type" }, { key: "is_active", label: "Status", format: "status" }] },
  staff: { table: "staff", title: "Team", eyebrow: "WORKSPACE", description: "Give your team the right access to keep customers moving.", singular: "team member", adminOnly: true, fields: [
    { key: "full_name", label: "Full name", required: true }, { key: "email", label: "Email address", type: "email", required: true }, { key: "password", label: "Temporary password", type: "text", required: true },
  ], columns: [{ key: "full_name", label: "Name" }, { key: "email", label: "Email" }, { key: "created_at", label: "Added", format: "date" }] },
};

function pretty(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replaceAll("_", " ");
}

function currency(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount) : "—";
}

function dateLabel(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function ModulePage({ module, role, customerId }: { module: string; role: AppRole; customerId?: string }) {
  const definition = definitions[module];
  const [rows, setRows] = useState<Row[]>([]);
  const [references, setReferences] = useState<Record<string, Row[]>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");

  const load = useCallback(async () => {
    if (!definition) return;
    setLoading(true);
    setError("");
    try {
      const data = await fetchRows(definition.table, search, page * 25);
      setRows(customerId && !["customers"].includes(module) ? data.filter(row => row.customer_id === customerId) : data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load records.");
    } finally {
      setLoading(false);
    }
  }, [definition, search, page, customerId, module]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!modal || !definition) return;
    const sources = [...new Set(definition.fields.map(field => field.source).filter((value): value is string => Boolean(value)))];
    if (!sources.length) return;
    Promise.all(sources.map(async source => {
      const { data, error: queryError } = await requireSupabase().from(source).select("id,name,display_name,number").order("created_at", { ascending: false }).limit(100);
      if (queryError) throw queryError;
      return [source, (data ?? []) as Row[]] as const;
    })).then(entries => setReferences(Object.fromEntries(entries))).catch(caught => setError(caught instanceof Error ? caught.message : "Could not load form options."));
  }, [modal, definition]);

  const visibleRows = useMemo(() => invoiceFilter === "all" ? rows : rows.filter(row => row.status === invoiceFilter), [rows, invoiceFilter]);
  if (!definition) return <div className="empty-state">This page is not available.</div>;
  if (definition.adminOnly && role !== "admin") return <NoAccess />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const values: Record<string, unknown> = {};
    for (const field of definition.fields) {
      const value = form.get(field.key);
      if (field.type === "checkbox") values[field.key] = form.get(field.key) === "on";
      else if (value !== null && String(value).trim() !== "") values[field.key] = field.type === "number" ? Number(value) : String(value).trim();
    }
    try {
      if (module === "staff") {
        await callFunction("create-staff", { ...values });
      } else if (module === "payments") {
        await callFunction("record-payment", { ...values, amount: Number(values.amount) });
      } else {
        await createRow(definition.table, values);
      }
      setModal(false);
      setToast(`${definition.singular} saved`);
      window.setTimeout(() => setToast(""), 3000);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this record.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(row: Row, action: string) {
    try {
      if (module === "subscriptions") {
        await callFunction("subscription-action", { subscription_id: row.id, action });
      } else if (module === "quotations" && action === "convert") {
        await callFunction("quotation-workflows", { quotation_id: row.id, action: "convert" });
      } else if (module === "quotations" && action === "confirm") {
        await callFunction("quotation-workflows", { quotation_id: row.id, action: "confirm" });
      } else if (module === "invoices" && action === "confirm") {
        await updateRow(definition.table, row.id, { status: "confirmed" });
      } else if (module === "invoices" && action === "cancel") {
        await updateRow(definition.table, row.id, { status: "cancelled" });
      } else if (module === "subscriptions" && action === "archive") {
        await archiveRow(definition.table, row.id);
      }
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This action could not be completed.");
    }
  }

  function exportRows() {
    const csv = [definition.columns.map(column => column.label).join(","), ...visibleRows.map(row => definition.columns.map(column => JSON.stringify(String(row[column.key] ?? ""))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${module}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page-content">
      <div className="page-heading"><div><div className="eyebrow">{definition.eyebrow}</div><h1>{definition.title}</h1><p>{definition.description}</p></div><div className="heading-actions"><button className="button button--secondary" onClick={exportRows}><ArrowDownToLine size={15} /> Export</button><button className="button button--primary" onClick={() => { setError(""); setModal(true); }}><Plus size={16} /> New {definition.singular}</button></div></div>
      <div className="module-toolbar">
        <div className="search-box"><Search size={16} /><input placeholder={`Search ${definition.title.toLowerCase()}…`} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
        {module === "invoices" && <div className="filter-pills">{["all", "draft", "confirmed", "paid", "overdue"].map(status => <button key={status} className={invoiceFilter === status ? "filter-pill active" : "filter-pill"} onClick={() => setInvoiceFilter(status)}>{status}</button>)}</div>}
        <span className="result-count">{visibleRows.length} records</span>
      </div>
      {error && <div className="inline-alert inline-alert--error"><CircleAlert size={16} />{error}<button className="icon-button" onClick={() => setError("")}><X size={15} /></button></div>}
      <div className="table-card">
        <div className="table-scroll"><table><thead><tr>{definition.columns.map(column => <th key={column.key}>{column.label}</th>)}<th className="action-head"></th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={definition.columns.length + 1}><div className="table-loading"><LoaderCircle className="spin" size={18} /> Loading your records…</div></td></tr> : visibleRows.length === 0 ? <tr><td colSpan={definition.columns.length + 1}><div className="table-empty"><div className="empty-icon"><Search size={18} /></div><strong>{search ? "No matching records" : `No ${definition.title.toLowerCase()} yet`}</strong><span>{search ? "Try another search." : "Create your first record to get started."}</span>{!search && <button className="button button--secondary button--small" onClick={() => setModal(true)}><Plus size={14} /> Add {definition.singular}</button>}</div></td></tr> : visibleRows.map((row, index) => <tr key={row.id} className="table-row" style={{ animationDelay: `${index * 28}ms` }}>{definition.columns.map(column => <td key={column.key}>
              {column.format === "currency" ? <span className="money">{currency(row[column.key])}</span> : column.format === "date" ? dateLabel(row[column.key]) : column.format === "status" ? <span className={`status-badge status-${pretty(row[column.key]).toLowerCase().replaceAll(" ", "-")}`}><i />{pretty(row[column.key])}</span> : column.format === "relation" ? <RelationLabel module={module} field={column.key} id={row[column.key]} references={references} /> : <span className={column.key === "number" || column.key === "reference" ? "mono-ref" : ""}>{pretty(row[column.key])}</span>}
            </td>)}<td><RowActions module={module} row={row} role={role} onAction={runAction} /></td></tr>)}</tbody>
        </table></div>
        <div className="table-footer"><span>Showing {visibleRows.length ? page * 25 + 1 : 0}–{page * 25 + visibleRows.length} records</span><div className="pagination"><button className="icon-button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}><ChevronLeft size={16} /></button><span>Page {page + 1}</span><button className="icon-button" aria-label="Next page" disabled={rows.length < 25} onClick={() => setPage(current => current + 1)}><ChevronRight size={16} /></button></div></div>
      </div>
      {modal && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setModal(false); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="modal-heading"><div><div className="eyebrow">NEW RECORD</div><h2 id="create-title">Add {definition.singular}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(false)}><X size={18} /></button></div>
        <form className="record-form" onSubmit={submit}>{definition.fields.map(field => <label key={field.key} className={`field ${field.type === "checkbox" ? "field--checkbox" : ""}`}><span>{field.label}{field.required && <em> *</em>}</span>
          {field.type === "textarea" ? <textarea name={field.key} placeholder={field.placeholder} rows={3} /> : field.type === "select" ? <select name={field.key} required={field.required} defaultValue=""><option value="" disabled>Select {field.label.toLowerCase()}</option>{field.options?.map(option => <option key={option} value={option}>{pretty(option)}</option>)}{field.source && references[field.source]?.map(reference => <option key={reference.id} value={reference.id}>{String(reference.name ?? reference.display_name ?? reference.number ?? reference.id)}</option>)}</select> : field.type === "checkbox" ? <input type="checkbox" name={field.key} /> : <input name={field.key} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} min={field.type === "number" ? "0" : undefined} step={field.type === "number" ? "0.01" : undefined} />}</label>)}
          {error && <div className="inline-alert inline-alert--error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button button--secondary" onClick={() => setModal(false)}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? <LoaderCircle size={15} className="spin" /> : <><Check size={15} /> Save {definition.singular}</>}</button></div></form></div></div>}
      {toast && <div className="toast"><Check size={16} /> {toast} <ArrowRight size={14} /></div>}
    </section>
  );
}

function RelationLabel({ module, field, id, references }: { module: string; field: string; id: unknown; references: Record<string, Row[]> }) {
  const source = field === "customer_id" ? "customers" : field === "plan_id" ? "subscription_plans" : field === "product_id" ? "products" : field === "invoice_id" ? "invoices" : "";
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!id || !source) { setLabel("—"); return; }
    const known = references[source]?.find(item => item.id === id);
    if (known) {
      setLabel(String(known.display_name ?? known.name ?? known.number ?? "—"));
      return;
    }
    requireSupabase().from(source).select("name,display_name,number").eq("id", String(id)).maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("Could not load related record.", error);
        setLabel(data ? String(data.display_name ?? data.name ?? data.number ?? "—") : "—");
      });
  }, [id, source, references, module]);
  return <span className="relation-label">{label || "—"}</span>;
}

function RowActions({ module, row, role, onAction }: { module: string; row: Row; role: AppRole; onAction: (row: Row, action: string) => void }) {
  if (module === "subscriptions") {
    return <div className="row-actions">{row.status === "active" && <button className="action-chip" title="Pause subscription" onClick={() => onAction(row, "pause")}><Pause size={13} /></button>}{row.status === "paused" && <button className="action-chip" title="Resume subscription" onClick={() => onAction(row, "resume")}><Play size={13} /></button>}{["active", "paused"].includes(String(row.status)) && <button className="action-chip action-chip--danger" title="Cancel subscription" onClick={() => onAction(row, "cancel")}><X size={13} /></button>}<button className="action-chip" title="More actions" onClick={() => onAction(row, "renew")}><MoreHorizontal size={15} /></button></div>;
  }
  if (module === "quotations") return <div className="row-actions">{row.status === "draft" && <button className="action-chip" title="Confirm quotation" onClick={() => onAction(row, "confirm")}><Check size={14} /></button>}{row.status === "confirmed" && <button className="action-chip action-chip--primary" title="Convert to subscription" onClick={() => onAction(row, "convert")}><ArrowRight size={14} /></button>}</div>;
  if (module === "invoices" && role !== "customer") return <div className="row-actions">{row.status === "draft" && <button className="action-chip" title="Confirm invoice" onClick={() => onAction(row, "confirm")}><Check size={14} /></button>}{["draft", "confirmed"].includes(String(row.status)) && <button className="action-chip action-chip--danger" title="Cancel invoice" onClick={() => onAction(row, "cancel")}><X size={13} /></button>}</div>;
  if (["products", "subscription_plans"].includes(module) && role === "admin" && !row.archived_at) return <button className="action-chip action-chip--danger" title="Archive record" onClick={() => onAction(row, "archive")}><Archive size={14} /></button>;
  return <span className="row-action-empty">—</span>;
}

function NoAccess() {
  return <div className="page-content"><div className="restricted-card"><div className="restricted-icon"><CircleAlert size={20} /></div><h2>Admin access required</h2><p>This area is only available to workspace administrators.</p></div></div>;
}
