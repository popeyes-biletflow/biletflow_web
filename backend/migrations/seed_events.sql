do $$
declare
  v_org uuid := (select id from auth.users where email = 'ibragim.mukashev@nu.edu.kz');
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
begin
  if v_org is null then raise exception 'User not found, check email'; end if;

  insert into events (organizer_id, title, description, category,
                      event_date, starts_at, ends_at, timezone,
                      venue, venue_name, venue_address,
                      status, visibility, capacity, paid_sales_status, paid_sales_active)
  values (v_org, 'Astana Tech Conference 2026', 'Конференция по IT и AI', 'Conference',
          now() + interval '14 days', now() + interval '14 days', now() + interval '14 days 8 hours', 'Asia/Almaty',
          'Astana IT Hub', 'Astana IT Hub', 'пр. Мангилик Ел, 55/8',
          'published', 'public', 300, 'ACTIVE', true)
  returning id into v_e1;

  insert into events (organizer_id, title, description, category,
                      event_date, starts_at, ends_at, timezone,
                      venue, venue_name, venue_address,
                      status, visibility, capacity, paid_sales_status, paid_sales_active)
  values (v_org, 'Jazz Night Almaty', 'Вечер живого джаза', 'Concert',
          now() + interval '21 days', now() + interval '21 days', now() + interval '21 days 3 hours', 'Asia/Almaty',
          'Kazakhconcert', 'Kazakhconcert', 'ул. Абылай хана, 83',
          'published', 'public', 150, 'ACTIVE', true)
  returning id into v_e2;

  insert into events (organizer_id, title, description, category,
                      event_date, starts_at, ends_at, timezone,
                      venue, venue_name, venue_address,
                      status, visibility, capacity)
  values (v_org, 'Open Startup Meetup', 'Бесплатный митап стартапов', 'Meetup',
          now() + interval '7 days', now() + interval '7 days', now() + interval '7 days 2 hours', 'Asia/Almaty',
          'NU Library', 'NU Library', 'пр. Кабанбай батыра, 53',
          'published', 'public', 80)
  returning id into v_e3;

  insert into ticket_types (event_id, name, description, price, quantity, max_per_order, is_hidden) values
    (v_e1, 'Standard', 'Вход на конференцию', 15000, 250, 5, false),
    (v_e1, 'VIP',      'Первые ряды + нетворкинг', 40000, 50, 2, false),
    (v_e2, 'Standard', 'Входной билет', 8000, 120, 4, false),
    (v_e2, 'Last 5',   'Для теста SOLD_OUT', 5000, 5, 5, false),
    (v_e3, 'Free',     'Бесплатная регистрация', 0, 80, 1, false);
end $$;