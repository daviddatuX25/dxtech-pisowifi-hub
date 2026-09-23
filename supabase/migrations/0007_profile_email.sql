-- 0007_profile_email.sql
-- Adds optional email to customer profiles for email alerts and updates
-- Updates notification_jobs event_type constraint to allow admin notifications

alter table public.profiles
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_email_format'
  ) then
    alter table public.profiles
      add constraint profiles_email_format
      check (email is null or (char_length(trim(email)) <= 255 and email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'));
  end if;
end;
$$;

create index if not exists profiles_email_idx
  on public.profiles(branch_id, email)
  where email is not null;

-- Expand notification_jobs event_type to include admin alert events
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.notification_jobs'::regclass
      and conname = 'notification_jobs_event_type_check'
  ) then
    alter table public.notification_jobs
      drop constraint notification_jobs_event_type_check;
    alter table public.notification_jobs
      add constraint notification_jobs_event_type_check
      check (event_type in ('new_promotion', 'request_reviewed', 'issue_reviewed', 'admin_promo_request'));
  end if;
end;
$$;
