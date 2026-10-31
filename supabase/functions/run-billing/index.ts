import { authorizeRequest, corsHeaders, errorResponse, getServiceClient, isOptions, jsonResponse, methodNotAllowed } from "../_shared/auth.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type SubscriptionLine = {
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  discount_amount: number;
};
type BillingSubscription = {
  id: string;
  customer_id: string;
  number: string;
  total: number;
  next_billing_date: string;
  expiry_date: string | null;
  auto_close: boolean;
  billing_cycle: "daily" | "weekly" | "monthly" | "yearly";
  subscription_lines: SubscriptionLine[];
};
type TaxRule = { id: string; rate: number; tax_type: string; applicable_products: string[] };
type DiscountRule = {
  id: string;
  discount_type: "fixed" | "percentage";
  value: number;
  minimum_purchase: number;
  minimum_quantity: number;
  applicable_products: string[];
  subscription_wide: boolean;
  max_uses: number | null;
  usage_count: number;
};
type BillLine = SubscriptionLine & { tax_rate: number; tax_amount: number; line_total: number };

function addCycle(dateText: string, cycle: BillingSubscription["billing_cycle"]) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (cycle === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (cycle === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (cycle === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  if (cycle === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function authorizedSchedule(request: Request) {
  const configuredSecret = Deno.env.get("ORBIT_SCHEDULE_SECRET");
  const suppliedSecret = request.headers.get("x-orbit-schedule-secret");
  return Boolean(configuredSecret && suppliedSecret && configuredSecret.length === suppliedSecret.length &&
    [...configuredSecret].every((character, index) => character === suppliedSecret[index]));
}

Deno.serve(async request => {
  if (isOptions(request)) return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (request.method !== "POST") return methodNotAllowed();
  let runId: string | undefined;
  let service: SupabaseClient | undefined;
  let actorId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const scheduled = body.source === "scheduled" && authorizedSchedule(request);
    if (body.source === "scheduled" && !scheduled) throw new Error("Scheduled billing secret is missing or invalid.");
    if (scheduled) {
      service = getServiceClient();
    } else {
      const authorized = await authorizeRequest(request, ["admin", "staff"]);
      service = authorized.service;
      actorId = authorized.user.id;
    }

    const { data: run, error: runError } = await service.from("billing_runs")
      .insert({ status: "running", source: scheduled ? "scheduled" : "manual", triggered_by: actorId })
      .select("id").single();
    if (runError) throw runError;
    runId = run.id;

    const today = new Date().toISOString().slice(0, 10);
    const { error: overdueError } = await service.rpc("update_invoice_overdue_status");
    if (overdueError) throw overdueError;

    const { data: dueSubscriptions, error: dueError } = await service.from("subscriptions")
      .select("id,customer_id,number,total,next_billing_date,expiry_date,auto_close,billing_cycle,subscription_lines(product_id,description,quantity,unit_price,tax_rate,discount_amount)")
      .eq("status", "active").lte("next_billing_date", today)
      .order("next_billing_date", { ascending: true }).limit(100);
    if (dueError) throw dueError;

    const { data: taxRules, error: taxError } = await service.from("tax_rules")
      .select("id,rate,tax_type,applicable_products").eq("is_active", true);
    if (taxError) throw taxError;
    const { data: discountRules, error: discountError } = await service.from("discount_rules")
      .select("id,discount_type,value,minimum_purchase,minimum_quantity,applicable_products,subscription_wide,max_uses,usage_count")
      .eq("is_active", true);
    if (discountError) throw discountError;

    const failures: { subscription_id: string; message: string }[] = [];
    let invoicesCreated = 0;
    for (const subscription of (dueSubscriptions ?? []) as BillingSubscription[]) {
      let invoiceId: string | undefined;
      try {
        if (subscription.auto_close && subscription.expiry_date && subscription.expiry_date < today) {
          const { error } = await service.from("subscriptions").update({ status: "closed" }).eq("id", subscription.id);
          if (error) throw error;
          continue;
        }
        if (!subscription.subscription_lines.length) throw new Error("Subscription has no billable product lines.");
        const periodStart = subscription.next_billing_date;
        const periodEnd = addCycle(periodStart, subscription.billing_cycle);
        const { data: existing, error: existingError } = await service.from("invoices")
          .select("id,status").eq("subscription_id", subscription.id).eq("billing_period_start", periodStart).maybeSingle();
        if (existingError) throw existingError;
        if (existing && existing.status !== "draft") {
          const { error } = await service.from("subscriptions").update({ next_billing_date: periodEnd }).eq("id", subscription.id);
          if (error) throw error;
          continue;
        }

        const { data: invoice, error: invoiceError } = existing
          ? await service.from("invoices").update({ generation_error: null }).eq("id", existing.id).select("id").single()
          : await service.from("invoices").insert({
              customer_id: subscription.customer_id,
              subscription_id: subscription.id,
              billing_period_start: periodStart,
              billing_period_end: periodEnd,
              status: "draft",
              issue_date: today,
              due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
            }).select("id").single();
        if (invoiceError || !invoice) throw invoiceError ?? new Error("Could not create an invoice.");
        invoiceId = invoice.id;
        await service.from("invoice_lines").delete().eq("invoice_id", invoiceId);

        const productIds = [...new Set(subscription.subscription_lines.map(line => line.product_id))];
        const billLines: BillLine[] = subscription.subscription_lines.map(line => {
          const tax = (taxRules as TaxRule[]).find(rule => rule.applicable_products.length === 0 || rule.applicable_products.includes(line.product_id));
          const rate = tax ? Number(tax.rate) : Number(line.tax_rate ?? 0);
          const base = Math.max(0, Number(line.quantity) * Number(line.unit_price) - Number(line.discount_amount ?? 0));
          const taxAmount = tax?.tax_type === "inclusive" ? roundMoney(base - base / (1 + rate / 100)) : roundMoney(base * rate / 100);
          const total = tax?.tax_type === "inclusive" ? base : base + taxAmount;
          return { ...line, tax_rate: rate, tax_amount: taxAmount, line_total: roundMoney(total) };
        });
        const subtotal = roundMoney(billLines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0));
        const taxTotal = roundMoney(billLines.reduce((sum, line) => sum + line.tax_amount, 0));
        const lineDiscountTotal = roundMoney(billLines.reduce((sum, line) => sum + Number(line.discount_amount ?? 0), 0));
        const quantityTotal = billLines.reduce((sum, line) => sum + Number(line.quantity), 0);
        const productSubtotal = roundMoney(billLines.reduce((sum, line) => sum + line.line_total, 0));
        const discount = (discountRules as DiscountRule[]).find(rule =>
          rule.subscription_wide &&
          (rule.applicable_products.length === 0 || productIds.some(productId => rule.applicable_products.includes(productId))) &&
          subtotal >= Number(rule.minimum_purchase) && quantityTotal >= Number(rule.minimum_quantity) &&
          (rule.max_uses === null || Number(rule.usage_count) < rule.max_uses)
        );
        let discountAmount = 0;
        if (discount) {
          const discountBase = Math.max(0, subtotal - lineDiscountTotal);
          discountAmount = roundMoney(discount.discount_type === "percentage" ? discountBase * Number(discount.value) / 100 : Number(discount.value));
          discountAmount = Math.min(discountAmount, productSubtotal);
        }
        const invoiceLines = billLines.map(line => ({
          invoice_id: invoiceId,
          product_id: line.product_id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          tax_rate: line.tax_rate,
          tax_amount: line.tax_amount,
          discount_amount: line.discount_amount,
          line_total: line.line_total,
        }));
        const { error: linesInsertError } = await service.from("invoice_lines").insert(invoiceLines);
        if (linesInsertError) throw linesInsertError;
        if (discount && discountAmount > 0) {
          const { data: claimed, error: claimError } = await service.rpc("claim_discount_usage", {
            p_discount_id: discount.id,
            p_invoice_id: invoiceId,
            p_customer_id: subscription.customer_id,
            p_amount: discountAmount,
          });
          if (claimError) throw claimError;
          if (!claimed) discountAmount = 0;
        }
        const total = roundMoney(Math.max(0, productSubtotal - discountAmount));
        const { error: finalizeError } = await service.from("invoices").update({
          subtotal,
          tax_total: taxTotal,
          discount_total: lineDiscountTotal + discountAmount,
          total,
          balance_due: total,
          status: "confirmed",
          generation_error: null,
        }).eq("id", invoiceId);
        if (finalizeError) throw finalizeError;
        const { error: advanceError } = await service.from("subscriptions").update({ next_billing_date: periodEnd }).eq("id", subscription.id);
        if (advanceError) throw advanceError;
        invoicesCreated += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invoice generation failed.";
        failures.push({ subscription_id: subscription.id, message });
        if (invoiceId) await service.from("invoices").update({ generation_error: message }).eq("id", invoiceId);
      }
    }

    const { error: finishError } = await service.from("billing_runs").update({
      status: failures.length ? (invoicesCreated ? "completed_with_errors" : "failed") : "completed",
      subscriptions_checked: dueSubscriptions?.length ?? 0,
      invoices_created: invoicesCreated,
      errors: failures,
      completed_at: new Date().toISOString(),
    }).eq("id", runId);
    if (finishError) throw finishError;
    return jsonResponse({
      run_id: runId,
      generated: invoicesCreated,
      checked: dueSubscriptions?.length ?? 0,
      errors: failures,
      message: failures.length ? `${invoicesCreated} invoices generated; ${failures.length} need attention.` : `${invoicesCreated} invoices generated from ${dueSubscriptions?.length ?? 0} due subscriptions.`,
    });
  } catch (error) {
    if (runId && service) {
      const message = error instanceof Error ? error.message : "Billing run failed.";
      await service.from("billing_runs").update({ status: "failed", errors: [{ message }], completed_at: new Date().toISOString() }).eq("id", runId);
    }
    return errorResponse(error, 400);
  }
});
