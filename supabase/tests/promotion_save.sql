\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values ('10000000-0000-0000-0000-000000000001');
insert into public.branches (id, name) values
  ('20000000-0000-0000-0000-000000000001', 'promotion-save-test-a'),
  ('20000000-0000-0000-0000-000000000002', 'promotion-save-test-b');

-- A representative valid value document used throughout the transaction tests.
DO $$
DECLARE
  v_admin uuid := '10000000-0000-0000-0000-000000000001';
  v_branch_a uuid := '20000000-0000-0000-0000-000000000001';
  v_branch_b uuid := '20000000-0000-0000-0000-000000000002';
  v_promo uuid;
  v_result record;
  v_count integer;
  v_audit_before integer;
  v_existing_id uuid := '30000000-0000-0000-0000-000000000002';
  v_value jsonb := '{"name":"Atomic voucher test","description":"test","audience":"everyone","fulfillment_type":"voucher","requires_student_document":false,"published":true,"active":true,"notify_on_publish":false}'::jsonb;
BEGIN
  -- Fifty voucher entries persist against the requested branch.
  SELECT * INTO v_result
  FROM public.save_promotion_with_inventory(
    v_admin, null, v_value, '[]'::jsonb,
    (SELECT jsonb_agg(jsonb_build_object('branch_id', v_branch_a, 'code', 'CODE-' || n, 'duration_label', '30 days'))
     FROM generate_series(1, 50) n)
  );
  v_promo := v_result.promotion_id;
  IF v_promo IS NULL OR NOT v_result.newly_published OR v_result.published_at IS NULL THEN
    RAISE EXCEPTION 'created promotion return values are incorrect';
  END IF;
  SELECT count(*) INTO v_count FROM public.promotion_vouchers
  WHERE promotion_id = v_promo AND branch_id = v_branch_a AND code like 'CODE-%';
  IF v_count <> 50 THEN RAISE EXCEPTION 'expected 50 vouchers in branch A, got %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE promotion_id = v_promo AND branch_id <> v_branch_a) THEN
    RAISE EXCEPTION 'voucher saved against the wrong branch';
  END IF;

  -- Duplicate branch/code is ignored without overwriting; same code in another branch is distinct.
  INSERT INTO public.promotion_vouchers (promotion_id, branch_id, code, duration_label)
  VALUES (v_promo, v_branch_a, 'DUPLICATE', 'original');
  PERFORM public.save_promotion_with_inventory(
    v_admin, v_promo,
    jsonb_set(v_value, '{published}', 'true'::jsonb), '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('branch_id', v_branch_a, 'code', 'DUPLICATE', 'duration_label', 'replacement'),
      jsonb_build_object('branch_id', v_branch_b, 'code', 'DUPLICATE', 'duration_label', 'branch B')
    )
  );
  IF (SELECT duration_label FROM public.promotion_vouchers WHERE promotion_id=v_promo AND branch_id=v_branch_a AND code='DUPLICATE') <> 'original' THEN
    RAISE EXCEPTION 'duplicate voucher overwrote existing inventory';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE promotion_id=v_promo AND branch_id=v_branch_b AND code='DUPLICATE' AND duration_label='branch B') THEN
    RAISE EXCEPTION 'same voucher code was not accepted in another branch';
  END IF;
  SELECT * INTO v_result FROM public.save_promotion_with_inventory(
    v_admin, v_promo, v_value, '[]'::jsonb, '[]'::jsonb
  );
  IF v_result.newly_published THEN RAISE EXCEPTION 'already-published promotion reported newly_published'; END IF;

  SELECT count(*) INTO v_audit_before FROM public.audit_logs;
  BEGIN
    PERFORM public.save_promotion_with_inventory(
      v_admin, null,
      jsonb_set(v_value, '{name}', '"rollback new promotion"'::jsonb),
      jsonb_build_array(jsonb_build_object('branch_id', v_branch_a, 'capacity', 9)),
      jsonb_build_array(jsonb_build_object('branch_id', '2fffffff-0000-0000-0000-000000000001', 'code', 'BAD', 'duration_label', null))
    );
    RAISE EXCEPTION 'new-promotion voucher failure unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.promotions WHERE name='rollback new promotion') THEN
    RAISE EXCEPTION 'new promotion survived failed voucher insertion';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs) <> v_audit_before THEN
    RAISE EXCEPTION 'audit row survived failed new-promotion voucher insertion';
  END IF;

  INSERT INTO public.promotions (id, name, audience, fulfillment_type, requires_student_document, published, active, notify_on_publish)
  VALUES (v_existing_id, 'before update', 'everyone', 'manual_topup', false, false, true, false);
  INSERT INTO public.promotion_slots (promotion_id, branch_id, capacity, approved_count)
  VALUES (v_existing_id, v_branch_a, 4, 1);
  SELECT count(*) INTO v_audit_before FROM public.audit_logs WHERE target_id=v_existing_id;
  BEGIN
    PERFORM public.save_promotion_with_inventory(
      v_admin, v_existing_id,
      jsonb_set(jsonb_set(v_value, '{name}', '"after update"'::jsonb), '{published}', 'false'::jsonb),
      jsonb_build_array(
        jsonb_build_object('branch_id', v_branch_a, 'capacity', 6),
        jsonb_build_object('branch_id', v_branch_b, 'capacity', 2)
      ),
      jsonb_build_array(jsonb_build_object('branch_id', '2fffffff-0000-0000-0000-000000000001', 'code', 'BAD', 'duration_label', null))
    );
    RAISE EXCEPTION 'existing-promotion voucher failure unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF (SELECT name FROM public.promotions WHERE id=v_existing_id) <> 'before update' THEN
    RAISE EXCEPTION 'promotion update survived failed voucher insertion';
  END IF;
  IF (SELECT capacity FROM public.promotion_slots WHERE promotion_id=v_existing_id AND branch_id=v_branch_a) <> 4 OR
     EXISTS (SELECT 1 FROM public.promotion_slots WHERE promotion_id=v_existing_id AND branch_id=v_branch_b) THEN
    RAISE EXCEPTION 'slot changes survived failed voucher insertion';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE target_id=v_existing_id) <> v_audit_before THEN
    RAISE EXCEPTION 'audit row survived failed voucher insertion';
  END IF;

  -- Missing composite conflict constraint reproduces SQLSTATE 42P10 and must be atomic.
  BEGIN
    ALTER TABLE public.promotion_vouchers DROP CONSTRAINT promotion_vouchers_unique_branch_code;
    PERFORM public.save_promotion_with_inventory(
      v_admin, null,
      jsonb_set(v_value, '{name}', '"missing constraint rollback"'::jsonb), '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('branch_id', v_branch_a, 'code', 'NO-CONSTRAINT', 'duration_label', null))
    );
    RAISE EXCEPTION 'RPC unexpectedly succeeded without composite voucher constraint';
  EXCEPTION WHEN invalid_column_reference THEN
    -- DDL and attempted RPC are rolled back to this block's savepoint.
    IF EXISTS (SELECT 1 FROM public.promotions WHERE name='missing constraint rollback') THEN
      RAISE EXCEPTION 'promotion survived missing-constraint voucher failure';
    END IF;
  END;

  -- Approved slots cannot be removed or reduced below approved_count; errors preserve state.
  BEGIN
    PERFORM public.save_promotion_with_inventory(
      v_admin, '30000000-0000-0000-0000-000000000002',
      jsonb_set(v_value, '{fulfillment_type}', '"manual_topup"'::jsonb), '[]'::jsonb, '[]'::jsonb
    );
    RAISE EXCEPTION 'approved slot removal unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF (SELECT name FROM public.promotions WHERE id='30000000-0000-0000-0000-000000000002') <> 'before update' OR
     (SELECT capacity FROM public.promotion_slots WHERE promotion_id='30000000-0000-0000-0000-000000000002' AND branch_id=v_branch_a) <> 4 THEN
    RAISE EXCEPTION 'approved-slot removal conflict changed state';
  END IF;
  BEGIN
    PERFORM public.save_promotion_with_inventory(
      v_admin, '30000000-0000-0000-0000-000000000002',
      jsonb_set(v_value, '{fulfillment_type}', '"manual_topup"'::jsonb),
      jsonb_build_array(jsonb_build_object('branch_id', v_branch_a, 'capacity', 0)), '[]'::jsonb
    );
    RAISE EXCEPTION 'approved slot reduction unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF (SELECT capacity FROM public.promotion_slots WHERE promotion_id='30000000-0000-0000-0000-000000000002' AND branch_id=v_branch_a) <> 4 THEN
    RAISE EXCEPTION 'approved-slot capacity conflict changed state';
  END IF;

  -- Manual top-up save creates branch slots normally without inventory.
  SELECT * INTO v_result FROM public.save_promotion_with_inventory(
    v_admin, null,
    '{"name":"manual topup","description":null,"audience":"students","fulfillment_type":"manual_topup","requires_student_document":true,"published":false,"active":true,"notify_on_publish":false}'::jsonb,
    jsonb_build_array(jsonb_build_object('branch_id', v_branch_b, 'capacity', 3)), '[]'::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.promotion_slots WHERE promotion_id=v_result.promotion_id AND branch_id=v_branch_b AND capacity=3 AND approved_count=0) THEN
    RAISE EXCEPTION 'manual top-up slot was not saved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE promotion_id=v_result.promotion_id) THEN
    RAISE EXCEPTION 'manual top-up save unexpectedly created vouchers';
  END IF;

  IF has_function_privilege('anon', 'public.save_promotion_with_inventory(uuid,uuid,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute promotion save RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.save_promotion_with_inventory(uuid,uuid,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute promotion save RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.save_promotion_with_inventory(uuid,uuid,jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute promotion save RPC';
  END IF;
END;
$$;

rollback;
