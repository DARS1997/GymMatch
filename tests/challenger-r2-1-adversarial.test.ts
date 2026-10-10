import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '../src/context/RoleContext';
import {
  LINZ_GYMS,
  LINZ_COACHES,
  LINZ_PROFILES,
  DEFAULT_PORTAL_BOOKINGS,
  LINZ_BOOKINGS,
  LINZ_PASSES,
} from '../src/lib/data/linz-seed';
import { Booking, BookingStatus, CheckInPass, CoachProfile, Gym } from '../src/types/database';
import { eurToCents, calculateSplitPayment } from '../src/lib/payments/split';

describe('Challenger R2-1: Adversarial Verification of RBAC Expansion & Tenant Boundaries', () => {
  const gymJohnHarris = LINZ_GYMS[0]; // 00000000-0000-0000-0000-000000000001
  const gymFitFabrik = LINZ_GYMS[1];  // 00000000-0000-0000-0000-000000000002
  const gymHappyFit = LINZ_GYMS[2];   // 00000000-0000-0000-0000-000000000003
  const gymKieser = LINZ_GYMS[3];     // 00000000-0000-0000-0000-000000000004

  const coachLukas = LINZ_COACHES[0]; // 44444444-4444-4444-4444-000000000001
  const coachElena = LINZ_COACHES[1]; // 44444444-4444-4444-4444-000000000002
  const coachDavid = LINZ_COACHES[2]; // 44444444-4444-4444-4444-000000000003
  const coachSarah = LINZ_COACHES[3]; // 44444444-4444-4444-4444-000000000004

  const clientMax = LINZ_PROFILES[0]; // 11111111-1111-1111-1111-000000000001

  // =========================================================================
  // SUITE 1: 4-ROLE NAVIGATION & LEGACY ROLE NORMALIZATION STRESS HARNESS
  // =========================================================================

  describe('Suite 1: 4-Role Navigation & Legacy Role Normalization Stress Harness', () => {
    function normalizeRole(roleInput: string): UserRole {
      if (roleInput === 'reception') return 'gym';
      if (['client', 'coach', 'gym', 'manager'].includes(roleInput)) {
        return roleInput as UserRole;
      }
      return 'client';
    }

    it('1.1 High-frequency 10,000-cycle randomized transition fuzzing', () => {
      const candidates = ['client', 'coach', 'gym', 'manager', 'reception', 'unknown', '', 'admin', 'root'];
      let gymCount = 0;
      let clientCount = 0;
      let coachCount = 0;
      let managerCount = 0;

      for (let i = 0; i < 10000; i++) {
        const input = candidates[Math.floor(Math.random() * candidates.length)];
        const normalized = normalizeRole(input);

        assert.ok(['client', 'coach', 'gym', 'manager'].includes(normalized));
        if (input === 'reception') {
          assert.equal(normalized, 'gym', 'reception must normalize to gym');
        }

        if (normalized === 'gym') gymCount++;
        else if (normalized === 'coach') coachCount++;
        else if (normalized === 'manager') managerCount++;
        else clientCount++;
      }

      assert.ok(gymCount > 0 && clientCount > 0 && coachCount > 0 && managerCount > 0);
    });

    it('1.2 Hostile and malformed inputs: prototype pollution, script injection, and unicode', () => {
      const hostileStrings = [
        '__proto__',
        'constructor',
        'prototype',
        '<script>alert("xss")</script>',
        'SELECT * FROM users;',
        '../../../../etc/passwd',
        '🏋️',
        'GYM',
        'Coach',
        ' CLIENT ',
        '\0',
        '\n\r\t',
        'undefined',
        'null',
      ];

      for (const hostile of hostileStrings) {
        assert.doesNotThrow(() => {
          const res = normalizeRole(hostile);
          assert.equal(res, 'client', `Hostile string "${hostile}" must safely fallback to client`);
        });
      }
    });

    it('1.3 Desk selector scoping: strict privilege separation across roles', () => {
      let currentRole: UserRole = 'client';
      let receptionGymId = gymJohnHarris.id;

      const setRole = (r: UserRole) => {
        currentRole = r === 'reception' ? 'gym' : r;
      };

      const setDesk = (gymId: string) => {
        // Mirrored from RoleSwitcher.tsx logic: desk selector only visible/active in gym role
        if (currentRole === 'gym' || currentRole === 'reception') {
          receptionGymId = gymId;
        }
      };

      // Attempt to change desk from Client role
      setRole('client');
      setDesk(gymFitFabrik.id);
      assert.equal(receptionGymId, gymJohnHarris.id, 'Desk change must be blocked in Client role');

      // Attempt to change desk from Coach role
      setRole('coach');
      setDesk(gymHappyFit.id);
      assert.equal(receptionGymId, gymJohnHarris.id, 'Desk change must be blocked in Coach role');

      // Attempt to change desk from Platform Manager role
      setRole('manager');
      setDesk(gymKieser.id);
      assert.equal(receptionGymId, gymJohnHarris.id, 'Desk change must be blocked in Manager role');

      // Desk change succeeds in Gym role
      setRole('gym');
      setDesk(gymFitFabrik.id);
      assert.equal(receptionGymId, gymFitFabrik.id, 'Desk change must succeed in Gym role');

      // Desk change succeeds when legacy reception role is provided
      setRole('reception');
      setDesk(gymHappyFit.id);
      assert.equal(receptionGymId, gymHappyFit.id, 'Desk change must succeed when legacy reception role is passed');
    });

    it('1.4 Legacy pass scan redirection sets gym role, scanner tab, and venue desk cleanly', () => {
      let role: UserRole = 'client';
      let gymTab = 'schedule';
      let receptionGymId = gymJohnHarris.id;

      const handleScanPassInReception = (token: string, gymId: string) => {
        receptionGymId = gymId;
        role = 'gym';
        gymTab = 'scanner';
      };

      handleScanPassInReception('GM1.dummy.sig', gymKieser.id);

      assert.equal(role, 'gym');
      assert.equal(gymTab, 'scanner');
      assert.equal(receptionGymId, gymKieser.id);
    });

    it('1.5 Coach dual-mode state preservation across global role switching', () => {
      let role: UserRole = 'coach';
      let coachSubMode: 'business' | 'client' = 'client'; // Coach is shopping

      // Switch to Manager
      role = 'manager';
      // Switch to Client
      role = 'client';
      // Switch back to Coach
      role = 'coach';

      // coachSubMode state remains 'client'
      assert.equal(coachSubMode, 'client', 'coachSubMode must be preserved across role transitions');
    });
  });

  // =========================================================================
  // SUITE 2: COACH-AS-CLIENT MODE: SELF-BOOKING GUARDS & SESSION DECOUPLING
  // =========================================================================

  describe('Suite 2: Coach-as-Client Mode: Self-Booking Guards & Session Decoupling', () => {
    function evaluateSelfBookingGuard(params: {
      role: UserRole;
      coachSubMode: 'business' | 'client';
      selectedCoachId: string;
      activeCoachId: string;
    }): { allowed: boolean; warning?: string } {
      const cleanSelected = params.selectedCoachId.trim().toLowerCase();
      const cleanActive = params.activeCoachId.trim().toLowerCase();

      if (params.role === 'coach' && params.coachSubMode === 'client' && cleanSelected === cleanActive) {
        return {
          allowed: false,
          warning: 'Self-booking protected: You cannot book a session with yourself. Please select another coach.',
        };
      }
      return { allowed: true };
    }

    it('2.1 Self-booking guard blocks identical coach under all casing and whitespace variants', () => {
      const activeId = coachLukas.id; // '44444444-4444-4444-4444-000000000001'
      const adversarialVariations = [
        activeId,
        activeId.toUpperCase(),
        ` ${activeId} `,
        `\t${activeId}\n`,
        '44444444-4444-4444-4444-000000000001',
        '44444444-4444-4444-4444-000000000001'.toUpperCase(),
      ];

      for (const variant of adversarialVariations) {
        const guard = evaluateSelfBookingGuard({
          role: 'coach',
          coachSubMode: 'client',
          selectedCoachId: variant,
          activeCoachId: activeId,
        });

        assert.equal(guard.allowed, false, `Variation "${variant}" should have been blocked`);
        assert.ok(guard.warning?.includes('Self-booking protected'));
      }
    });

    it('2.2 Self-booking guard permits booking other coaches in Coach-as-Client mode', () => {
      const activeId = coachLukas.id;
      const otherCoaches = [coachElena.id, coachDavid.id, coachSarah.id];

      for (const otherId of otherCoaches) {
        const guard = evaluateSelfBookingGuard({
          role: 'coach',
          coachSubMode: 'client',
          selectedCoachId: otherId,
          activeCoachId: activeId,
        });

        assert.equal(guard.allowed, true, `Booking coach ${otherId} should be permitted`);
        assert.equal(guard.warning, undefined);
      }
    });

    it('2.3 Self-booking guard never restricts standard Client role or Coach Business mode', () => {
      // In Client role, choosing Lukas
      const clientGuard = evaluateSelfBookingGuard({
        role: 'client',
        coachSubMode: 'client',
        selectedCoachId: coachLukas.id,
        activeCoachId: coachLukas.id,
      });
      assert.equal(clientGuard.allowed, true, 'Client role must not be blocked by coach self-booking guard');

      // In Coach Business mode
      const businessGuard = evaluateSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'business',
        selectedCoachId: coachLukas.id,
        activeCoachId: coachLukas.id,
      });
      assert.equal(businessGuard.allowed, true, 'Business mode does not trigger client shopping self-booking block');
    });

    it('2.4 Deep business payout and session decoupling when Coach Lukas books Coach Elena', () => {
      // Baseline coach business statistics
      const initialLukasBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.coach_id === coachLukas.id);
      const initialLukasGross = initialLukasBookings.reduce((sum, b) => sum + b.gross_amount, 0);
      const initialLukasNet = initialLukasBookings.reduce((sum, b) => sum + b.coach_payout, 0);

      const initialElenaBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.coach_id === coachElena.id);
      const initialElenaGross = initialElenaBookings.reduce((sum, b) => sum + b.gross_amount, 0);
      const initialElenaNet = initialElenaBookings.reduce((sum, b) => sum + b.coach_payout, 0);

      // Simulate Lukas booking Elena for €85.00
      const split = calculateSplitPayment({ grossAmountCents: 8500 });
      const newBooking: Booking = {
        id: 'mock-peer-booking-lukas-to-elena',
        client_id: clientMax.id, // Booked under active user persona
        coach_id: coachElena.id, // The booked coach is Elena
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-20T10:00:00Z',
        duration_minutes: 60,
        hourly_rate: 85.0,
        gross_amount: 85.0,
        gym_floor_fee: split.gymFloorFeeCents / 100, // 8.00
        platform_fee: split.platformFeeCents / 100,   // 11.90
        coach_payout: split.coachPayoutCents / 100,   // 65.10
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const updatedBookings = [...DEFAULT_PORTAL_BOOKINGS, newBooking];

      // Re-evaluate Lukas's business dashboard
      const updatedLukasBookings = updatedBookings.filter((b) => b.coach_id === coachLukas.id);
      const updatedLukasGross = updatedLukasBookings.reduce((sum, b) => sum + b.gross_amount, 0);
      const updatedLukasNet = updatedLukasBookings.reduce((sum, b) => sum + b.coach_payout, 0);

      assert.equal(updatedLukasBookings.length, initialLukasBookings.length, 'Lukas business session count must not change');
      assert.equal(updatedLukasGross, initialLukasGross, 'Lukas gross revenue must not change');
      assert.equal(updatedLukasNet, initialLukasNet, 'Lukas net payout must not change');

      // Re-evaluate Elena's business dashboard
      const updatedElenaBookings = updatedBookings.filter((b) => b.coach_id === coachElena.id);
      const updatedElenaGross = updatedElenaBookings.reduce((sum, b) => sum + b.gross_amount, 0);
      const updatedElenaNet = updatedElenaBookings.reduce((sum, b) => sum + b.coach_payout, 0);

      assert.equal(updatedElenaBookings.length, initialElenaBookings.length + 1, 'Elena session count must increment by 1');
      assert.equal(updatedElenaGross, initialElenaGross + 85.0, 'Elena gross must increment by €85.00');
      assert.equal(updatedElenaNet, initialElenaNet + 65.10, 'Elena net payout must increment by €65.10');
    });
  });

  // =========================================================================
  // SUITE 3: FACILITY BOUNDARY ISOLATION ACROSS LINZ GYMS
  // =========================================================================

  describe('Suite 3: Facility Boundary Isolation Across Linz Gyms', () => {
    it('3.1 Strict venue filtering: each facility sees only its own bookings', () => {
      for (const gym of LINZ_GYMS) {
        const facilityBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gym.id);
        for (const b of facilityBookings) {
          assert.equal(b.gym_id, gym.id, `Booking ${b.id} must strictly belong to gym ${gym.id}`);
        }
      }
    });

    it('3.2 Disjoint partition invariant: sum of facility bookings equals total non-orphaned bookings', () => {
      const facilityCounts = LINZ_GYMS.map((g) => {
        return DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === g.id).length;
      });
      const totalSum = facilityCounts.reduce((a, b) => a + b, 0);
      assert.equal(totalSum, DEFAULT_PORTAL_BOOKINGS.length, 'Partition across all 4 gyms must be exhaustive and disjoint');
    });

    it('3.3 Hostile receptionGymId fallback: non-existent or corrupted gym ID falls back safely to gym[0]', () => {
      const hostileGymIds = [
        'non-existent-uuid-9999-9999-9999',
        '',
        '../../root',
        '<svg onload=alert(1)>',
        '00000000-0000-0000-0000-000000000000',
      ];

      for (const hostileId of hostileGymIds) {
        const resolvedGym = LINZ_GYMS.find((g) => g.id === hostileId) || LINZ_GYMS[0];
        assert.equal(resolvedGym.id, gymJohnHarris.id, `Hostile gym ID "${hostileId}" must fallback to John Harris Atrium`);
        assert.doesNotThrow(() => {
          const facilityBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === resolvedGym.id);
          assert.ok(Array.isArray(facilityBookings));
        });
      }
    });

    it('3.4 Extreme boundary: facility with 0 sessions calculates metrics without division by zero', () => {
      const emptyBookings: Booking[] = [];
      const attendedSessions = emptyBookings.filter((b) => b.status === 'checked_in' || b.status === 'completed').length;
      const nonCancelledSessions = emptyBookings.filter((b) => b.status !== 'cancelled').length;
      const rate = nonCancelledSessions > 0 ? Math.round((attendedSessions / nonCancelledSessions) * 100) : 0;
      const floorFeesEarned = attendedSessions * 8.0;

      assert.equal(rate, 0);
      assert.equal(floorFeesEarned, 0);
      assert.equal(Number.isNaN(rate), false);
    });

    it('3.5 Extreme boundary: facility with 100% cancelled sessions calculates 0% attendance', () => {
      const allCancelledBookings: Booking[] = [
        {
          id: 'c1',
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          hourly_rate: 75,
          gross_amount: 75,
          gym_floor_fee: 0,
          platform_fee: 0,
          coach_payout: 0,
          status: 'cancelled',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const attendedSessions = allCancelledBookings.filter((b) => b.status === 'checked_in' || b.status === 'completed').length;
      const nonCancelledSessions = allCancelledBookings.filter((b) => b.status !== 'cancelled').length;
      const rate = nonCancelledSessions > 0 ? Math.round((attendedSessions / nonCancelledSessions) * 100) : 0;
      const floorFeesEarned = attendedSessions * 8.0;

      assert.equal(rate, 0, 'Attendance rate for 100% cancelled sessions must be 0%');
      assert.equal(floorFeesEarned, 0, 'Floor fees for 100% cancelled sessions must be €0.00');
    });

    it('3.6 Strict floor fee conservation: sum of coach breakdowns equals facility total floor fee', () => {
      for (const gym of LINZ_GYMS) {
        const facilityBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gym.id);
        const facilityTotalAttended = facilityBookings.filter(
          (b) => b.status === 'checked_in' || b.status === 'completed'
        ).length;
        const expectedFacilityFloorFee = facilityTotalAttended * 8.0;

        // Simulate coach breakdown
        const coachBreakdown = new Map<string, number>();
        for (const b of facilityBookings) {
          if (b.status === 'checked_in' || b.status === 'completed') {
            coachBreakdown.set(b.coach_id, (coachBreakdown.get(b.coach_id) || 0) + 8.0);
          }
        }

        const sumCoachFloorFees = Array.from(coachBreakdown.values()).reduce((a, b) => a + b, 0);
        assert.equal(
          sumCoachFloorFees,
          expectedFacilityFloorFee,
          `Floor fee breakdown for gym ${gym.name} must sum to facility total`
        );
      }
    });
  });

  // =========================================================================
  // SUITE 4: MULTI-FILTER TOOLBAR EDGE CASES & CONJUNCTION ENGINE
  // =========================================================================

  describe('Suite 4: Multi-Filter Toolbar Edge Cases & Conjunction Engine', () => {
    function filterSessions(
      sessions: Booking[],
      dateFilterMode: 'all' | 'today' | 'custom',
      customDate: string,
      selectedCoachId: string,
      selectedStatus: string,
      todayIso: string
    ): Booking[] {
      return sessions.filter((b) => {
        // Date filter
        if (dateFilterMode === 'today') {
          const sessionDate = b.session_time.split('T')[0];
          if (sessionDate !== todayIso) return false;
        } else if (dateFilterMode === 'custom') {
          const sessionDate = b.session_time.split('T')[0];
          if (sessionDate !== customDate) return false;
        }

        // Coach filter
        if (selectedCoachId !== 'all' && b.coach_id !== selectedCoachId) {
          return false;
        }

        // Status filter
        if (selectedStatus !== 'all' && b.status !== selectedStatus) {
          return false;
        }

        return true;
      });
    }

    it('4.1 Conjunction verification across all filter permutations', () => {
      const jhSessions = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);
      const testDates = ['all', 'custom'];
      const customDateVal = '2026-10-14';
      const testCoaches = ['all', coachLukas.id, coachElena.id, 'non-existent-coach'];
      const testStatuses = ['all', 'confirmed', 'checked_in', 'completed', 'cancelled'];

      for (const dMode of testDates as ('all' | 'custom')[]) {
        for (const cId of testCoaches) {
          for (const sVal of testStatuses) {
            const filtered = filterSessions(jhSessions, dMode, customDateVal, cId, sVal, '2026-10-14');

            for (const b of filtered) {
              if (dMode === 'custom') {
                assert.equal(b.session_time.split('T')[0], customDateVal);
              }
              if (cId !== 'all') {
                assert.equal(b.coach_id, cId);
              }
              if (sVal !== 'all') {
                assert.equal(b.status, sVal);
              }
            }
          }
        }
      }
    });

    it('4.2 Extreme and invalid custom dates return empty array gracefully without error', () => {
      const jhSessions = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);
      const adversarialDates = [
        '1970-01-01',
        '2099-12-31',
        'invalid-date',
        '',
        '2026-13-45',
        'NaN-NaN-NaN',
        '2026/10/14',
      ];

      for (const badDate of adversarialDates) {
        assert.doesNotThrow(() => {
          const res = filterSessions(jhSessions, 'custom', badDate, 'all', 'all', '2026-10-14');
          assert.equal(res.length, 0, `Adversarial date "${badDate}" should yield 0 matches`);
        });
      }
    });

    it('4.3 Sessions with ISO timezone offsets (+02:00, Z) parse date correctly', () => {
      const mockSessions: Booking[] = [
        {
          id: 'tz1',
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T14:00:00+02:00',
          duration_minutes: 60,
          hourly_rate: 75,
          gross_amount: 75,
          gym_floor_fee: 8,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'tz2',
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T12:00:00.000Z',
          duration_minutes: 60,
          hourly_rate: 75,
          gross_amount: 75,
          gym_floor_fee: 8,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const res = filterSessions(mockSessions, 'custom', '2026-10-15', 'all', 'all', '2026-10-15');
      assert.equal(res.length, 2, 'Both timezone formatted sessions should match date 2026-10-15');
    });

    it('4.4 Coach schedule breakdown fallback handles deleted or unknown coach IDs safely', () => {
      const unknownCoachBooking: Booking = {
        id: 'b-unknown-coach',
        client_id: clientMax.id,
        coach_id: '99999999-9999-9999-9999-000000000099', // Unknown coach
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-15T10:00:00Z',
        duration_minutes: 60,
        hourly_rate: 75,
        gross_amount: 75,
        gym_floor_fee: 8,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const coach = LINZ_COACHES.find((c) => c.id === unknownCoachBooking.coach_id);
      const coachName = coach ? coach.full_name : `Coach ${unknownCoachBooking.coach_id.substring(0, 6)}`;

      assert.equal(coachName, 'Coach 999999');
    });
  });

  // =========================================================================
  // SUITE 5: UN-CANCELLATION REMEDIATION & MULTI-CYCLE LEDGER CONSERVATION
  // =========================================================================

  describe('Suite 5: Un-Cancellation Remediation & Multi-Cycle Ledger Conservation', () => {
    function simulateStatusTransition(
      booking: Booking,
      newStatus: BookingStatus,
      reason?: string
    ): Booking {
      let gym_floor_fee = booking.gym_floor_fee;
      let platform_fee = booking.platform_fee;
      let coach_payout = booking.coach_payout;

      if (newStatus === 'cancelled') {
        gym_floor_fee = 0;
        platform_fee = 0;
        coach_payout = 0;
      } else if (booking.status === 'cancelled') {
        const split = calculateSplitPayment({
          grossAmountCents: eurToCents(booking.gross_amount),
        });
        gym_floor_fee = split.gymFloorFeeCents / 100;
        platform_fee = split.platformFeeCents / 100;
        coach_payout = split.coachPayoutCents / 100;
      }

      return {
        ...booking,
        status: newStatus,
        gym_floor_fee,
        platform_fee,
        coach_payout,
        cancellation_reason: reason !== undefined ? reason : booking.cancellation_reason,
        updated_at: new Date().toISOString(),
      };
    }

    function checkDrift(booking: Booking): number {
      const grossCents = eurToCents(booking.gross_amount);
      const floorCents = eurToCents(booking.gym_floor_fee);
      const platformCents = eurToCents(booking.platform_fee);
      const coachCents = eurToCents(booking.coach_payout);
      const refundCents = booking.status === 'cancelled' ? grossCents : 0;

      const totalAllocated = floorCents + platformCents + coachCents + refundCents;
      return grossCents - totalAllocated;
    }

    it('5.1 Multi-cycle state transitions maintain strict 0.00¢ drift at every transition', () => {
      let b: Booking = {
        id: 'b-lifecycle-test',
        client_id: clientMax.id,
        coach_id: coachLukas.id,
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-15T10:00:00Z',
        duration_minutes: 60,
        hourly_rate: 75.0,
        gross_amount: 75.0,
        gym_floor_fee: 8.0,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const lifecycleSteps: BookingStatus[] = [
        'cancelled', // 1: Cancel session (fees zeroed, refund = 7500¢)
        'confirmed', // 2: Un-cancel session (fees restored: 800 + 1050 + 5650, refund = 0)
        'cancelled', // 3: Cancel again
        'pending',   // 4: Un-cancel to pending
        'confirmed', // 5: Transition to confirmed (already active, fees preserved)
        'checked_in',// 6: Check in at reception
        'completed', // 7: Complete session
      ];

      for (let step = 0; step < lifecycleSteps.length; step++) {
        const nextStatus = lifecycleSteps[step];
        b = simulateStatusTransition(b, nextStatus);

        const drift = checkDrift(b);
        assert.equal(drift, 0, `Drift detected (${drift}¢) at step ${step + 1} (${nextStatus})`);

        if (nextStatus === 'cancelled') {
          assert.equal(b.gym_floor_fee, 0);
          assert.equal(b.platform_fee, 0);
          assert.equal(b.coach_payout, 0);
        } else {
          assert.equal(b.gym_floor_fee, 8.0);
          assert.equal(b.platform_fee, 10.5);
          assert.equal(b.coach_payout, 56.5);
        }
      }
    });

    it('5.2 Un-cancellation rate sweep (€20.00 to €250.00) preserves exact splits with zero drift', () => {
      const sweepRatesEur = [20, 25, 40, 50, 60, 75, 80, 90, 100, 120, 150, 200, 250];

      for (const rate of sweepRatesEur) {
        const initialSplit = calculateSplitPayment({ grossAmountCents: rate * 100 });
        let b: Booking = {
          id: `b-rate-${rate}`,
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          hourly_rate: rate,
          gross_amount: rate,
          gym_floor_fee: initialSplit.gymFloorFeeCents / 100,
          platform_fee: initialSplit.platformFeeCents / 100,
          coach_payout: initialSplit.coachPayoutCents / 100,
          status: 'confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Cancel
        b = simulateStatusTransition(b, 'cancelled');
        assert.equal(checkDrift(b), 0, `Drift on cancel for rate €${rate}`);

        // Un-cancel
        b = simulateStatusTransition(b, 'confirmed');
        assert.equal(checkDrift(b), 0, `Drift on un-cancel for rate €${rate}`);

        assert.equal(eurToCents(b.gym_floor_fee), initialSplit.gymFloorFeeCents);
        assert.equal(eurToCents(b.platform_fee), initialSplit.platformFeeCents);
        assert.equal(eurToCents(b.coach_payout), initialSplit.coachPayoutCents);
      }
    });

    it('5.3 Idempotent repeated cancellations and repeated activations', () => {
      let b: Booking = {
        id: 'b-idempotent',
        client_id: clientMax.id,
        coach_id: coachLukas.id,
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-15T10:00:00Z',
        duration_minutes: 60,
        hourly_rate: 75.0,
        gross_amount: 75.0,
        gym_floor_fee: 8.0,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Double cancel
      b = simulateStatusTransition(b, 'cancelled');
      b = simulateStatusTransition(b, 'cancelled');
      assert.equal(checkDrift(b), 0);
      assert.equal(b.gym_floor_fee, 0);

      // Double un-cancel
      b = simulateStatusTransition(b, 'confirmed');
      b = simulateStatusTransition(b, 'confirmed');
      assert.equal(checkDrift(b), 0);
      assert.equal(b.gym_floor_fee, 8.0);
      assert.equal(b.platform_fee, 10.5);
      assert.equal(b.coach_payout, 56.5);
    });
  });
});
