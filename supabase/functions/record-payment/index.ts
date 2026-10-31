import { authorizeRequest, corsHeaders, errorResponse, isOptions, jsonResponse, methodNotAllowed } from "../_shared/auth.ts";

Deno.serve(async request => {
  if (isOptions(request)) return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (request.method !== "POST") return methodNotAllowed();
  try {
    const { client } = await authorizeRequest(request, ["admin", "staff"]);
    const body = await request.json();
    const invoiceId = typeof body.invoice_id === "string" ? body.invoice_id : "";
    const amount = Number(body.amount);
    const paymentMethod = String(body.payment_method ?? "");
    const paymentDate = String(body.payment_date ?? "");
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) throw new Error("Choose a valid invoice.");
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error("Enter a valid payment amount.");
    if (!["cash", "bank_transfer", "upi", "card", "other"].includes(paymentMethod)) throw new Error("Choose a supported payment method.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || Number.isNaN(new Date(`${paymentDate}T00:00:00Z`).getTime())) throw new Error("Choose a valid payment date.");

    const { data, error } = await client.rpc("record_payment_atomic", {
      p_invoice_id: invoiceId,
      p_amount: Math.round(amount * 100) / 100,
      p_payment_method: paymentMethod,
      p_payment_date: paymentDate,
      p_notes: notes,
    });
    if (error) throw error;
    return jsonResponse({ payment_id: data, message: "Payment recorded and allocated to the invoice." });
  } catch (error) {
    return errorResponse(error, 400);
  }
});
