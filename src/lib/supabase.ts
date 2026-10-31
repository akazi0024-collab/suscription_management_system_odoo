export type LocalUser = { id: string; email: string; full_name?: string; role?: AppRole };
export type LocalSession = { access_token: string; user: LocalUser };
type DbError = { message: string };
type DbResult<T> = { data: T | null; error: DbError | null };
type DbRow = { id: string; [key: string]: unknown };
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthListener = (event: AuthEvent, session: LocalSession | null) => void;

const API_URL = import.meta.env.VITE_LOCAL_API_URL || "http://127.0.0.1:8000";
const SESSION_KEY = "orbit-local-session";
const listeners = new Set<AuthListener>();

export const isSupabaseConfigured = true;
export const isLocalDemoModeRequested = true;
export const isLocalDemoMode = true;
export const localDemoCredentials = { email: "demo@orbit.local", password: "any-non-empty-password" };

export type AppRole = "admin" | "staff" | "customer";
export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  avatar_url: string | null;
}

function storedSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as LocalSession : null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function setSession(session: LocalSession | null, event: AuthEvent) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  listeners.forEach(listener => listener(event, session));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = storedSession();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json() as T | DbError;
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "message" in payload
      ? String(payload.message)
      : `Local API request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

function resultError(error: unknown): DbError {
  return { message: error instanceof Error ? error.message : "Local database request failed." };
}

class LocalQuery<TData = DbRow[]> implements PromiseLike<DbResult<TData>> {
  private method: "GET" | "POST" | "PATCH" | "DELETE" = "GET";
  private body: Record<string, unknown> | null = null;
  private params = new URLSearchParams();
  private singleResult: "many" | "single" | "maybeSingle" = "many";

  constructor(private readonly table: string) {}

  select(columns = "*") {
    this.params.set("select", columns);
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.method = "POST";
    this.body = Array.isArray(values) ? { records: values } : values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.method = "PATCH";
    this.body = values;
    return this;
  }

  delete() {
    this.method = "DELETE";
    return this;
  }

  eq(column: string, value: string | number | boolean) {
    this.params.set(`eq_${column}`, String(value));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.params.set("order", `${column}.${options?.ascending ? "asc" : "desc"}`);
    return this;
  }

  range(from: number, to: number) {
    this.params.set("offset", String(from));
    this.params.set("limit", String(Math.max(1, to - from + 1)));
    return this;
  }

  limit(count: number) {
    this.params.set("limit", String(count));
    return this;
  }

  or(filters: string) {
    const columns = filters.split(",").map(filter => filter.split(".")[0]).filter(Boolean);
    const term = filters.match(/ilike\.%(.+?)%/)?.[1] ?? "";
    if (columns.length && term) {
      this.params.set("search_cols", columns.join(","));
      this.params.set("search", term);
    }
    return this;
  }

  single(): LocalQuery<DbRow> {
    this.singleResult = "single";
    return this as unknown as LocalQuery<DbRow>;
  }

  maybeSingle(): LocalQuery<DbRow | null> {
    this.singleResult = "maybeSingle";
    return this as unknown as LocalQuery<DbRow | null>;
  }

  async then<TResult1 = DbResult<TData>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<TData>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const query = this.params.size ? `?${this.params.toString()}` : "";
      const url = `/api/data/${encodeURIComponent(this.table)}${query}`;
      const payload = await request<DbRow[] | DbRow>(url, {
        method: this.method,
        ...(this.body ? { body: JSON.stringify(this.body) } : {}),
      });
      let data: unknown = payload;
      if (this.singleResult !== "many") {
        const rows = Array.isArray(payload) ? payload : [payload];
        if (rows.length === 0 && this.singleResult === "single") throw new Error("Record not found.");
        data = rows[0] ?? null;
      }
      const result: DbResult<TData> = { data: data as TData, error: null };
      return onfulfilled ? await onfulfilled(result) : result as TResult1;
    } catch (error) {
      const result: DbResult<TData> = { data: null, error: resultError(error) };
      return onfulfilled ? await onfulfilled(result) : onrejected ? await onrejected(error) : result as TResult1;
    }
  }
}

const auth = {
  async getSession() {
    const session = storedSession();
    if (!session) return { data: { session: null }, error: null };
    try {
      const { user } = await request<{ user: LocalUser }>("/api/auth/session");
      const refreshed = { ...session, user };
      setSession(refreshed, "USER_UPDATED");
      return { data: { session: refreshed }, error: null };
    } catch {
      setSession(null, "SIGNED_OUT");
      return { data: { session: null }, error: null };
    }
  },
  async getUser() {
    const session = storedSession();
    if (!session) return { data: { user: null }, error: null };
    try {
      const { user } = await request<{ user: LocalUser }>("/api/auth/session");
      return { data: { user }, error: null };
    } catch (error) {
      return { data: { user: null }, error: resultError(error) };
    }
  },
  onAuthStateChange(callback: AuthListener) {
    listeners.add(callback);
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
  },
  async signInWithPassword(credentials: { email: string; password: string }) {
    try {
      const result = await request<{ token: string; user: LocalUser }>("/api/auth/login", {
        method: "POST", body: JSON.stringify(credentials),
      });
      const session = { access_token: result.token, user: result.user };
      setSession(session, "SIGNED_IN");
      return { data: { user: result.user, session }, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: resultError(error) };
    }
  },
  async signUp(options: { email: string; password: string; options?: { data?: { full_name?: string; role?: string } } }) {
    try {
      await request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: options.email, password: options.password, full_name: options.options?.data?.full_name }),
      });
      return { data: { user: null, session: null }, error: null };
    } catch (error) {
      return { data: { user: null, session: null }, error: resultError(error) };
    }
  },
  async signOut() {
    try {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
      setSession(null, "SIGNED_OUT");
      return { error: null };
    } catch (error) {
      return { error: resultError(error) };
    }
  },
  async updateUser(attributes: { password?: string }) {
    try {
      if (attributes.password) await request("/api/auth/password", { method: "POST", body: JSON.stringify(attributes) });
      const session = storedSession();
      if (session) setSession(session, "USER_UPDATED");
      return { data: { user: session?.user ?? null }, error: null };
    } catch (error) {
      return { data: { user: null }, error: resultError(error) };
    }
  },
  async resetPasswordForEmail(_email: string, _options: { redirectTo?: string }) {
    return { error: { message: "Password reset email is not available in the local backend. Sign in with the local demo account." } };
  },
};

const client = {
  auth,
  from: (table: string) => new LocalQuery(table),
  async rpc<T>(name: string, args: Record<string, unknown>) {
    try {
      const params = new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]));
      return { data: await request<T>(`/api/rpc/${encodeURIComponent(name)}?${params}`), error: null };
    } catch (error) {
      return { data: null, error: resultError(error) };
    }
  },
  functions: {
    async invoke<T>(name: string, options: { body: Record<string, unknown> }) {
      try {
        return { data: await request<T>(`/api/functions/${encodeURIComponent(name)}`, {
          method: "POST", body: JSON.stringify(options.body),
        }), error: null };
      } catch (error) {
        return { data: null, error: resultError(error) };
      }
    },
  },
};

export const supabase = client;

export function requireSupabase() {
  return client;
}
