create or replace function public.delete_promotion_with_inventory(
  p_admin_user_id uuid,
  p_promotion_id uuid
)
returns uuid
language plpgsql
as $$
declare
  selected_promotion public.promotions;
  slot_count bigint;
  voucher_count bigint;
begin
  select * into selected_promotion
  from public.promotions
  where id = p_promotion_id
  for update;

  if not found then
    raise exception 'Promo not found.' using errcode = 'PT404';
  end if;

  if exists (
    select 1 from public.promo_requests
    where promotion_id = p_promotion_id
  ) or exists (
    select 1 from public.promotion_vouchers
    where promotion_id = p_promotion_id
      and (assigned_profile_id is not null
        or assigned_request_id is not null
        or assigned_at is not null)
  ) or exists (
    select 1 from public.promotion_slots
    where promotion_id = p_promotion_id
      and approved_count > 0
  ) then
    raise exception 'Promo has request or assigned-inventory history.' using errcode = 'PT409';
  end if;

  select count(*) into slot_count
  from public.promotion_slots
  where promotion_id = p_promotion_id;
  select count(*) into voucher_count
  from public.promotion_vouchers
  where promotion_id = p_promotion_id;

  delete from public.notification_jobs
  where event_type = 'new_promotion'
    and status = 'pending'
    and dedupe_key like 'promotion:' || p_promotion_id::text || ':%';

  insert into public.audit_logs (admin_user_id, action, target_type, target_id, outcome, metadata)
  values (
    p_admin_user_id,
    'delete_promotion',
    'promotion',
    p_promotion_id,
    'success',
    jsonb_build_object(
      'name', selected_promotion.name,
      'slotCount', slot_count,
      'voucherCount', voucher_count
    )
  );

  delete from public.promotions
  where id = p_promotion_id;

  return p_promotion_id;
end;
$$;

revoke all on function public.delete_promotion_with_inventory(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_promotion_with_inventory(uuid, uuid) to service_role;
