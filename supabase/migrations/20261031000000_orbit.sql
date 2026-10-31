create extension if not exists pgcrypto;

create sequence if not exists public.quotation_number_seq start 1;
create sequence if not exists public.subscription_number_seq start 1;
create sequence if not exists public.invoice_number_seq start 1;
create sequence if not exists public.payment_number_seq start 1;

create table public.roles (
  name text primary key check (name in ('admin', 'staff', 'customer')),
  description text not null,
  updated_at timestamptz not null default now()
);
insert into public.roles (name, description) values
  ('admin', 'Full workspace access'),
  ('staff', 'Customer and billing operations'),
  ('customer', 'Access to the customer portal')
on conflict (name) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'customer' references public.roles(name),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  email text not null,
  phone text,
  company text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_email_lowercase check (email = lower(email)),
  constraint customers_email_unique unique (email)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  permissions jsonb not null default '{"customers":true,"subscriptions":true,"invoices":true,"payments":true,"reports":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_type text not null default 'service' check (product_type in ('service', 'goods', 'subscription')),
  price numeric(14,2) not null default 0 check (price >= 0),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  description text,
  notes text,
  image_url text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  attribute_name text not null,
  attribute_value text not null,
  price_delta numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, attribute_name, attribute_value)
);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  name text not null,
  billing_cycle text not null check (billing_cycle in ('daily', 'weekly', 'monthly', 'yearly')),
  price numeric(14,2) not null check (price >= 0),
  minimum_quantity integer not null default 1 check (minimum_quantity > 0),
  availability_start date,
  availability_end date,
  auto_close boolean not null default false,
  allow_early_cancel boolean not null default true,
  allow_pause boolean not null default true,
  allow_renewal boolean not null default true,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_availability_order check (availability_end is null or availability_start is null or availability_end >= availability_start)
);

create table public.quotation_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  validity_days integer not null default 30 check (validity_days > 0),
  terms text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('QUO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.quotation_number_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  template_id uuid references public.quotation_templates(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'quotation', 'confirmed', 'active', 'closed', 'cancelled')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  valid_until date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('SUB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.subscription_number_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  quotation_id uuid references public.quotations(id) on delete set null,
  status text not null default 'active' check (status in ('draft', 'quotation', 'confirmed', 'active', 'paused', 'cancelled', 'closed')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('daily', 'weekly', 'monthly', 'yearly')),
  start_date date not null default current_date,
  expiry_date date,
  next_billing_date date not null default current_date,
  payment_terms text not null default 'due_on_receipt',
  auto_close boolean not null default false,
  total numeric(14,2) not null default 0 check (total >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_id),
  constraint subscription_expiry_order check (expiry_date is null or expiry_date >= start_date)
);

