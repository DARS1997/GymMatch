-- =============================================================================
-- Migration: 20261010000001_initial_schema.sql
-- Description: Core tables, constraints, enums, triggers, and indexes for GymMatch
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure auth schema and auth.users exist for local PostgreSQL compatibility
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 1. Profiles (Application user metadata extending auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'coach', 'gym_owner', 'gym_receptionist', 'admin')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. Gyms (Partner fitness facilities in Linz)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Linz',
  postal_code TEXT NOT NULL DEFAULT '4020',
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  floor_fee NUMERIC(10, 2) NOT NULL DEFAULT 8.00 CHECK (floor_fee >= 0),
  stripe_account_id TEXT,
  hero_image_url TEXT,
  amenities TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Gym Staff (Staff & Receptionist role association)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gym_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'receptionist' CHECK (role IN ('owner', 'manager', 'receptionist')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_gym_staff UNIQUE (gym_id, user_id)
);

-- -----------------------------------------------------------------------------
-- 4. Coach Profiles (Freelance personal trainers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  specialties TEXT[] NOT NULL DEFAULT '{}',
  certifications TEXT[] NOT NULL DEFAULT '{}',
  hourly_rate NUMERIC(10, 2) NOT NULL DEFAULT 75.00 CHECK (hourly_rate >= 20.00 AND hourly_rate <= 500.00),
  rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00 CHECK (rating >= 0.00 AND rating <= 5.00),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  stripe_account_id TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 5. Coach Gym Affiliations (Junction linking coaches with Linz partner gyms)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_gym_affiliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  is_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_coach_gym UNIQUE (coach_id, gym_id)
);

-- -----------------------------------------------------------------------------
-- 6. Coach Availability (Weekly scheduling slots across affiliated gyms)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coach_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  is_recurring BOOLEAN NOT NULL DEFAULT TRUE,
  specific_date DATE,
  is_booked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 7. Bookings (Session lifecycle & split payments)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  coach_id UUID NOT NULL REFERENCES public.coach_profiles(id) ON DELETE RESTRICT,
  gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE RESTRICT,
  session_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes >= 30 AND duration_minutes <= 180),
  gross_amount NUMERIC(10, 2) NOT NULL CHECK (gross_amount > 0),
  gym_floor_fee NUMERIC(10, 2) NOT NULL DEFAULT 8.00 CHECK (gym_floor_fee >= 0),
  platform_fee NUMERIC(10, 2) NOT NULL CHECK (platform_fee >= 0),
  coach_payout NUMERIC(10, 2) NOT NULL CHECK (coach_payout >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled')),
  client_notes TEXT,
  cancellation_reason TEXT,
  stripe_payment_intent_id TEXT,
  stripe_transfer_coach_id TEXT,
  stripe_transfer_gym_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_split_balance CHECK (gross_amount = gym_floor_fee + platform_fee + coach_payout)
);

-- -----------------------------------------------------------------------------
-- 8. Check-In Passes (Cryptographic dynamic QR tokens)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.check_in_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES public.gyms(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  dynamic_token TEXT NOT NULL UNIQUE,
  qr_signature TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  is_redeemed BOOLEAN NOT NULL DEFAULT FALSE,
  redeemed_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9. Automatic Updated_at Trigger Function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_gyms_updated_at ON public.gyms;
CREATE TRIGGER trg_gyms_updated_at BEFORE UPDATE ON public.gyms FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_coach_profiles_updated_at ON public.coach_profiles;
CREATE TRIGGER trg_coach_profiles_updated_at BEFORE UPDATE ON public.coach_profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- -----------------------------------------------------------------------------
-- 10. Performance Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_gyms_city ON public.gyms(city) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_gyms_slug ON public.gyms(slug);
CREATE INDEX IF NOT EXISTS idx_coach_profiles_rating ON public.coach_profiles(is_active, rating DESC);
CREATE INDEX IF NOT EXISTS idx_coach_profiles_user_id ON public.coach_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_staff_lookup ON public.gym_staff(user_id, gym_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_pair ON public.coach_gym_affiliations(coach_id, gym_id);
CREATE INDEX IF NOT EXISTS idx_availability_search ON public.coach_availability(coach_id, gym_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON public.bookings(client_id, session_time DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_coach ON public.bookings(coach_id, session_time DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_gym_status ON public.bookings(gym_id, status, session_time);
CREATE INDEX IF NOT EXISTS idx_passes_token ON public.check_in_passes(dynamic_token);
CREATE INDEX IF NOT EXISTS idx_passes_gym_pending ON public.check_in_passes(gym_id, is_redeemed);
