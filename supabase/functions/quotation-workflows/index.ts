import { authorizeRequest, corsHeaders, errorResponse, isOptions, jsonResponse, methodNotAllowed } from "../_shared/auth.ts";

Deno.serve(async request => {
  if (isOptions(request)) return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (request.method !== "POST") return methodNotAllowed();
  try {
    const { user, service } = await authorizeRequest(request, ["admin", "staff"]);
    const body = await request.json();
    const quotationId = typeof body.quotation_id === "string" ? body.quotation_id : "";
    const action = String(body.action ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(quotationId)) throw new Error("Choose a valid quotation.");
    if (!["send", "confirm", "convert"].includes(action)) throw new Error("Unsupported quotation action.");
    const { data: quotation, error: quotationError } = await service.from("quotations").select("id,customer_id,status,total,valid_until,template_id").eq("id", quotationId).single();
    if (quotationError || !quotation) throw new Error("Quotation not found.");

    if (action === "send" || action === "confirm") {
      const expectedStatus = action === "send" ? "draft" : "quotation";
      const nextStatus = action === "send" ? "quotation" : "confirmed";
      if (quotation.status !== expectedStatus) throw new Error(`Only ${expectedStatus} quotations can be ${action === "send" ? "sent" : "confirmed"}.`);
      const updates: Record<string, unknown> = { status: nextStatus, created_by: user.id };
      if (action === "send" && !quotation.valid_until && quotation.template_id) {
        const { data: template, error: templateError } = await service.from("quotation_templates").select("validity_days").eq("id", quotation.template_id).single();
        if (templateError) throw templateError;
        const validUntil = new Date();
        validUntil.setUTCDate(validUntil.getUTCDate() + Number(template.validity_days));
        updates.valid_until = validUntil.toISOString().slice(0, 10);
      }
      const { error } = await service.from("quotations").update(updates).eq("id", quotationId);
      if (error) throw error;
      return jsonResponse({ status: nextStatus, message: `Quotation ${action === "send" ? "sent" : "confirmed"}.` });
    }

    if (quotation.status !== "confirmed") throw new Error("Confirm the quotation before converting it.");
    if (quotation.valid_until && quotation.valid_until < new Date().toISOString().slice(0, 10)) throw new Error("This quotation has expired.");
    const { data, error } = await service.rpc("convert_quotation_atomic", { p_quotation_id: quotationId, p_actor_id: user.id });
    if (error) throw error;
    const result = data as { subscription_id: string; subscription_number: string };
    return jsonResponse({ ...result, message: "Quotation converted to a subscription." });
  } catch (error) {
    return errorResponse(error);
  }
});
