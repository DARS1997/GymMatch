import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSplitPayment,
  calculateCancellationRefund,
  formatCentsToEur,
  eurToCents,
} from '../src/lib/payments/split';
import {
  createMockSupabaseClient,
  resetMockDatastore,
  getMockDatastore,
} from '../src/lib/supabase/mock-db';

describe('Adversarial Stress Test: Financial Split Calculations & Zero-Drift Integrity', () => {
  it('€25.00 minimum rate boundary split calculates cleanly with zero currency loss', () => {
    // €25.00 session: 2500 cents
    // Gym Floor Fee: 800 cents (€8.00)
    // Platform Fee: round(2500 * 0.14) = 350 cents (€3.50)
    // Coach Payout: 2500 - 800 - 350 = 1350 cents (€13.50)
    const result = calculateSplitPayment({
      grossAmountCents: 2500,
      gymFloorFeeCents: 800,
      platformFeeRateBps: 1400,
    });

    assert.equal(result.grossAmountCents, 2500);
    assert.equal(result.gymFloorFeeCents, 800);
    assert.equal(result.platformFeeCents, 350);
    assert.equal(result.coachPayoutCents, 1350);

    assert.equal(result.formatted.gross, '€25.00');
    assert.equal(result.formatted.gymFloorFee, '€8.00');
    assert.equal(result.formatted.platformFee, '€3.50');
    assert.equal(result.formatted.coachPayout, '€13.50');

    // Conservation of currency invariant
    assert.equal(
      result.grossAmountCents,
      result.gymFloorFeeCents + result.platformFeeCents + result.coachPayoutCents
    );
  });

  it('Calculates split accurately across extreme and diverse rates (€60, €75, €90, €120, €200, €500)', () => {
    const rateMatrix = [
      { gross: 6000, expectedGym: 800, expectedPlat: 840, expectedCoach: 4360 },
      { gross: 7500, expectedGym: 800, expectedPlat: 1050, expectedCoach: 5650 },
      { gross: 9000, expectedGym: 800, expectedPlat: 1260, expectedCoach: 6940 },
      { gross: 12000, expectedGym: 800, expectedPlat: 1680, expectedCoach: 9520 },
      { gross: 20000, expectedGym: 800, expectedPlat: 2800, expectedCoach: 16400 },
      { gross: 50000, expectedGym: 800, expectedPlat: 7000, expectedCoach: 42200 },
    ];

    for (const item of rateMatrix) {
      const res = calculateSplitPayment({
        grossAmountCents: item.gross,
        gymFloorFeeCents: 800,
        platformFeeRateBps: 1400,
      });

      assert.equal(res.gymFloorFeeCents, item.expectedGym);
      assert.equal(res.platformFeeCents, item.expectedPlat);
      assert.equal(res.coachPayoutCents, item.expectedCoach);
      assert.equal(
        res.grossAmountCents,
        res.gymFloorFeeCents + res.platformFeeCents + res.coachPayoutCents,
        `Drift detected at gross rate ${item.gross}`
      );
    }
  });

  it('Handles odd cents and fractional amounts without drift (€99.99, €25.01, €33.33, €49.95, €79.99)', () => {
    const oddCentsMatrix = [
      { gross: 9999, platExpected: 1400, coachExpected: 7799 }, // 9999 * 0.14 = 1399.86 -> 1400
      { gross: 2501, platExpected: 350, coachExpected: 1351 },  // 2501 * 0.14 = 350.14 -> 350
      { gross: 3333, platExpected: 467, coachExpected: 2066 },  // 3333 * 0.14 = 466.62 -> 467
      { gross: 4995, platExpected: 699, coachExpected: 3496 },  // 4995 * 0.14 = 699.30 -> 699
      { gross: 7999, platExpected: 1120, coachExpected: 6079 }, // 7999 * 0.14 = 1119.86 -> 1120
    ];

    for (const tc of oddCentsMatrix) {
      const res = calculateSplitPayment({
        grossAmountCents: tc.gross,
        gymFloorFeeCents: 800,
        platformFeeRateBps: 1400,
      });

      assert.equal(res.platformFeeCents, tc.platExpected);
      assert.equal(res.coachPayoutCents, tc.coachExpected);
      assert.equal(
        res.grossAmountCents,
        res.gymFloorFeeCents + res.platformFeeCents + res.coachPayoutCents,
        `Drift detected at odd rate ${tc.gross}`
      );
    }
  });

  it('Exhaustive Cent Sweep Oracle: 13,001 consecutive cent values (€20.00 to €150.00) verify 100% zero-drift', () => {
    let testedCount = 0;
    for (let cent = 2000; cent <= 15000; cent++) {
      const res = calculateSplitPayment({
        grossAmountCents: cent,
        gymFloorFeeCents: 800,
        platformFeeRateBps: 1400,
      });

      // Assert conservation of currency
      const sum = res.gymFloorFeeCents + res.platformFeeCents + res.coachPayoutCents;
      if (sum !== res.grossAmountCents) {
        throw new Error(`Integrity violation at ${cent} cents: sum was ${sum}`);
      }

      // Assert non-negative and positive splits
      assert.ok(res.platformFeeCents >= 0);
      assert.ok(res.coachPayoutCents > 0);
      assert.equal(res.gymFloorFeeCents, 800);
      testedCount++;
    }

    assert.equal(testedCount, 13001);
  });

  it('Platform take-rate variation sweep: 10.0% to 20.0% preserves currency conservation', () => {
    const bpsValues = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000];
    const testRates = [2500, 6000, 7500, 9000, 9999, 12000];

    for (const bps of bpsValues) {
      for (const gross of testRates) {
        const res = calculateSplitPayment({
          grossAmountCents: gross,
          gymFloorFeeCents: 800,
          platformFeeRateBps: bps,
        });

        assert.equal(
          res.grossAmountCents,
          res.gymFloorFeeCents + res.platformFeeCents + res.coachPayoutCents,
          `Drift at gross ${gross} with bps ${bps}`
        );
        assert.ok(res.coachPayoutCents > 0);
      }
    }
  });

  it('Strict boundary rejection: rejects sub-minimum, supra-maximum, and illegal parameters', () => {
    // 1999 cents (€19.99) < 2000
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 1999 });
    }, /Gross session amount must be at least €20.00/);

    // 0 cents
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 0 });
    }, /Gross session amount must be at least €20.00/);

    // 50001 cents (€500.01) > 50000
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 50001 });
    }, /Gross session amount cannot exceed €500.00/);

    // Take-rate out of bounds: 999 bps (< 1000)
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 999 });
    }, /Platform take rate must be between 10.00% and 20.00%/);

    // Take-rate out of bounds: 2001 bps (> 2000)
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 2001 });
    }, /Platform take rate must be between 10.00% and 20.00%/);

    // Negative floor fee
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 7500, gymFloorFeeCents: -100 });
    }, /Gym floor fee cannot be negative/);

    // Floor fee too large resulting in non-positive coach payout
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 2000, gymFloorFeeCents: 1800 });
    }, /Fee structure results in non-positive coach payout/);
  });

  it('Floating-point helper utility resilience (eurToCents & formatCentsToEur)', () => {
    assert.equal(eurToCents(75), 7500);
    assert.equal(eurToCents(99.99), 9999);
    assert.equal(eurToCents(0.07), 7);
    assert.equal(eurToCents(29.99), 2999);
    assert.equal(eurToCents(25.0), 2500);

    assert.equal(formatCentsToEur(7500), '€75.00');
    assert.equal(formatCentsToEur(0), '€0.00');
    assert.equal(formatCentsToEur(5), '€0.05');
    assert.equal(formatCentsToEur(9999), '€99.99');
    assert.equal(formatCentsToEur(-800), '-€8.00');
  });
});

