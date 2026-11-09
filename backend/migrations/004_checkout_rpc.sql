create or replace function create_ticket_hold(
  p_ticket_type_id uuid,
  p_quantity       int,
  p_promo_code     text default null,
  p_fee_percent    int  default 5,
  p_hold_minutes   int  default 15
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user        uuid := auth.uid();
  v_tt          record;
  v_ev          record;
  v_promo_id    uuid;
  v_campaign_id uuid;
  v_pct         int;
  v_max_uses    int;
  v_starts      timestamptz;
  v_ends        timestamptz;
  v_taken       int;
  v_used        int;
  v_sub         int;
  v_disc        int := 0;
  v_fee         int;
  v_expires     timestamptz := now() + make_interval(mins => p_hold_minutes);
  v_hold        uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'BAD_QUANTITY'; end if;

  select * into v_tt from ticket_types where id = p_ticket_type_id for update;
  if not found or coalesce(v_tt.is_hidden, false) then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;

  select * into v_ev from events where id = v_tt.event_id;
  if v_ev.status is distinct from 'published' then raise exception 'EVENT_NOT_ON_SALE'; end if;
  if coalesce(v_tt.price, 0) > 0 and v_ev.paid_sales_status is distinct from 'ACTIVE' then
    raise exception 'PAID_SALES_INACTIVE';
  end if;
  if (v_tt.sale_starts_at is not null and now() < v_tt.sale_starts_at)
     or (v_tt.sale_ends_at is not null and now() > v_tt.sale_ends_at) then
    raise exception 'SALE_WINDOW_CLOSED';
  end if;
  if v_tt.max_per_order is not null and p_quantity > v_tt.max_per_order then
    raise exception 'MAX_PER_ORDER';
  end if;

  update ticket_holds set status = 'released'
   where user_id = v_user and ticket_type_id = v_tt.id and status = 'active';

  select
    (select count(*) from tickets
      where ticket_type_id = v_tt.id and status in ('valid', 'checked_in'))
    + coalesce((select sum(quantity) from ticket_holds
      where ticket_type_id = v_tt.id and status = 'active' and expires_at > now()), 0)
  into v_taken;

  if v_tt.quantity is not null and v_taken + p_quantity > v_tt.quantity then
    raise exception 'SOLD_OUT';
  end if;

  v_sub := coalesce(v_tt.price, 0) * p_quantity;

  if p_promo_code is not null and trim(p_promo_code) <> '' then
    select p.id, p.max_uses, c.id, c.discount_percent, c.starts_at, c.ends_at
      into v_promo_id, v_max_uses, v_campaign_id, v_pct, v_starts, v_ends
      from promo_codes p
      join campaigns c on c.id = p.campaign_id
     where p.event_id = v_ev.id and upper(p.code) = upper(trim(p_promo_code))
     for update of p;

    if v_promo_id is null then raise exception 'PROMO_NOT_FOUND'; end if;
    if now() < v_starts or now() > v_ends then raise exception 'PROMO_INACTIVE'; end if;

    select
      (select count(*) from orders where promo_code_id = v_promo_id and status = 'paid')
      + (select count(*) from ticket_holds
          where promo_code_id = v_promo_id and status = 'active' and expires_at > now())
    into v_used;

    if v_used >= v_max_uses then raise exception 'PROMO_EXHAUSTED'; end if;
    v_disc := v_sub * v_pct / 100;
  end if;

  v_fee := ((v_sub - v_disc) * p_fee_percent + 50) / 100;

  insert into ticket_holds (user_id, event_id, ticket_type_id, quantity, promo_code_id, campaign_id,
                            subtotal_kzt, discount_kzt, fee_kzt, total_kzt, expires_at)
  values (v_user, v_ev.id, v_tt.id, p_quantity, v_promo_id, v_campaign_id,
          v_sub, v_disc, v_fee, v_sub - v_disc + v_fee, v_expires)
  returning id into v_hold;

  return jsonb_build_object(
    'hold_id', v_hold,
    'event_id', v_ev.id,
    'ticket_type_id', v_tt.id,
    'quantity', p_quantity,
    'subtotal_kzt', v_sub,
    'discount_kzt', v_disc,
    'discount_percent', coalesce(v_pct, 0),
    'fee_kzt', v_fee,
    'total_kzt', v_sub - v_disc + v_fee,
    'hold_expires_at', v_expires
  );
end $$;

create or replace function finalize_order(
  p_hold_id       uuid,
  p_currency      text,
  p_fx_rate       numeric,
  p_charged_minor bigint,
  p_gateway_txn   text,
  p_tickets       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_h     record;
  v_order uuid;
begin
  select * into v_h from ticket_holds where id = p_hold_id for update;
  if not found or v_h.user_id is distinct from auth.uid() then raise exception 'HOLD_NOT_FOUND'; end if;
  if v_h.status <> 'active' then raise exception 'HOLD_NOT_ACTIVE'; end if;
  if v_h.expires_at < now() then
    update ticket_holds set status = 'expired' where id = p_hold_id;
    raise exception 'HOLD_EXPIRED';
  end if;
  if jsonb_array_length(p_tickets) <> v_h.quantity then raise exception 'BAD_TICKETS'; end if;

  insert into orders (user_id, event_id, ticket_type_id, quantity, hold_id, promo_code_id, campaign_id,
                      subtotal_kzt, discount_kzt, fee_kzt, total_amount, currency, fx_rate,
                      charged_minor, gateway_txn_id, status)
  values (v_h.user_id, v_h.event_id, v_h.ticket_type_id, v_h.quantity, v_h.id, v_h.promo_code_id,
          v_h.campaign_id, v_h.subtotal_kzt, v_h.discount_kzt, v_h.fee_kzt, v_h.total_kzt,
          p_currency, p_fx_rate, p_charged_minor, p_gateway_txn, 'paid')
  returning id into v_order;

  insert into tickets (id, order_id, ticket_type_id, user_id, event_id, status, qr_code_hash)
  select t.id, v_order, v_h.ticket_type_id, v_h.user_id, v_h.event_id, 'valid', t.qr_code_hash
    from jsonb_to_recordset(p_tickets) as t(id uuid, qr_code_hash text);

  update ticket_holds set status = 'converted' where id = p_hold_id;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values ('ORDER_PAID', v_h.user_id, 'event', v_h.event_id::text,
          jsonb_build_object('order_id', v_order, 'quantity', v_h.quantity,
                             'total_kzt', v_h.total_kzt, 'promo_code_id', v_h.promo_code_id));
  return v_order;
end $$;

create or replace function create_campaign(
  p_event_id         uuid,
  p_name             text,
  p_discount_percent int,
  p_code             text,
  p_max_uses         int,
  p_ends_at          timestamptz,
  p_slug             text,
  p_starts_at        timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_owner    uuid;
  v_campaign uuid;
  v_code     text := upper(trim(p_code));
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select organizer_id into v_owner from events where id = p_event_id;
  if v_owner is null then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_owner <> v_user then raise exception 'NOT_EVENT_OWNER'; end if;

  begin
    insert into campaigns (event_id, organizer_id, name, discount_percent, starts_at, ends_at, qr_slug)
    values (p_event_id, v_user, p_name, p_discount_percent, coalesce(p_starts_at, now()), p_ends_at, p_slug)
    returning id into v_campaign;

    insert into promo_codes (campaign_id, event_id, code, max_uses)
    values (v_campaign, p_event_id, v_code, p_max_uses);
  exception when unique_violation then
    raise exception 'PROMO_CODE_EXISTS';
  end;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values ('PROMO_CREATED', v_user, 'event', p_event_id::text,
          jsonb_build_object('campaign_id', v_campaign, 'code', v_code,
                             'discount_percent', p_discount_percent, 'max_uses', p_max_uses));

  return jsonb_build_object('campaign_id', v_campaign, 'code', v_code, 'qr_slug', p_slug);
end $$;


create or replace function register_campaign_scan(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_campaign uuid;
  v_event    uuid;
  v_code     text;
begin
  select c.id, c.event_id, p.code
    into v_campaign, v_event, v_code
    from campaigns c
    join promo_codes p on p.campaign_id = c.id
   where c.qr_slug = p_slug and now() between c.starts_at and c.ends_at
   limit 1;

  if v_campaign is null then return null; end if;

  insert into campaign_scans (campaign_id) values (v_campaign);
  return jsonb_build_object('event_id', v_event, 'code', v_code);
end $$;

grant execute on function create_ticket_hold(uuid, int, text, int, int) to authenticated;
grant execute on function finalize_order(uuid, text, numeric, bigint, text, jsonb) to authenticated;
grant execute on function create_campaign(uuid, text, int, text, int, timestamptz, text, timestamptz) to authenticated;
grant execute on function register_campaign_scan(text) to anon, authenticated;