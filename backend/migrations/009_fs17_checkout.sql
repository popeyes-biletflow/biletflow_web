-- FS-17: checkout through ticket holds. Run after 003/004. Safe to re-run.

-- 1. Attendee details per ticket (name printed on the ticket, email for delivery)
alter table tickets add column if not exists attendee_name  text;
alter table tickets add column if not exists attendee_email text;

-- 2. finalize_order: idempotent + attendee details + free orders
--    * a second call for the same hold (double click, retry after a timeout)
--      returns the order that was already created instead of failing
--    * free orders (total 0) get status 'completed', paid ones 'paid'
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
  -- row lock: concurrent confirmations of one hold run one after another
  select * into v_h from ticket_holds where id = p_hold_id for update;
  if not found or v_h.user_id is distinct from auth.uid() then raise exception 'HOLD_NOT_FOUND'; end if;

  if v_h.status = 'converted' then
    select id into v_order from orders where hold_id = p_hold_id order by created_at limit 1;
    if v_order is not null then return v_order; end if;
  end if;

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
          p_currency, p_fx_rate, p_charged_minor, p_gateway_txn,
          case when v_h.total_kzt = 0 then 'completed' else 'paid' end)
  returning id into v_order;

  insert into tickets (id, order_id, ticket_type_id, user_id, event_id, status, qr_code_hash,
                       attendee_name, attendee_email)
  select t.id, v_order, v_h.ticket_type_id, v_h.user_id, v_h.event_id, 'valid', t.qr_code_hash,
         nullif(trim(t.attendee_name), ''), nullif(trim(t.attendee_email), '')
    from jsonb_to_recordset(p_tickets) as t(id uuid, qr_code_hash text, attendee_name text, attendee_email text);

  update ticket_holds set status = 'converted' where id = p_hold_id;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata)
  values (case when v_h.total_kzt = 0 then 'FREE_REGISTRATION' else 'ORDER_PAID' end,
          v_h.user_id, 'event', v_h.event_id::text,
          jsonb_build_object('order_id', v_order, 'quantity', v_h.quantity,
                             'total_kzt', v_h.total_kzt, 'promo_code_id', v_h.promo_code_id));
  return v_order;
end $$;

-- 3. Release a hold when the attendee leaves checkout (seats/stock return at once)
create or replace function release_ticket_hold(p_hold_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update ticket_holds set status = 'released'
   where id = p_hold_id and user_id = auth.uid() and status = 'active';
  return found;
end $$;

grant execute on function finalize_order(uuid, text, numeric, bigint, text, jsonb) to authenticated;
grant execute on function release_ticket_hold(uuid) to authenticated;

-- 4. Attendees read their own orders and tickets (used by /api/me/orders)
drop policy if exists "fs17 own orders" on orders;
create policy "fs17 own orders" on orders for select using (user_id = auth.uid());
drop policy if exists "fs17 own tickets" on tickets;
create policy "fs17 own tickets" on tickets for select using (user_id = auth.uid());