create table public.subscription_lines (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rate numeric(7,4) not null check (rate >= 0 and rate <= 100),
  tax_type text not null default 'exclusive' check (tax_type in ('exclusive', 'inclusive')),
  applicable_products uuid[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.discount_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_type text not null check (discount_type in ('fixed', 'percentage')),
  value numeric(14,2) not null check (value >= 0),
  minimum_purchase numeric(14,2) not null default 0 check (minimum_purchase >= 0),
  minimum_quantity integer not null default 1 check (minimum_quantity > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  applicable_products uuid[] not null default '{}',
  subscription_wide boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_expiry_order check (expires_at is null or starts_at is null or expires_at >= starts_at)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  quotation_id uuid references public.quotations(id) on delete set null,
  billing_period_start date,
  billing_period_end date,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'paid', 'overdue', 'cancelled')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  balance_due numeric(14,2) not null default 0 check (balance_due >= 0),
  issue_date date not null default current_date,
  due_date date not null default current_date + 14,
  notes text,
  generation_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, billing_period_start),
  constraint invoice_total_balance check (balance_due <= total)
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('PAY-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.payment_number_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'upi', 'card', 'other')),
  payment_date date not null default current_date,
  notes text,
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create table public.discount_usages (
  id uuid primary key default gen_random_uuid(),
  discount_id uuid not null references public.discount_rules(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discount_id, invoice_id)
);

create table public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  triggered_by uuid references public.profiles(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'scheduled')),
  subscriptions_checked integer not null default 0,
  invoices_created integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index customers_user_id_idx on public.customers(user_id);
create index customers_email_idx on public.customers(email);
create index products_active_idx on public.products(archived_at, name);
create index plans_product_active_idx on public.subscription_plans(product_id, is_active);
create index quotations_customer_status_idx on public.quotations(customer_id, status, created_at desc);
create index quotation_lines_quotation_idx on public.quotation_lines(quotation_id);
create index subscriptions_customer_status_idx on public.subscriptions(customer_id, status);
create index subscriptions_due_idx on public.subscriptions(next_billing_date) where status = 'active';
create index subscription_lines_subscription_idx on public.subscription_lines(subscription_id);
create index invoice_customer_status_idx on public.invoices(customer_id, status, created_at desc);
create index invoice_due_idx on public.invoices(due_date) where status in ('confirmed', 'overdue');
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index payments_invoice_idx on public.payments(invoice_id, payment_date desc);
create index payments_customer_idx on public.payments(customer_id, payment_date desc);
create index payments_status_date_idx on public.payments(status, payment_date);
create index payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index discount_usage_invoice_idx on public.discount_usages(invoice_id);
create index billing_runs_started_idx on public.billing_runs(started_at desc);
create index activity_entity_idx on public.activity_logs(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'roles', 'profiles', 'customers', 'staff', 'products', 'product_variants', 'subscription_plans',
    'quotation_templates', 'quotations', 'quotation_lines', 'subscriptions', 'subscription_lines',
    'tax_rules', 'discount_rules', 'invoices', 'invoice_lines', 'payments', 'payment_allocations',
    'discount_usages', 'billing_runs'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare clean_name text;
begin
  clean_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, full_name, role)
  values (new.id, clean_name, 'customer')
  on conflict (id) do nothing;
  if coalesce(new.raw_app_meta_data ->> 'role', 'customer') <> 'staff' then
    insert into public.customers (user_id, display_name, email)
    values (new.id, clean_name, lower(new.email))
    on conflict (email) do update
      set user_id = excluded.user_id
      where public.customers.user_id is null;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = (select auth.uid())
$$;
create or replace function public.is_staff(allowed_roles text[] default array['admin', 'staff'])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = any(allowed_roles)
  )
$$;
create or replace function public.current_customer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.customers where user_id = (select auth.uid()) limit 1
$$;

create or replace function public.initialize_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
declare plan public.subscription_plans%rowtype;
begin
  select * into plan from public.subscription_plans where id = new.plan_id and is_active = true;
  if not found then raise exception 'The selected plan is unavailable'; end if;
  if plan.availability_start is not null and new.start_date < plan.availability_start then
    raise exception 'The selected plan is not available yet';
  end if;
  if plan.availability_end is not null and new.start_date > plan.availability_end then
    raise exception 'The selected plan is no longer available';
  end if;
  if new.total = 0 then new.total := plan.price * plan.minimum_quantity; end if;
  new.billing_cycle := plan.billing_cycle;
  new.auto_close := plan.auto_close;
  return new;
end;
$$;
create trigger initialize_subscription_before_insert before insert on public.subscriptions
for each row execute function public.initialize_subscription();

create or replace function public.add_subscription_line()
returns trigger language plpgsql security definer set search_path = public as $$
declare plan public.subscription_plans%rowtype;
declare product public.products%rowtype;
begin
  select * into plan from public.subscription_plans where id = new.plan_id;
  select * into product from public.products where id = plan.product_id;
  insert into public.subscription_lines (subscription_id, product_id, description, quantity, unit_price, line_total)
  values (new.id, product.id, product.name, plan.minimum_quantity, plan.price, plan.price * plan.minimum_quantity);
  return new;
end;
$$;
create trigger create_subscription_line after insert on public.subscriptions
for each row execute function public.add_subscription_line();

