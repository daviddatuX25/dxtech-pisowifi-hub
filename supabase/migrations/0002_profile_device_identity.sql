-- Device ID is the sole public profile identifier. Keep the legacy column synchronized for schema compatibility.
update public.profiles
set id_value = device_id
where id_value is distinct from device_id;

do $$
begin
  if exists (
    select device_id
    from public.profiles
    group by device_id
    having count(*) > 1
  ) then
    raise exception 'Cannot enforce one profile per Device ID until duplicate profiles are resolved.';
  end if;
end;
$$;

create unique index if not exists profiles_device_id_unique
  on public.profiles(device_id);

alter table public.profiles
  add constraint profiles_id_value_matches_device_id
  check (id_value = device_id);
