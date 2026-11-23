create or replace function refund_order(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_o          orders%rowtype;
  v_event_id   uuid;
  v_ev         events%rowtype;
  v_is_org     boolean;
  v_tickets    uuid[];
  v_prev       refunds%rowtype;
  v_free       boolean;
  v_total      int;
  v_fee        int;
  v_new_status text;
  v_refund     uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_o from orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  v_event_id := coalesce(v_o.event_id, (select event_id from tickets where order_id = v_o.id limit 1));
  select * into v_ev from events where id = v_event_id;
  v_is_org := (v_ev.organizer_id is not distinct from v_user);

  if v_o.user_id is distinct from v_user and not v_is_org then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select * into v_prev from refunds where order_id = v_o.id and status = 'completed';
  if found then
    return jsonb_build_object(
      'refund_id', v_prev.id, 'order_id', v_o.id,
      'amount_kzt', v_prev.amount_kzt, 'fee_refunded_kzt', v_prev.fee_refunded_kzt,
      'ticket_ids', to_jsonb(v_prev.ticket_ids), 'status', v_o.status, 'already_refunded', true);
  end if;

  if v_o.status not in ('paid', 'completed') then raise exception 'ORDER_NOT_REFUNDABLE'; end if;

  if exists (select 1 from tickets where order_id = v_o.id and status = 'checked_in') then
    raise exception 'TICKET_ALREADY_USED';
  end if;

  select array_agg(id) into v_tickets from tickets where order_id = v_o.id and status = 'valid';
  if v_tickets is null then raise exception 'NOTHING_TO_REFUND'; end if;

  if v_o.user_id = v_user and v_ev.status is distinct from 'cancelled' then
    if v_ev.refund_policy = 'none' then raise exception 'REFUND_NOT_ALLOWED'; end if;
    if v_ev.starts_at is not null then
      if v_ev.refund_policy = 'full_until_start' and now() >= v_ev.starts_at then
        raise exception 'REFUND_WINDOW_CLOSED';
      end if;
      if v_ev.refund_policy = 'full_24h_before' and now() >= v_ev.starts_at - interval '24 hours' then
        raise exception 'REFUND_WINDOW_CLOSED';
      end if;
    end if;
  end if;

  v_total      := coalesce(v_o.total_amount, 0)::int;
  v_fee        := coalesce(v_o.fee_kzt, 0);
  v_free       := v_total = 0;
  v_new_status := case when v_free then 'cancelled' else 'refunded' end;

  update tickets set status = v_new_status where id = any(v_tickets) and status = 'valid';
  update orders  set status = v_new_status where id = v_o.id;

  insert into refunds (order_id, event_id, requested_by, reason, amount_kzt, fee_refunded_kzt, ticket_ids)
  values (v_o.id, v_event_id, v_user, nullif(trim(p_reason), ''), v_total, v_fee, v_tickets)
  returning id into v_refund;

  if not v_free then
    insert into payments (user_id, order_id, event_id, amount, currency, status, simulated)
    values (v_o.user_id, v_o.id, v_event_id, v_total, 'KZT', 'refunded', true);
  end if;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values (case when v_free then 'ORDER_CANCELLED' else 'ORDER_REFUNDED' end,
          v_user, 'event', v_event_id::text,
          jsonb_build_object('order_id', v_o.id, 'refund_id', v_refund, 'ticket_ids', to_jsonb(v_tickets),
                             'amount_kzt', v_total, 'fee_refunded_kzt', v_fee,
                             'reason', nullif(trim(p_reason), ''), 'by_organizer', (v_is_org and v_o.user_id is distinct from v_user)));

  return jsonb_build_object(
    'refund_id', v_refund, 'order_id', v_o.id,
    'amount_kzt', v_total, 'fee_refunded_kzt', v_fee,
    'ticket_ids', to_jsonb(v_tickets), 'status', v_new_status, 'already_refunded', false);
end $$;

grant execute on function refund_order(uuid, text) to authenticated;