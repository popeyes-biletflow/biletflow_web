create or replace function event_history(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select organizer_id into v_owner from events where id = p_event_id;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if v_owner is distinct from auth.uid() then raise exception 'NOT_EVENT_OWNER'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id,
             'action', a.action,
             'created_at', a.created_at,
             'performed_by', a.performed_by,
             'performed_by_name', p.full_name,
             'metadata', a.metadata)
           order by a.created_at)
      from audit_log a
      left join profiles p on p.id = a.performed_by
     where a.entity_type = 'event' and a.entity_id = p_event_id::text
  ), '[]'::jsonb);
end $$;

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
                      status, paid_sales_status, paid_sales_active)
  values (v_src.organizer_id,
          coalesce(nullif(trim(p_title), ''), v_src.title || ' (копия)'),
          v_src.description, v_src.category,
          v_src.event_date + v_shift, v_src.starts_at + v_shift, v_src.ends_at + v_shift, v_src.timezone,
          v_src.venue, v_src.venue_name, v_src.venue_address, v_src.image_url,
          v_src.capacity, v_src.visibility,
          v_src.registration_opens_at + v_shift, v_src.registration_closes_at + v_shift,
          'draft', 'NONE', false)
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

grant execute on function event_history(uuid) to authenticated;
grant execute on function duplicate_event(uuid, text, timestamptz) to authenticated;