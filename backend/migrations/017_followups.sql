create or replace function duplicate_event(
  p_event_id  uuid,
  p_title     text default null,
  p_starts_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src   events%rowtype;
  v_new   uuid;
  v_shift interval := interval '0';
  v_types int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_src from events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_src.organizer_id is distinct from auth.uid() then raise exception 'NOT_EVENT_OWNER'; end if;

  if p_starts_at is not null and v_src.starts_at is not null then
    v_shift := p_starts_at - v_src.starts_at;
  end if;

  insert into events (organizer_id, title, description, category,
                      event_date, starts_at, ends_at, timezone,
                      venue, venue_name, venue_address, image_url,
                      capacity, visibility, registration_opens_at, registration_closes_at,
                      refund_policy, status, paid_sales_status, paid_sales_active)
  values (v_src.organizer_id,
          coalesce(nullif(trim(p_title), ''), v_src.title || ' (копия)'),
          v_src.description, v_src.category,
          v_src.event_date + v_shift, v_src.starts_at + v_shift, v_src.ends_at + v_shift, v_src.timezone,
          v_src.venue, v_src.venue_name, v_src.venue_address, v_src.image_url,
          v_src.capacity, v_src.visibility,
          v_src.registration_opens_at + v_shift, v_src.registration_closes_at + v_shift,
          v_src.refund_policy, 'draft', 'NONE', false)
  returning id into v_new;

  insert into ticket_types (event_id, name, description, price, quantity, max_per_order,
                            is_hidden, sale_starts_at, sale_ends_at)
  select v_new, name, description, price, quantity, max_per_order,
         is_hidden, sale_starts_at + v_shift, sale_ends_at + v_shift
    from ticket_types where event_id = p_event_id;
  get diagnostics v_types = row_count;

  insert into audit_log (action, performed_by, entity_type, entity_id, metadata) values
    ('EVENT_DUPLICATED_FROM', auth.uid(), 'event', v_new::text,
       jsonb_build_object('source_event_id', p_event_id, 'ticket_types_copied', v_types)),
    ('EVENT_DUPLICATED_TO', auth.uid(), 'event', p_event_id::text,
       jsonb_build_object('new_event_id', v_new));

  return jsonb_build_object('event_id', v_new, 'source_event_id', p_event_id,
                            'status', 'draft', 'ticket_types_copied', v_types);
end $$;

grant execute on function duplicate_event(uuid, text, timestamptz) to authenticated;

update orders o
   set event_id       = coalesce(o.event_id, t.event_id),
       ticket_type_id = coalesce(o.ticket_type_id, t.ticket_type_id),
       quantity       = coalesce(o.quantity, t.n)
  from (select order_id,
               min(event_id::text)::uuid as event_id,
               min(ticket_type_id::text)::uuid as ticket_type_id,
               count(*)::int as n
          from tickets where order_id is not null group by order_id) t
 where o.id = t.order_id and (o.event_id is null or o.ticket_type_id is null or o.quantity is null);

update orders
   set subtotal_kzt = coalesce(subtotal_kzt, subtotal_amount, total_amount::int),
       discount_kzt = coalesce(discount_kzt, discount_amount, 0),
       fee_kzt      = coalesce(fee_kzt, fee_amount, 0)
 where subtotal_kzt is null or discount_kzt is null or fee_kzt is null;