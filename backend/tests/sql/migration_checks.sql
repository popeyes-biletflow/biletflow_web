-- Behaviour checks for migrations 019 (atomic check-in, staff access) and 020 (paid-sales guard).
-- Run through run_migration_checks.sh. Any failed expectation aborts with a non-zero exit.
\set ON_ERROR_STOP on
\set org   '00000000-0000-0000-0000-0000000000a1'
\set org2  '00000000-0000-0000-0000-0000000000a2'
\set staff '00000000-0000-0000-0000-0000000000b1'
\set other '00000000-0000-0000-0000-0000000000b2'
\set noundo '00000000-0000-0000-0000-0000000000b3'
\set admin '00000000-0000-0000-0000-0000000000c1'
\set attendee '00000000-0000-0000-0000-0000000000f1'
\set ev    '00000000-0000-0000-0000-0000000000e1'
\set t_ok  '00000000-0000-0000-0000-000000000011'
\set t_ref '00000000-0000-0000-0000-000000000012'
\set t_two '00000000-0000-0000-0000-000000000013'

insert into profiles values
  (:'org','organizer','Org'), (:'org2','organizer','Org 2'),
  (:'staff','event_admin','Staff'), (:'other','event_admin','Unassigned'),
  (:'noundo','event_admin','No undo'), (:'admin','platform_admin','Admin');
insert into events(id, organizer_id) values (:'ev', :'org');
insert into event_staff(event_id, user_id, can_undo) values (:'ev', :'staff', true), (:'ev', :'noundo', false);
insert into tickets(id, event_id, user_id, status) values
  (:'t_ok', :'ev', :'attendee', 'valid'), (:'t_ref', :'ev', :'attendee', 'refunded'), (:'t_two', :'ev', :'attendee', 'valid');

\echo == assigned staff
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staff', 'role', 'authenticated')::text, false) \g /dev/null
select expect('first scan admits', (checkin_ticket_atomic(:'t_ok', :'ev', :'staff')->>'success')::boolean);
select expect('second scan is ALREADY_USED', checkin_ticket_atomic(:'t_ok', :'ev', :'staff')->>'error_code' = 'ALREADY_USED');
select expect('refunded ticket is INVALID_STATUS', checkin_ticket_atomic(:'t_ref', :'ev', :'staff')->>'error_code' = 'INVALID_STATUS');
select expect('staff id must match the caller', checkin_ticket_atomic(:'t_two', :'ev', :'other')->>'error_code' = 'FORBIDDEN');
select expect('assigned staff can read the roster', (select count(*) from tickets) = 3);

\echo == unassigned staff
select set_config('request.jwt.claims', json_build_object('sub', :'other', 'role', 'authenticated')::text, false) \g /dev/null
select expect('unassigned staff refused', checkin_ticket_atomic(:'t_two', :'ev', :'other')->>'error_code' = 'FORBIDDEN');
select expect('unassigned staff cannot read the roster', (select count(*) from tickets) = 0);

\echo == undo permission
select set_config('request.jwt.claims', json_build_object('sub', :'noundo', 'role', 'authenticated')::text, false) \g /dev/null
select expect('staff without can_undo refused', undo_checkin_atomic(:'t_ok', :'ev', :'noundo')->>'error_code' = 'FORBIDDEN');
select set_config('request.jwt.claims', json_build_object('sub', :'staff', 'role', 'authenticated')::text, false) \g /dev/null
select expect('staff with can_undo reverses', (undo_checkin_atomic(:'t_ok', :'ev', :'staff')->>'success')::boolean);
select expect('undo of a ticket that is not checked in refused', undo_checkin_atomic(:'t_ok', :'ev', :'staff')->>'error_code' = 'NOT_CHECKED_IN');

\echo == anonymous callers
reset role;
set role anon;
do $$ begin
  perform checkin_ticket_atomic('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1');
  raise exception 'FAIL: anon can call checkin_ticket_atomic';
exception when insufficient_privilege then raise notice 'PASS: anon cannot call checkin_ticket_atomic';
end $$;
reset role;

\echo == paid-sales guard
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'org', 'role', 'authenticated')::text, false) \g /dev/null
do $$ begin
  update events set paid_sales_active = true, paid_sales_status = 'ACTIVE';
  raise exception 'FAIL: organizer changed paid sales directly';
exception when insufficient_privilege then raise notice 'PASS: direct paid-sales write by organizer rejected';
end $$;
select expect('event still NONE', (select paid_sales_status from events) = 'NONE');
do $$ declare n int; begin
  update events set organizer_id = organizer_id; get diagnostics n = row_count;
  perform expect('other event columns remain editable', n = 1);
end $$;
select expect('organizer activates through the function', activate_paid_sales(:'ev', :'org', 5000)->>'status' = 'activated');
select expect('event is ACTIVE after activation', (select paid_sales_status from events) = 'ACTIVE');
select expect('activation is idempotent', activate_paid_sales(:'ev', :'org', 5000)->>'status' = 'already_active');
select set_config('request.jwt.claims', json_build_object('sub', :'org2', 'role', 'authenticated')::text, false) \g /dev/null
do $$ begin
  perform activate_paid_sales('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a2',5000);
  raise exception 'FAIL: another organizer activated this event';
exception when insufficient_privilege then raise notice 'PASS: another organizer cannot activate this event';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role', 'authenticated')::text, false) \g /dev/null
do $$ declare n int; begin
  update events set paid_sales_status = 'SUSPENDED', paid_sales_active = false; get diagnostics n = row_count;
  perform expect('platform admin can suspend', n = 1);
end $$;
reset role;
set role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, false) \g /dev/null
do $$ declare n int; begin
  update events set paid_sales_status = 'NONE'; get diagnostics n = row_count;
  perform expect('service role may write', n = 1);
end $$;
select expect('service role may check in', (checkin_ticket_atomic(:'t_two', :'ev', :'staff')->>'success')::boolean);
reset role;
