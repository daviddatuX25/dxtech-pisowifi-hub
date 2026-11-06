\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('11000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000002');
insert into public.branches (id, name) values
  ('21000000-0000-0000-0000-000000000001', 'promotion-delete-test');
insert into public.profiles (id, device_id, id_value, name, branch_id, privacy_consent_at) values
  ('31000000-0000-0000-0000-000000000001', 'DELETEPROFILE1', 'DELETEPROFILE1', 'Delete test 1', '21000000-0000-0000-0000-000000000001', now()),
  ('31000000-0000-0000-0000-000000000002', 'DELETEPROFILE2', 'DELETEPROFILE2', 'Delete test 2', '21000000-0000-0000-0000-000000000001', now()),
  ('31000000-0000-0000-0000-000000000003', 'DELETEPROFILE3', 'DELETEPROFILE3', 'Delete test 3', '21000000-0000-0000-0000-000000000001', now()),
  ('31000000-0000-0000-0000-000000000004', 'DELETEPROFILE4', 'DELETEPROFILE4', 'Delete test 4', '21000000-0000-0000-0000-000000000001', now());

insert into public.promotions (id, name, audience, fulfillment_type, requires_student_document, published, active, notify_on_publish) values
  ('41000000-0000-0000-0000-000000000001', 'Delete empty promo', 'everyone', 'manual_topup', false, false, true, false),
  ('41000000-0000-0000-0000-000000000002', 'Delete unused stocked promo', 'everyone', 'voucher', false, true, true, true),
  ('41000000-0000-0000-0000-000000000003', 'Pending protected promo', 'everyone', 'voucher', false, false, true, false),
  ('41000000-0000-0000-0000-000000000004', 'Rejected protected promo', 'everyone', 'manual_topup', false, false, true, false),
  ('41000000-0000-0000-0000-000000000005', 'Approved protected promo', 'everyone', 'manual_topup', false, false, true, false),
  ('41000000-0000-0000-0000-000000000006', 'Assigned legacy protected promo', 'everyone', 'voucher', false, false, true, false),
  ('41000000-0000-0000-0000-000000000007', 'Approved slot protected promo', 'everyone', 'manual_topup', false, false, true, false),
  ('41000000-0000-0000-0000-000000000008', 'Unrelated promo remains', 'everyone', 'voucher', false, false, true, false);

