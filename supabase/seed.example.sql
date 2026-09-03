-- Manual launch seed. Replace placeholders; do not run unchanged.
-- Create the Auth user first, then use the UUID from auth.users.
insert into public.admins (user_id, display_name)
values ('00000000-0000-0000-0000-000000000000', 'Owner');

-- Launch branches.
insert into public.branches (name, active)
values
  ('Lisa’s Canteen [Candon] Branch', true),
  ('Pudoc Branch', true)
on conflict (name) do update set active = excluded.active;
