import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-orbit-schedule-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export class RequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  const responseStatus = error instanceof RequestError ? error.status : status;
  return jsonResponse({ error: message }, responseStatus);
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service configuration is missing.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type AuthorizedUser = { user: User; role: string; service: SupabaseClient; client: SupabaseClient };

export async function authorizeRequest(request: Request, allowedRoles: string[]): Promise<AuthorizedUser> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new RequestError("Authentication required.", 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new RequestError("Supabase authentication configuration is missing.", 500);
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new RequestError("Your session is invalid or has expired.", 401);
  const service = getServiceClient();
  const { data: profile, error: profileError } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profileError || !profile) throw new RequestError("Your workspace profile could not be verified.", 403);
  if (!allowedRoles.includes(profile.role)) throw new RequestError("You do not have permission to perform this action.", 403);
  return { user, role: profile.role, service, client };
}

export function isOptions(request: Request) {
  return request.method === "OPTIONS";
}

export function methodNotAllowed() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}