create or replace function public.record_payment_atomic(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date date,
  p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare invoice_record public.invoices%rowtype;
declare payment_id uuid;
declare actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if not public.is_staff() then raise exception 'Staff access required to record manual payments'; end if;
  if p_amount <= 0 then raise exception 'Payment amount must be greater than zero'; end if;
  if p_payment_method not in ('cash', 'bank_transfer', 'upi', 'card', 'other') then raise exception 'Unsupported payment method'; end if;

  select * into invoice_record
  from public.invoices
  where id = p_invoice_id
  for update;
  if not found then raise exception 'Invoice not found'; end if;
  if invoice_record.status not in ('confirmed', 'overdue') then raise exception 'Only confirmed invoices can receive payments'; end if;
  if p_amount > invoice_record.balance_due then raise exception 'Payment exceeds the outstanding invoice balance'; end if;

  insert into public.payments (customer_id, invoice_id, amount, payment_method, payment_date, notes, status, recorded_by)
  values (invoice_record.customer_id, invoice_record.id, p_amount, p_payment_method, p_payment_date, p_notes, 'succeeded', actor)
  returning id into payment_id;
  insert into public.payment_allocations (payment_id, invoice_id, amount)
  values (payment_id, invoice_record.id, p_amount);
  update public.invoices
  set balance_due = balance_due - p_amount,
      status = case when balance_due - p_amount = 0 then 'paid' else status end
  where id = invoice_record.id;
  return payment_id;
end;
$$;

create or replace function public.convert_quotation_atomic(p_quotation_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare quote public.quotations%rowtype;
declare plan public.subscription_plans%rowtype;
declare created_subscription public.subscriptions%rowtype;
begin
  select * into quote from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'Quotation not found'; end if;
  if quote.status = 'active' then
    select * into created_subscription from public.subscriptions where quotation_id = quote.id;
    if found then
      return jsonb_build_object('subscription_id', created_subscription.id, 'subscription_number', created_subscription.number);
    end if;
  end if;
  if quote.status <> 'confirmed' then raise exception 'Confirm the quotation before converting it'; end if;
  if quote.valid_until is not null and quote.valid_until < current_date then raise exception 'This quotation has expired'; end if;
  if not exists (select 1 from public.quotation_lines where quotation_id = quote.id) then
    raise exception 'Add at least one product line before converting this quotation';
  end if;

  select sp.* into plan
  from public.subscription_plans sp
  join public.quotation_lines ql on ql.product_id = sp.product_id
  where ql.quotation_id = quote.id and sp.is_active and sp.archived_at is null
  order by sp.created_at
  limit 1;
  if not found then raise exception 'Create an active subscription plan for a quoted product before converting it'; end if;

  insert into public.subscriptions (
    customer_id, plan_id, quotation_id, status, start_date, next_billing_date, total, created_by
  ) values (
    quote.customer_id, plan.id, quote.id, 'active', current_date, current_date, quote.total, p_actor_id
  ) returning * into created_subscription;

  delete from public.subscription_lines where subscription_id = created_subscription.id;
  insert into public.subscription_lines (
    subscription_id, product_id, description, quantity, unit_price, tax_rate, discount_amount, line_total
  )
  select created_subscription.id, product_id, description, quantity, unit_price, tax_rate, discount_amount, line_total
  from public.quotation_lines where quotation_id = quote.id;

  update public.subscriptions set total = quote.total where id = created_subscription.id;
  update public.quotations set status = 'active' where id = quote.id;
  return jsonb_build_object('subscription_id', created_subscription.id, 'subscription_number', created_subscription.number);
end;
$$;

create or replace function public.claim_discount_usage(
  p_discount_id uuid,
  p_invoice_id uuid,
  p_customer_id uuid,
  p_amount numeric
)
returns boolean language plpgsql security definer set search_path = public as $$
declare rule public.discount_rules%rowtype;
declare inserted_id uuid;
begin
  select * into rule from public.discount_rules where id = p_discount_id for update;
  if not found or not rule.is_active then return false; end if;
  if exists (select 1 from public.discount_usages where discount_id = p_discount_id and invoice_id = p_invoice_id) then return true; end if;
  if rule.starts_at is not null and rule.starts_at > now() then return false; end if;
  if rule.expires_at is not null and rule.expires_at < now() then return false; end if;
  if rule.max_uses is not null and rule.usage_count >= rule.max_uses then return false; end if;

  insert into public.discount_usages (discount_id, invoice_id, customer_id, amount)
  values (p_discount_id, p_invoice_id, p_customer_id, p_amount)
  on conflict (discount_id, invoice_id) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    update public.discount_rules set usage_count = usage_count + 1 where id = p_discount_id;
  end if;
  return true;
end;
$$;

create or replace function public.log_business_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare related_customer uuid;
declare related_id uuid;
declare entity_status text;
declare current_actor uuid := (select auth.uid());
begin
  if tg_op = 'DELETE' then
    related_id := old.id;
    entity_status := old.status;
    related_customer := old.customer_id;
  else
    related_id := new.id;
    entity_status := new.status;
    related_customer := new.customer_id;
  end if;
  insert into public.activity_logs (actor_id, customer_id, action, entity_type, entity_id, details)
  values (
    current_actor,
    related_customer,
    lower(tg_op) || case when tg_op = 'UPDATE' then ':' || coalesce(entity_status, '') else '' end,
    tg_table_name,
    related_id,
    jsonb_build_object('status', entity_status)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger subscriptions_activity after insert or update or delete on public.subscriptions for each row execute function public.log_business_activity();
create trigger invoices_activity after insert or update or delete on public.invoices for each row execute function public.log_business_activity();
create trigger payments_activity after insert or update or delete on public.payments for each row execute function public.log_business_activity();
create trigger quotations_activity after insert or update or delete on public.quotations for each row execute function public.log_business_activity();

create or replace function public.prevent_invoice_paid_without_payment()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    if new.balance_due <> 0 or
      not exists (select 1 from public.payments p where p.invoice_id = new.id and p.status = 'succeeded') or
      coalesce((select sum(a.amount) from public.payment_allocations a where a.invoice_id = new.id), 0) < new.total then
      raise exception 'An invoice can only be marked paid after its full balance is allocated from recorded payments';
    end if;
  end if;
  return new;
end;
$$;
create trigger invoice_payment_required before update of status on public.invoices
for each row execute function public.prevent_invoice_paid_without_payment();

create or replace function public.prevent_invoice_cancel_after_payment()
returns trigger language plpgsql as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
    select 1 from public.payment_allocations a where a.invoice_id = new.id
  ) then
    raise exception 'An invoice with allocated payments cannot be cancelled';
  end if;
  return new;
end;
$$;
create trigger invoice_payment_prevents_cancel before update of status on public.invoices
for each row execute function public.prevent_invoice_cancel_after_payment();

create or replace function public.update_invoice_overdue_status()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  if (select auth.uid()) is not null and not public.is_staff() then
    raise exception 'Staff access required';
  end if;
  update public.invoices set status = 'overdue'
  where status = 'confirmed' and balance_due > 0 and due_date < current_date;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.dashboard_summary(p_months integer default 6)
returns jsonb language sql stable security invoker set search_path = public as $$
  with settings as (
    select greatest(1, least(coalesce(p_months, 6), 24)) as month_count
  ),
  active_revenue as (
    select
      count(*) filter (where status = 'active') as active_count,
      count(*) filter (where status = 'paused') as paused_count,
      count(*) filter (where status = 'cancelled') as cancelled_count,
      count(*) as subscription_count,
      coalesce(sum(total * case billing_cycle
        when 'yearly' then 1.0 / 12
        when 'weekly' then 4.345
        when 'daily' then 30
        else 1
      end) filter (where status = 'active'), 0) as mrr
    from public.subscriptions
  ),
  payment_totals as (
    select coalesce(sum(amount), 0) as collected
    from public.payments
    where status = 'succeeded'
  ),
  invoice_totals as (
    select
      coalesce(sum(balance_due) filter (where status in ('confirmed', 'overdue')), 0) as outstanding,
      count(*) filter (where status in ('confirmed', 'overdue') and balance_due > 0) as outstanding_count,
      coalesce(sum(balance_due) filter (
        where status in ('confirmed', 'overdue') and (status = 'overdue' or due_date < current_date)
      ), 0) as overdue_amount,
      count(*) filter (
        where status in ('confirmed', 'overdue') and (status = 'overdue' or due_date < current_date)
      ) as overdue_count
    from public.invoices
  ),
  month_series as (
    select generated.month_start::date as month_start
    from settings
    cross join lateral generate_series(
      date_trunc('month', current_date)::timestamp - ((settings.month_count - 1) * interval '1 month'),
      date_trunc('month', current_date)::timestamp,
      interval '1 month'
    ) as generated(month_start)
  ),
  monthly_revenue as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(month_series.month_start, 'Mon'),
      'revenue', coalesce(month_payments.revenue, 0)
    ) order by month_series.month_start), '[]'::jsonb) as payload
    from month_series
    left join lateral (
      select sum(amount) as revenue
      from public.payments
      where status = 'succeeded'
        and payment_date >= month_series.month_start
        and payment_date < (month_series.month_start + interval '1 month')::date
    ) month_payments on true
  ),
  monthly_customers as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(month_series.month_start, 'Mon'),
      'customers', coalesce(month_customers.customer_count, 0)
    ) order by month_series.month_start), '[]'::jsonb) as payload
    from month_series
    left join lateral (
      select count(*) as customer_count
      from public.customers
      where created_at >= month_series.month_start
        and created_at < (month_series.month_start + interval '1 month')::date
    ) month_customers on true
  ),
  recent_payments as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', recent.id,
      'reference', recent.reference,
      'amount', recent.amount,
      'status', recent.status,
      'payment_date', recent.payment_date,
      'customer_name', customer.display_name,
      'invoice_number', invoice.number
    ) order by recent.payment_date desc), '[]'::jsonb) as payload
    from (
      select id, reference, amount, status, payment_date, customer_id, invoice_id
      from public.payments
      order by payment_date desc, created_at desc
      limit 5
    ) recent
    left join public.customers customer on customer.id = recent.customer_id
    left join public.invoices invoice on invoice.id = recent.invoice_id
  )
  select jsonb_build_object(
    'total_collected', payment_totals.collected,
    'mrr', active_revenue.mrr,
    'active_count', active_revenue.active_count,
    'paused_count', active_revenue.paused_count,
    'cancelled_count', active_revenue.cancelled_count,
    'subscription_count', active_revenue.subscription_count,
    'customer_count', (select count(*) from public.customers),
    'outstanding', invoice_totals.outstanding,
    'outstanding_count', invoice_totals.outstanding_count,
    'overdue_count', invoice_totals.overdue_count,
    'overdue_amount', invoice_totals.overdue_amount,
    'monthly_revenue', monthly_revenue.payload,
    'monthly_customers', monthly_customers.payload,
    'recent_payments', recent_payments.payload
  )
  from active_revenue, payment_totals, invoice_totals, monthly_revenue, monthly_customers, recent_payments
