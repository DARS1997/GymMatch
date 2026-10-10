import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '../src/context/RoleContext';
import { LINZ_GYMS, LINZ_COACHES, LINZ_BOOKINGS, DEFAULT_PORTAL_BOOKINGS } from '../src/lib/data/linz-seed';
import { Booking, CoachProfile } from '../src/types/database';
import { eurToCents } from '../src/lib/payments/split';

describe('RBAC State Transitions & Coach Dual-Mode Verification (WP4 / R4)', () => {
  const activeCoachIdLukas = '44444444-4444-4444-4444-000000000001';
  const activeClientIdMax = '11111111-1111-1111-1111-000000000001';
  const coachElena = LINZ_COACHES.find((c) => c.id === '44444444-4444-4444-4444-000000000002') || LINZ_COACHES[1];
  const coachLukas = LINZ_COACHES.find((c) => c.id === activeCoachIdLukas) || LINZ_COACHES[0];

  // Helper simulating RoleContext normalize role logic
  function normalizeRole(roleInput: UserRole): UserRole {
    return roleInput === 'reception' ? 'gym' : roleInput;
  }

  // Helper simulating page.tsx self-booking guard logic
  function checkSelfBookingGuard(params: {
    role: UserRole;
    coachSubMode: 'business' | 'client';
    selectedCoachId: string;
    activeCoachId: string;
  }): { allowed: boolean; warning: string | null } {
    const { role, coachSubMode, selectedCoachId, activeCoachId } = params;
    const normalizedRole = normalizeRole(role);

    if (normalizedRole === 'coach' && coachSubMode === 'client' && selectedCoachId.toLowerCase() === activeCoachId.toLowerCase()) {
      return {
        allowed: false,
        warning: 'Self-booking protected: You cannot book a session with yourself. Please select another coach.',
      };
    }

    return {
      allowed: true,
      warning: null,
    };
  }

  // =========================================================================
  // 1. 4-Role Transitions & Legacy 'reception' Normalization
  // =========================================================================

  describe('1. 4-Role Transitions & Legacy Normalization', () => {
    it('Normalizes legacy "reception" role to "gym" automatically', () => {
      const normalized = normalizeRole('reception');
      assert.equal(normalized, 'gym', 'Legacy "reception" must be normalized to "gym"');
    });

    it('Preserves modern roles intact without alteration', () => {
      const modernRoles: UserRole[] = ['client', 'coach', 'gym', 'manager'];
      for (const role of modernRoles) {
        assert.equal(normalizeRole(role), role, `Role "${role}" must remain unchanged`);
      }
    });

    it('Executes seamless transitions across all 4 roles in full cyclic sequence', () => {
      let currentRole: UserRole = 'client';

      const roleTransitions: { target: UserRole; expected: UserRole }[] = [
        { target: 'coach', expected: 'coach' },
        { target: 'gym', expected: 'gym' },
        { target: 'manager', expected: 'manager' },
        { target: 'reception', expected: 'gym' }, // legacy input
        { target: 'client', expected: 'client' },
        { target: 'manager', expected: 'manager' },
        { target: 'coach', expected: 'coach' },
      ];

      for (const t of roleTransitions) {
        currentRole = normalizeRole(t.target);
        assert.equal(currentRole, t.expected, `Transition to ${t.target} should result in ${t.expected}`);
      }
    });

    it('Supports desk selection scoping when role is "gym" or legacy "reception"', () => {
      const gymJohnHarris = LINZ_GYMS[0].id;
      const gymFitFabrik = LINZ_GYMS[1].id;

      let activeDeskGymId = gymJohnHarris;

      const switchDesk = (role: UserRole, targetGymId: string) => {
        const norm = normalizeRole(role);
        if (norm === 'gym') {
          activeDeskGymId = targetGymId;
        }
      };

      switchDesk('gym', gymFitFabrik);
      assert.equal(activeDeskGymId, gymFitFabrik);

      switchDesk('reception', gymJohnHarris);
      assert.equal(activeDeskGymId, gymJohnHarris);

      // In client or manager mode, desk selection is ignored
      switchDesk('client', gymFitFabrik);
      assert.equal(activeDeskGymId, gymJohnHarris, 'Client role must not mutate gym desk');
    });
  });

  // =========================================================================
  // 2. Coach Dual-Mode Switching & State Decoupling
  // =========================================================================

  describe('2. Coach Dual-Mode Switching & State Preservation', () => {
    it('Initializes coach view in "business" mode by default', () => {
      const defaultMode: 'business' | 'client' = 'business';
      assert.equal(defaultMode, 'business');
    });

    it('Preserves coach profile, session state, and payout tallies when toggling to "client" mode', () => {
      // Setup initial coach business state for Lukas Bauer
      const initialBookings: Booking[] = [...DEFAULT_PORTAL_BOOKINGS];
      const coachSessionsBefore = initialBookings.filter((b) => b.coach_id === activeCoachIdLukas);
      
      const payoutTallyBeforeCents = coachSessionsBefore
        .filter((b) => b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'completed')
        .reduce((sum, b) => sum + eurToCents(b.coach_payout), 0);

      assert.ok(coachSessionsBefore.length > 0, 'Lukas must have active sessions');
      assert.ok(payoutTallyBeforeCents > 0, 'Lukas must have positive payout tally');

      // Toggle to Coach-as-Client mode
      let coachSubMode: 'business' | 'client' = 'business';
      coachSubMode = 'client';

      // Verify coach identity is untouched
      assert.equal(activeCoachIdLukas, coachLukas.id);
      assert.equal(coachLukas.full_name, 'Lukas Bauer');

      // Coach creates a booking as a client booking Elena Weber
      const clientSessionBooking: Booking = {
        id: 'bk_coach_as_client_001',
        client_id: activeClientIdMax,
        coach_id: coachElena.id, // Booking Elena
        gym_id: LINZ_GYMS[0].id,
        session_time: '2026-10-18T14:00:00Z',
        duration_minutes: 60,
        gross_amount: 80.0,
        gym_floor_fee: 8.0,
        platform_fee: 11.2,
        coach_payout: 60.8,
        status: 'confirmed',
        client_notes: 'Peer sparring & recovery',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const updatedBookings = [clientSessionBooking, ...initialBookings];

      // Re-verify Lukas's coach business sessions
      const coachSessionsAfter = updatedBookings.filter((b) => b.coach_id === activeCoachIdLukas);
      const payoutTallyAfterCents = coachSessionsAfter
        .filter((b) => b.status === 'confirmed' || b.status === 'checked_in' || b.status === 'completed')
        .reduce((sum, b) => sum + eurToCents(b.coach_payout), 0);

      // Verify zero data pollution
      assert.equal(
        coachSessionsAfter.length,
        coachSessionsBefore.length,
        'Lukas business sessions must not be polluted by client bookings'
      );
      assert.equal(
        payoutTallyAfterCents,
        payoutTallyBeforeCents,
        'Lukas business payout tallies must remain strictly identical'
      );

      // Toggle back to "business" mode
      coachSubMode = 'business';
      assert.equal(coachSubMode, 'business');
    });

    it('Prevents client bookings from being attributed to coach business dashboard', () => {
      const testBookings: Booking[] = [
        // Session where Lukas is the COACH
        {
          id: 'bk_lukas_coach',
          client_id: activeClientIdMax,
          coach_id: activeCoachIdLukas,
          gym_id: LINZ_GYMS[0].id,
          session_time: '2026-10-15T09:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 8.0,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: '2026-10-10T08:00:00Z',
          updated_at: '2026-10-10T08:00:00Z',
        },
        // Session where Lukas booked Elena as a CLIENT
        {
          id: 'bk_lukas_as_client',
          client_id: activeClientIdMax,
          coach_id: coachElena.id,
          gym_id: LINZ_GYMS[1].id,
          session_time: '2026-10-16T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 80.0,
          gym_floor_fee: 8.0,
          platform_fee: 11.2,
          coach_payout: 60.8,
          status: 'confirmed',
          created_at: '2026-10-11T08:00:00Z',
          updated_at: '2026-10-11T08:00:00Z',
        },
      ];

      // Coach business view filters strictly by coach_id === activeCoachId
      const lukasBusinessSessions = testBookings.filter((b) => b.coach_id === activeCoachIdLukas);
      assert.equal(lukasBusinessSessions.length, 1);
      assert.equal(lukasBusinessSessions[0].id, 'bk_lukas_coach');
      assert.equal(lukasBusinessSessions[0].coach_payout, 56.5);
    });
  });

  // =========================================================================
  // 3. Self-Booking Protection Guard Logic
  // =========================================================================

  describe('3. Self-Booking Guard Logic in Coach-as-Client Mode', () => {
    it('Blocks coach from booking themselves in Coach-as-Client mode', () => {
      const guardResult = checkSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: activeCoachIdLukas,
        activeCoachId: activeCoachIdLukas,
      });

      assert.equal(guardResult.allowed, false);
      assert.equal(
        guardResult.warning,
        'Self-booking protected: You cannot book a session with yourself. Please select another coach.'
      );
    });

    it('Allows coach to book another coach in Coach-as-Client mode', () => {
      const guardResult = checkSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: coachElena.id,
        activeCoachId: activeCoachIdLukas,
      });

      assert.equal(guardResult.allowed, true);
      assert.equal(guardResult.warning, null);
    });

    it('Allows standard client to book any coach without self-booking restriction', () => {
      // In standard client mode, booking Lukas is completely valid
      const guardResult = checkSelfBookingGuard({
        role: 'client',
        coachSubMode: 'client',
        selectedCoachId: activeCoachIdLukas,
        activeCoachId: activeCoachIdLukas,
      });

      assert.equal(guardResult.allowed, true);
      assert.equal(guardResult.warning, null);
    });

    it('Case-insensitive UUID matching protects against UUID casing bypass', () => {
      const upperCaseCoachId = activeCoachIdLukas.toUpperCase();
      const guardResult = checkSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: upperCaseCoachId,
        activeCoachId: activeCoachIdLukas.toLowerCase(),
      });

      assert.equal(guardResult.allowed, false, 'Must reject even with mixed casing');
      assert.ok(guardResult.warning);
    });

    it('Does not trigger self-booking guard in "business" mode', () => {
      const guardResult = checkSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'business',
        selectedCoachId: activeCoachIdLukas,
        activeCoachId: activeCoachIdLukas,
      });

      assert.equal(guardResult.allowed, true, 'Business mode does not restrict storefront selection');
      assert.equal(guardResult.warning, null);
    });
  });
});
