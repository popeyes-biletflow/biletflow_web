create or replace function event_metrics(
  p_event_id       uuid,
  p_date_from      date default null,
  p_date_to        date default null,
  p_ticket_type_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ev       events%rowtype;
  v_tz       text;
  v_capacity int;
  v_sold     int;
  v_checked  int;
  v_gross    bigint;
  v_disc     bigint;
  v_fees     bigint;
  v_captured bigint;
  v_refunded bigint;
  v_ref_fees bigint;
  v_series   jsonb;
  v_tiers    jsonb;
  v_camps    jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_ev from events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_ev.organizer_id is distinct from auth.uid() then raise exception 'NOT_EVENT_OWNER'; end if;
  v_tz := coalesce(v_ev.timezone, 'Asia/Almaty');

  if p_ticket_type_id is not null then
    select quantity into v_capacity from ticket_types where id = p_ticket_type_id and event_id = p_event_id;
  else
    select case when bool_or(quantity is null) then null else sum(quantity)::int end
      into v_capacity from ticket_types where event_id = p_event_id;
    if v_ev.capacity is not null then
      v_capacity := least(coalesce(v_capacity, v_ev.capacity), v_ev.capacity);
    end if;
  end if;

  with ord as (
    select o.* from orders o
     where o.event_id = p_event_id
       and (p_ticket_type_id is null or o.ticket_type_id = p_ticket_type_id)
       and (p_date_from is null or (o.created_at at time zone v_tz)::date >= p_date_from)
       and (p_date_to   is null or (o.created_at at time zone v_tz)::date <= p_date_to)
  ), cap as (
    select * from ord where status in ('paid', 'completed', 'refunded') and coalesce(total_amount, 0) > 0
  ), act as (
    select * from ord where status in ('paid', 'completed')
  ), tk as (
    select t.* from tickets t
     where t.event_id = p_event_id
       and (p_ticket_type_id is null or t.ticket_type_id = p_ticket_type_id)
       and ((p_date_from is null and p_date_to is null) or t.order_id in (select id from ord))
  ), rf as (
    select r.* from refunds r where r.order_id in (select id from cap) and r.status = 'completed'
  )
  select
    (select count(*) from tk where status in ('valid', 'checked_in')),
    (select count(*) from tk where status = 'checked_in'),
    (select coalesce(sum(subtotal_kzt), 0) from cap),
    (select coalesce(sum(discount_kzt), 0) from cap),
    (select coalesce(sum(fee_kzt), 0) from cap),
    (select coalesce(sum(total_amount), 0) from cap),
    (select coalesce(sum(amount_kzt), 0) from rf),
    (select coalesce(sum(fee_refunded_kzt), 0) from rf),
    (select coalesce(jsonb_agg(jsonb_build_object('date', s.d, 'tickets', s.n, 'revenue_kzt', s.rev) order by s.d), '[]'::jsonb)
       from (select (a.created_at at time zone v_tz)::date as d,
                    sum(a.quantity)::int as n,
                    sum(a.subtotal_kzt - a.discount_kzt)::bigint as rev
               from act a group by 1) s),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'ticket_type_id', tt.id, 'name', tt.name, 'price_kzt', tt.price, 'capacity', tt.quantity,
              'sold', (select count(*) from tk where tk.ticket_type_id = tt.id and tk.status in ('valid', 'checked_in')),
              'checked_in', (select count(*) from tk where tk.ticket_type_id = tt.id and tk.status = 'checked_in'),
              'revenue_kzt', (select coalesce(sum(a.subtotal_kzt - a.discount_kzt), 0) from act a where a.ticket_type_id = tt.id)
            ) order by tt.name), '[]'::jsonb)
       from ticket_types tt
      where tt.event_id = p_event_id and (p_ticket_type_id is null or tt.id = p_ticket_type_id)),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'campaign_id', c.id, 'name', c.name, 'code', p.code,
              'discount_type', c.discount_type, 'is_disabled', c.is_disabled,
              'qr_visits', (select count(*) from campaign_scans s where s.campaign_id = c.id),
              'redemptions', (select count(*) from act a where a.campaign_id = c.id),
              'tickets', (select coalesce(sum(a.quantity), 0) from act a where a.campaign_id = c.id),
              'discount_kzt', (select coalesce(sum(a.discount_kzt), 0) from act a where a.campaign_id = c.id),
              'net_kzt', (select coalesce(sum(a.subtotal_kzt - a.discount_kzt), 0) from act a where a.campaign_id = c.id),
              'refunded_orders', (select count(*) from ord o where o.campaign_id = c.id and o.status = 'refunded')
            ) order by c.created_at), '[]'::jsonb)
       from campaigns c join promo_codes p on p.campaign_id = c.id
      where c.event_id = p_event_id)
  into v_sold, v_checked, v_gross, v_disc, v_fees, v_captured, v_refunded, v_ref_fees, v_series, v_tiers, v_camps;

  return jsonb_build_object(
    'event_id', p_event_id,
    'filters', jsonb_build_object('date_from', p_date_from, 'date_to', p_date_to, 'ticket_type_id', p_ticket_type_id),
    'capacity', jsonb_build_object(
        'total', v_capacity, 'sold', v_sold,
        'remaining', case when v_capacity is null then null else greatest(v_capacity - v_sold, 0) end,
        'percent_sold', case when v_capacity > 0 then round(v_sold * 100.0 / v_capacity, 1) end),
    'attendance', jsonb_build_object(
        'checked_in', v_checked, 'absent', greatest(v_sold - v_checked, 0),
        'percent', case when v_sold > 0 then round(v_checked * 100.0 / v_sold, 1) end),
    'revenue', jsonb_build_object(
        'gross_kzt', v_gross, 'discounts_kzt', v_disc, 'fees_kzt', v_fees,
        'captured_kzt', v_captured, 'refunded_kzt', v_refunded, 'refunded_fees_kzt', v_ref_fees,
        'fees_kept_kzt', v_fees - v_ref_fees,
        'net_kzt', (v_gross - v_disc) - (v_refunded - v_ref_fees)),
    'sales_over_time', v_series,
    'ticket_types', v_tiers,
    'campaigns', v_camps);
end $$;

create or replace function event_activity(
  p_event_id uuid,
  p_action   text default null,
  p_from     timestamptz default null,
  p_to       timestamptz default null,
  p_limit    int default 50,
  p_offset   int default 0
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

  select count(*) into v_total from audit_log a
   where a.entity_type = 'event' and a.entity_id = p_event_id::text
     and (p_action is null or a.action = upper(p_action))
     and (p_from is null or a.created_at >= p_from)
     and (p_to is null or a.created_at <= p_to);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_items
    from (
      select a.id, a.action, a.created_at, a.performed_by, p.full_name as performed_by_name, a.metadata
        from audit_log a
        left join profiles p on p.id = a.performed_by
       where a.entity_type = 'event' and a.entity_id = p_event_id::text
         and (p_action is null or a.action = upper(p_action))
         and (p_from is null or a.created_at >= p_from)
         and (p_to is null or a.created_at <= p_to)
       order by a.created_at desc
       limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
    ) x;

  return jsonb_build_object('total', v_total, 'limit', least(greatest(p_limit, 1), 200),
                            'offset', greatest(p_offset, 0), 'items', v_items);
end $$;

revoke update, delete on audit_log from anon, authenticated;

grant execute on function event_metrics(uuid, date, date, uuid) to authenticated;
grant execute on function event_activity(uuid, text, timestamptz, timestamptz, int, int) to authenticated;