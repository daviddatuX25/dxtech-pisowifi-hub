create or replace function public.claim_voucher_promo(
  p_promotion_id uuid,
  p_profile_id uuid,
  p_branch_id uuid,
  p_student_document_id uuid default null
)
returns table(request_id uuid, voucher_code text, duration_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_promotion public.promotions;
  selected_voucher public.promotion_vouchers;
  created_request public.promo_requests;
begin
  select *
  into selected_promotion
  from public.promotions
  where id = p_promotion_id
    and active
    and published
    and fulfillment_type = 'voucher'
  for share;

  if not found then
    raise exception 'voucher_promo_unavailable' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and branch_id = p_branch_id
  ) then
    raise exception 'profile_branch_mismatch' using errcode = 'P0004';
  end if;

  if (selected_promotion.audience = 'students' or selected_promotion.requires_student_document)
     and not exists (
       select 1
       from public.student_documents
       where id = p_student_document_id
         and profile_id = p_profile_id
         and deleted_at is null
     ) then
    raise exception 'student_document_required' using errcode = 'P0005';
  end if;

  if exists (
    select 1
    from public.promo_requests
    where promotion_id = p_promotion_id
      and profile_id = p_profile_id
  ) then
    raise exception 'voucher_already_claimed' using errcode = 'P0003';
  end if;

  select *
  into selected_voucher
  from public.promotion_vouchers
  where promotion_id = p_promotion_id
    and assigned_profile_id is null
    and (branch_id is null or branch_id = p_branch_id)
  order by created_at, id
  for update skip locked
  limit 1;

  if not found then
    raise exception 'voucher_unavailable' using errcode = 'P0002';
  end if;

  insert into public.promo_requests (
    promotion_id,
    profile_id,
    branch_id,
    student_document_id,
    status,
    voucher_code,
    reviewed_at
  )
  values (
    p_promotion_id,
    p_profile_id,
    p_branch_id,
    p_student_document_id,
    'approved',
    selected_voucher.code,
    now()
  )
  returning * into created_request;

  update public.promotion_vouchers
  set assigned_profile_id = p_profile_id,
      assigned_request_id = created_request.id,
      assigned_at = now()
  where id = selected_voucher.id;

  request_id := created_request.id;
  voucher_code := created_request.voucher_code;
  duration_label := selected_voucher.duration_label;
  return next;
end;
$$;

revoke all on function public.claim_voucher_promo(uuid, uuid, uuid, uuid) from public, anon, authenticated;
