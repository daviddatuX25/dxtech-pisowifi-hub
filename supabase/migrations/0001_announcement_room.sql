create extension if not exists pgcrypto;

create type public.audience_type as enum ('everyone', 'students');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.issue_type as enum ('ghost_credit', 'lost_points');
create type public.credit_unit as enum ('money', 'time', 'coins');
create type public.notification_job_status as enum ('pending', 'processing', 'sent', 'failed');

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  device_id text not null check (device_id ~ '^[A-Z0-9]{1,64}$'),
  id_value text not null check (char_length(trim(id_value)) between 1 and 120),
  name text not null check (char_length(trim(name)) between 1 and 120),
  branch_id uuid not null references public.branches(id),
  privacy_consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index profile_sessions_lookup_idx on public.profile_sessions(token_hash, expires_at);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 500),
  audience public.audience_type not null default 'everyone',
  requires_student_document boolean not null default false,
  active boolean not null default true,
  published boolean not null default false,
  notify_on_publish boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.promotion_slots (
  promotion_id uuid not null references public.promotions(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  capacity integer not null default 0 check (capacity >= 0),
  approved_count integer not null default 0 check (approved_count >= 0 and approved_count <= capacity),
  primary key (promotion_id, branch_id)
);

create table public.student_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index student_documents_profile_idx on public.student_documents(profile_id, created_at desc);

create table public.promo_requests (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions(id),
  profile_id uuid not null references public.profiles(id),
  branch_id uuid not null references public.branches(id),
  student_document_id uuid references public.student_documents(id),
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (promotion_id, profile_id)
);

create index promo_requests_review_idx on public.promo_requests(status, created_at desc);
create index promo_requests_profile_idx on public.promo_requests(profile_id, created_at desc);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  branch_id uuid not null references public.branches(id),
  issue_type public.issue_type not null,
  unit public.credit_unit,
  amount_inserted numeric(14, 2),
  amount_credited numeric(14, 2),
  points_lost numeric(14, 2),
  description text check (description is null or char_length(description) <= 500),
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint issue_values_valid check (
    (issue_type = 'ghost_credit'
      and unit is not null
      and amount_inserted is not null
      and amount_inserted > 0
      and amount_credited is not null
      and amount_credited >= 0
      and amount_credited <= amount_inserted
      and points_lost is null)
    or
    (issue_type = 'lost_points'
      and points_lost is not null
      and points_lost > 0
      and unit is null
      and amount_inserted is null
      and amount_credited is null)
  )
);

create index issues_review_idx on public.issues(status, created_at desc);
create index issues_profile_idx on public.issues(profile_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_profile_idx on public.push_subscriptions(profile_id, active);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('new_promotion', 'request_reviewed', 'issue_reviewed')),
  target_profile_id uuid references public.profiles(id) on delete cascade,
  payload jsonb not null,
  status public.notification_job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  dedupe_key text not null unique
);

