import {
  SplitCalculationInput,
  SplitCalculationResult,
  RefundCalculationInput,
  RefundCalculationResult,
} from '@/types/payments';

/**
 * Format integer cents into European Euro display string (e.g. 7500 -> "€75.00")
 */
export function formatCentsToEur(cents: number): string {
  const isNegative = cents < 0;
  const absCents = Math.abs(cents);
  const euros = (absCents / 100).toFixed(2);
  return `${isNegative ? '-' : ''}€${euros}`;
}

/**
 * Convert Euro amount (float or integer) to integer cents without floating-point drift
 */
export function eurToCents(eur: number): number {
  return Math.round(eur * 100);
}

/**
 * Calculate multi-party payment split in exact integer Euro cents.
 *
 * Invariant:
 * grossAmountCents === gymFloorFeeCents + platformFeeCents + coachPayoutCents
 *
 * Baseline:
 * For a €75.00 session (7500 cents), 1400 bps (14%), €8.00 gym floor fee (800 cents):
 * - gymFloorFeeCents = 800 (€8.00)
 * - platformFeeCents = round(7500 * 0.14) = 1050 (€10.50)
 * - coachPayoutCents = 7500 - 800 - 1050 = 5650 (€56.50)
 */
export function calculateSplitPayment(input: SplitCalculationInput): SplitCalculationResult {
  const {
    grossAmountCents,
    gymFloorFeeCents = 800,
    platformFeeRateBps = 1400, // 14.00%
  } = input;

  if (grossAmountCents < 2000) {
    throw new Error(
      `Gross session amount must be at least €20.00 (2000 cents), got ${formatCentsToEur(grossAmountCents)}`
    );
  }

  if (grossAmountCents > 50000) {
    throw new Error(
      `Gross session amount cannot exceed €500.00 (50000 cents), got ${formatCentsToEur(grossAmountCents)}`
    );
  }

  if (gymFloorFeeCents < 0) {
    throw new Error(`Gym floor fee cannot be negative, got ${gymFloorFeeCents} cents`);
  }

  if (platformFeeRateBps < 1000 || platformFeeRateBps > 2000) {
    throw new Error(
      `Platform take rate must be between 10.00% and 20.00% (1000 to 2000 bps), got ${platformFeeRateBps} bps`
    );
  }

  // Calculate platform fee rounded to nearest integer cent
  const platformFeeCents = Math.round((grossAmountCents * platformFeeRateBps) / 10000);

  // Coach payout is the exact residual to guarantee zero rounding drift or unallocated cents
  const coachPayoutCents = grossAmountCents - gymFloorFeeCents - platformFeeCents;

  if (coachPayoutCents <= 0) {
    throw new Error(
      `Fee structure results in non-positive coach payout (${coachPayoutCents} cents) for gross amount ${formatCentsToEur(
        grossAmountCents
      )}`
    );
  }

  // Conservation of currency assertion
  if (grossAmountCents !== gymFloorFeeCents + platformFeeCents + coachPayoutCents) {
    throw new Error(
      `Accounting integrity violation: Gross (${grossAmountCents}) != Floor (${gymFloorFeeCents}) + Platform (${platformFeeCents}) + Coach (${coachPayoutCents})`
    );
  }

  const effectiveCoachRatePercent = Number(
    ((coachPayoutCents / grossAmountCents) * 100).toFixed(2)
  );

  return {
    grossAmountCents,
    gymFloorFeeCents,
    platformFeeCents,
    coachPayoutCents,
    platformTakeRateBps: platformFeeRateBps,
    effectiveCoachRatePercent,
    formatted: {
      gross: formatCentsToEur(grossAmountCents),
      gymFloorFee: formatCentsToEur(gymFloorFeeCents),
      platformFee: formatCentsToEur(platformFeeCents),
      coachPayout: formatCentsToEur(coachPayoutCents),
    },
  };
}

/**
 * Calculate refund amounts and payout disbursements upon booking cancellation.
 *
 * Rules:
 * - Coach or Gym cancellation: 100% refund to client, 0 fees disbursed.
 * - Early Client cancellation (> 24h prior to session): 100% refund to client, 0 fees disbursed.
 * - Late Client cancellation (<= 24h prior to session): 0% refund to client, full floor fee and coach payout disbursed.
 */
export function calculateCancellationRefund(input: RefundCalculationInput): RefundCalculationResult {
  const {
    grossAmountCents,
    cancelledAtEpochSeconds,
    sessionStartEpochSeconds,
    cancelledBy,
    platformTakeRateBps = 1400,
    gymFloorFeeCents = 800,
  } = input;

  const secondsUntilSession = sessionStartEpochSeconds - cancelledAtEpochSeconds;
  const isEarlyClient = secondsUntilSession > 24 * 3600;

  if (cancelledBy === 'coach' || cancelledBy === 'gym') {
    return {
      clientRefundCents: grossAmountCents,
      gymFloorFeeCents: 0,
      platformFeeCents: 0,
      coachPayoutCents: 0,
      isEarlyCancellation: true,
      policyNotes: `Full 100% refund issued due to cancellation by ${cancelledBy}.`,
    };
  }

  // Client cancellation
  if (isEarlyClient) {
    return {
      clientRefundCents: grossAmountCents,
      gymFloorFeeCents: 0,
      platformFeeCents: 0,
      coachPayoutCents: 0,
      isEarlyCancellation: true,
      policyNotes: 'Early client cancellation (> 24h before session): Full 100% refund issued.',
    };
  }

  // Late client cancellation (within 24 hours)
  const split = calculateSplitPayment({
    grossAmountCents,
    gymFloorFeeCents,
    platformFeeRateBps: platformTakeRateBps,
  });

  return {
    clientRefundCents: 0,
    gymFloorFeeCents: split.gymFloorFeeCents,
    platformFeeCents: split.platformFeeCents,
    coachPayoutCents: split.coachPayoutCents,
    isEarlyCancellation: false,
    policyNotes:
      'Late client cancellation (<= 24h before session): 0% refund. Gym floor fee and coach payout are protected.',
  };
}