$$;

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.staff enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.quotation_templates enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_lines enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_lines enable row level security;
alter table public.tax_rules enable row level security;
alter table public.discount_rules enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.discount_usages enable row level security;
alter table public.billing_runs enable row level security;
alter table public.activity_logs enable row level security;

create policy "roles readable to authenticated users" on public.roles for select to authenticated using (true);
create policy "profiles read own or admin" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_staff(array['admin']));
create policy "profiles update own safe fields" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create policy "customers read own or staff" on public.customers for select to authenticated using (user_id = (select auth.uid()) or public.is_staff());
create policy "staff manage customers" on public.customers for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "customer update own profile" on public.customers for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "staff read staff records" on public.staff for select to authenticated using (public.is_staff());
create policy "admin manage staff records" on public.staff for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

create policy "catalog available to authenticated users" on public.products for select to authenticated using (archived_at is null or public.is_staff());
create policy "admin manage products" on public.products for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));
create policy "variants available with catalog" on public.product_variants for select to authenticated using (
  is_active and exists (select 1 from public.products p where p.id = product_id and p.archived_at is null)
  or public.is_staff()
);
create policy "admin manage variants" on public.product_variants for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

create policy "active plans visible to authenticated" on public.subscription_plans for select to authenticated using (is_active and archived_at is null or public.is_staff());
create policy "admin manage plans" on public.subscription_plans for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));
create policy "staff read quotation templates" on public.quotation_templates for select to authenticated using (public.is_staff());
create policy "admin manage quotation templates" on public.quotation_templates for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

