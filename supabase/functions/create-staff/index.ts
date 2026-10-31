import { authorizeRequest, corsHeaders, errorResponse, isOptions, jsonResponse, methodNotAllowed } from "../_shared/auth.ts";

Deno.serve(async request => {
  if (isOptions(request)) return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS" } });
  if (request.method !== "POST") return methodNotAllowed();
  try {
    const { service } = await authorizeRequest(request, ["admin"]);
    const body = await request.json();
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (fullName.length < 2 || fullName.length > 120) throw new Error("Enter a name between 2 and 120 characters.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
    if (password.length <= 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[^A-Za-z0-9]/.test(password)) throw new Error("Use at least 9 characters with uppercase, lowercase and a special character.");

    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName }, app_metadata: { role: "staff" } });
    if (error) throw error;
    const { error: profileError } = await service.from("profiles").update({ full_name: fullName, role: "staff" }).eq("id", data.user.id);
    if (profileError) {
      await service.auth.admin.deleteUser(data.user.id);
      throw profileError;
    }
    const { error: staffError } = await service.from("staff").insert({ profile_id: data.user.id, full_name: fullName, email });
    if (staffError) {
      await service.auth.admin.deleteUser(data.user.id);
      throw staffError;
    }
    return jsonResponse({ id: data.user.id, message: "Staff account created." });
  } catch (error) {
    return errorResponse(error);
  }
});