describe('Adversarial Stress Test: Cancellation Refund Timing & Zero Drift', () => {
  const sessionStart = 1792000000;
  const h24 = 24 * 3600;

  it('Exact 24-hour boundary probe: >24h grants 100% refund, <=24h protects floor fee and coach payout', () => {
    // Case A: 24h + 1s before session (>24h) -> Early cancellation
    const early = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - (h24 + 1),
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(early.isEarlyCancellation, true);
    assert.equal(early.clientRefundCents, 7500);
    assert.equal(early.gymFloorFeeCents, 0);
    assert.equal(early.platformFeeCents, 0);
    assert.equal(early.coachPayoutCents, 0);
    assert.equal(
      7500,
      early.clientRefundCents + early.gymFloorFeeCents + early.platformFeeCents + early.coachPayoutCents
    );

    // Case B: Exactly 24h (86400s) before session (<= 24h boundary) -> Late cancellation
    const exact24h = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - h24,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(exact24h.isEarlyCancellation, false);
    assert.equal(exact24h.clientRefundCents, 0);
    assert.equal(exact24h.gymFloorFeeCents, 800);
    assert.equal(exact24h.platformFeeCents, 1050);
    assert.equal(exact24h.coachPayoutCents, 5650);
    assert.equal(
      7500,
      exact24h.clientRefundCents + exact24h.gymFloorFeeCents + exact24h.platformFeeCents + exact24h.coachPayoutCents
    );

    // Case C: 24h - 1s (86399s) before session (<24h) -> Late cancellation
    const justUnder24h = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - (h24 - 1),
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(justUnder24h.isEarlyCancellation, false);
    assert.equal(justUnder24h.clientRefundCents, 0);
    assert.equal(justUnder24h.gymFloorFeeCents, 800);
    assert.equal(justUnder24h.platformFeeCents, 1050);
    assert.equal(justUnder24h.coachPayoutCents, 5650);

    // Case D: Zero seconds before session -> Late cancellation
    const atSessionStart = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(atSessionStart.isEarlyCancellation, false);
    assert.equal(atSessionStart.clientRefundCents, 0);

    // Case E: Post session no-show / cancellation (-3600s) -> Late cancellation
    const postSession = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart + 3600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(postSession.isEarlyCancellation, false);
    assert.equal(postSession.clientRefundCents, 0);
  });

  it('Coach or Gym initiated cancellation yields 100% refund regardless of timestamp', () => {
    // Coach cancels 10 minutes prior to session
    const coachCancel = calculateCancellationRefund({
      grossAmountCents: 9000,
      cancelledAtEpochSeconds: sessionStart - 600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'coach',
    });
    assert.equal(coachCancel.isEarlyCancellation, true);
    assert.equal(coachCancel.clientRefundCents, 9000);
    assert.equal(coachCancel.gymFloorFeeCents, 0);
    assert.equal(coachCancel.platformFeeCents, 0);
    assert.equal(coachCancel.coachPayoutCents, 0);

    // Gym cancels 5 minutes prior to session
    const gymCancel = calculateCancellationRefund({
      grossAmountCents: 9000,
      cancelledAtEpochSeconds: sessionStart - 300,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'gym',
    });
    assert.equal(gymCancel.isEarlyCancellation, true);
    assert.equal(gymCancel.clientRefundCents, 9000);
    assert.equal(gymCancel.gymFloorFeeCents, 0);
    assert.equal(gymCancel.platformFeeCents, 0);
    assert.equal(gymCancel.coachPayoutCents, 0);
  });

  it('Refund with odd cents (€99.99) preserves strict conservation of money', () => {
    const lateOddRefund = calculateCancellationRefund({
      grossAmountCents: 9999,
      cancelledAtEpochSeconds: sessionStart - 3600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(lateOddRefund.clientRefundCents, 0);
    assert.equal(lateOddRefund.gymFloorFeeCents, 800);
    assert.equal(lateOddRefund.platformFeeCents, 1400);
    assert.equal(lateOddRefund.coachPayoutCents, 7799);
    assert.equal(
      9999,
      lateOddRefund.clientRefundCents +
        lateOddRefund.gymFloorFeeCents +
        lateOddRefund.platformFeeCents +
        lateOddRefund.coachPayoutCents
    );
  });
});

describe('Adversarial Stress Test: Supabase RLS Multi-Tenant Security Isolation', () => {
  beforeEach(() => {
    resetMockDatastore();
  });

  const client1Id = '11111111-1111-1111-1111-000000000001'; // Max
  const client2Id = '11111111-1111-1111-1111-000000000002'; // Sophie
  const coachLukasUserId = '22222222-2222-2222-2222-000000000001';
  const coachElenaUserId = '22222222-2222-2222-2222-000000000002';
  const coachLukasProfileId = '44444444-4444-4444-4444-000000000001';
  const coachElenaProfileId = '44444444-4444-4444-4444-000000000002';
  const gymJohnHarrisId = '00000000-0000-0000-0000-000000000001';
  const gymFitFabrikId = '00000000-0000-0000-0000-000000000002';
  const receptionJohnHarrisUserId = '33333333-3333-3333-3333-000000000001';
  const receptionFitFabrikUserId = '33333333-3333-3333-3333-000000000002';

  const booking1Id = '66666666-6666-6666-6666-000000000001';
  const pass1Id = '77777777-7777-7777-7777-000000000001';

  it('Client 2 cannot read Client 1 bookings or passes by explicit ID filters', async () => {
    const client2 = createMockSupabaseClient({
      user: { id: client2Id, email: 'sophie@linz.at', role: 'client' },
    });

    // Targeted filter on Client 1's ID
    const { data: bByClient } = await client2
      .from('bookings')
      .select()
      .eq('client_id', client1Id);
    assert.equal(bByClient?.length, 0);

    // Targeted filter on specific baseline booking ID
    const { data: bById } = await client2
      .from('bookings')
      .select()
      .eq('id', booking1Id);
    assert.equal(bById?.length, 0);

    // Targeted filter on Client 1's check-in pass
    const { data: pById } = await client2
      .from('check_in_passes')
      .select()
      .eq('client_id', client1Id);
    assert.equal(pById?.length, 0);
  });

  it('Client 2 cannot update Client 1 booking', async () => {
    const client2 = createMockSupabaseClient({
      user: { id: client2Id, email: 'sophie@linz.at', role: 'client' },
    });

    const { error: updateError } = await client2
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', booking1Id);

    assert.ok(updateError);
    assert.equal(updateError.code, '42501');
  });

  it('Client 1 cannot self-elevate booking status to "confirmed" or "completed"', async () => {
    const client1 = createMockSupabaseClient({
      user: { id: client1Id, email: 'max@linz.at', role: 'client' },
    });

    // Client attempts to mark booking as confirmed without payment
    const { error: elevateError } = await client1
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('id', booking1Id);

    assert.ok(elevateError);
    assert.equal(elevateError.code, '42501');

    // Client attempts to mark booking as completed
    const { error: completeError } = await client1
      .from('bookings')
      .update({ status: 'completed' })
      .eq('id', booking1Id);

    assert.ok(completeError);
    assert.equal(completeError.code, '42501');
  });

  it('Coach Elena cannot view or update Coach Lukas assigned bookings', async () => {
    const elenaClient = createMockSupabaseClient({
      user: { id: coachElenaUserId, email: 'elena@coach.at', role: 'coach' },
    });

    // SELECT Lukas's booking
    const { data: bookings } = await elenaClient
      .from('bookings')
      .select()
      .eq('coach_id', coachLukasProfileId);
    assert.equal(bookings?.length, 0);

    // UPDATE Lukas's booking
    const { error: updateError } = await elenaClient
      .from('bookings')
      .update({ client_notes: 'Hacked by Elena' })
      .eq('id', booking1Id);
    assert.ok(updateError);
    assert.equal(updateError.code, '42501');
  });

  it('Gym Receptionist cannot redeem or view passes belonging to another gym', async () => {
    const fitFabrikReception = createMockSupabaseClient({
      user: { id: receptionFitFabrikUserId, email: 'empfang.fitfabrik@linz.at', role: 'gym_receptionist' },
    });

    // SELECT John Harris pass
    const { data: jhPasses } = await fitFabrikReception
      .from('check_in_passes')
      .select()
      .eq('gym_id', gymJohnHarrisId);
    assert.equal(jhPasses?.length, 0);

    // Attempt to redeem John Harris pass
    const { error: redeemError } = await fitFabrikReception
      .from('check_in_passes')
      .update({ is_redeemed: true, redeemed_at: new Date().toISOString() })
      .eq('gym_id', gymJohnHarrisId);

    assert.ok(redeemError);
    assert.equal(redeemError.code, '42501');
  });

  it('Anonymous user mutations are completely blocked across all tables', async () => {
    const anon = createMockSupabaseClient({
      user: { id: '00000000-0000-0000-0000-000000000000', email: 'anon@linz.at', role: 'anon' },
    });

    // INSERT bookings
    const { error: err1 } = await anon.from('bookings').insert({ client_id: client1Id, status: 'pending' });
    assert.equal(err1?.code, '42501');

    // UPDATE bookings
    const { error: err2 } = await anon.from('bookings').update({ status: 'cancelled' }).eq('id', booking1Id);
    assert.equal(err2?.code, '42501');

    // INSERT coach_profiles
    const { error: err3 } = await anon.from('coach_profiles').insert({ full_name: 'Fake Coach', user_id: 'anon' });
    assert.equal(err3?.code, '42501');

    // UPDATE coach_profiles
    const { error: err4 } = await anon.from('coach_profiles').update({ hourly_rate: 10 }).eq('id', coachLukasProfileId);
    assert.equal(err4?.code, '42501');
  });

  it('Check-In Pass Atomic CAS rejects double redemption (anti-replay)', async () => {
    const jHarrisStaff = createMockSupabaseClient({
      user: { id: receptionJohnHarrisUserId, email: 'empfang.johnharris@linz.at', role: 'gym_receptionist' },
    });

    // First redemption: succeeds
    const { data: pass1, error: err1 } = await jHarrisStaff
      .from('check_in_passes')
      .update({ is_redeemed: true, redeemed_at: new Date().toISOString() })
      .eq('id', pass1Id)
      .single();

    assert.equal(err1, null);
    assert.equal(pass1.is_redeemed, true);

    // Second redemption: blocked with anti-replay error
    const { error: err2 } = await jHarrisStaff
      .from('check_in_passes')
      .update({ is_redeemed: true, redeemed_at: new Date().toISOString() })
      .eq('id', pass1Id)
      .single();

    assert.ok(err2);
    assert.match(err2.message, /Pass has already been redeemed/);
  });

  it('Coach Elena cannot forge availability slots for Coach Lukas (INSERT RLS policy)', async () => {
    const elenaClient = createMockSupabaseClient({
      user: { id: coachElenaUserId, email: 'elena@coach.at', role: 'coach' },
    });

    const { error: insErr } = await elenaClient.from('coach_availability').insert({
      coach_id: coachLukasProfileId, // Forging Lukas slot
      gym_id: gymJohnHarrisId,
      day_of_week: 2,
      start_time: '11:00:00',
      end_time: '12:00:00',
    });

    assert.ok(insErr);
    assert.equal(insErr.code, '42501');
  });

  it('Check constraint chk_split_balance rejects mathematical discrepancy in bookings (75.00 != 8.00 + 10.50 + 56.49)', async () => {
    const client1 = createMockSupabaseClient({
      user: { id: client1Id, email: 'max@linz.at', role: 'client' },
    });

    const { error: chkErr } = await client1.from('bookings').insert({
      client_id: client1Id,
      coach_id: coachLukasProfileId,
      gym_id: gymJohnHarrisId,
      session_time: '2026-10-18T10:00:00Z',
      gross_amount: 75.0,
      gym_floor_fee: 8.0,
      platform_fee: 10.5,
      coach_payout: 56.49, // 1 cent discrepancy
      status: 'pending',
    });

    assert.ok(chkErr);
    assert.equal(chkErr.code, '23514');
  });

  it('Security Audit Finding: Mock datastore lacks RLS evaluation on DELETE operations', async () => {
    const anon = createMockSupabaseClient({
      user: { id: '00000000-0000-0000-0000-000000000000', email: 'anon@linz.at', role: 'anon' },
    });

    // In PostgreSQL (20261010000002_rls_policies.sql), bookings has RLS enabled with NO DELETE policy.
    // Therefore in PostgreSQL, anonymous DELETE is strictly blocked by RLS.
    // However, in mock-db.ts, delete() bypasses RlsPolicyEvaluator:
    const { data: deletedBookings, error: delError } = await anon
      .from('bookings')
      .delete()
      .eq('id', booking1Id);

    // Documenting empirical observation:
    // mock-db.ts permits delete without error (delError === null) because mock DB has not implemented validateDelete.
    // In live PostgreSQL, RLS blocks this completely.
    assert.equal(delError, null, 'Mock DB does not enforce validateDelete');
    assert.ok(deletedBookings && deletedBookings.length > 0, 'Mock DB deleted row without RLS check');
  });

  it('Security Audit Finding: Mock datastore lacks UPDATE policy evaluation for coach_availability', async () => {
    const elenaClient = createMockSupabaseClient({
      user: { id: coachElenaUserId, email: 'elena@coach.at', role: 'coach' },
    });

    // In PostgreSQL (20261010000002_rls_policies.sql line 129), policy "Coach manage availability":
    // USING (coach_id = public.get_auth_coach_id()) WITH CHECK (coach_id = public.get_auth_coach_id())
    // Blocks Elena from updating Lukas availability slots.
    // In mock-db.ts / rls-evaluator.ts, validateUpdate has no case for 'coach_availability' (hits default: break):
    const { data: updatedSlots, error: updateError } = await elenaClient
      .from('coach_availability')
      .update({ is_booked: true })
      .eq('coach_id', coachLukasProfileId);

    // Documenting empirical observation:
    // mock-db.ts permits cross-coach availability updates without error.
    assert.equal(updateError, null, 'Mock DB does not enforce coach_availability update policy');
    assert.ok(updatedSlots && updatedSlots.length > 0);
  });
});