create policy "quotations staff or owner read" on public.quotations for select to authenticated using (
  public.is_staff() or exists (select 1 from public.customers c where c.id = customer_id and c.user_id = (select auth.uid()))
);
create policy "staff manage quotations" on public.quotations for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "quotation lines staff or owner read" on public.quotation_lines for select to authenticated using (
  public.is_staff() or exists (select 1 from public.quotations q join public.customers c on c.id = q.customer_id where q.id = quotation_id and c.user_id = (select auth.uid()))
);
create policy "staff manage quotation lines" on public.quotation_lines for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "subscriptions staff or owner read" on public.subscriptions for select to authenticated using (
  public.is_staff() or customer_id = (select public.current_customer_id())
);
create policy "staff manage subscriptions" on public.subscriptions for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "subscription lines staff or owner read" on public.subscription_lines for select to authenticated using (
  public.is_staff() or exists (select 1 from public.subscriptions s where s.id = subscription_id and s.customer_id = (select public.current_customer_id()))
);
create policy "staff manage subscription lines" on public.subscription_lines for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "tax rules visible to staff" on public.tax_rules for select to authenticated using (public.is_staff());
create policy "admin manage taxes" on public.tax_rules for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));
create policy "discounts available to staff" on public.discount_rules for select to authenticated using (public.is_staff());
create policy "admin manage discounts" on public.discount_rules for all to authenticated using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