create index notification_jobs_work_idx on public.notification_jobs(status, next_attempt_at, created_at);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.rate_limit_buckets (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do update set public = false;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_sessions enable row level security;
alter table public.admins enable row level security;
alter table public.promotions enable row level security;
alter table public.promotion_slots enable row level security;
alter table public.student_documents enable row level security;
alter table public.promo_requests enable row level security;
alter table public.issues enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_buckets enable row level security;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_bucket public.rate_limit_buckets;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  select * into current_bucket
  from public.rate_limit_buckets
  where key_hash = p_key_hash
  for update;

  if not found then
    insert into public.rate_limit_buckets (key_hash, request_count)
    values (p_key_hash, 1)
    on conflict (key_hash) do nothing;
    if found then
      return true;
    end if;
    select * into current_bucket
    from public.rate_limit_buckets
    where key_hash = p_key_hash
    for update;
  end if;

  if now() >= current_bucket.window_started_at + make_interval(secs => p_window_seconds) then
    update public.rate_limit_buckets
    set window_started_at = now(), request_count = 1, updated_at = now()
    where key_hash = p_key_hash;
    return true;
  end if;

  if current_bucket.request_count >= p_limit then
    update public.rate_limit_buckets set updated_at = now() where key_hash = p_key_hash;
    return false;
  end if;

  update public.rate_limit_buckets
  set request_count = request_count + 1, updated_at = now()
  where key_hash = p_key_hash;
  return true;
end;
$$;

create or replace function public.review_promo_requests(
  p_request_ids uuid[],
  p_status public.request_status,
  p_admin_user_id uuid
)
returns table(request_id uuid, outcome text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_request public.promo_requests;
  current_slot public.promotion_slots;
  current_promotion public.promotions;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid review status';
  end if;

  for current_request in
    select *
    from public.promo_requests
    where id = any(p_request_ids)
    order by id
    for update
  loop
    request_id := current_request.id;

    if current_request.status <> 'pending' then
      outcome := 'skipped';
      reason := 'request_already_reviewed';
      return next;
      continue;
    end if;

    select * into current_promotion from public.promotions where id = current_request.promotion_id;

    if p_status = 'rejected' then
      update public.promo_requests
      set status = 'rejected', reviewed_by = p_admin_user_id, reviewed_at = now()
      where id = current_request.id;

      insert into public.audit_logs (admin_user_id, action, target_type, target_id, outcome, metadata)
      values (p_admin_user_id, 'reject_promo_request', 'promo_request', current_request.id, 'success', jsonb_build_object('promotion_id', current_request.promotion_id));

      begin
        insert into public.notification_jobs (event_type, target_profile_id, payload, dedupe_key)
        values (
          'request_reviewed', current_request.profile_id,
          jsonb_build_object('title', 'Request update', 'body', coalesce(current_promotion.name, 'Promo') || ' was not approved.', 'path', '/'),
          'promo-request:' || current_request.id::text || ':rejected'
        )
        on conflict (dedupe_key) do nothing;
      exception when others then
        null;
      end;

      outcome := 'rejected';
      reason := null;
      return next;
      continue;
    end if;

    select * into current_slot
    from public.promotion_slots
    where promotion_id = current_request.promotion_id
      and branch_id = current_request.branch_id
    for update;

    if not found then
      outcome := 'skipped';
      reason := 'slot_not_configured';
      return next;
      continue;
    end if;

    if current_slot.approved_count >= current_slot.capacity then
      outcome := 'skipped';
      reason := 'no_available_slot';
      return next;
      continue;
    end if;

    update public.promo_requests
    set status = 'approved', reviewed_by = p_admin_user_id, reviewed_at = now()
    where id = current_request.id;

    update public.promotion_slots
    set approved_count = approved_count + 1
    where promotion_id = current_request.promotion_id
      and branch_id = current_request.branch_id;

    insert into public.audit_logs (admin_user_id, action, target_type, target_id, outcome, metadata)
    values (p_admin_user_id, 'approve_promo_request', 'promo_request', current_request.id, 'success', jsonb_build_object('promotion_id', current_request.promotion_id, 'branch_id', current_request.branch_id));

    begin
      insert into public.notification_jobs (event_type, target_profile_id, payload, dedupe_key)
      values (
        'request_reviewed', current_request.profile_id,
        jsonb_build_object('title', 'Request approved', 'body', coalesce(current_promotion.name, 'Promo') || ' was approved. Please visit the administrator for next steps.', 'path', '/'),
        'promo-request:' || current_request.id::text || ':approved'
      )
      on conflict (dedupe_key) do nothing;
    exception when others then
      null;
    end;

    outcome := 'approved';
    reason := null;
    return next;
  end loop;
end;
$$;

create or replace function public.claim_notification_jobs(p_limit integer default 20)
returns setof public.notification_jobs
language sql
security definer
set search_path = public
as $$
  with claimable as (
    select id
    from public.notification_jobs
    where (status = 'pending'
        and (next_attempt_at is null or next_attempt_at <= now()))
       or (status = 'processing' and locked_at < now() - interval '10 minutes')
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.notification_jobs jobs
  set status = 'processing', attempts = jobs.attempts + 1, locked_at = now(), locked_by = gen_random_uuid()::text, last_error = null
  from claimable
  where jobs.id = claimable.id
  returning jobs.*;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.review_promo_requests(uuid[], public.request_status, uuid) from public, anon, authenticated;
revoke all on function public.claim_notification_jobs(integer) from public, anon, authenticated;
