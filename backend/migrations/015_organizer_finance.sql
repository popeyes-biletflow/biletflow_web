create or replace function organizer_payout_estimate(p_event_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_res  jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_event_id is not null
     and not exists (select 1 from events where id = p_event_id and organizer_id = v_user) then
    raise exception 'NOT_EVENT_OWNER';
  end if;

  with ev as (
    select id from events
     where organizer_id = v_user and (p_event_id is null or id = p_event_id)
  ), paid as (
    select o.* from orders o
     where o.event_id in (select id from ev)
       and o.status in ('paid', 'completed') and coalesce(o.total_amount, 0) > 0
  ), ref as (
    select r.* from refunds r
     where r.event_id in (select id from ev) and r.status = 'completed' and r.amount_kzt > 0
  )
  select jsonb_build_object(
           'event_id', p_event_id,
           'orders_paid', p.n,
           'gross_sales_kzt', p.gross,
           'discounts_kzt', p.disc,
           'fees_kzt', p.fees,
           'captured_kzt', p.captured,
           'refunds_count', r.n,
           'refunded_kzt', r.amount,
           'refunded_fees_kzt', r.fee,
           'captured_before_refunds_kzt', p.captured + r.amount,
           'estimated_payout_kzt', p.gross - p.disc,
           'payout_account_set', exists (select 1 from profiles
                                          where id = v_user and nullif(trim(payout_info::text), '') is not null),
           'simulated', true)
    into v_res
    from (select count(*)::int as n,
                 coalesce(sum(subtotal_kzt), 0)::bigint as gross,
                 coalesce(sum(discount_kzt), 0)::bigint as disc,
                 coalesce(sum(fee_kzt), 0)::bigint as fees,
                 coalesce(sum(total_amount), 0)::bigint as captured
            from paid) p,
         (select count(*)::int as n,
                 coalesce(sum(amount_kzt), 0)::bigint as amount,
                 coalesce(sum(fee_refunded_kzt), 0)::bigint as fee
            from ref) r;

  return v_res;
end $$;

create or replace function organizer_attendees(
  p_event_id uuid,
  p_status   text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_total int;
  v_items jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select organizer_id into v_owner from events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_owner is distinct from auth.uid() then raise exception 'NOT_EVENT_OWNER'; end if;

  select count(*) into v_total from tickets t
   where t.event_id = p_event_id and (p_status is null or t.status = p_status);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc nulls last), '[]'::jsonb)
    into v_items
    from (
      select t.id as ticket_id,
             coalesce(t.attendee_name, p.full_name) as attendee_name,
             coalesce(t.attendee_email, p.email) as attendee_email,
             tt.name as ticket_type,
             t.status,
             t.order_id,
             t.checked_in_at,
             o.created_at
        from tickets t
        left join ticket_types tt on tt.id = t.ticket_type_id
        left join orders o on o.id = t.order_id
        left join profiles p on p.id = t.user_id
       where t.event_id = p_event_id and (p_status is null or t.status = p_status)
       order by o.created_at desc nulls last, t.id
       limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) x;

  return jsonb_build_object('total', v_total, 'limit', least(greatest(p_limit, 1), 200),
                            'offset', greatest(p_offset, 0), 'items', v_items);
end $$;

grant execute on function organizer_payout_estimate(uuid) to authenticated;
grant execute on function organizer_attendees(uuid, text, int, int) to authenticated;