import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSplitPayment,
  calculateCancellationRefund,
  formatCentsToEur,
  eurToCents,
} from '../src/lib/payments/split';

describe('Split Payment Mathematics & Precision', () => {
  it('Baseline €75.00 session yields exactly €8.00 floor, €10.50 platform (14%), and €56.50 coach payout', () => {
    const result = calculateSplitPayment({
      grossAmountCents: 7500, // €75.00
      gymFloorFeeCents: 800,  // €8.00
      platformFeeRateBps: 1400, // 14.00%
    });

    assert.equal(result.grossAmountCents, 7500);
    assert.equal(result.gymFloorFeeCents, 800);
    assert.equal(result.platformFeeCents, 1050);
    assert.equal(result.coachPayoutCents, 5650);

    assert.equal(result.formatted.gross, '€75.00');
    assert.equal(result.formatted.gymFloorFee, '€8.00');
    assert.equal(result.formatted.platformFee, '€10.50');
    assert.equal(result.formatted.coachPayout, '€56.50');

    // Fundamental Invariant Check
    assert.equal(
      result.grossAmountCents,
      result.gymFloorFeeCents + result.platformFeeCents + result.coachPayoutCents
    );
  });

  it('Calculates split accurately across diverse Linz coach hourly rates (€60, €90, €120)', () => {
    const testCases = [
      { gross: 6000, expectedGym: 800, expectedPlat: 840, expectedCoach: 4360 },
      { gross: 9000, expectedGym: 800, expectedPlat: 1260, expectedCoach: 6940 },
      { gross: 12000, expectedGym: 800, expectedPlat: 1680, expectedCoach: 9520 },
    ];

    for (const tc of testCases) {
      const res = calculateSplitPayment({
        grossAmountCents: tc.gross,
        gymFloorFeeCents: 800,
        platformFeeRateBps: 1400,
      });

      assert.equal(res.gymFloorFeeCents, tc.expectedGym);
      assert.equal(res.platformFeeCents, tc.expectedPlat);
      assert.equal(res.coachPayoutCents, tc.expectedCoach);
      assert.equal(res.grossAmountCents, tc.expectedGym + tc.expectedPlat + tc.expectedCoach);
    }
  });

  it('Handles odd cents and fractional amounts without rounding drift (€99.99, €77.50)', () => {
    // €99.99 = 9999 cents. 14% of 9999 = 1399.86 -> 1400. Residual: 9999 - 800 - 1400 = 7799
    const oddRes = calculateSplitPayment({
      grossAmountCents: 9999,
      gymFloorFeeCents: 800,
      platformFeeRateBps: 1400,
    });
    assert.equal(oddRes.platformFeeCents, 1400);
    assert.equal(oddRes.coachPayoutCents, 7799);
    assert.equal(oddRes.grossAmountCents, 800 + 1400 + 7799);

    // €77.50 = 7750 cents. 14% of 7750 = 1085. Residual: 7750 - 800 - 1085 = 5865
    const fracRes = calculateSplitPayment({
      grossAmountCents: 7750,
      gymFloorFeeCents: 800,
      platformFeeRateBps: 1400,
    });
    assert.equal(fracRes.platformFeeCents, 1085);
    assert.equal(fracRes.coachPayoutCents, 5865);
    assert.equal(fracRes.grossAmountCents, 800 + 1085 + 5865);
  });

  it('Rejects amounts below minimum threshold or invalid take rates', () => {
    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 1500 }); // €15.00 < €20.00
    }, /Gross session amount must be at least €20.00/);

    assert.throws(() => {
      calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 500 }); // 5% < 10%
    }, /Platform take rate must be between 10.00% and 20.00%/);
  });

  it('Calculates cancellation refunds accurately based on 24-hour window', () => {
    const sessionStart = 1792060000;

    // 1. Early client cancellation (30 hours before)
    const earlyCancel = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - 30 * 3600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(earlyCancel.clientRefundCents, 7500);
    assert.equal(earlyCancel.gymFloorFeeCents, 0);
    assert.equal(earlyCancel.coachPayoutCents, 0);
    assert.equal(earlyCancel.isEarlyCancellation, true);

    // 2. Late client cancellation (2 hours before) -> Gym and coach are protected
    const lateCancel = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - 2 * 3600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'client',
    });
    assert.equal(lateCancel.clientRefundCents, 0);
    assert.equal(lateCancel.gymFloorFeeCents, 800);
    assert.equal(lateCancel.coachPayoutCents, 5650);
    assert.equal(lateCancel.platformFeeCents, 1050);
    assert.equal(lateCancel.isEarlyCancellation, false);

    // 3. Coach cancellation at any time -> 100% refund to client
    const coachCancel = calculateCancellationRefund({
      grossAmountCents: 7500,
      cancelledAtEpochSeconds: sessionStart - 1 * 3600,
      sessionStartEpochSeconds: sessionStart,
      cancelledBy: 'coach',
    });
    assert.equal(coachCancel.clientRefundCents, 7500);
    assert.equal(coachCancel.coachPayoutCents, 0);
    assert.equal(coachCancel.gymFloorFeeCents, 0);
  });
});
