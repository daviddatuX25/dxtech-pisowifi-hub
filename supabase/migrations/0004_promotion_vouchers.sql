alter table public.promotions
  add column if not exists fulfillment_type text not null default 'manual_topup';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.promotions'::regclass
      and conname = 'promotions_fulfillment_type_check'
  ) then
    alter table public.promotions
      add constraint promotions_fulfillment_type_check
      check (fulfillment_type in ('manual_topup', 'voucher'));
  end if;
end;
$$;

alter table public.promo_requests
  add column if not exists voucher_code text;

create table if not exists public.promotion_vouchers (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  code text not null,
  duration_label text,
  metadata jsonb not null default '{}'::jsonb,
  assigned_profile_id uuid references public.profiles(id) on delete set null,
  assigned_request_id uuid references public.promo_requests(id) on delete set null,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  constraint promotion_vouchers_unique_code unique (promotion_id, code)
);

alter table public.promotion_vouchers
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.promotion_vouchers'::regclass
      and conname = 'promotion_vouchers_unique_code'
  ) then
    alter table public.promotion_vouchers
      add constraint promotion_vouchers_unique_code unique (promotion_id, code);
  end if;
end;
$$;

create index if not exists promotion_vouchers_available_idx
  on public.promotion_vouchers(promotion_id, branch_id, created_at)
  where assigned_profile_id is null;

alter table public.promotion_vouchers enable row level security;
