-- =============================================================================
-- Seed Data: Authentic Linz, Austria Partner Gyms, Coaches, and Staff
-- =============================================================================

-- 1. Insert Auth Users (for local PG testing)
INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-1111-1111-000000000001', 'max.mustermann@linz.at'),
  ('11111111-1111-1111-1111-000000000002', 'sophie.huber@linz.at'),
  ('22222222-2222-2222-2222-000000000001', 'lukas.bauer@coach.at'),
  ('22222222-2222-2222-2222-000000000002', 'elena.fischer@coach.at'),
  ('22222222-2222-2222-2222-000000000003', 'markus.weber@coach.at'),
  ('22222222-2222-2222-2222-000000000004', 'anna.steyr@coach.at'),
  ('33333333-3333-3333-3333-000000000001', 'empfang.johnharris@linz.at'),
  ('33333333-3333-3333-3333-000000000002', 'empfang.fitfabrik@linz.at'),
  ('33333333-3333-3333-3333-000000000003', 'empfang.happyfit@linz.at'),
  ('33333333-3333-3333-3333-000000000004', 'empfang.kieser@linz.at')
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Profiles
INSERT INTO public.profiles (id, role, full_name, email, phone)
VALUES
  ('11111111-1111-1111-1111-000000000001', 'client', 'Max Mustermann', 'max.mustermann@linz.at', '+43 664 1234567'),
  ('11111111-1111-1111-1111-000000000002', 'client', 'Sophie Huber', 'sophie.huber@linz.at', '+43 664 2345678'),
  ('22222222-2222-2222-2222-000000000001', 'coach', 'Lukas Bauer', 'lukas.bauer@coach.at', '+43 676 3456789'),
  ('22222222-2222-2222-2222-000000000002', 'coach', 'Elena Fischer', 'elena.fischer@coach.at', '+43 676 4567890'),
  ('22222222-2222-2222-2222-000000000003', 'coach', 'Markus Weber', 'markus.weber@coach.at', '+43 676 5678901'),
  ('22222222-2222-2222-2222-000000000004', 'coach', 'Anna Steyr', 'anna.steyr@coach.at', '+43 676 6789012'),
  ('33333333-3333-3333-3333-000000000001', 'gym_receptionist', 'Florian Leitner', 'empfang.johnharris@linz.at', '+43 732 770770'),
  ('33333333-3333-3333-3333-000000000002', 'gym_receptionist', 'Sabine Mayr', 'empfang.fitfabrik@linz.at', '+43 732 781234'),
  ('33333333-3333-3333-3333-000000000003', 'gym_receptionist', 'Christoph Ortner', 'empfang.happyfit@linz.at', '+43 732 245678'),
  ('33333333-3333-3333-3333-000000000004', 'gym_receptionist', 'Daniela Hofer', 'empfang.kieser@linz.at', '+43 732 779911')
ON CONFLICT (id) DO NOTHING;

