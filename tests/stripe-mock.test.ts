import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockStripeService } from '../src/lib/payments/stripe-mock';

describe('Stripe Connect Mock Multi-Party Payment Engine', () => {
  let stripe: MockStripeService;

  beforeEach(() => {
    stripe = new MockStripeService();
  });

  const bookingId = '66666666-6666-6666-6666-000000000001';
  const coachStripeAccount = 'acct_coach_lukas_bauer';
  const gymStripeAccount = 'acct_linz_johnharris_atrium';

  it('Captures Gross Booking Value in escrow via PaymentIntent with transfer_group', async () => {
    const pi = await stripe.paymentIntents.create({
      amount: 7500, // €75.00
      currency: 'eur',
      transfer_group: `booking_${bookingId}`,
      metadata: {
        booking_id: bookingId,
        gym_floor_fee_cents: '800',
        platform_fee_cents: '1050',
        coach_payout_cents: '5650',
      },
    });

    assert.equal(pi.amount, 7500);
    assert.equal(pi.status, 'requires_confirmation');
    assert.equal(pi.transfer_group, `booking_${bookingId}`);

    // Confirm PaymentIntent -> captures funds in platform escrow
    const confirmedPi = await stripe.paymentIntents.confirm(pi.id);
    assert.equal(confirmedPi.status, 'succeeded');

    const escrow = stripe.getEscrowHold(bookingId);
    assert.equal(escrow.isEscrowHeld, true);
    assert.equal(escrow.isFullyDisbursed, false);
  });

  it('Disburses Separate Transfers to Coach (€56.50) and Gym (€8.00) after completion', async () => {
    const pi = await stripe.paymentIntents.create({
      amount: 7500,
      currency: 'eur',
      transfer_group: `booking_${bookingId}`,
    });
    await stripe.paymentIntents.confirm(pi.id);

    // 1. Disburse Gym Floor Fee (€8.00)
    const gymTransfer = await stripe.transfers.create({
      amount: 800,
      currency: 'eur',
      destination: gymStripeAccount,
      transfer_group: `booking_${bookingId}`,
      metadata: { type: 'gym_floor_fee', booking_id: bookingId },
    });
    assert.equal(gymTransfer.amount, 800);
    assert.equal(gymTransfer.destination, gymStripeAccount);

    // 2. Disburse Coach Payout (€56.50)
    const coachTransfer = await stripe.transfers.create({
      amount: 5650,
      currency: 'eur',
      destination: coachStripeAccount,
      transfer_group: `booking_${bookingId}`,
      metadata: { type: 'coach_payout', booking_id: bookingId },
    });
    assert.equal(coachTransfer.amount, 5650);
    assert.equal(coachTransfer.destination, coachStripeAccount);

    // Verify transfers associated with transfer_group
    const transfers = await stripe.transfers.list({
      transfer_group: `booking_${bookingId}`,
    });
    assert.equal(transfers.length, 2);

    const escrow = stripe.getEscrowHold(bookingId);
    assert.equal(escrow.isFullyDisbursed, true);
  });

  it('Processes full 100% client refund upon early cancellation', async () => {
    const pi = await stripe.paymentIntents.create({
      amount: 7500,
      currency: 'eur',
      transfer_group: `booking_${bookingId}`,
    });
    await stripe.paymentIntents.confirm(pi.id);

    const refund = await stripe.refunds.create({
      payment_intent: pi.id,
      amount: 7500,
      reason: 'requested_by_customer',
    });

    assert.equal(refund.status, 'succeeded');
    assert.equal(refund.amount, 7500);

    const retrievedPi = await stripe.paymentIntents.retrieve(pi.id);
    assert.equal(retrievedPi.status, 'canceled');
  });

  it('Supports idempotency keys preventing duplicate transfers or refunds', async () => {
    const idempKey = 'transfer_gym_test_unique_key';
    const tr1 = await stripe.transfers.create(
      {
        amount: 800,
        currency: 'eur',
        destination: gymStripeAccount,
      },
      { idempotencyKey: idempKey }
    );

    const tr2 = await stripe.transfers.create(
      {
        amount: 800,
        currency: 'eur',
        destination: gymStripeAccount,
      },
      { idempotencyKey: idempKey }
    );

    assert.equal(tr1.id, tr2.id); // Same transfer returned
  });
});
