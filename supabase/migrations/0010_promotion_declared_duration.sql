alter table public.promotions
  add column if not exists declared_duration text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.promotions'::regclass
      and conname = 'promotions_declared_duration_check'
  ) then
    alter table public.promotions
      add constraint promotions_declared_duration_check
      check (
        declared_duration is null or
        (length(declared_duration) <= 80 and length(btrim(declared_duration)) > 0)
      );
  end if;
end;
$$;

-- Infer only a single unambiguous duration across every voucher row. Preserve
-- any administrator-saved declaration if this migration is reapplied.
with uniform_durations as (
  select promotion_id, min(btrim(duration_label)) as duration
  from public.promotion_vouchers
  group by promotion_id
  having bool_and(duration_label is not null and length(btrim(duration_label)) between 1 and 80)
     and count(distinct lower(btrim(duration_label))) = 1
)
update public.promotions p
set declared_duration = d.duration
from uniform_durations d
where p.id = d.promotion_id
  and p.declared_duration is null;

create or replace function public.save_promotion_with_inventory(
  p_admin_user_id uuid,
  p_promotion_id uuid,
  p_values jsonb,
  p_slots jsonb,
  p_vouchers jsonb
)
returns table(promotion_id uuid, published_at timestamptz, newly_published boolean)
language plpgsql
as $$
#variable_conflict use_column
declare
  old_promotion public.promotions;
  saved_promotion_id uuid;
  saved_published_at timestamptz;
  was_published boolean := false;
  old_slot record;
  new_capacity integer;
begin
  if p_promotion_id is not null then
    select * into old_promotion
    from public.promotions
    where id = p_promotion_id
    for update;

    if not found then
      raise exception 'Promo not found.' using errcode = 'PT404';
    end if;
    was_published := old_promotion.published;
  end if;

  -- Verify capacity changes against locked promotion and slot state before writing.
  if p_promotion_id is not null then
    for old_slot in
      select ps.branch_id, ps.approved_count
      from public.promotion_slots ps
      where ps.promotion_id = p_promotion_id
      order by ps.branch_id
      for update
    loop
      select (item->>'capacity')::integer into new_capacity
      from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) item
      where (item->>'branch_id')::uuid = old_slot.branch_id
      limit 1;

      if new_capacity is null and old_slot.approved_count > 0 then
        raise exception 'An approved slot cannot be removed.' using errcode = 'PT409';
      end if;
      if new_capacity is not null and new_capacity < old_slot.approved_count then
        raise exception 'Capacity cannot be lower than approved requests.' using errcode = 'PT409';
      end if;
    end loop;
  end if;

  saved_published_at := case
    when coalesce((p_values->>'published')::boolean, false) then
      case when was_published then old_promotion.published_at else now() end
    else null
  end;

  if p_promotion_id is null then
    insert into public.promotions (
      name, description, audience, fulfillment_type, requires_student_document,
      declared_duration, published, active, notify_on_publish, published_at
    ) values (
      p_values->>'name', p_values->>'description', (p_values->>'audience')::public.audience_type,
      p_values->>'fulfillment_type', (p_values->>'requires_student_document')::boolean,
      nullif(btrim(p_values->>'declared_duration'), ''),
      (p_values->>'published')::boolean, (p_values->>'active')::boolean,
      (p_values->>'notify_on_publish')::boolean, saved_published_at
    ) returning id into saved_promotion_id;
  else
    update public.promotions
    set name = p_values->>'name',
        description = p_values->>'description',
        audience = (p_values->>'audience')::public.audience_type,
        fulfillment_type = p_values->>'fulfillment_type',
        requires_student_document = (p_values->>'requires_student_document')::boolean,
        declared_duration = nullif(btrim(p_values->>'declared_duration'), ''),
        published = (p_values->>'published')::boolean,
        active = (p_values->>'active')::boolean,
        notify_on_publish = (p_values->>'notify_on_publish')::boolean,
        published_at = saved_published_at,
        updated_at = now()
    where id = p_promotion_id;
    saved_promotion_id := p_promotion_id;
  end if;

  insert into public.promotion_slots (promotion_id, branch_id, capacity)
  select saved_promotion_id, slot.branch_id, slot.capacity
  from jsonb_to_recordset(coalesce(p_slots, '[]'::jsonb)) as slot(branch_id uuid, capacity integer)
  on conflict (promotion_id, branch_id) do update
    set capacity = excluded.capacity;

  delete from public.promotion_slots ps
  where ps.promotion_id = saved_promotion_id
    and ps.approved_count = 0
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_slots, '[]'::jsonb)) item
      where (item->>'branch_id')::uuid = ps.branch_id
    );

  insert into public.promotion_vouchers (promotion_id, branch_id, code, duration_label)
  select saved_promotion_id, voucher.branch_id, voucher.code, voucher.duration_label
  from jsonb_to_recordset(coalesce(p_vouchers, '[]'::jsonb))
    as voucher(branch_id uuid, code text, duration_label text)
  on conflict (promotion_id, branch_id, code) do nothing;

  insert into public.audit_logs (admin_user_id, action, target_type, target_id, outcome, metadata)
  values (
    p_admin_user_id,
    case when p_promotion_id is null then 'create_promotion' else 'update_promotion' end,
    'promotion', saved_promotion_id, 'success',
    jsonb_build_object(
      'published', (p_values->>'published')::boolean,
      'audience', p_values->>'audience',
      'fulfillmentType', p_values->>'fulfillment_type',
      'declaredDuration', nullif(btrim(p_values->>'declared_duration'), '')
    )
  );

  promotion_id := saved_promotion_id;
  published_at := saved_published_at;
  newly_published := not was_published and coalesce((p_values->>'published')::boolean, false);
  return next;
end;
$$;

revoke all on function public.save_promotion_with_inventory(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_promotion_with_inventory(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
