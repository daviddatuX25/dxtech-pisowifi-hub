\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values ('12000000-0000-0000-0000-000000000001');
insert into public.branches (id, name) values
  ('22000000-0000-0000-0000-000000000001', 'declared-duration-test');
insert into public.profiles (id, device_id, id_value, name, branch_id, privacy_consent_at) values
  ('32000000-0000-0000-0000-000000000001', 'DURATIONPROFILE1', 'DURATIONPROFILE1', 'Duration test', '22000000-0000-0000-0000-000000000001', now());

-- Fixtures created as if they predated the declared-duration migration.
insert into public.promotions (id, name, audience, fulfillment_type, requires_student_document, published, active, notify_on_publish) values
  ('42000000-0000-0000-0000-000000000001', 'Uniform duration', 'everyone', 'voucher', false, true, true, false),
  ('42000000-0000-0000-0000-000000000002', 'Mixed duration', 'everyone', 'voucher', false, true, true, false),
  ('42000000-0000-0000-0000-000000000003', 'Unknown duration', 'everyone', 'voucher', false, true, true, false),
  ('42000000-0000-0000-0000-000000000004', 'Saved duration', 'everyone', 'voucher', false, true, true, false);
insert into public.promotion_vouchers (promotion_id, branch_id, code, duration_label) values
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'UNIFORM-A', '  30 Days '),
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'UNIFORM-B', '30 days'),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', 'MIXED-A', '30 days'),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', 'MIXED-B', '60 days'),
  ('42000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000001', 'UNKNOWN-A', null),
  ('42000000-0000-0000-0000-000000000004', '22000000-0000-0000-0000-000000000001', 'SAVED-A', '90 days');
update public.promotions set declared_duration='Administrator value' where id='42000000-0000-0000-0000-000000000004';
\ir ../migrations/0010_promotion_declared_duration.sql

DO $$
DECLARE
  v_admin uuid := '12000000-0000-0000-0000-000000000001';
  v_branch uuid := '22000000-0000-0000-0000-000000000001';
  v_promo uuid;
  v_request uuid;
  v_audit_count integer;
  v_voucher_id uuid;
  v_metadata jsonb;
  v_values jsonb := '{"name":"Declared duration create","description":"test","audience":"everyone","fulfillment_type":"manual_topup","requires_student_document":false,"declared_duration":"  2 hours ","published":false,"active":true,"notify_on_publish":false}'::jsonb;
BEGIN
  IF (SELECT declared_duration FROM public.promotions WHERE id='42000000-0000-0000-0000-000000000001') <> '30 Days' THEN
    RAISE EXCEPTION 'uniform voucher duration was not backfilled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotions WHERE id IN ('42000000-0000-0000-0000-000000000002','42000000-0000-0000-0000-000000000003') AND declared_duration IS NOT NULL) THEN
    RAISE EXCEPTION 'mixed or unknown voucher duration was backfilled';
  END IF;
  IF (SELECT declared_duration FROM public.promotions WHERE id='42000000-0000-0000-0000-000000000004') <> 'Administrator value' THEN
    RAISE EXCEPTION 'backfill overwrote an existing administrator declaration';
  END IF;

  SELECT promotion_id INTO v_promo FROM public.save_promotion_with_inventory(
    v_admin, null, v_values, '[]'::jsonb, '[]'::jsonb
  );
  IF (SELECT declared_duration FROM public.promotions WHERE id=v_promo) <> '2 hours' OR
     (SELECT metadata->>'declaredDuration' FROM public.audit_logs WHERE target_id=v_promo AND action='create_promotion') <> '2 hours' THEN
    RAISE EXCEPTION 'create did not persist normalized declared duration and audit metadata';
  END IF;

  INSERT INTO public.promotion_vouchers (promotion_id, branch_id, code, duration_label)
  VALUES (v_promo, v_branch, 'VOUCHER-CLAIMED', 'voucher-specific 45 minutes') RETURNING id INTO v_voucher_id;
  INSERT INTO public.promo_requests (promotion_id, profile_id, branch_id, status, voucher_code)
  VALUES (v_promo, '32000000-0000-0000-0000-000000000001', v_branch, 'approved', 'VOUCHER-CLAIMED') RETURNING id INTO v_request;
  UPDATE public.promotion_vouchers SET assigned_profile_id='32000000-0000-0000-0000-000000000001', assigned_request_id=v_request, assigned_at=now() WHERE id=v_voucher_id;

  v_values := jsonb_set(v_values, '{name}', '"Declared duration edited"'::jsonb);
  v_values := jsonb_set(v_values, '{declared_duration}', '"  3 hours "'::jsonb);
  PERFORM public.save_promotion_with_inventory(v_admin, v_promo, v_values, '[]'::jsonb, '[]'::jsonb);
  IF (SELECT declared_duration FROM public.promotions WHERE id=v_promo) <> '3 hours' OR
     NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE target_id=v_promo AND action='update_promotion' AND metadata->>'declaredDuration'='3 hours') THEN
    RAISE EXCEPTION 'edit did not persist declared duration and audit metadata';
  END IF;
  IF (SELECT duration_label FROM public.promotion_vouchers WHERE id=v_voucher_id) <> 'voucher-specific 45 minutes' OR
     (SELECT assigned_request_id FROM public.promotion_vouchers WHERE id=v_voucher_id) <> v_request OR
     NOT EXISTS (SELECT 1 FROM public.promo_requests WHERE id=v_request AND voucher_code='VOUCHER-CLAIMED') THEN
    RAISE EXCEPTION 'metadata-only edit changed voucher duration or claim state';
  END IF;

  v_values := jsonb_set(v_values, '{declared_duration}', '"   "'::jsonb);
  PERFORM public.save_promotion_with_inventory(v_admin, v_promo, v_values, '[]'::jsonb, '[]'::jsonb);
  IF (SELECT declared_duration FROM public.promotions WHERE id=v_promo) IS NOT NULL OR
     NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE target_id=v_promo AND action='update_promotion' AND metadata ? 'declaredDuration' AND metadata->>'declaredDuration' IS NULL) THEN
    RAISE EXCEPTION 'empty declaration did not clear to null';
  END IF;

  SELECT count(*) INTO v_audit_count FROM public.audit_logs WHERE target_id=v_promo;
  BEGIN
    PERFORM public.save_promotion_with_inventory(
      '12000000-0000-0000-0000-000000000099', v_promo,
      jsonb_set(v_values, '{name}', '"audit failure must roll back"'::jsonb), '[]'::jsonb, '[]'::jsonb
    );
    RAISE EXCEPTION 'save with invalid audit admin unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF (SELECT name FROM public.promotions WHERE id=v_promo) <> 'Declared duration edited' OR
     (SELECT count(*) FROM public.audit_logs WHERE target_id=v_promo) <> v_audit_count THEN
    RAISE EXCEPTION 'audit failure did not roll back promotion update';
  END IF;

  BEGIN
    INSERT INTO public.promotions (name, audience, fulfillment_type, requires_student_document, declared_duration)
    VALUES ('Too long duration', 'everyone', 'manual_topup', false, repeat('x', 81));
    RAISE EXCEPTION 'overlength declared duration unexpectedly inserted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.promotions (name, audience, fulfillment_type, requires_student_document, declared_duration)
    VALUES ('Blank duration', 'everyone', 'manual_topup', false, '   ');
    RAISE EXCEPTION 'blank declared duration unexpectedly inserted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

rollback;