insert into public.promotion_slots (promotion_id, branch_id, capacity, approved_count) values
  ('41000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 4, 0),
  ('41000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000001', 2, 1),
  ('41000000-0000-0000-0000-000000000007', '21000000-0000-0000-0000-000000000001', 2, 1);

insert into public.promotion_vouchers (promotion_id, branch_id, code, duration_label) values
  ('41000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'UNUSED-1', '30 days'),
  ('41000000-0000-0000-0000-000000000008', '21000000-0000-0000-0000-000000000001', 'UNRELATED-1', '60 days');
insert into public.promotion_vouchers (promotion_id, branch_id, code, assigned_profile_id, assigned_at) values
  ('41000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000001', 'LEGACY-ASSIGNED', '31000000-0000-0000-0000-000000000004', now());

insert into public.promo_requests (id, promotion_id, profile_id, branch_id, status) values
  ('51000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'pending'),
  ('51000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000004', '31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'rejected'),
  ('51000000-0000-0000-0000-000000000003', '41000000-0000-0000-0000-000000000005', '31000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', 'approved');

insert into public.notification_jobs (event_type, payload, dedupe_key) values
  ('new_promotion', '{"title":"queued target"}', 'promotion:41000000-0000-0000-0000-000000000002:2026-01-01T00:00:00Z'),
  ('new_promotion', '{"title":"unrelated queued"}', 'promotion:41000000-0000-0000-0000-000000000008:2026-01-01T00:00:00Z'),
  ('issue_reviewed', '{"title":"unrelated event"}', 'promotion:41000000-0000-0000-0000-000000000002:other-event');

DO $$
DECLARE
  v_admin uuid := '11000000-0000-0000-0000-000000000001';
  v_deleted uuid;
  v_audit jsonb;
  v_audit_count integer;
  v_jobs integer;
  v_constraint uuid := '41000000-0000-0000-0000-000000000002';
  v_protected uuid;
BEGIN
  -- Empty promotions delete and leave a durable audit record.
  v_deleted := public.delete_promotion_with_inventory(v_admin, '41000000-0000-0000-0000-000000000001');
  IF v_deleted <> '41000000-0000-0000-0000-000000000001' OR EXISTS (SELECT 1 FROM public.promotions WHERE id=v_deleted) THEN
    RAISE EXCEPTION 'empty promotion was not deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE target_id=v_deleted AND action='delete_promotion' AND metadata->>'name'='Delete empty promo') THEN
    RAISE EXCEPTION 'empty promotion deletion audit was not retained';
  END IF;

  -- A stocked promo with only unused vouchers and manual capacities deletes as one unit.
  v_deleted := public.delete_promotion_with_inventory(v_admin, v_constraint);
  IF v_deleted <> v_constraint OR EXISTS (SELECT 1 FROM public.promotions WHERE id=v_constraint) OR
     EXISTS (SELECT 1 FROM public.promotion_slots WHERE promotion_id=v_constraint) OR
     EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE promotion_id=v_constraint) THEN
    RAISE EXCEPTION 'unused promo inventory was not deleted with its promotion';
  END IF;
  SELECT metadata INTO v_audit FROM public.audit_logs WHERE target_id=v_constraint AND action='delete_promotion';
  IF v_audit->>'name' <> 'Delete unused stocked promo' OR v_audit->>'slotCount' <> '1' OR v_audit->>'voucherCount' <> '1' THEN
    RAISE EXCEPTION 'deletion audit did not retain promo name and inventory counts: %', v_audit;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_jobs WHERE event_type='new_promotion' AND status='pending' AND dedupe_key LIKE 'promotion:' || v_constraint::text || ':%') THEN
    RAISE EXCEPTION 'queued target promo notification was not removed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_jobs WHERE dedupe_key='promotion:41000000-0000-0000-0000-000000000008:2026-01-01T00:00:00Z') OR
     NOT EXISTS (SELECT 1 FROM public.notification_jobs WHERE dedupe_key='promotion:41000000-0000-0000-0000-000000000002:other-event') THEN
    RAISE EXCEPTION 'unrelated notification job was removed';
  END IF;

  -- Failed audit insertion rolls back queued-job cleanup and promotion deletion.
  SELECT count(*) INTO v_jobs FROM public.notification_jobs WHERE dedupe_key LIKE 'promotion:41000000-0000-0000-0000-000000000008:%';
  SELECT count(*) INTO v_audit_count FROM public.audit_logs WHERE target_id='41000000-0000-0000-0000-000000000008' AND action='delete_promotion';
  BEGIN
    PERFORM public.delete_promotion_with_inventory('11000000-0000-0000-0000-000000000099', '41000000-0000-0000-0000-000000000008');
    RAISE EXCEPTION 'delete with invalid admin unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id='41000000-0000-0000-0000-000000000008') OR
     (SELECT count(*) FROM public.notification_jobs WHERE dedupe_key LIKE 'promotion:41000000-0000-0000-0000-000000000008:%') <> v_jobs OR
     (SELECT count(*) FROM public.audit_logs WHERE target_id='41000000-0000-0000-0000-000000000008' AND action='delete_promotion') <> v_audit_count THEN
    RAISE EXCEPTION 'failed deletion did not roll back its changes';
  END IF;

  -- Every request status is protected; all request and inventory rows remain untouched.
  FOREACH v_protected IN ARRAY ARRAY[
    '41000000-0000-0000-0000-000000000003'::uuid,
    '41000000-0000-0000-0000-000000000004'::uuid,
    '41000000-0000-0000-0000-000000000005'::uuid
  ] LOOP
    BEGIN
      PERFORM public.delete_promotion_with_inventory(v_admin, v_protected);
      RAISE EXCEPTION 'promotion with request history unexpectedly deleted: %', v_protected;
    EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id=v_protected) OR
       NOT EXISTS (SELECT 1 FROM public.promo_requests WHERE promotion_id=v_protected) THEN
      RAISE EXCEPTION 'request-protected promo state changed: %', v_protected;
    END IF;
  END LOOP;

  -- Legacy vouchers can be assigned without a promo request; all assignment markers protect them.
  BEGIN
    PERFORM public.delete_promotion_with_inventory(v_admin, '41000000-0000-0000-0000-000000000006');
    RAISE EXCEPTION 'promo with assigned legacy voucher unexpectedly deleted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id='41000000-0000-0000-0000-000000000006') OR
     NOT EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE promotion_id='41000000-0000-0000-0000-000000000006' AND assigned_profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'assigned legacy voucher state changed after refusal';
  END IF;

  BEGIN
    PERFORM public.delete_promotion_with_inventory(v_admin, '41000000-0000-0000-0000-000000000007');
    RAISE EXCEPTION 'promo with approved slot unexpectedly deleted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id='41000000-0000-0000-0000-000000000007') OR
     NOT EXISTS (SELECT 1 FROM public.promotion_slots WHERE promotion_id='41000000-0000-0000-0000-000000000007' AND approved_count=1) THEN
    RAISE EXCEPTION 'approved slot state changed after refusal';
  END IF;

  SELECT count(*) INTO v_audit_count FROM public.audit_logs WHERE action='delete_promotion';
  BEGIN
    PERFORM public.delete_promotion_with_inventory(v_admin, '41000000-0000-0000-0000-000000000099');
    RAISE EXCEPTION 'nonexistent promotion unexpectedly deleted';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  IF (SELECT count(*) FROM public.audit_logs WHERE action='delete_promotion') <> v_audit_count THEN
    RAISE EXCEPTION 'nonexistent promotion unexpectedly wrote an audit record';
  END IF;

  IF has_function_privilege('anon', 'public.delete_promotion_with_inventory(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute promotion delete RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.delete_promotion_with_inventory(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute promotion delete RPC';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.delete_promotion_with_inventory(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute promotion delete RPC';
  END IF;
END;
$$;

rollback;
