create or replace function create_campaign_v2(
  p_event_id       uuid,
  p_name           text,
  p_discount_type  text,
  p_discount_value int,
  p_code           text,
  p_max_uses       int,
  p_ends_at        timestamptz,
  p_slug           text,
  p_starts_at      timestamptz default null,
  p_ticket_type_id uuid default null
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

  if p_discount_type = 'percent' then
    if p_discount_value not between 1 and 100 then raise exception 'BAD_DISCOUNT'; end if;
  elsif p_discount_type = 'fixed_kzt' then
    if p_discount_value < 1 then raise exception 'BAD_DISCOUNT'; end if;
  else
    raise exception 'BAD_DISCOUNT';
  end if;

  if p_ticket_type_id is not null
     and not exists (select 1 from ticket_types where id = p_ticket_type_id and event_id = p_event_id) then
    raise exception 'INVALID_TICKET_TYPE';
  end if;

  begin
    insert into campaigns (event_id, organizer_id, name, discount_type, discount_value, discount_percent,
                           ticket_type_id, starts_at, ends_at, qr_slug)
    values (p_event_id, v_user, p_name, p_discount_type, p_discount_value,
            case when p_discount_type = 'percent' then p_discount_value end,
            p_ticket_type_id, coalesce(p_starts_at, now()), p_ends_at, p_slug)
    returning id into v_campaign;

    insert into promo_codes (campaign_id, event_id, code, max_uses)
    values (v_campaign, p_event_id, v_code, p_max_uses);
  exception when unique_violation then
    raise exception 'PROMO_CODE_EXISTS';
  end;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values ('PROMO_CREATED', v_user, 'event', p_event_id::text,
          jsonb_build_object('campaign_id', v_campaign, 'code', v_code,
                             'discount_type', p_discount_type, 'discount_value', p_discount_value,
                             'ticket_type_id', p_ticket_type_id, 'max_uses', p_max_uses));

  return jsonb_build_object('campaign_id', v_campaign, 'code', v_code, 'qr_slug', p_slug);
end $$;

create or replace function set_campaign_disabled(p_campaign_id uuid, p_disabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_c campaigns%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_c from campaigns where id = p_campaign_id for update;
  if not found then raise exception 'CAMPAIGN_NOT_FOUND'; end if;
  if v_c.organizer_id is distinct from auth.uid() then raise exception 'NOT_EVENT_OWNER'; end if;

  update campaigns set is_disabled = p_disabled where id = p_campaign_id;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values (case when p_disabled then 'PROMO_DISABLED' else 'PROMO_ENABLED' end,
          auth.uid(), 'event', v_c.event_id::text, jsonb_build_object('campaign_id', p_campaign_id));

  return jsonb_build_object('campaign_id', p_campaign_id, 'is_disabled', p_disabled);
end $$;

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
  v_dtype       text;
  v_dval        int;
  v_tier        uuid;
  v_disabled    boolean;
  v_max_uses    int;
  v_starts      timestamptz;
  v_ends        timestamptz;
  v_taken       int;
  v_used        int;
  v_sub         int;
  v_disc        int := 0;
  v_pct         int := 0;
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
    select p.id, p.max_uses, c.id, c.discount_type, coalesce(c.discount_value, c.discount_percent),
           c.ticket_type_id, c.is_disabled, c.starts_at, c.ends_at
      into v_promo_id, v_max_uses, v_campaign_id, v_dtype, v_dval, v_tier, v_disabled, v_starts, v_ends
      from promo_codes p
      join campaigns c on c.id = p.campaign_id
     where p.event_id = v_ev.id and upper(p.code) = upper(trim(p_promo_code))
     for update of p;

    if v_promo_id is null then raise exception 'PROMO_NOT_FOUND'; end if;
    if v_disabled then raise exception 'PROMO_DISABLED'; end if;
    if now() < v_starts then raise exception 'PROMO_NOT_STARTED'; end if;
    if now() > v_ends then raise exception 'PROMO_EXPIRED'; end if;
    if v_tier is not null and v_tier <> v_tt.id then raise exception 'PROMO_WRONG_TIER'; end if;

    select
      (select count(*) from orders
        where promo_code_id = v_promo_id and status in ('paid', 'completed'))
      + (select count(*) from ticket_holds
          where promo_code_id = v_promo_id and status = 'active' and expires_at > now())
    into v_used;

    if v_used >= v_max_uses then raise exception 'PROMO_EXHAUSTED'; end if;

    if v_dtype = 'fixed_kzt' then
      v_disc := least(v_dval, v_sub);
    else
      v_pct  := v_dval;
      v_disc := v_sub * v_dval / 100;
    end if;
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
    'discount_percent', v_pct,
    'discount_type', coalesce(v_dtype, 'none'),
    'fee_kzt', v_fee,
    'total_kzt', v_sub - v_disc + v_fee,
    'hold_expires_at', v_expires
  );
end $$;

create or replace function lookup_promo_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_used int;
begin
  select p.id, p.code, p.max_uses, c.discount_type, coalesce(c.discount_value, c.discount_percent) as dval,
         c.ticket_type_id, c.is_disabled, c.starts_at, c.ends_at
    into r
    from promo_codes p join campaigns c on c.id = p.campaign_id
   where upper(p.code) = upper(trim(p_code))
   order by c.created_at desc limit 1;
  if not found then return null; end if;

  select (select count(*) from orders o
           where o.status in ('paid', 'completed')
             and (o.promo_code_id = r.id or upper(o.promo_code) = r.code))
       + (select count(*) from ticket_holds h
           where h.promo_code_id = r.id and h.status = 'active' and h.expires_at > now())
    into v_used;

  return jsonb_build_object('id', r.id, 'code', r.code,
                            'discount_percent', case when r.discount_type = 'percent' then r.dval else 0 end,
                            'discount_type', r.discount_type, 'discount_value', r.dval,
                            'ticket_type_id', r.ticket_type_id,
                            'max_uses', r.max_uses, 'used', v_used,
                            'active', (not r.is_disabled) and now() between r.starts_at and r.ends_at);
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
   where c.qr_slug = p_slug and not c.is_disabled and now() between c.starts_at and c.ends_at
   limit 1;

  if v_campaign is null then return null; end if;

  insert into campaign_scans (campaign_id) values (v_campaign);
  return jsonb_build_object('event_id', v_event, 'code', v_code);
end $$;

grant execute on function create_campaign_v2(uuid, text, text, int, text, int, timestamptz, text, timestamptz, uuid) to authenticated;
grant execute on function set_campaign_disabled(uuid, boolean) to authenticated;
grant execute on function create_ticket_hold(uuid, int, text, int, int) to authenticated;
grant execute on function lookup_promo_code(text) to anon, authenticated;
grant execute on function register_campaign_scan(text) to anon, authenticated;