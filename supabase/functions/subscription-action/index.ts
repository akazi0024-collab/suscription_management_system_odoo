import { authorizeRequest, corsHeaders, errorResponse, isOptions, jsonResponse, methodNotAllowed } from "../_shared/auth.ts";

Deno.serve(async request => {
  if (isOptions(request)) return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (request.method !== "POST") return methodNotAllowed();
  try {
    const { user, role, service } = await authorizeRequest(request, ["admin", "staff", "customer"]);
    const body = await request.json();
    const subscriptionId = typeof body.subscription_id === "string" ? body.subscription_id : "";
    const action = String(body.action ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subscriptionId)) throw new Error("Choose a valid subscription.");
    if (!["pause", "resume", "cancel", "renew"].includes(action)) throw new Error("Unsupported subscription action.");

    const { data: subscription, error: queryError } = await service.from("subscriptions")
      .select("id,customer_id,plan_id,status,next_billing_date,expiry_date,subscription_plans(allow_pause,allow_early_cancel,allow_renewal)")
      .eq("id", subscriptionId).single();
    if (queryError || !subscription) throw new Error("Subscription not found.");
    if (role === "customer") {
      const { data: customer, error: customerError } = await service.from("customers").select("id").eq("user_id", user.id).single();
      if (customerError || customer?.id !== subscription.customer_id) throw new Error("You cannot manage another customer's subscription.");
    }

    const planRelation = subscription.subscription_plans;
    const plan = (Array.isArray(planRelation) ? planRelation[0] : planRelation) as
      { allow_pause: boolean; allow_early_cancel: boolean; allow_renewal: boolean } | null;
    const currentStatus = subscription.status;
    const statusMap: Record<string, string> = { pause: "paused", resume: "active", cancel: "cancelled", renew: "active" };
    if (action === "pause" && (currentStatus !== "active" || !plan?.allow_pause)) throw new Error("This subscription cannot be paused.");
    if (action === "resume" && currentStatus !== "paused") throw new Error("Only paused subscriptions can be resumed.");
    if (action === "cancel" && (!["active", "paused"].includes(currentStatus) || (role === "customer" && !plan?.allow_early_cancel))) throw new Error("This subscription cannot be cancelled.");
    if (action === "renew" && (!["cancelled", "closed"].includes(currentStatus) || !plan?.allow_renewal)) throw new Error("This subscription cannot be renewed.");

    const updates: Record<string, unknown> = { status: statusMap[action] };
    if (action === "renew") {
      const nextBilling = subscription.expiry_date && subscription.expiry_date >= new Date().toISOString().slice(0, 10)
        ? subscription.expiry_date
        : new Date().toISOString().slice(0, 10);
      updates.start_date = nextBilling;
      updates.next_billing_date = nextBilling;
      updates.expiry_date = null;
    }
    const { error: updateError } = await service.from("subscriptions").update(updates).eq("id", subscriptionId);
    if (updateError) throw updateError;
    await service.from("activity_logs").insert({ actor_id: user.id, customer_id: subscription.customer_id, action: `subscription_${action}`, entity_type: "subscriptions", entity_id: subscriptionId, details: { previous_status: currentStatus, status: updates.status } });
    const actionMessage: Record<string, string> = { pause: "paused", resume: "resumed", cancel: "cancelled", renew: "renewed" };
    return jsonResponse({ status: updates.status, message: `Subscription ${actionMessage[action]}.` });
  } catch (error) {
    return errorResponse(error);
  }
});