create policy "invoices staff or owner read" on public.invoices for select to authenticated using (
  public.is_staff() or customer_id = (select public.current_customer_id())
);
create policy "staff manage invoices" on public.invoices for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "invoice lines staff or owner read" on public.invoice_lines for select to authenticated using (
  public.is_staff() or exists (select 1 from public.invoices i where i.id = invoice_id and i.customer_id = (select public.current_customer_id()))
);
create policy "staff manage invoice lines" on public.invoice_lines for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "payments staff or owner read" on public.payments for select to authenticated using (
  public.is_staff() or customer_id = (select public.current_customer_id())
);
revoke insert, update, delete on public.payments from authenticated;
create policy "payment allocations staff or owner read" on public.payment_allocations for select to authenticated using (
  public.is_staff() or exists (select 1 from public.invoices i where i.id = invoice_id and i.customer_id = (select public.current_customer_id()))
);
create policy "discount usage staff or owner read" on public.discount_usages for select to authenticated using (
  public.is_staff() or customer_id = (select public.current_customer_id())
);
create policy "billing runs visible to staff" on public.billing_runs for select to authenticated using (public.is_staff());
create policy "activity logs visible to staff or owner" on public.activity_logs for select to authenticated using (
  public.is_staff() or customer_id = (select public.current_customer_id())
);

grant execute on function public.record_payment_atomic(uuid, numeric, text, date, text) to authenticated;
grant execute on function public.update_invoice_overdue_status() to authenticated;
grant execute on function public.dashboard_summary(integer) to authenticated;
revoke all on function public.record_payment_atomic(uuid, numeric, text, date, text) from public, anon;
revoke all on function public.update_invoice_overdue_status() from public, anon;
revoke all on function public.dashboard_summary(integer) from public, anon;
revoke all on function public.convert_quotation_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.convert_quotation_atomic(uuid, uuid) to service_role;
revoke all on function public.claim_discount_usage(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.claim_discount_usage(uuid, uuid, uuid, numeric) to service_role;
