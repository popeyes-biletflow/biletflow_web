-- seed_events_batch2.sql: 22 additional events with real photography and buyable ticket tiers
DO $$
DECLARE
  v_org1 uuid := '518a158f-c97f-494c-a692-12675b10de28';
  v_org2 uuid := '26306fa7-d4aa-4934-a223-a8a751b90bb0';
  v_org3 uuid := '59283c9c-74c4-4629-a547-1193624eca95';
  e_id uuid;
BEGIN

  -- 1. Imagine Dragons
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Imagine Dragons: Mercury World Tour Almaty', 'Multi-platinum Grammy award-winning band Imagine Dragons perform their greatest hits and new singles live at Almaty Arena.', 'Almaty Arena', 'Almaty Arena', 'Momyshuly St 1, Almaty', '2026-08-15 19:00:00+05', '2026-08-15 19:00:00+05', '2026-08-15 22:30:00+05', 'Asia/Almaty', 'concert', 'published', 'public', true, 'ACTIVE', 12000, '2026-01-01 00:00:00+00', '2026-08-15 19:00:00+05', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Fan Zone Standing', 28000, 4000, 6, '2026-01-01 00:00:00+00', '2026-08-15 19:00:00+05', false, 'Standing pit right by the main stage'),
    (e_id, 'Sector B Grandstand', 38000, 3000, 6, '2026-01-01 00:00:00+00', '2026-08-15 19:00:00+05', false, 'Numbered seating with direct stage view'),
    (e_id, 'VIP Lounge & Afterparty', 75000, 300, 4, '2026-01-01 00:00:00+00', '2026-08-15 19:00:00+05', false, 'VIP bar, buffet, and premium elevated seating');

  -- 2. Coldplay
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Coldplay - Music of the Spheres Astana', 'A spectacular stadium show featuring kinetic dance floors, laser shows, and legendary anthems.', 'Astana Arena', 'Astana Arena', 'Turan Ave 48, Astana', '2026-09-05 20:00:00+05', '2026-09-05 20:00:00+05', '2026-09-05 23:30:00+05', 'Asia/Almaty', 'concert', 'published', 'public', true, 'ACTIVE', 30000, '2026-01-01 00:00:00+00', '2026-09-05 20:00:00+05', 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'General Admission', 22000, 10000, 6, '2026-01-01 00:00:00+00', '2026-09-05 20:00:00+05', false, 'Pitch standing area'),
    (e_id, 'Lower Tier Tribune', 42000, 5000, 6, '2026-01-01 00:00:00+00', '2026-09-05 20:00:00+05', false, 'Frontal seats in lower bowl'),
    (e_id, 'Early Entry VIP Package', 85000, 500, 4, '2026-01-01 00:00:00+00', '2026-09-05 20:00:00+05', false, 'Early pitch entry + exclusive merch pack');

  -- 3. Central Asia Tech Summit
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'Central Asia Tech Summit 2026', 'Leading technology leaders, venture capitalists, and innovators gather to discuss AI, Fintech, and GovTech.', 'EXPO Congress Center', 'EXPO Congress Center', 'Mangilik El Ave 53, Astana', '2026-06-20 09:30:00+05', '2026-06-20 09:30:00+05', '2026-06-21 18:00:00+05', 'Asia/Almaty', 'technology', 'published', 'public', true, 'ACTIVE', 2500, '2026-01-01 00:00:00+00', '2026-06-20 09:30:00+05', 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Standard Attendee', 15000, 1500, 5, '2026-01-01 00:00:00+00', '2026-06-20 09:30:00+05', false, 'Full 2-day keynotes access and expo hall'),
    (e_id, 'Business & Investor Pass', 45000, 500, 5, '2026-01-01 00:00:00+00', '2026-06-20 09:30:00+05', false, 'B2B lounge, 1-on-1 meetings and networking dinner');

  -- 4. FC Kairat vs Chelsea
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'FC Kairat vs Chelsea FC (UEFA Conference League)', 'Historic clash in Almaty as FC Kairat host London giants Chelsea FC.', 'Central Stadium Almaty', 'Central Stadium Almaty', 'Abay Ave 48, Almaty', '2026-10-22 21:00:00+05', '2026-10-22 21:00:00+05', '2026-10-22 23:15:00+05', 'Asia/Almaty', 'sports', 'published', 'public', true, 'ACTIVE', 23000, '2026-01-01 00:00:00+00', '2026-10-22 21:00:00+05', 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'South Tribune (Fan Sector)', 5000, 6000, 4, '2026-01-01 00:00:00+00', '2026-10-22 21:00:00+05', false, 'Behind goal standing & cheering sector'),
    (e_id, 'West Tribune Central', 18000, 4000, 4, '2026-01-01 00:00:00+00', '2026-10-22 21:00:00+05', false, 'Prime midfield covered seats'),
    (e_id, 'VIP Box Lounge', 60000, 200, 2, '2026-01-01 00:00:00+00', '2026-10-22 21:00:00+05', false, 'Catering and VIP private skybox');

  -- 5. Almaty Half Marathon
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Almaty Half Marathon 2026', 'Scenic mountain-view running event across the heart of Almaty. Distances: 10km, 21km, and Nordic Walking.', 'First President Park', 'First President Park', 'Al-Farabi Ave, Almaty', '2026-07-12 07:00:00+05', '2026-07-12 07:00:00+05', '2026-07-12 13:00:00+05', 'Asia/Almaty', 'sports', 'published', 'public', true, 'ACTIVE', 8000, '2026-01-01 00:00:00+00', '2026-07-12 07:00:00+05', 'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, '10K Run Entry', 9000, 4000, 2, '2026-01-01 00:00:00+00', '2026-07-12 07:00:00+05', false, 'Chip timing, medal, running jersey'),
    (e_id, '21K Half Marathon Entry', 14000, 3000, 2, '2026-01-01 00:00:00+00', '2026-07-12 07:00:00+05', false, 'Official 21.1 km race packet and finisher medal');

  -- 6. Swan Lake
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'Swan Lake — Astana Opera Ballet', 'Tchaikovsky iconic masterpiece performed by the world-class Astana Opera Ballet troupe and symphony orchestra.', 'Astana Opera', 'Astana Opera', 'Kunayev St 1, Astana', '2026-06-27 18:00:00+05', '2026-06-27 18:00:00+05', '2026-06-27 21:00:00+05', 'Asia/Almaty', 'theatre', 'published', 'public', true, 'ACTIVE', 1250, '2026-01-01 00:00:00+00', '2026-06-27 18:00:00+05', 'https://images.unsplash.com/photo-1518834107812-67b0b7c58434?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Parterre Center', 16000, 400, 4, '2026-01-01 00:00:00+00', '2026-06-27 18:00:00+05', false, 'Ground floor center rows with optimal acoustics'),
    (e_id, 'Bel-Etage & Boxes', 24000, 200, 4, '2026-01-01 00:00:00+00', '2026-06-27 18:00:00+05', false, 'First tier royal boxes'),
    (e_id, 'Amphitheatre', 8000, 350, 4, '2026-01-01 00:00:00+00', '2026-06-27 18:00:00+05', false, 'Elevated upper tier seating');

  -- 7. StandUp Festival
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'StandUp Festival Almaty: Big Spring Show', 'Top comedians from Kazakhstan and Central Asia present brand new solo materials and improvisations.', 'Palace of the Republic', 'Palace of the Republic', 'Dostyk Ave 56, Almaty', '2026-07-04 19:30:00+05', '2026-07-04 19:30:00+05', '2026-07-04 22:00:00+05', 'Asia/Almaty', 'comedy', 'published', 'public', true, 'ACTIVE', 2800, '2026-01-01 00:00:00+00', '2026-07-04 19:30:00+05', 'https://images.unsplash.com/photo-1585699324551-f6c309eedeca?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Standard Balcony', 7000, 800, 6, '2026-01-01 00:00:00+00', '2026-07-04 19:30:00+05', false, 'Upper balcony seating'),
    (e_id, 'Parterre Rows 5-15', 14000, 1000, 6, '2026-01-01 00:00:00+00', '2026-07-04 19:30:00+05', false, 'Main floor seating'),
    (e_id, 'VIP Front Row Tables', 25000, 120, 4, '2026-01-01 00:00:00+00', '2026-07-04 19:30:00+05', false, 'Close to stage with beverage service');

  -- 8. Kazakhstan AI & Robotics Expo
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Kazakhstan AI & Robotics Expo 2026', 'Discover hands-on robotics, LLM demonstrations, autonomous drones, and future tech showcases.', 'Atakent Exhibition Center', 'Atakent Exhibition Center', 'Timiryazev St 42, Almaty', '2026-09-18 10:00:00+05', '2026-09-18 10:00:00+05', '2026-09-20 18:00:00+05', 'Asia/Almaty', 'technology', 'published', 'public', true, 'ACTIVE', 5000, '2026-01-01 00:00:00+00', '2026-09-18 10:00:00+05', 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Day Pass (Student / General)', 4000, 3000, 6, '2026-01-01 00:00:00+00', '2026-09-18 10:00:00+05', false, 'Single day exhibition hall access'),
    (e_id, 'All-Days Tech Pass', 9000, 1500, 6, '2026-01-01 00:00:00+00', '2026-09-18 10:00:00+05', false, '3-day pass with workshop stages access');

  -- 9. Hans Zimmer Live
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'Hans Zimmer Live: Film Symphony Almaty', 'Legendary film scores from Interstellar, Gladiator, Dune, Inception, and The Lion King performed by a 100-piece symphony.', 'Palace of the Republic', 'Palace of the Republic', 'Dostyk Ave 56, Almaty', '2026-10-10 19:00:00+05', '2026-10-10 19:00:00+05', '2026-10-10 22:00:00+05', 'Asia/Almaty', 'concert', 'published', 'public', true, 'ACTIVE', 2800, '2026-01-01 00:00:00+00', '2026-10-10 19:00:00+05', 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Balcony Tier', 12000, 700, 4, '2026-01-01 00:00:00+00', '2026-10-10 19:00:00+05', false, 'Standard balcony seating'),
    (e_id, 'Orchestra Center', 28000, 1000, 4, '2026-01-01 00:00:00+00', '2026-10-10 19:00:00+05', false, 'Superb acoustic central parterre seats'),
    (e_id, 'VIP Premium Parterre', 45000, 300, 4, '2026-01-01 00:00:00+00', '2026-10-10 19:00:00+05', false, 'First 5 rows frontal view');

  -- 10. Dimash Qudaibergen
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Dimash Qudaibergen: Homecoming Concert', 'The world-renowned vocal prodigy performs his landmark solo show in the capital.', 'Barys Arena', 'Barys Arena', 'Turan Ave 57, Astana', '2026-09-26 19:00:00+05', '2026-09-26 19:00:00+05', '2026-09-26 22:30:00+05', 'Asia/Almaty', 'music', 'published', 'public', true, 'ACTIVE', 11500, '2026-01-01 00:00:00+00', '2026-09-26 19:00:00+05', 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Fan Zone', 25000, 3500, 4, '2026-01-01 00:00:00+00', '2026-09-26 19:00:00+05', false, 'Standing pit directly in front of stage'),
    (e_id, 'Sector A Lower', 35000, 3000, 4, '2026-01-01 00:00:00+00', '2026-09-26 19:00:00+05', false, 'Numbered seats in lower bowl'),
    (e_id, 'VIP Gold Pass', 65000, 250, 2, '2026-01-01 00:00:00+00', '2026-09-26 19:00:00+05', false, 'VIP entry lane and souvenir lanyard');

  -- 11. Shymkent Open Air
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Shymkent Open Air Electronic Music Fest', 'Sunsets, beats, and light installations featuring top domestic and international DJs.', 'Nauryz Park', 'Nauryz Park', 'Baitursynov St, Shymkent', '2026-08-01 16:00:00+05', '2026-08-01 16:00:00+05', '2026-08-02 04:00:00+05', 'Asia/Almaty', 'festival', 'published', 'public', true, 'ACTIVE', 6000, '2026-01-01 00:00:00+00', '2026-08-01 16:00:00+05', 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Early Bird Dance Ticket', 8000, 2000, 6, '2026-01-01 00:00:00+00', '2026-08-01 16:00:00+05', false, 'Full night general admission'),
    (e_id, 'Backstage Lounge', 22000, 300, 4, '2026-01-01 00:00:00+00', '2026-08-01 16:00:00+05', false, 'VIP bar area and artist viewing deck');

  -- 12. TEDxAstana
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'TEDxAstana 2026: Beyond Horizons', 'Ideas worth spreading: multidisciplinary talks on climate, biotechnology, education, and human potential.', 'Nazarbayev University Main Hall', 'Nazarbayev University Main Hall', 'Kabanbay Batyr 53, Astana', '2026-10-17 10:00:00+05', '2026-10-17 10:00:00+05', '2026-10-17 17:30:00+05', 'Asia/Almaty', 'conference', 'published', 'public', true, 'ACTIVE', 900, '2026-01-01 00:00:00+00', '2026-10-17 10:00:00+05', 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Standard Delegate', 10000, 600, 2, '2026-01-01 00:00:00+00', '2026-10-17 10:00:00+05', false, 'Full day talks, networking lunch and gift bag'),
    (e_id, 'Supporter Pass', 25000, 150, 2, '2026-01-01 00:00:00+00', '2026-10-17 10:00:00+05', false, 'Front rows and speaker dinner access');

  -- 13. Romeo and Juliet
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Romeo and Juliet — Abay State Academic Opera', 'Sergei Prokofiev dramatic ballet staged in the historic hall of Abay Opera House in Almaty.', 'Abay Opera House', 'Abay Opera House', 'Kabanbay Batyr St 110, Almaty', '2026-11-06 18:30:00+05', '2026-11-06 18:30:00+05', '2026-11-06 21:00:00+05', 'Asia/Almaty', 'theatre', 'published', 'public', true, 'ACTIVE', 850, '2026-01-01 00:00:00+00', '2026-11-06 18:30:00+05', 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Parterre', 12000, 350, 4, '2026-01-01 00:00:00+00', '2026-11-06 18:30:00+05', false, 'Classic auditorium seating'),
    (e_id, 'Tier Boxes', 18000, 150, 4, '2026-01-01 00:00:00+00', '2026-11-06 18:30:00+05', false, 'First tier private side boxes'),
    (e_id, 'Upper Gallery', 5000, 200, 4, '2026-01-01 00:00:00+00', '2026-11-06 18:30:00+05', false, 'Top gallery seating');

  -- 14. Silk Way Food & Wine Festival
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Silk Way Food & Wine Festival', 'Culinary masterclasses from Michelin-starred chefs, local craft wine tastings, and live acoustic music on Kok Tobe.', 'Kok Tobe Park', 'Kok Tobe Park', 'Dostyk Ave 104B, Almaty', '2026-08-22 12:00:00+05', '2026-08-22 12:00:00+05', '2026-08-23 22:00:00+05', 'Asia/Almaty', 'festival', 'published', 'public', true, 'ACTIVE', 4000, '2026-01-01 00:00:00+00', '2026-08-22 12:00:00+05', 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Standard Tasting Ticket', 7500, 2500, 6, '2026-01-01 00:00:00+00', '2026-08-22 12:00:00+05', false, 'Entrance + 5 food/drink tasting tokens'),
    (e_id, 'Gourmet Masterclass Pass', 18000, 400, 4, '2026-01-01 00:00:00+00', '2026-08-22 12:00:00+05', false, 'Chef table workshop and premium pairing');

  -- 15. Kazakhstan Cyber Games
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'Kazakhstan Cyber Games: CS2 Major Finals', 'The regional grand finals of Counter-Strike 2 featuring top CIS and European pro rosters.', 'Qazaqstan Athletic Complex', 'Qazaqstan Athletic Complex', 'Turan Ave 59, Astana', '2026-11-14 12:00:00+05', '2026-11-14 12:00:00+05', '2026-11-15 21:00:00+05', 'Asia/Almaty', 'sports', 'published', 'public', true, 'ACTIVE', 7000, '2026-01-01 00:00:00+00', '2026-11-14 12:00:00+05', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Grandstand Weekend Pass', 9000, 4500, 4, '2026-01-01 00:00:00+00', '2026-11-14 12:00:00+05', false, 'Access to 2-day playoffs and finals'),
    (e_id, 'Player Fan VIP', 28000, 300, 2, '2026-01-01 00:00:00+00', '2026-11-14 12:00:00+05', false, 'Autograph sessions, stage front seats and in-game swag');

  -- 16. Contemporary Art Biennale
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Contemporary Art Biennale Almaty', 'Over 60 artists from Central Asia, Europe and East Asia presenting multimedia installations and contemporary sculpture.', 'Kasteyev State Museum of Arts', 'Kasteyev State Museum of Arts', 'Satpaev St 30A, Almaty', '2026-09-12 10:00:00+05', '2026-09-12 10:00:00+05', '2026-10-05 18:00:00+05', 'Asia/Almaty', 'exhibition', 'published', 'public', true, 'ACTIVE', 3000, '2026-01-01 00:00:00+00', '2026-09-12 10:00:00+05', 'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'General Entry', 3000, 2500, 6, '2026-01-01 00:00:00+00', '2026-09-12 10:00:00+05', false, 'Admission to all museum pavilions'),
    (e_id, 'Curator-Led Guided Tour', 7000, 300, 4, '2026-01-01 00:00:00+00', '2026-09-12 10:00:00+05', false, '90-minute exclusive curator tour');

  -- 17. The Nutcracker on Ice
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'The Nutcracker on Ice: World Stars', 'A fairy-tale winter spectacle combining Olympic figure skaters, acrobats, and classic choreography.', 'Halyk Arena', 'Halyk Arena', 'Kulzhinsky Trakt 2D, Almaty', '2026-12-19 14:00:00+05', '2026-12-19 14:00:00+05', '2026-12-19 16:30:00+05', 'Asia/Almaty', 'theatre', 'published', 'public', true, 'ACTIVE', 3200, '2026-01-01 00:00:00+00', '2026-12-19 14:00:00+05', 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Sector B Family', 8500, 1200, 6, '2026-01-01 00:00:00+00', '2026-12-19 14:00:00+05', false, 'Numbered tribune seating'),
    (e_id, 'Ice Rink Ringside', 18000, 500, 4, '2026-01-01 00:00:00+00', '2026-12-19 14:00:00+05', false, 'Closest seats to the ice surface');

  -- 18. DevFest Kazakhstan
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'DevFest Kazakhstan 2026: Cloud & Web', 'The premier community-led software engineering conference focusing on React, Go, Kubernetes, and AI Agents.', 'Astana Hub', 'Astana Hub', 'Mangilik El Ave 55/8, Astana', '2026-10-24 09:00:00+05', '2026-10-24 09:00:00+05', '2026-10-24 18:00:00+05', 'Asia/Almaty', 'technology', 'published', 'public', true, 'ACTIVE', 1200, '2026-01-01 00:00:00+00', '2026-10-24 09:00:00+05', 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Free Community Pass', 0, 700, 1, '2026-01-01 00:00:00+00', '2026-10-24 09:00:00+05', false, 'Community entry to all keynote streams'),
    (e_id, 'Pro Developer Workshop Ticket', 15000, 300, 2, '2026-01-01 00:00:00+00', '2026-10-24 09:00:00+05', false, 'Hands-on afternoon masterclasses + lunch');

  -- 19. Almaty Jazz Nights
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Almaty Jazz Nights: Mediterranean Trio', 'Intimate live saxophone, double bass, and piano trio in an atmospheric jazz lounge setting.', 'EverJazz Club', 'EverJazz Club', 'Zenkov St 24, Almaty', '2026-07-25 20:00:00+05', '2026-07-25 20:00:00+05', '2026-07-25 23:00:00+05', 'Asia/Almaty', 'music', 'published', 'public', true, 'ACTIVE', 220, '2026-01-01 00:00:00+00', '2026-07-25 20:00:00+05', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Bar Stool Ticket', 6000, 60, 4, '2026-01-01 00:00:00+00', '2026-07-25 20:00:00+05', false, 'Bar area unreserved seat'),
    (e_id, 'Stage Front Table Seat', 14000, 80, 4, '2026-01-01 00:00:00+00', '2026-07-25 20:00:00+05', false, 'Reserved table near the stage with welcome glass');

  -- 20. Nur-Sultan Philharmonic
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org2, 'Astana Philharmonic: Vivaldi Four Seasons', 'The timeless beauty of Antonio Vivaldi baroque masterpiece performed by chamber orchestra soloists.', 'Kazakhstan Central Concert Hall', 'Kazakhstan Central Concert Hall', 'Mangilik El 10/1, Astana', '2026-11-28 18:00:00+05', '2026-11-28 18:00:00+05', '2026-11-28 20:30:00+05', 'Asia/Almaty', 'music', 'published', 'public', true, 'ACTIVE', 1800, '2026-01-01 00:00:00+00', '2026-11-28 18:00:00+05', 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Parterre Center', 9000, 700, 4, '2026-01-01 00:00:00+00', '2026-11-28 18:00:00+05', false, 'Central parterre numbered seating'),
    (e_id, 'Amphitheatre', 5500, 600, 4, '2026-01-01 00:00:00+00', '2026-11-28 18:00:00+05', false, 'Raised amphitheatre seating');

  -- 21. International Education Fair
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org3, 'International Education Fair 2026', 'Meet representatives from 120+ top universities from the UK, USA, Europe, and Asia. Scholarships and admissions guidance.', 'Rixos President Astana', 'Rixos President Astana', 'Dinmukhamed Kunayev St 7, Astana', '2026-10-03 11:00:00+05', '2026-10-03 11:00:00+05', '2026-10-03 17:00:00+05', 'Asia/Almaty', 'education', 'published', 'public', true, 'ACTIVE', 2000, '2026-01-01 00:00:00+00', '2026-10-03 11:00:00+05', 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Free Visitor Entry', 0, 1500, 2, '2026-01-01 00:00:00+00', '2026-10-03 11:00:00+05', false, 'General admission to university booths'),
    (e_id, 'IELTS / SAT Prep Session Pass', 5000, 300, 2, '2026-01-01 00:00:00+00', '2026-10-03 11:00:00+05', false, 'Test strategy masterclass with certified tutors');

  -- 22. Stand-Up Comedy Club: Nurlan Saburov Solo Tour
  e_id := gen_random_uuid();
  INSERT INTO events (id, organizer_id, title, description, venue, venue_name, venue_address, event_date, starts_at, ends_at, timezone, category, status, visibility, paid_sales_active, paid_sales_status, capacity, registration_opens_at, registration_closes_at, image_url, is_suspended, refund_policy)
  VALUES (e_id, v_org1, 'Stand-Up Comedy: Nurlan Saburov Solo Tour', 'A brand-new solo comedy tour "Principles" by Nurlan Saburov in Almaty.', 'Almaty Arena', 'Almaty Arena', 'Momyshuly St 1, Almaty', '2026-11-21 19:00:00+05', '2026-11-21 19:00:00+05', '2026-11-21 21:30:00+05', 'Asia/Almaty', 'comedy', 'published', 'public', true, 'ACTIVE', 10000, '2026-01-01 00:00:00+00', '2026-11-21 19:00:00+05', 'https://images.unsplash.com/photo-1527224857830-43a7acc85260?auto=format&fit=crop&w=1200&q=80', false, 'full_until_start');
  INSERT INTO ticket_types (event_id, name, price, quantity, max_per_order, sale_starts_at, sale_ends_at, is_hidden, description) VALUES
    (e_id, 'Sector C Grandstand', 12000, 3000, 4, '2026-01-01 00:00:00+00', '2026-11-21 19:00:00+05', false, 'Grandstand upper seating'),
    (e_id, 'Sector A Parterre', 25000, 2000, 4, '2026-01-01 00:00:00+00', '2026-11-21 19:00:00+05', false, 'Central floor parterre'),
    (e_id, 'Front VIP Row', 45000, 200, 2, '2026-01-01 00:00:00+00', '2026-11-21 19:00:00+05', false, 'Front row seating right by the stage');

END $$;
