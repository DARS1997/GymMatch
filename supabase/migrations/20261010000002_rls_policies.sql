-- =============================================================================
-- Migration: 20261010000002_rls_policies.sql
-- Description: Strict multi-tenant Row Level Security (RLS) policies for GymMatch
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper Security Functions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_gym_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gym_id FROM public.gym_staff WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_auth_coach_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.coach_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- -----------------------------------------------------------------------------
-- 2. Enable RLS across all application tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gyms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gym_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_gym_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_in_passes ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. Profiles Policies
-- -----------------------------------------------------------------------------
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. Gyms Policies
-- -----------------------------------------------------------------------------
-- Public (anonymous and authenticated) can browse active gyms in Linz
CREATE POLICY "Public read active gyms"
  ON public.gyms FOR SELECT
  TO public
  USING (is_active = TRUE);

-- Gym owners / managers can update and manage their gym facility
CREATE POLICY "Gym owner manage gym"
  ON public.gyms FOR ALL
  TO authenticated
  USING (id IN (SELECT public.get_auth_gym_ids()))
  WITH CHECK (id IN (SELECT public.get_auth_gym_ids()));

-- -----------------------------------------------------------------------------
-- 5. Gym Staff Policies
-- -----------------------------------------------------------------------------
-- Gym staff can view team colleagues at their assigned gyms
CREATE POLICY "Staff read gym colleagues"
  ON public.gym_staff FOR SELECT
  TO authenticated
  USING (gym_id IN (SELECT public.get_auth_gym_ids()));

-- -----------------------------------------------------------------------------
-- 6. Coach Profiles Policies
-- -----------------------------------------------------------------------------
-- Public can browse active coach marketplace storefronts
CREATE POLICY "Public read active coaches"
  ON public.coach_profiles FOR SELECT
  TO public
  USING (is_active = TRUE);

-- Coaches can insert their personal profile upon onboarding
CREATE POLICY "Coach create profile"
  ON public.coach_profiles FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Coaches can update their own profile and rates
CREATE POLICY "Coach update profile"
  ON public.coach_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 7. Coach Affiliations & Availability Policies
-- -----------------------------------------------------------------------------
-- Public can see verified coach-gym partnerships
CREATE POLICY "Public read affiliations"
  ON public.coach_gym_affiliations FOR SELECT
  TO public
  USING (is_verified = TRUE);

CREATE POLICY "Party manage affiliations"
  ON public.coach_gym_affiliations FOR ALL
  TO authenticated
  USING (coach_id = public.get_auth_coach_id() OR gym_id IN (SELECT public.get_auth_gym_ids()))
  WITH CHECK (coach_id = public.get_auth_coach_id() OR gym_id IN (SELECT public.get_auth_gym_ids()));

-- Public can see calendar availability slots
CREATE POLICY "Public read availability"
  ON public.coach_availability FOR SELECT
  TO public
  USING (TRUE);

-- Coaches can manage their own availability slots
CREATE POLICY "Coach manage availability"
  ON public.coach_availability FOR ALL
  TO authenticated
  USING (coach_id = public.get_auth_coach_id())
  WITH CHECK (coach_id = public.get_auth_coach_id());

-- -----------------------------------------------------------------------------
-- 8. Bookings Policies (Strict Multi-Tenant Isolation)
-- -----------------------------------------------------------------------------
-- Clients can read only their own bookings
CREATE POLICY "Client view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Coaches can read bookings assigned to them
CREATE POLICY "Coach view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (coach_id = public.get_auth_coach_id());

-- Gym staff can read bookings strictly scheduled at their venue
CREATE POLICY "Gym staff view venue bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (gym_id IN (SELECT public.get_auth_gym_ids()));

-- Clients can create pending bookings for themselves
CREATE POLICY "Client create pending booking"
  ON public.bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND status = 'pending'
  );

-- Clients can cancel their booking prior to session
CREATE POLICY "Client cancel pending booking"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (client_id = auth.uid() AND status IN ('pending', 'confirmed'))
  WITH CHECK (client_id = auth.uid() AND status = 'cancelled');

-- Coaches can update their assigned bookings (e.g. session notes)
CREATE POLICY "Coach update booking"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (coach_id = public.get_auth_coach_id())
  WITH CHECK (coach_id = public.get_auth_coach_id());

-- Gym staff can update booking check-in status at their venue
CREATE POLICY "Gym staff update booking"
  ON public.bookings FOR UPDATE
  TO authenticated
  USING (gym_id IN (SELECT public.get_auth_gym_ids()))
  WITH CHECK (gym_id IN (SELECT public.get_auth_gym_ids()));

-- -----------------------------------------------------------------------------
-- 9. Check-In Passes Policies
-- -----------------------------------------------------------------------------
-- Clients can view their own passes
CREATE POLICY "Client view own passes"
  ON public.check_in_passes FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Gym staff can view passes issued for their venue
CREATE POLICY "Gym staff view venue passes"
  ON public.check_in_passes FOR SELECT
  TO authenticated
  USING (gym_id IN (SELECT public.get_auth_gym_ids()));

-- Gym staff can redeem unredeemed passes for their venue
CREATE POLICY "Gym staff redeem venue pass"
  ON public.check_in_passes FOR UPDATE
  TO authenticated
  USING (
    gym_id IN (SELECT public.get_auth_gym_ids())
    AND is_redeemed = FALSE
  )
  WITH CHECK (
    gym_id IN (SELECT public.get_auth_gym_ids())
    AND is_redeemed = TRUE
  );
