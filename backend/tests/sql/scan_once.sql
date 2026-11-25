set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', false) \g /dev/null
select coalesce(checkin_ticket_atomic('00000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000b1')->>'error_code', 'ADMITTED');
