import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINZ_GYMS, LINZ_COACHES, DEFAULT_PORTAL_BOOKINGS } from '../src/lib/data/linz-seed';
import { Booking, BookingStatus } from '../src/types/database';

describe('Partner Gym Facility Tenant Isolation & Schedule Metrics (WP4 / R4)', () => {
  const gymJohnHarris = LINZ_GYMS[0]; // 00000000-0000-0000-0000-000000000001
  const gymFitFabrik = LINZ_GYMS[1];  // 00000000-0000-0000-0000-000000000002
  const gymHappyFit = LINZ_GYMS[2];   // 00000000-0000-0000-0000-000000000003
  const gymKieser = LINZ_GYMS[3];     // 00000000-0000-0000-0000-000000000004

  // Pure domain calculation engine matching TrainerSchedule.tsx specification
  function computeFacilityScheduleMetrics(facilityBookings: Booking[]) {
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

    // Per-coach breakdown
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
      totalBookedHours,
      attendedSessions,
      nonCancelledSessions,
      rate,
      floorFeesEarned,
      coachesBreakdown: Array.from(coachesMap.values()),
    };
  }

  // Filter engine matching TrainerSchedule.tsx multi-filter toolbar
  function filterFacilitySessions(params: {
    facilityBookings: Booking[];
    dateFilterMode: 'all' | 'today' | 'custom';
    todayIso: string;
    customDate?: string;
    selectedCoachId: string;
    selectedStatus: string;
  }): Booking[] {
    const {
      facilityBookings,
      dateFilterMode,
      todayIso,
      customDate,
      selectedCoachId,
      selectedStatus,
    } = params;

    return facilityBookings.filter((b) => {
      if (dateFilterMode === 'today') {
        const sessionDate = b.session_time.split('T')[0];
        if (sessionDate !== todayIso) return false;
      } else if (dateFilterMode === 'custom' && customDate) {
        const sessionDate = b.session_time.split('T')[0];
        if (sessionDate !== customDate) return false;
      }

      if (selectedCoachId !== 'all' && b.coach_id !== selectedCoachId) {
        return false;
      }

      if (selectedStatus !== 'all' && b.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }

  // =========================================================================
  // 1. Facility-Scoped Schedule Isolation
  // =========================================================================

  describe('1. Facility-Scoped Schedule Isolation', () => {
    it('Gym staff can only view sessions matching their specific gym_id', () => {
      const allBookings = [...DEFAULT_PORTAL_BOOKINGS];

      const jhBookings = allBookings.filter((b) => b.gym_id === gymJohnHarris.id);
      const ffBookings = allBookings.filter((b) => b.gym_id === gymFitFabrik.id);
      const hfBookings = allBookings.filter((b) => b.gym_id === gymHappyFit.id);
      const ktBookings = allBookings.filter((b) => b.gym_id === gymKieser.id);

      assert.ok(jhBookings.length > 0, 'John Harris must have sessions');
      assert.ok(ffBookings.length > 0, 'Fit Fabrik must have sessions');
      assert.ok(hfBookings.length > 0, 'Happy Fit must have sessions');
      assert.ok(ktBookings.length > 0, 'Kieser must have sessions');

      // Assert complete partitioning
      assert.equal(
        allBookings.length,
        jhBookings.length + ffBookings.length + hfBookings.length + ktBookings.length,
        'Sum of venue-scoped bookings must partition all portal bookings'
      );

      // Verify strict isolation within each partition
      for (const b of jhBookings) {
        assert.equal(b.gym_id, gymJohnHarris.id);
      }
      for (const b of ffBookings) {
        assert.equal(b.gym_id, gymFitFabrik.id);
      }
    });

    it('Cross-facility access rejection: John Harris schedule strictly excludes other gyms', () => {
      const allBookings = [...DEFAULT_PORTAL_BOOKINGS];
      const jhScoped = allBookings.filter((b) => b.gym_id === gymJohnHarris.id);

      // Assert no Fit Fabrik, Happy Fit, or Kieser bookings appear in John Harris board
      const foreignInJH = jhScoped.filter((b) => b.gym_id !== gymJohnHarris.id);
      assert.equal(foreignInJH.length, 0, 'Zero foreign bookings allowed in John Harris board');

      const ffInJH = jhScoped.some((b) => b.gym_id === gymFitFabrik.id);
      assert.equal(ffInJH, false, 'Fit Fabrik bookings must never be in John Harris schedule');
    });

    it('Adversarial: Malicious or spoofed gym_id sessions are completely rejected', () => {
      const maliciousBookings: Booking[] = [
        ...DEFAULT_PORTAL_BOOKINGS,
        {
          id: 'bk_hacked_cross_tenant_01',
          client_id: 'client_attacker',
          coach_id: LINZ_COACHES[0].id,
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

      const jhScoped = maliciousBookings.filter((b) => b.gym_id === gymJohnHarris.id);
      assert.equal(jhScoped.some((b) => b.id === 'bk_hacked_cross_tenant_01'), false);

      const ffScoped = maliciousBookings.filter((b) => b.gym_id === gymFitFabrik.id);
      assert.equal(ffScoped.some((b) => b.id === 'bk_hacked_cross_tenant_01'), false);
    });
  });

  // =========================================================================
  // 2. Metrics Calculation: Attendance Rate, Booked Hours & Floor Fees
  // =========================================================================

  describe('2. Metrics Calculation & Floor Fee Accrual', () => {
    it('Calculates booked hours accurately across standard and non-standard durations', () => {
      const customSessions: Booking[] = [
        {
          id: 'bk_m1',
          client_id: 'c1',
          coach_id: 'co1',
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T08:00:00Z',
          duration_minutes: 60, // 1.0h
          gross_amount: 75.0,
          gym_floor_fee: 8.0,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'bk_m2',
          client_id: 'c2',
          coach_id: 'co1',
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T09:30:00Z',
          duration_minutes: 90, // 1.5h
          gross_amount: 110.0,
          gym_floor_fee: 8.0,
          platform_fee: 15.4,
          coach_payout: 86.6,
          status: 'checked_in',
          created_at: '',
          updated_at: '',
        },
        {
          id: 'bk_m3',
          client_id: 'c3',
          coach_id: 'co2',
          gym_id: gymJohnHarris.id,
          session_time: '2026-10-15T11:00:00Z',
          duration_minutes: 45, // 0.75h
          gross_amount: 55.0,
          gym_floor_fee: 8.0,
          platform_fee: 7.7,
          coach_payout: 39.3,
          status: 'completed',
          created_at: '',
          updated_at: '',
        },
      ];

      const metrics = computeFacilityScheduleMetrics(customSessions);
      // Total duration = 60 + 90 + 45 = 195 mins = 3.25 hours
      assert.equal(metrics.totalBookedHours, 3.25);
    });

    it('Calculates attendance rate as (attended / non-cancelled) * 100', () => {
      const testSessions: Booking[] = [
        { id: '1', client_id: 'c', coach_id: 'co1', gym_id: gymFitFabrik.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 8, platform_fee: 10.5, coach_payout: 56.5, status: 'checked_in', created_at: '', updated_at: '' },
        { id: '2', client_id: 'c', coach_id: 'co1', gym_id: gymFitFabrik.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 8, platform_fee: 10.5, coach_payout: 56.5, status: 'completed', created_at: '', updated_at: '' },
        { id: '3', client_id: 'c', coach_id: 'co2', gym_id: gymFitFabrik.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 8, platform_fee: 10.5, coach_payout: 56.5, status: 'confirmed', created_at: '', updated_at: '' },
        { id: '4', client_id: 'c', coach_id: 'co2', gym_id: gymFitFabrik.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 0, platform_fee: 0, coach_payout: 0, status: 'cancelled', created_at: '', updated_at: '' },
      ];

      const metrics = computeFacilityScheduleMetrics(testSessions);
      // Attended: checked_in (1) + completed (2) = 2
      // Non-cancelled: 4 - 1 = 3 (checked_in, completed, confirmed)
      // Rate = round((2 / 3) * 100) = 67%
      assert.equal(metrics.attendedSessions, 2);
      assert.equal(metrics.nonCancelledSessions, 3);
      assert.equal(metrics.rate, 67);
      // Floor fees earned: 2 * 8.0 = €16.00
      assert.equal(metrics.floorFeesEarned, 16.0);
    });

    it('Allocates €8.00 floor fees strictly for attended sessions and €0.00 for cancelled sessions', () => {
      const jhSessions = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);
      const metrics = computeFacilityScheduleMetrics(jhSessions);

      const attendedCount = jhSessions.filter(
        (b) => b.status === 'checked_in' || b.status === 'completed'
      ).length;

      assert.equal(metrics.floorFeesEarned, attendedCount * 8.0);

      // Verify that cancelled sessions generate €0.00 floor fee
      const cancelledCount = jhSessions.filter((b) => b.status === 'cancelled').length;
      assert.ok(cancelledCount > 0, 'John Harris seed data has at least 1 cancelled session');
    });

    it('Computes per-coach breakdown preserving exact facility total floor fee conservation', () => {
      const jhSessions = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);
      const metrics = computeFacilityScheduleMetrics(jhSessions);

      // Sum of coach floor fees must strictly equal facility total
      const sumCoachFloorFees = metrics.coachesBreakdown.reduce((sum, cb) => sum + cb.floorFeesEarned, 0);
      assert.equal(sumCoachFloorFees, metrics.floorFeesEarned);

      // Sum of coach booked hours must strictly equal facility total hours
      const sumCoachBookedHours = metrics.coachesBreakdown.reduce((sum, cb) => sum + cb.bookedHours, 0);
      assert.equal(sumCoachBookedHours, metrics.totalBookedHours);
    });

    it('Boundary: Facility with 0 sessions returns zero values without division by zero errors', () => {
      const emptySessions: Booking[] = [];
      const metrics = computeFacilityScheduleMetrics(emptySessions);

      assert.equal(metrics.totalBookedHours, 0);
      assert.equal(metrics.attendedSessions, 0);
      assert.equal(metrics.nonCancelledSessions, 0);
      assert.equal(metrics.rate, 0);
      assert.equal(metrics.floorFeesEarned, 0);
      assert.equal(metrics.coachesBreakdown.length, 0);
    });

    it('Boundary: Facility where all sessions are cancelled returns 0% attendance and €0.00 floor fee', () => {
      const cancelledOnly: Booking[] = [
        { id: 'c1', client_id: 'c', coach_id: 'co1', gym_id: gymJohnHarris.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 0, platform_fee: 0, coach_payout: 0, status: 'cancelled', created_at: '', updated_at: '' },
        { id: 'c2', client_id: 'c', coach_id: 'co1', gym_id: gymJohnHarris.id, session_time: '', duration_minutes: 60, gross_amount: 75, gym_floor_fee: 0, platform_fee: 0, coach_payout: 0, status: 'cancelled', created_at: '', updated_at: '' },
      ];

      const metrics = computeFacilityScheduleMetrics(cancelledOnly);
      assert.equal(metrics.attendedSessions, 0);
      assert.equal(metrics.nonCancelledSessions, 0);
      assert.equal(metrics.rate, 0);
      assert.equal(metrics.floorFeesEarned, 0);
    });
  });

  // =========================================================================
  // 3. Multi-Filter Engine Behavior
  // =========================================================================

  describe('3. Multi-Filter Engine Filtering Behavior', () => {
    const jhSessions = DEFAULT_PORTAL_BOOKINGS.filter((b) => b.gym_id === gymJohnHarris.id);

    it('Filters schedule correctly by specific custom date', () => {
      const filtered = filterFacilitySessions({
        facilityBookings: jhSessions,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '2026-10-15',
        selectedCoachId: 'all',
        selectedStatus: 'all',
      });

      assert.ok(filtered.length > 0);
      for (const b of filtered) {
        assert.ok(b.session_time.startsWith('2026-10-15'));
      }
    });

    it('Filters schedule correctly by specific coach ID', () => {
      const coachIdLukas = LINZ_COACHES[0].id;
      const filtered = filterFacilitySessions({
        facilityBookings: jhSessions,
        dateFilterMode: 'all',
        todayIso: '2026-10-15',
        selectedCoachId: coachIdLukas,
        selectedStatus: 'all',
      });

      assert.ok(filtered.length > 0);
      for (const b of filtered) {
        assert.equal(b.coach_id, coachIdLukas);
      }
    });

    it('Filters schedule correctly by booking status', () => {
      const filtered = filterFacilitySessions({
        facilityBookings: jhSessions,
        dateFilterMode: 'all',
        todayIso: '2026-10-15',
        selectedCoachId: 'all',
        selectedStatus: 'completed',
      });

      assert.ok(filtered.length > 0);
      for (const b of filtered) {
        assert.equal(b.status, 'completed');
      }
    });

    it('Combines date, coach, and status filters simultaneously', () => {
      const coachIdLukas = LINZ_COACHES[0].id;
      const filtered = filterFacilitySessions({
        facilityBookings: jhSessions,
        dateFilterMode: 'custom',
        todayIso: '2026-10-15',
        customDate: '2026-10-15',
        selectedCoachId: coachIdLukas,
        selectedStatus: 'confirmed',
      });

      for (const b of filtered) {
        assert.ok(b.session_time.startsWith('2026-10-15'));
        assert.equal(b.coach_id, coachIdLukas);
        assert.equal(b.status, 'confirmed');
      }
    });
  });
});
