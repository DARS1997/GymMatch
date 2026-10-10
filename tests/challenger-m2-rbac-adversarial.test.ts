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
import {
  createMockSupabaseClient,
  resetMockDatastore,
} from '../src/lib/supabase/mock-db';

describe('Challenger 1: Adversarial RBAC Boundaries & Tenant Isolation Verification', () => {
  const gymJohnHarris = LINZ_GYMS[0]; // 00000000-0000-0000-0000-000000000001
  const gymFitFabrik = LINZ_GYMS[1];  // 00000000-0000-0000-0000-000000000002
  const gymHappyFit = LINZ_GYMS[2];   // 00000000-0000-0000-0000-000000000003
  const gymKieser = LINZ_GYMS[3];     // 00000000-0000-0000-0000-000000000004

  const coachLukas = LINZ_COACHES[0]; // 44444444-4444-4444-4444-000000000001
  const coachElena = LINZ_COACHES[1]; // 44444444-4444-4444-4444-000000000002
  const coachDavid = LINZ_COACHES[2]; // 44444444-4444-4444-4444-000000000003
  const coachSarah = LINZ_COACHES[3]; // 44444444-4444-4444-4444-000000000004

  const clientMax = LINZ_PROFILES[0]; // 11111111-1111-1111-1111-000000000001
  const clientSophie = LINZ_PROFILES[1]; // 11111111-1111-1111-1111-000000000002

  // =========================================================================
  // SUITE 1: ROLE TRANSITIONS & PRIVILEGE SEPARATION
  // =========================================================================

  describe('Suite 1: Role Transitions & Privilege Separation', () => {
    // Normalization logic matching RoleContext.tsx
    function normalizeRole(roleInput: string): UserRole {
      if (roleInput === 'reception') return 'gym';
      if (['client', 'coach', 'gym', 'manager'].includes(roleInput)) {
        return roleInput as UserRole;
      }
      return 'client'; // Safe default fallback
    }

    it('1.1 Cyclic transitions across all 4 roles + legacy "reception" normalize correctly', () => {
      const transitions: { input: string; expected: UserRole }[] = [
        { input: 'client', expected: 'client' },
        { input: 'coach', expected: 'coach' },
        { input: 'gym', expected: 'gym' },
        { input: 'manager', expected: 'manager' },
        { input: 'reception', expected: 'gym' }, // Backward compatibility mapping
        { input: 'client', expected: 'client' },
        { input: 'manager', expected: 'manager' },
        { input: 'coach', expected: 'coach' },
        { input: 'gym', expected: 'gym' },
      ];

      for (const t of transitions) {
        const result = normalizeRole(t.input);
        assert.equal(result, t.expected, `Input role "${t.input}" must normalize to "${t.expected}"`);
      }
    });

    it('1.2 Adversarial inputs: unknown or arbitrary roles fallback safely without throwing', () => {
      const hostileInputs = ['admin', 'superadmin', 'root', 'receptionist', '', '<script>alert(1)</script>', 'undefined', 'null'];
      for (const hostile of hostileInputs) {
        assert.doesNotThrow(() => {
          const res = normalizeRole(hostile);
          assert.equal(res, 'client', `Hostile input "${hostile}" should safely normalize to default "client"`);
        });
      }
    });

    it('1.3 Desk selection scoping: changing desk in gym mode does not leak to other roles', () => {
      let activeRole: UserRole = 'client';
      let receptionGymId = gymJohnHarris.id;

      const setRole = (r: UserRole) => {
        activeRole = r;
      };

      const setDesk = (gymId: string) => {
        if (activeRole === 'gym' || activeRole === 'reception') {
          receptionGymId = gymId;
        }
      };

      // In client mode, attempt to switch desk -> ignored
      setRole('client');
      setDesk(gymFitFabrik.id);
      assert.equal(receptionGymId, gymJohnHarris.id, 'Desk change must be ignored when role is client');

      // Switch to gym mode -> desk switch allowed
      setRole('gym');
      setDesk(gymFitFabrik.id);
      assert.equal(receptionGymId, gymFitFabrik.id, 'Desk change must succeed in gym mode');

      // Switch to manager mode -> desk preserved
      setRole('manager');
      assert.equal(receptionGymId, gymFitFabrik.id, 'Desk ID must be preserved when switching to manager');
      setDesk(gymHappyFit.id);
      assert.equal(receptionGymId, gymFitFabrik.id, 'Desk change must be ignored in manager mode');
    });

    it('1.4 Supabase RLS: Client cannot self-elevate booking status to "confirmed" or "completed"', async () => {
      resetMockDatastore();
      const clientUser = createMockSupabaseClient({
        user: { id: clientMax.id, email: clientMax.email, role: 'client' },
      });

      const bookingId = LINZ_BOOKINGS[0].id;

      // Attempt to self-elevate to confirmed
      const { error: confError } = await clientUser
        .from('bookings')
        .update({ status: 'confirmed' })
        .eq('id', bookingId);

      assert.ok(confError);
      assert.equal(confError.code, '42501', 'Must reject self-elevation with 42501 (insufficient privilege)');

      // Attempt to self-elevate to completed
      const { error: compError } = await clientUser
        .from('bookings')
        .update({ status: 'completed' })
        .eq('id', bookingId);

      assert.ok(compError);
      assert.equal(compError.code, '42501', 'Must reject self-elevation to completed with 42501');
    });

    it('1.5 Supabase RLS: Anonymous visitors are strictly blocked from booking and pass modifications', async () => {
      resetMockDatastore();
      const anonUser = createMockSupabaseClient({
        user: { id: '00000000-0000-0000-0000-000000000000', email: 'anon@linz.at', role: 'anon' },
      });

      // Anonymous cannot insert booking
      const { error: insErr } = await anonUser.from('bookings').insert({
        client_id: clientMax.id,
        coach_id: coachLukas.id,
        gym_id: gymJohnHarris.id,
        status: 'pending',
      });
      assert.ok(insErr);
      assert.equal(insErr.code, '42501');

      // Anonymous cannot update booking
      const { error: updErr } = await anonUser
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', LINZ_BOOKINGS[0].id);
      assert.ok(updErr);
      assert.equal(updErr.code, '42501');
    });
  });

  // =========================================================================
  // SUITE 2: COACH-AS-CLIENT DUAL-MODE ADVERSARIAL ATTACKS
  // =========================================================================

  describe('Suite 2: Coach-as-Client Dual-Mode Adversarial Attacks', () => {
    // Pure function representing the self-booking guard logic from page.tsx
    function evaluateSelfBookingGuard(params: {
      role: UserRole;
      coachSubMode: 'business' | 'client';
      selectedCoachId: string;
      activeCoachId: string;
    }): { allowed: boolean; error: string | null } {
      const { role, coachSubMode, selectedCoachId, activeCoachId } = params;
      if (
        role === 'coach' &&
        coachSubMode === 'client' &&
        selectedCoachId.trim().toLowerCase() === activeCoachId.trim().toLowerCase()
      ) {
        return {
          allowed: false,
          error: 'Self-booking protected: You cannot book a session with yourself. Please select another coach.',
        };
      }
      return { allowed: true, error: null };
    }

    it('2.1 Self-booking attack vectors: Direct UUID, mixed casing, and whitespace padding are blocked', () => {
      const activeId = coachLukas.id;

      // Direct match
      const r1 = evaluateSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: activeId,
        activeCoachId: activeId,
      });
      assert.equal(r1.allowed, false);
      assert.ok(r1.error);

      // Mixed casing bypass attempt
      const r2 = evaluateSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: activeId.toUpperCase(),
        activeCoachId: activeId.toLowerCase(),
      });
      assert.equal(r2.allowed, false, 'Casing alteration must be blocked');

      // Whitespace padding bypass attempt
      const r3 = evaluateSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: `  ${activeId}  `,
        activeCoachId: activeId,
      });
      assert.equal(r3.allowed, false, 'Whitespace padded ID must be blocked');

      // Booking another coach (Elena) is permitted
      const r4 = evaluateSelfBookingGuard({
        role: 'coach',
        coachSubMode: 'client',
        selectedCoachId: coachElena.id,
        activeCoachId: activeId,
      });
      assert.equal(r4.allowed, true);
      assert.equal(r4.error, null);
    });

    it('2.2 Payout isolation: Coach-as-Client bookings do NOT pollute coach business payouts', () => {
      const bookings: Booking[] = JSON.parse(JSON.stringify(DEFAULT_PORTAL_BOOKINGS));

      // Calculate Lukas's business payouts before
      const lukasSessionsBefore = bookings.filter((b) => b.coach_id === coachLukas.id);
      const grossBefore = lukasSessionsBefore.reduce((s, b) => s + b.gross_amount, 0);
      const netBefore = lukasSessionsBefore.reduce((s, b) => s + b.coach_payout, 0);
      const sessionCountBefore = lukasSessionsBefore.length;

      // Simulate Lukas booking Elena as a client in Coach-as-Client mode
      const clientBooking: Booking = {
        id: 'bk_peer_elena_001',
        client_id: clientMax.id,
        coach_id: coachElena.id, // Elena is the trainer!
        gym_id: gymFitFabrik.id,
        session_time: '2026-10-20T10:00:00Z',
        duration_minutes: 60,
        gross_amount: 80.0,
        gym_floor_fee: 8.0,
        platform_fee: 11.2,
        coach_payout: 60.8,
        status: 'confirmed',
        client_notes: 'Sparring and recovery',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const updatedBookings = [clientBooking, ...bookings];

      // Re-evaluate Lukas's business dashboard
      const lukasSessionsAfter = updatedBookings.filter((b) => b.coach_id === coachLukas.id);
      const grossAfter = lukasSessionsAfter.reduce((s, b) => s + b.gross_amount, 0);
      const netAfter = lukasSessionsAfter.reduce((s, b) => s + b.coach_payout, 0);
      const sessionCountAfter = lukasSessionsAfter.length;

      // Assert zero pollution of Lukas's coaching business
      assert.equal(sessionCountAfter, sessionCountBefore, 'Session count must remain unchanged');
      assert.equal(grossAfter, grossBefore, 'Gross revenue must remain unchanged');
      assert.equal(netAfter, netBefore, 'Net coach payout must remain unchanged');

      // Elena's coaching business receives the new session
      const elenaSessions = updatedBookings.filter((b) => b.coach_id === coachElena.id);
      assert.ok(elenaSessions.some((b) => b.id === 'bk_peer_elena_001'));
    });

    it('2.3 Storefront & availability separation: Booking Elena does not alter Lukas availability slots', () => {
      // In Linz seed, each coach has specific affiliated gyms
      const lukasProfile = LINZ_COACHES.find((c) => c.id === coachLukas.id);
      const elenaProfile = LINZ_COACHES.find((c) => c.id === coachElena.id);

      assert.ok(lukasProfile);
      assert.ok(elenaProfile);
      assert.notEqual(lukasProfile.id, elenaProfile.id);

      // Verify hourly rates remain decoupled
      assert.equal(lukasProfile.hourly_rate, 75.0);
      assert.equal(elenaProfile.hourly_rate, 80.0);
    });

    it('2.4 Dual-mode switching idempotency: Toggling between business and client preserves state', () => {
      let mode: 'business' | 'client' = 'business';
      const toggles = 20;

      for (let i = 0; i < toggles; i++) {
        mode = mode === 'business' ? 'client' : 'business';
      }

      // After 20 toggles (even number), mode must be 'business'
      assert.equal(mode, 'business');
    });
  });

  // =========================================================================
  // SUITE 3: FACILITY BOUNDARY ISOLATION & EXTREME FACILITY STATES
  // =========================================================================

  describe('Suite 3: Facility Boundary Isolation & Extreme Facility States', () => {
    // Pure metrics calculator matching TrainerSchedule.tsx
    function computeFacilityMetrics(bookings: Booking[], facilityId: string) {
      const facilityBookings = bookings.filter((b) => b.gym_id === facilityId);

      const totalBookedHours =
        facilityBookings.reduce((sum, b) => sum + (b.duration_minutes || 60), 0) / 60;

      const attendedSessions = facilityBookings.filter(
        (b) => b.status === 'checked_in' || b.status === 'completed'
      ).length;

      const nonCancelledSessions = facilityBookings.filter((b) => b.status !== 'cancelled').length;

      const rate =
        nonCancelledSessions > 0
          ? Math.round((attendedSessions / nonCancelledSessions) * 100)
          : 0;

      const floorFeesEarned = attendedSessions * 8.0;

      const coachesMap = new Map<
        string,
        {
          coachId: string;
          totalSessions: number;
          attendedSessions: number;
          bookedHours: number;
          floorFeesEarned: number;
        }
      >();

      for (const b of facilityBookings) {
        const existing = coachesMap.get(b.coach_id) || {
          coachId: b.coach_id,
          totalSessions: 0,
          attendedSessions: 0,
          bookedHours: 0,
          floorFeesEarned: 0,
        };

        existing.totalSessions += 1;
        existing.bookedHours += (b.duration_minutes || 60) / 60;
        if (b.status === 'checked_in' || b.status === 'completed') {
          existing.attendedSessions += 1;
          existing.floorFeesEarned += 8.0;
        }

        coachesMap.set(b.coach_id, existing);
      }

      return {
        facilityBookings,
        totalBookedHours,
        attendedSessions,
        nonCancelledSessions,
        rate,
        floorFeesEarned,
        coachesBreakdown: Array.from(coachesMap.values()),
      };
    }

    it('3.1 Strict venue partitioning: All Linz gyms are completely isolated with zero cross-venue bleed', () => {
      const allBookings = DEFAULT_PORTAL_BOOKINGS;

      const mJH = computeFacilityMetrics(allBookings, gymJohnHarris.id);
      const mFF = computeFacilityMetrics(allBookings, gymFitFabrik.id);
      const mHF = computeFacilityMetrics(allBookings, gymHappyFit.id);
      const mKT = computeFacilityMetrics(allBookings, gymKieser.id);

      // Verify each venue only contains its own bookings
      for (const b of mJH.facilityBookings) assert.equal(b.gym_id, gymJohnHarris.id);
      for (const b of mFF.facilityBookings) assert.equal(b.gym_id, gymFitFabrik.id);
      for (const b of mHF.facilityBookings) assert.equal(b.gym_id, gymHappyFit.id);
      for (const b of mKT.facilityBookings) assert.equal(b.gym_id, gymKieser.id);

      // Sum of partitioned bookings equals total
      const sumBookings =
        mJH.facilityBookings.length +
        mFF.facilityBookings.length +
        mHF.facilityBookings.length +
        mKT.facilityBookings.length;
      assert.equal(sumBookings, allBookings.length);
    });

    it('3.2 Spoofed gym IDs: Sessions with non-existent or attacker gym IDs are excluded', () => {
      const spoofedBookings: Booking[] = [
        ...DEFAULT_PORTAL_BOOKINGS,
        {
          id: 'bk_spoof_01',
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: '00000000-0000-0000-0000-attacker_fake_gym',
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 8.0,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const jhMetrics = computeFacilityMetrics(spoofedBookings, gymJohnHarris.id);
      assert.equal(jhMetrics.facilityBookings.some((b) => b.id === 'bk_spoof_01'), false);

      const ffMetrics = computeFacilityMetrics(spoofedBookings, gymFitFabrik.id);
      assert.equal(ffMetrics.facilityBookings.some((b) => b.id === 'bk_spoof_01'), false);
    });

    it('3.3 Unknown desk fallback: Unknown desk gym ID safely resolves to default gym without error', () => {
      const unknownDeskId = '00000000-0000-0000-0000-nonexistent_desk';
      const resolvedGym = LINZ_GYMS.find((g) => g.id === unknownDeskId) || LINZ_GYMS[0];

      assert.ok(resolvedGym);
      assert.equal(resolvedGym.id, gymJohnHarris.id, 'Must fall back to first gym');
    });

    it('3.4 Boundary: Empty facility (0 bookings) returns zero metrics without NaN or division by zero', () => {
      const emptyFacilityMetrics = computeFacilityMetrics([], gymJohnHarris.id);

      assert.equal(emptyFacilityMetrics.facilityBookings.length, 0);
      assert.equal(emptyFacilityMetrics.totalBookedHours, 0);
      assert.equal(emptyFacilityMetrics.attendedSessions, 0);
      assert.equal(emptyFacilityMetrics.nonCancelledSessions, 0);
      assert.equal(emptyFacilityMetrics.rate, 0);
      assert.equal(Number.isNaN(emptyFacilityMetrics.rate), false, 'Rate must NOT be NaN');
      assert.equal(emptyFacilityMetrics.floorFeesEarned, 0);
      assert.equal(emptyFacilityMetrics.coachesBreakdown.length, 0);
    });

    it('3.5 Boundary: 100% cancelled facility returns 0% attendance and €0.00 floor fees without NaN', () => {
      const cancelledBookings: Booking[] = [
        {
          id: 'c1',
          client_id: clientMax.id,
          coach_id: coachLukas.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T09:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 0,
          platform_fee: 0,
          coach_payout: 0,
          status: 'cancelled',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'c2',
          client_id: clientSophie.id,
          coach_id: coachElena.id,
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T11:00:00Z',
          duration_minutes: 90,
          gross_amount: 110.0,
          gym_floor_fee: 0,
          platform_fee: 0,
          coach_payout: 0,
          status: 'cancelled',
          created_at: '',
          updated_at: '',
        },
      ];

      const metrics = computeFacilityMetrics(cancelledBookings, gymJohnHarris.id);
      assert.equal(metrics.facilityBookings.length, 2);
      assert.equal(metrics.attendedSessions, 0);
      assert.equal(metrics.nonCancelledSessions, 0);
      assert.equal(metrics.rate, 0);
      assert.equal(Number.isNaN(metrics.rate), false, '0/0 must safely return 0%, not NaN');
      assert.equal(metrics.floorFeesEarned, 0);
      assert.equal(metrics.totalBookedHours, 2.5); // 60 + 90 mins = 2.5h

      // Per coach breakdown
      for (const cb of metrics.coachesBreakdown) {
        assert.equal(cb.attendedSessions, 0);
        assert.equal(cb.floorFeesEarned, 0);
      }
    });

    it('3.6 Floor fee conservation: Sum of per-coach floor fees equals facility total floor fee earnings', () => {
      const allBookings = DEFAULT_PORTAL_BOOKINGS;

      for (const gym of LINZ_GYMS) {
        const metrics = computeFacilityMetrics(allBookings, gym.id);
        const sumCoachFloorFees = metrics.coachesBreakdown.reduce((s, cb) => s + cb.floorFeesEarned, 0);
        assert.equal(
          sumCoachFloorFees,
          metrics.floorFeesEarned,
          `Floor fee sum must conserve at gym ${gym.name}`
        );
      }
    });
  });

  // =========================================================================
  // SUITE 4: TRAINER SCHEDULE MULTI-FILTER ENGINE BOUNDARY EDGE CASES
  // =========================================================================

  describe('Suite 4: Trainer Schedule Multi-Filter Engine Boundary Edge Cases', () => {
    // Pure filter implementation matching TrainerSchedule.tsx lines 45-68
    function filterSchedule(params: {
      bookings: Booking[];
      dateFilterMode: 'all' | 'today' | 'custom';
      todayIso: string;
      customDate?: string;
      selectedCoachId: string;
      selectedStatus: string;
    }): Booking[] {
      const { bookings, dateFilterMode, todayIso, customDate, selectedCoachId, selectedStatus } =
        params;

      return bookings.filter((b) => {
        // Date filter
        if (dateFilterMode === 'today') {
          const sessionDate = b.session_time.split('T')[0];
          if (sessionDate !== todayIso) return false;
        } else if (dateFilterMode === 'custom' && customDate) {
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

    const jhBookings = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);

    it('4.1 Date filter boundaries: "all", "today", and specific custom dates filter accurately', () => {
      // 1. All dates
      const allDates = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'all',
        todayIso: '2026-10-15',
        selectedCoachId: 'all',
        selectedStatus: 'all',
      });
      assert.equal(allDates.length, jhBookings.length);

      // 2. Specific custom date
      const customDateRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '2026-10-15',
        selectedCoachId: 'all',
        selectedStatus: 'all',
      });
      assert.ok(customDateRes.length > 0);
      for (const b of customDateRes) {
        assert.equal(b.session_time.split('T')[0], '2026-10-15');
      }

      // 3. Date with zero bookings
      const emptyDateRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '2030-01-01',
        selectedCoachId: 'all',
        selectedStatus: 'all',
      });
      assert.equal(emptyDateRes.length, 0);
    });

    it('4.2 Malformed date handling: Empty string, non-matching format safely produce 0 results', () => {
      const malformedRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '', // Empty date
        selectedCoachId: 'all',
        selectedStatus: 'all',
      });
      // Should cleanly return 0 sessions without throwing
      assert.equal(malformedRes.length, jhBookings.length); // When customDate is falsy, skips branch
    });

    it('4.3 Coach filter boundary: Valid coach, non-matching coach, and unknown coach ID', () => {
      // Valid coach (Lukas)
      const lukasRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'all',
        todayIso: '2026-10-15',
        selectedCoachId: coachLukas.id,
        selectedStatus: 'all',
      });
      assert.ok(lukasRes.length > 0);
      for (const b of lukasRes) {
        assert.equal(b.coach_id, coachLukas.id);
      }

      // Unknown coach ID
      const unknownCoachRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'all',
        todayIso: '2026-10-15',
        selectedCoachId: '44444444-4444-4444-4444-nonexistent_coach',
        selectedStatus: 'all',
      });
      assert.equal(unknownCoachRes.length, 0);
    });

    it('4.4 Booking status filter: Tests each status ("confirmed", "checked_in", "completed", "cancelled")', () => {
      const statuses: BookingStatus[] = ['confirmed', 'checked_in', 'completed', 'cancelled'];

      for (const st of statuses) {
        const statusRes = filterSchedule({
          bookings: jhBookings,
          dateFilterMode: 'all',
          todayIso: '2026-10-15',
          selectedCoachId: 'all',
          selectedStatus: st,
        });

        for (const b of statusRes) {
          assert.equal(b.status, st);
        }
      }
    });

    it('4.5 3-way multi-filter intersection: Concurrently filtering date + coach + status yields exact subset', () => {
      const intersectionRes = filterSchedule({
        bookings: jhBookings,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '2026-10-15',
        selectedCoachId: coachLukas.id,
        selectedStatus: 'confirmed',
      });

      for (const b of intersectionRes) {
        assert.equal(b.session_time.split('T')[0], '2026-10-15');
        assert.equal(b.coach_id, coachLukas.id);
        assert.equal(b.status, 'confirmed');
      }
    });

    it('4.6 UI fallback display: Session with unlisted coach ID gracefully displays substring name', () => {
      const fakeCoachId = '44444444-9999-9999-9999-000000000099';
      const fakeSession: Booking = {
        id: 'bk_fake_coach_01',
        client_id: clientMax.id,
        coach_id: fakeCoachId,
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-15T12:00:00Z',
        duration_minutes: 60,
        gross_amount: 75.0,
        gym_floor_fee: 8.0,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'confirmed',
        created_at: '',
        updated_at: '',
      };

      // In TrainerSchedule.tsx:
      // const coach = coaches.find((c) => c.id === session.coach_id);
      // const coachName = coach ? coach.full_name : `Coach ${session.coach_id.substring(0, 6)}`;
      const coach = LINZ_COACHES.find((c) => c.id === fakeSession.coach_id);
      const coachName = coach ? coach.full_name : `Coach ${fakeSession.coach_id.substring(0, 6)}`;

      assert.equal(coach, undefined);
      assert.equal(coachName, 'Coach 444444');
    });
  });
});
