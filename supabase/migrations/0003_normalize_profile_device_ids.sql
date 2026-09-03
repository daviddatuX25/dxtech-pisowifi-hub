-- Normalize legacy Device IDs before enforcing case-insensitive uniqueness.
drop index if exists public.profiles_device_id_unique;

update public.profiles
set device_id = upper(device_id),
    id_value = upper(device_id)
where device_id is distinct from upper(device_id)
   or id_value is distinct from upper(device_id);

do $$
begin
  if exists (
    select upper(device_id)
    from public.profiles
    group by upper(device_id)
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one profile per normalized Device ID until duplicate profiles are resolved.';
  end if;
end;
$$;

create unique index profiles_device_id_unique
  on public.profiles (upper(device_id));
