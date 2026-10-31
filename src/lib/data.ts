import { requireSupabase } from "./supabase";

export type Row = Record<string, unknown> & { id: string; created_at?: string };

const searchableColumns: Record<string, string[]> = {
  products: ["name", "description"],
  subscription_plans: ["name"],
  customers: ["display_name", "email", "company"],
  quotations: ["number"],
  subscriptions: ["number"],
  invoices: ["number"],
  payments: ["reference"],
  discount_rules: ["name"],
  tax_rules: ["name"],
  staff: ["full_name", "email"],
};

export async function fetchRows(table: string, search = "", from = 0, pageSize = 25): Promise<Row[]> {
  const client = requireSupabase();
  let query = client.from(table).select("*").order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (search.trim()) {
    const escaped = search.trim().replace(/[,%()]/g, "");
    const columns = searchableColumns[table] ?? [];
    if (escaped && columns.length) query = query.or(columns.map(column => `${column}.ilike.%${escaped}%`).join(","));
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Row[];
}

export async function createRow(table: string, values: Record<string, unknown>) {
  const { error } = await requireSupabase().from(table).insert(values);
  if (error) throw error;
}

export async function updateRow(table: string, id: string, values: Record<string, unknown>) {
  const { error } = await requireSupabase().from(table).update(values).eq("id", id);
  if (error) throw error;
}

export async function archiveRow(table: string, id: string) {
  const { error } = await requireSupabase().from(table).update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}
