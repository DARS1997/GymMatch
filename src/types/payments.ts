export interface SplitCalculationInput {
  grossAmountCents: number; // e.g. 7500 for €75.00
  gymFloorFeeCents?: number; // default 800 (€8.00)
  platformFeeRateBps?: number; // default 1400 (14.00%)
}

export interface SplitCalculationResult {
  grossAmountCents: number;
  gymFloorFeeCents: number;
  platformFeeCents: number;
  coachPayoutCents: number;
  platformTakeRateBps: number;
  effectiveCoachRatePercent: number;
  formatted: {
    gross: string; // "€75.00"
    gymFloorFee: string; // "€8.00"
    platformFee: string; // "€10.50"
    coachPayout: string; // "€56.50"
  };
}

export type CancellationParty = 'client' | 'coach' | 'gym';

export interface RefundCalculationInput {
  grossAmountCents: number;
  cancelledAtEpochSeconds: number;
  sessionStartEpochSeconds: number;
  cancelledBy: CancellationParty;
  platformTakeRateBps?: number;
  gymFloorFeeCents?: number;
}

export interface RefundCalculationResult {
  clientRefundCents: number;
  gymFloorFeeCents: number;
  platformFeeCents: number;
  coachPayoutCents: number;
  isEarlyCancellation: boolean;
  policyNotes: string;
}

export interface MockPaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';
  transfer_group?: string;
  metadata: Record<string, string>;
  created: number;
}

export interface MockTransfer {
  id: string;
  amount: number;
  currency: string;
  destination: string;
  transfer_group?: string;
  metadata: Record<string, string>;
  created: number;
}

export interface MockRefund {
  id: string;
  payment_intent: string;
  amount: number;
  status: 'succeeded';
  created: number;
}

export interface StripeWebhookEvent<T = any> {
  id: string;
  type: string;
  data: {
    object: T;
  };
  created: number;
}
