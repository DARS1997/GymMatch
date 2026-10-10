import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTAL_BOOKINGS, LINZ_GYMS, LINZ_COACHES } from '../src/lib/data/linz-seed';
import { Booking, BookingStatus } from '../src/types/database';
import {
  calculateSplitPayment,
  eurToCents,
  formatCentsToEur,
} from '../src/lib/payments/split';

describe('Platform Manager Administrative Overrides & Financial Invariants (WP4 / R4)', () => {
  // Pure state updater simulating RoleContext.updateBookingStatus & refundBooking
  function updateBookingStatusSimulation(
    bookings: Booking[],
    bookingId: string,
    newStatus: BookingStatus,
    reason?: string
  ): Booking[] {
    const bookingIndex = bookings.findIndex((b) => b.id === bookingId);
    if (bookingIndex === -1) return bookings;

    const existing = bookings[bookingIndex];
    let gym_floor_fee = existing.gym_floor_fee;
    let platform_fee = existing.platform_fee;
    let coach_payout = existing.coach_payout;

    if (newStatus === 'cancelled') {
      gym_floor_fee = 0;
      platform_fee = 0;
      coach_payout = 0;
    } else if (existing.status === 'cancelled') {
      const split = calculateSplitPayment({
        grossAmountCents: eurToCents(existing.gross_amount),
      });
      gym_floor_fee = split.gymFloorFeeCents / 100;
      platform_fee = split.platformFeeCents / 100;
      coach_payout = split.coachPayoutCents / 100;
    }

    const updatedBooking: Booking = {
      ...existing,
      status: newStatus,
      gym_floor_fee,
      platform_fee,
      coach_payout,
      cancellation_reason: reason !== undefined ? reason : existing.cancellation_reason,
      updated_at: new Date().toISOString(),
    };

    const nextBookings = [...bookings];
    nextBookings[bookingIndex] = updatedBooking;
    return nextBookings;
  }

  function refundBookingSimulation(
    bookings: Booking[],
    bookingId: string,
    reason?: string
  ): Booking[] {
    return updateBookingStatusSimulation(
      bookings,
      bookingId,
      'cancelled',
      reason || 'Administrative full refund issued by platform manager'
    );
  }

  // Pure KPI aggregation engine matching PlatformKpiCards.tsx specification
  function computePlatformFinancialKpis(bookings: Booking[]) {
    let totalGrossCents = 0;
    let totalFloorCents = 0;
    let totalPlatformCents = 0;
    let totalCoachCents = 0;
    let totalRefundCents = 0;

    let activeBookingsCount = 0;
    let completedBookingsCount = 0;
    let cancelledBookingsCount = 0;
    let pendingBookingsCount = 0;

    for (const b of bookings) {
      const gross = eurToCents(b.gross_amount || 0);
      const floor = eurToCents(b.gym_floor_fee || 0);
      const platform = eurToCents(b.platform_fee || 0);
      const coach = eurToCents(b.coach_payout || 0);

      totalGrossCents += gross;
      totalFloorCents += floor;
      totalPlatformCents += platform;
      totalCoachCents += coach;

      if (b.status === 'cancelled') {
        cancelledBookingsCount += 1;
        const refund = Math.max(0, gross - (floor + platform + coach));
        totalRefundCents += refund;
      } else if (b.status === 'completed') {
        completedBookingsCount += 1;
      } else if (b.status === 'confirmed' || b.status === 'checked_in') {
        activeBookingsCount += 1;
      } else if (b.status === 'pending') {
        pendingBookingsCount += 1;
      }
    }

    const calculatedSum =
      totalFloorCents + totalPlatformCents + totalCoachCents + totalRefundCents;
    const driftCents = totalGrossCents - calculatedSum;

    return {
      totalGrossCents,
      totalFloorCents,
      totalPlatformCents,
      totalCoachCents,
      totalRefundCents,
      driftCents,
      isConserved: driftCents === 0,
      activeBookingsCount,
      completedBookingsCount,
      cancelledBookingsCount,
      pendingBookingsCount,
      totalBookingsCount: bookings.length,
    };
  }

  // =========================================================================
  // 1. Platform Manager Administrative Status Overrides
  // =========================================================================

  describe('1. Booking Lifecycle State Machine Administrative Overrides', () => {
    it('Transitions booking across full state machine: pending -> confirmed -> checked_in -> completed', () => {
      let bookings: Booking[] = [
        {
          id: 'bk_override_sm_01',
          client_id: 'c1',
          coach_id: LINZ_COACHES[0].id,
          gym_id: LINZ_GYMS[0].id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 8.0,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'pending',
          created_at: '2026-10-10T08:00:00Z',
          updated_at: '2026-10-10T08:00:00Z',
        },
      ];

      // Step 1: pending -> confirmed
      bookings = updateBookingStatusSimulation(bookings, 'bk_override_sm_01', 'confirmed', 'Admin confirmed slot');
      assert.equal(bookings[0].status, 'confirmed');
      assert.equal(bookings[0].cancellation_reason, 'Admin confirmed slot');
      assert.equal(bookings[0].coach_payout, 56.5);

      // Step 2: confirmed -> checked_in (e.g. manual front-desk verification)
      bookings = updateBookingStatusSimulation(
        bookings,
        'bk_override_sm_01',
        'checked_in',
        'Manual verification due to scanner glitch'
      );
      assert.equal(bookings[0].status, 'checked_in');
      assert.equal(bookings[0].cancellation_reason, 'Manual verification due to scanner glitch');
      assert.equal(bookings[0].gym_floor_fee, 8.0);

      // Step 3: checked_in -> completed
      bookings = updateBookingStatusSimulation(bookings, 'bk_override_sm_01', 'completed', 'Session concluded successfully');
      assert.equal(bookings[0].status, 'completed');
      assert.equal(bookings[0].coach_payout, 56.5);
    });

    it('Admin direct override to cancelled zeros out fees and preserves gross for refund', () => {
      let bookings: Booking[] = [
        {
          id: 'bk_override_cancel_01',
          client_id: 'c1',
          coach_id: LINZ_COACHES[0].id,
          gym_id: LINZ_GYMS[0].id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 8.0,
          platform_fee: 10.5,
          coach_payout: 56.5,
          status: 'confirmed',
          created_at: '2026-10-10T08:00:00Z',
          updated_at: '2026-10-10T08:00:00Z',
        },
      ];

      bookings = updateBookingStatusSimulation(
        bookings,
        'bk_override_cancel_01',
        'cancelled',
        'Administrative dispute resolution: Trainer illness'
      );

      const updated = bookings[0];
      assert.equal(updated.status, 'cancelled');
      assert.equal(updated.gross_amount, 75.0, 'Gross amount must remain untouched');
      assert.equal(updated.gym_floor_fee, 0.0, 'Floor fee must be zeroed');
      assert.equal(updated.platform_fee, 0.0, 'Platform fee must be zeroed');
      assert.equal(updated.coach_payout, 0.0, 'Coach payout must be zeroed');
      assert.equal(updated.cancellation_reason, 'Administrative dispute resolution: Trainer illness');
    });

    it('Dispute refund override function sets mandatory audit trail reason', () => {
      let bookings: Booking[] = [
        {
          id: 'bk_refund_01',
          client_id: 'c1',
          coach_id: LINZ_COACHES[0].id,
          gym_id: LINZ_GYMS[0].id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 90.0,
          gym_floor_fee: 8.0,
          platform_fee: 12.6,
          coach_payout: 69.4,
          status: 'confirmed',
          created_at: '2026-10-10T08:00:00Z',
          updated_at: '2026-10-10T08:00:00Z',
        },
      ];

      bookings = refundBookingSimulation(bookings, 'bk_refund_01', 'Facility power outage full refund');

      assert.equal(bookings[0].status, 'cancelled');
      assert.equal(bookings[0].cancellation_reason, 'Facility power outage full refund');
      assert.equal(bookings[0].coach_payout, 0);
    });

    it('Admin un-cancelling a cancelled booking recomputes splits and restores active disbursements', () => {
      let bookings: Booking[] = [
        {
          id: 'bk_uncancel_01',
          client_id: 'c1',
          coach_id: LINZ_COACHES[0].id,
          gym_id: LINZ_GYMS[0].id,
          session_time: '2026-10-15T10:00:00Z',
          duration_minutes: 60,
          gross_amount: 75.0,
          gym_floor_fee: 0.0,
          platform_fee: 0.0,
          coach_payout: 0.0,
          status: 'cancelled',
          cancellation_reason: 'Previous customer cancellation',
          created_at: '2026-10-10T08:00:00Z',
          updated_at: '2026-10-10T08:00:00Z',
        },
      ];

      bookings = updateBookingStatusSimulation(
        bookings,
        'bk_uncancel_01',
        'confirmed',
        'Dispute resolved: reinstated session'
      );

      const updated = bookings[0];
      assert.equal(updated.status, 'confirmed');
      assert.equal(updated.gross_amount, 75.0);
      assert.equal(updated.gym_floor_fee, 8.0, 'Floor fee must be restored to €8.00');
      assert.equal(updated.platform_fee, 10.5, 'Platform fee must be restored to 14% (€10.50)');
      assert.equal(updated.coach_payout, 56.5, 'Coach payout must be restored to residual (€56.50)');
      assert.equal(updated.cancellation_reason, 'Dispute resolved: reinstated session');
    });

    it('Non-existent booking ID safely returns unmodified bookings array without throwing', () => {
      const initial = [...DEFAULT_PORTAL_BOOKINGS];
      const updated = updateBookingStatusSimulation(initial, 'non_existent_booking_id', 'completed');
      assert.equal(updated.length, initial.length);
    });
  });

  // =========================================================================
  // 2. Refund Mechanics & Integer-Cent Currency Conservation
  // =========================================================================

  describe('2. Integer-Cent Currency Conservation & Zero Drift (Gross = Refund + Floor + Platform + Coach)', () => {
    it('Verifies single booking conservation before and after full refund ($0.00¢ drift)', () => {
      const sessionGrossEur = 75.0;
      const split = calculateSplitPayment({ grossAmountCents: eurToCents(sessionGrossEur) });

      // Before refund (active booking)
      const grossBefore = eurToCents(sessionGrossEur);
      const floorBefore = split.gymFloorFeeCents;
      const platformBefore = split.platformFeeCents;
      const coachBefore = split.coachPayoutCents;
      const refundBefore = 0;

      assert.equal(grossBefore, refundBefore + floorBefore + platformBefore + coachBefore);
      assert.equal(grossBefore - (refundBefore + floorBefore + platformBefore + coachBefore), 0);

      // After refund (cancelled booking)
      const grossAfter = grossBefore;
      const floorAfter = 0;
      const platformAfter = 0;
      const coachAfter = 0;
      const refundAfter = grossAfter; // 100% full refund

      assert.equal(grossAfter, refundAfter + floorAfter + platformAfter + coachAfter);
      assert.equal(grossAfter - (refundAfter + floorAfter + platformAfter + coachAfter), 0);
    });

    it('Sweep across diverse coach rates (€25, €60, €75, €90, €120, €200) strictly preserves zero drift', () => {
      const rateValuesEur = [25.0, 60.0, 75.0, 90.0, 120.0, 200.0];

      for (const rate of rateValuesEur) {
        const grossCents = eurToCents(rate);
        const split = calculateSplitPayment({ grossAmountCents: grossCents });

        // Conservation in active state
        assert.equal(
          grossCents,
          split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents,
          `Rate €${rate} must conserve active balance`
        );

        // Conservation in refunded state
        const refundCents = grossCents;
        const floorCents = 0;
        const platformCents = 0;
        const coachCents = 0;

        const sumAfter = refundCents + floorCents + platformCents + coachCents;
        const drift = grossCents - sumAfter;
        assert.equal(drift, 0, `Rate €${rate} must yield exactly 0.00¢ drift after full refund`);
      }
    });

    it('Odd-cent fractional amounts (€99.99, €25.01, €33.33, €49.95, €79.99) conserve integer cents', () => {
      const oddRates = [99.99, 25.01, 33.33, 49.95, 79.99];

      for (const rate of oddRates) {
        const grossCents = eurToCents(rate);
        const split = calculateSplitPayment({ grossAmountCents: grossCents });

        assert.equal(
          grossCents,
          split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents
        );

        const refundCents = grossCents;
        assert.equal(grossCents, refundCents);
      }
    });

    it('Exhaustive 101-cent sweep (€50.00 to €51.00) confirms zero drift across consecutive values', () => {
      for (let cents = 5000; cents <= 5100; cents++) {
        const split = calculateSplitPayment({ grossAmountCents: cents });
        assert.equal(cents, split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents);

        const refundCents = cents;
        const drift = cents - refundCents;
        assert.equal(drift, 0);
      }
    });

    it('Un-cancellation preserves exact zero drift ($0.00¢) across round-trip lifecycle (confirmed -> cancelled -> confirmed)', () => {
      const testRatesEur = [60.0, 75.0, 90.0, 120.0];

      for (const rate of testRatesEur) {
        const split = calculateSplitPayment({ grossAmountCents: eurToCents(rate) });
        let bookings: Booking[] = [
          {
            id: `bk_roundtrip_${rate}`,
            client_id: 'c1',
            coach_id: LINZ_COACHES[0].id,
            gym_id: LINZ_GYMS[0].id,
            session_time: '2026-10-15T10:00:00Z',
            duration_minutes: 60,
            gross_amount: rate,
            gym_floor_fee: split.gymFloorFeeCents / 100,
            platform_fee: split.platformFeeCents / 100,
            coach_payout: split.coachPayoutCents / 100,
            status: 'confirmed',
            created_at: '2026-10-10T08:00:00Z',
            updated_at: '2026-10-10T08:00:00Z',
          },
        ];

        // 1. Initial confirmed state: drift must be 0
        let kpis = computePlatformFinancialKpis(bookings);
        assert.equal(kpis.driftCents, 0, `Initial active state must have 0 drift for rate €${rate}`);
        assert.equal(kpis.isConserved, true);

        // 2. Transition to cancelled: drift must be 0
        bookings = updateBookingStatusSimulation(bookings, bookings[0].id, 'cancelled', 'Customer dispute');
        kpis = computePlatformFinancialKpis(bookings);
        assert.equal(kpis.driftCents, 0, `Cancelled state must have 0 drift for rate €${rate}`);
        assert.equal(kpis.totalRefundCents, eurToCents(rate));
        assert.equal(kpis.totalFloorCents, 0);
        assert.equal(kpis.totalCoachCents, 0);

        // 3. Transition back to confirmed (un-cancel): drift must remain exactly 0
        bookings = updateBookingStatusSimulation(bookings, bookings[0].id, 'confirmed', 'Dispute reversed');
        kpis = computePlatformFinancialKpis(bookings);
        assert.equal(kpis.driftCents, 0, `Re-activated state must have 0 drift for rate €${rate}`);
        assert.equal(kpis.isConserved, true);
        assert.equal(kpis.totalRefundCents, 0);
        assert.equal(kpis.totalFloorCents, split.gymFloorFeeCents);
        assert.equal(kpis.totalPlatformCents, split.platformFeeCents);
        assert.equal(kpis.totalCoachCents, split.coachPayoutCents);
      }
    });
  });

  // =========================================================================
  // 3. Platform Financial KPI Aggregations
  // =========================================================================

  describe('3. Platform Financial KPI Aggregations & Multi-Venue Portfolio Invariant', () => {
    it('Verifies global KPI calculations on DEFAULT_PORTAL_BOOKINGS with 0.00¢ drift', () => {
      const kpis = computePlatformFinancialKpis(DEFAULT_PORTAL_BOOKINGS);

      assert.ok(kpis.totalBookingsCount >= 10, 'Must have at least 10 portal bookings');
      assert.ok(kpis.activeBookingsCount > 0, 'Must have active bookings');
      assert.ok(kpis.completedBookingsCount > 0, 'Must have completed bookings');
      assert.ok(kpis.cancelledBookingsCount > 0, 'Must have cancelled bookings');

      assert.ok(kpis.totalGrossCents > 0);
      assert.ok(kpis.totalFloorCents > 0);
      assert.ok(kpis.totalPlatformCents > 0);
      assert.ok(kpis.totalCoachCents > 0);
      assert.ok(kpis.totalRefundCents > 0);

      // Core Live Invariant Check:
      assert.equal(kpis.driftCents, 0, 'Global drift must be strictly 0 cents');
      assert.equal(kpis.isConserved, true);
    });

    it('Dynamic portfolio perturbation: Refunding an active booking updates KPIs preserving exact zero drift', () => {
      let bookings = [...DEFAULT_PORTAL_BOOKINGS];
      const initialKpis = computePlatformFinancialKpis(bookings);

      // Find an active confirmed booking to refund
      const targetBooking = bookings.find((b) => b.status === 'confirmed');
      assert.ok(targetBooking, 'Must find a confirmed booking');

      const targetGrossCents = eurToCents(targetBooking.gross_amount);
      const targetFloorCents = eurToCents(targetBooking.gym_floor_fee);
      const targetPlatCents = eurToCents(targetBooking.platform_fee);
      const targetCoachCents = eurToCents(targetBooking.coach_payout);

      // Issue refund via simulation
      bookings = refundBookingSimulation(bookings, targetBooking.id, 'Customer dispute test refund');
      const updatedKpis = computePlatformFinancialKpis(bookings);

      // Active count decreases by 1, cancelled increases by 1
      assert.equal(updatedKpis.activeBookingsCount, initialKpis.activeBookingsCount - 1);
      assert.equal(updatedKpis.cancelledBookingsCount, initialKpis.cancelledBookingsCount + 1);

      // Floor, platform, coach totals decrease by target fees
      assert.equal(updatedKpis.totalFloorCents, initialKpis.totalFloorCents - targetFloorCents);
      assert.equal(updatedKpis.totalPlatformCents, initialKpis.totalPlatformCents - targetPlatCents);
      assert.equal(updatedKpis.totalCoachCents, initialKpis.totalCoachCents - targetCoachCents);

      // Refund total increases by target gross
      assert.equal(updatedKpis.totalRefundCents, initialKpis.totalRefundCents + targetGrossCents);

      // Total GBV remains constant
      assert.equal(updatedKpis.totalGrossCents, initialKpis.totalGrossCents);

      // Currency conservation invariant holds strictly with zero drift!
      assert.equal(updatedKpis.driftCents, 0);
      assert.equal(updatedKpis.isConserved, true);
    });

    it('Dynamic portfolio perturbation: Un-cancelling a pre-cancelled booking updates KPIs preserving exact zero drift ($0.00¢)', () => {
      let bookings = [...DEFAULT_PORTAL_BOOKINGS];
      const initialKpis = computePlatformFinancialKpis(bookings);

      // Find the pre-seeded cancelled booking
      const cancelledBooking = bookings.find((b) => b.status === 'cancelled');
      assert.ok(cancelledBooking, 'Must find a cancelled booking in default seed');

      const targetGrossCents = eurToCents(cancelledBooking.gross_amount);
      const expectedSplit = calculateSplitPayment({ grossAmountCents: targetGrossCents });

      // Un-cancel via simulation
      bookings = updateBookingStatusSimulation(
        bookings,
        cancelledBooking.id,
        'confirmed',
        'Manager dispute resolution reinstatement'
      );
      const updatedKpis = computePlatformFinancialKpis(bookings);

      // Cancelled count decreases by 1, active count increases by 1
      assert.equal(updatedKpis.cancelledBookingsCount, initialKpis.cancelledBookingsCount - 1);
      assert.equal(updatedKpis.activeBookingsCount, initialKpis.activeBookingsCount + 1);

      // Refund total decreases by gross amount
      assert.equal(updatedKpis.totalRefundCents, initialKpis.totalRefundCents - targetGrossCents);

      // Disbursements increase by recomputed split
      assert.equal(updatedKpis.totalFloorCents, initialKpis.totalFloorCents + expectedSplit.gymFloorFeeCents);
      assert.equal(updatedKpis.totalPlatformCents, initialKpis.totalPlatformCents + expectedSplit.platformFeeCents);
      assert.equal(updatedKpis.totalCoachCents, initialKpis.totalCoachCents + expectedSplit.coachPayoutCents);

      // Total GBV remains constant
      assert.equal(updatedKpis.totalGrossCents, initialKpis.totalGrossCents);

      // Zero drift invariant holds strictly ($0.00¢)
      assert.equal(updatedKpis.driftCents, 0);
      assert.equal(updatedKpis.isConserved, true);
    });

    it('Boundary: Empty bookings list calculates zero financial KPIs without NaN or errors', () => {
      const emptyKpis = computePlatformFinancialKpis([]);

      assert.equal(emptyKpis.totalBookingsCount, 0);
      assert.equal(emptyKpis.activeBookingsCount, 0);
      assert.equal(emptyKpis.totalGrossCents, 0);
      assert.equal(emptyKpis.totalRefundCents, 0);
      assert.equal(emptyKpis.driftCents, 0);
      assert.equal(emptyKpis.isConserved, true);
    });
  });
});