-- 3. Insert Partner Gyms in Linz
INSERT INTO public.gyms (id, name, slug, address, city, postal_code, contact_email, contact_phone, floor_fee, stripe_account_id, amenities, is_active)
VALUES 
  (
    '00000000-0000-0000-0000-000000000001',
    'John Harris Fitness Linz Atrium',
    'john-harris-atrium',
    'Am Winterhafen 4',
    'Linz',
    '4020',
    'linz@johnharris.at',
    '+43 732 770770',
    8.00,
    'acct_linz_johnharris_atrium',
    ARRAY['Wellness & Spa', 'Eleiko Olympic Lifting', 'Panoramablick', 'Handtuchservice'],
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Fit Fabrik Linz',
    'fit-fabrik-linz',
    'Hafenstraße 2a',
    'Linz',
    '4020',
    'empfang@fitfabrik-linz.at',
    '+43 732 781234',
    8.00,
    'acct_linz_fitfabrik',
    ARRAY['CrossFit Zone', 'Freihantelbereich bis 60kg', '24/7 Zugang', 'Getränkebar'],
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Happy Fit Linz Urfahr',
    'happy-fit-urfahr',
    'Freistädter Straße 313',
    'Linz',
    '4040',
    'urfahr@happyfit.eu',
    '+43 732 245678',
    8.00,
    'acct_linz_happyfit_urfahr',
    ARRAY['Cardio Kino', 'Functional Tower', 'Solarium', 'Parkplätze vor Ort'],
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'Kieser Training Linz Zentrum',
    'kieser-linz-zentrum',
    'Landstraße 49',
    'Linz',
    '4020',
    'linz1@kieser-training.com',
    '+43 732 779911',
    8.00,
    'acct_linz_kieser',
    ARRAY['Medizinische Kräftigung', 'Rückenanalyse', 'Gelenkschonende Maschinen'],
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Insert Gym Staff
INSERT INTO public.gym_staff (id, gym_id, user_id, role)
VALUES
  ('55555555-5555-5555-5555-000000000001', '00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-000000000001', 'receptionist'),
  ('55555555-5555-5555-5555-000000000002', '00000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-000000000002', 'receptionist'),
  ('55555555-5555-5555-5555-000000000003', '00000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-000000000003', 'receptionist'),
  ('55555555-5555-5555-5555-000000000004', '00000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-000000000004', 'receptionist')
ON CONFLICT (id) DO NOTHING;

-- 5. Insert Coach Profiles
INSERT INTO public.coach_profiles (id, user_id, full_name, bio, specialties, certifications, hourly_rate, rating, review_count, stripe_account_id, is_active)
VALUES
  (
    '44444444-4444-4444-4444-000000000001',
    '22222222-2222-2222-2222-000000000001',
    'Lukas Bauer',
    'Staatlich geprüfter Fitnesstrainer & Wettkampfathlet. Spezialisiert auf progressive Kraftsteigerung, Hypertrophie und sportspezifische Athletik.',
    ARRAY['Strength & Conditioning', 'Powerlifting', 'Hypertrophy'],
    ARRAY['ÖBSV Staatlich geprüfter Fitnesstrainer', 'CSCS Certified'],
    75.00,
    4.95,
    38,
    'acct_coach_lukas_bauer',
    TRUE
  ),
  (
    '44444444-4444-4444-4444-000000000002',
    '22222222-2222-2222-2222-000000000002',
    'Elena Fischer',
    'Sportphysiotherapeutin und Mobility-Expertin. Zielgerichtetes Training zur Haltungskorrektur, Verletzungsprävention und schmerzfreier Höchstleistung.',
    ARRAY['Mobility & Rehab', 'Functional Fitness', 'Post-Injury Return'],
    ARRAY['B-Lizenz Rehabilitation', 'FMS Level 2'],
    80.00,
    5.00,
    42,
    'acct_coach_elena_fischer',
    TRUE
  ),
  (
    '44444444-4444-4444-4444-000000000003',
    '22222222-2222-2222-2222-000000000003',
    'Markus Weber',
    'High-Energy HIIT & Ausdauercoach. Schnelle, messbare Fettverbrennung und Konditionsaufbau mit abwechslungsreichen funktionellen Einheiten.',
    ARRAY['HIIT & Endurance', 'Fat Loss', 'Athletic Conditioning'],
    ARRAY['Diplomierter Personal Trainer (Wifi OÖ)', 'TRX Certified Coach'],
    65.00,
    4.88,
    27,
    'acct_coach_markus_weber',
    TRUE
  ),
  (
    '44444444-4444-4444-4444-000000000004',
    '22222222-2222-2222-2222-000000000004',
    'Anna Steyr',
    'Ehemalige Bundesligaspielerin und Olympische Gewichthebetrainerin. Fokus auf Langhanteltechnik, Explosivkraft und mentale Wettkampfstärke.',
    ARRAY['Olympic Weightlifting', 'Cross-Training', 'Kettlebell Sport'],
    ARRAY['ÖGV Staatliche Gewichtheber-Trainerin', 'Eleiko Strength Coach'],
    90.00,
    4.98,
    56,
    'acct_coach_anna_steyr',
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

-- 6. Insert Coach-Gym Affiliations
INSERT INTO public.coach_gym_affiliations (id, coach_id, gym_id, is_verified)
VALUES
  ('a1111111-1111-1111-1111-000000000001', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000001', TRUE), -- Lukas at John Harris
  ('a1111111-1111-1111-1111-000000000002', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000002', TRUE), -- Lukas at Fit Fabrik
  ('a1111111-1111-1111-1111-000000000003', '44444444-4444-4444-4444-000000000002', '00000000-0000-0000-0000-000000000002', TRUE), -- Elena at Fit Fabrik
  ('a1111111-1111-1111-1111-000000000004', '44444444-4444-4444-4444-000000000002', '00000000-0000-0000-0000-000000000004', TRUE), -- Elena at Kieser
  ('a1111111-1111-1111-1111-000000000005', '44444444-4444-4444-4444-000000000003', '00000000-0000-0000-0000-000000000003', TRUE), -- Markus at Happy Fit
  ('a1111111-1111-1111-1111-000000000006', '44444444-4444-4444-4444-000000000003', '00000000-0000-0000-0000-000000000002', TRUE), -- Markus at Fit Fabrik
  ('a1111111-1111-1111-1111-000000000007', '44444444-4444-4444-4444-000000000004', '00000000-0000-0000-0000-000000000001', TRUE), -- Anna at John Harris
  ('a1111111-1111-1111-1111-000000000008', '44444444-4444-4444-4444-000000000004', '00000000-0000-0000-0000-000000000003', TRUE)  -- Anna at Happy Fit
ON CONFLICT (id) DO NOTHING;

-- 7. Insert Coach Availability Slots
INSERT INTO public.coach_availability (id, coach_id, gym_id, day_of_week, start_time, end_time, is_recurring, is_booked)
VALUES
  ('b1111111-1111-1111-1111-000000000001', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000001', 1, '08:00:00', '09:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000002', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000001', 1, '09:00:00', '10:00:00', TRUE, TRUE), -- booked
  ('b1111111-1111-1111-1111-000000000003', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000001', 1, '10:00:00', '11:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000004', '44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000002', 3, '14:00:00', '15:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000005', '44444444-4444-4444-4444-000000000002', '00000000-0000-0000-0000-000000000002', 2, '09:00:00', '10:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000006', '44444444-4444-4444-4444-000000000002', '00000000-0000-0000-0000-000000000004', 4, '15:00:00', '16:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000007', '44444444-4444-4444-4444-000000000003', '00000000-0000-0000-0000-000000000003', 1, '17:00:00', '18:00:00', TRUE, FALSE),
  ('b1111111-1111-1111-1111-000000000008', '44444444-4444-4444-4444-000000000004', '00000000-0000-0000-0000-000000000001', 5, '08:00:00', '09:00:00', TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 8. Insert Baseline Booking & Cryptographic Check-in Pass
-- Baseline session: €75.00 gross = €8.00 floor + €10.50 platform (14%) + €56.50 coach payout
INSERT INTO public.bookings (
  id,
  client_id,
  coach_id,
  gym_id,
  session_time,
  duration_minutes,
  gross_amount,
  gym_floor_fee,
  platform_fee,
  coach_payout,
  status,
  client_notes,
  stripe_payment_intent_id
) VALUES (
  '66666666-6666-6666-6666-000000000001',
  '11111111-1111-1111-1111-000000000001',
  '44444444-4444-4444-4444-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '2026-10-15T09:00:00Z',
  60,
  75.00,
  8.00,
  10.50,
  56.50,
  'confirmed',
  'Fokus auf Deadlift-Technik und Schulterstabilität',
  'pi_mock_baseline7500'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.check_in_passes (
  id,
  booking_id,
  gym_id,
  client_id,
  dynamic_token,
  qr_signature,
  nonce,
  expires_at,
  is_redeemed
) VALUES (
  '77777777-7777-7777-7777-000000000001',
  '66666666-6666-6666-6666-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-000000000001',
  'GM1.eyJ2IjoxLCJwaWQiOiI3Nzc3Nzc3Ny03Nzc3LTc3NzctNzc3Ny0wMDAwMDAwMDAwMDEiLCJiaWQiOiI2NjY2NjY2Ni02NjY2LTY2NjYtNjY2Ni0wMDAwMDAwMDAwMDEiLCJjaWQiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0wMDAwMDAwMDAwMDEiLCJnaWQiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJzdCI6MTc5MjA1NDgwMCwidmYiOjE3NjAwMDAwMDAsInZ1IjoxOTAwMDAwMDAwLCJuY2UiOiJzZWVkbm9uY2UwMDEiLCJpYXQiOjE3OTE2MTkyMDB9.BLfOHmfh0Zr5kj9L_viUlmwoZC6oUyG1RWGZcYUBYII',
  'BLfOHmfh0Zr5kj9L_viUlmwoZC6oUyG1RWGZcYUBYII',
  'seednonce001',
  '2026-10-15T10:30:00Z',
  FALSE
) ON CONFLICT (id) DO NOTHING;
