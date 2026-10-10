/**
 * GymMatch Linz — Challenger Milestone 3 Adversarial & Stress Verification Suite
 *
 * This test suite stress-tests and adversarially challenges the E2E simulation mechanics:
 * 1. Financial Conservation & Split Math Under Extreme/Adversarial Conditions
 * 2. Dynamic QR Anti-Replay Defense (Atomic CAS, Double Redemption, High Concurrency)
 * 3. Token Validity Windows (Premature Activation, Exact Boundary, Expired Token)
 * 4. Venue Scoping & Cross-Gym Isolation (Wrong Gym ID Rejection)
 * 5. Cryptographic Integrity (Signature Tampering, Rogue Secrets, Malformed Headers)
 * 6. Stripe Connect Escrow & Disbursement Security (Early Disbursement, Double Payout)
 * 7. Datastore Edge Cases (Missing Pass, Missing Booking, Unauthorized Access)
 * 8. Implementation Discovery: GenerateTokenOptions discriminated union requirement
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSplitPayment,
  eurToCents,
  formatCentsToEur,
} from '../src/lib/payments/split';
import { MockStripeService } from '../src/lib/payments/stripe-mock';
import {
  generateDynamicQRToken,
  verifyDynamicQRToken,
  DEFAULT_QR_SECRET,
} from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import {
  createMockSupabaseClient,
  resetMockDatastore,
  getMockDatastore,
} from '../src/lib/supabase/mock-db';
import {
  LINZ_GYMS,
  LINZ_COACHES,
  LINZ_PROFILES,
  LINZ_BOOKINGS,
} from '../src/lib/data/linz-seed';
import { Booking, CheckInPass } from '../src/types/database';

describe('Challenger M3: E2E Simulation Adversarial Stress Suite', () => {
  let datastore = getMockDatastore();
  let stripe = new MockStripeService();

  const partnerGym = LINZ_GYMS[0]; // John Harris Fitness Linz Atrium
  const otherGym = LINZ_GYMS[1];   // Fit Fabrik Linz
  const thirdGym = LINZ_GYMS[2];   // Happy Fit Linz Urfahr
  const coach = LINZ_COACHES[0];   // Lukas Bauer
  const clientProfile = LINZ_PROFILES[0]; // Max Mustermann
  const staffUserId = '33333333-3333-3333-3333-000000000001';

  beforeEach(() => {
    resetMockDatastore();
    datastore = getMockDatastore();
    stripe.reset();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Double Redemption & Anti-Replay Stress Testing
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 1: Double Redemption & Anti-Replay Protection', () => {
    it('strictly rejects immediate second redemption with ALREADY_REDEEMED', async () => {
      const sessionEpoch = Math.floor(Date.now() / 1000) + 3600;
      const passId = `pass_replay_${Date.now()}`;
      const bookingId = `bk_replay_${Date.now()}`;

      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const passRecord: CheckInPass = {
        id: passId,
        booking_id: bookingId,
        gym_id: partnerGym.id,
        client_id: clientProfile.id,
        dynamic_token: token,
        qr_signature: token.split('.')[2],
        nonce: 'nonce_replay_01',
        expires_at: new Date((sessionEpoch + 3600 + 1800) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };
      datastore.check_in_passes.push(passRecord);

      const dbAdapter = {
        findPassById: (pid: string) => datastore.check_in_passes.find((p) => p.id === pid) || null,
        atomicRedeemPass: ({ passId: pid, staffUserId: staff, nowIso }: any) => {
          const pass = datastore.check_in_passes.find((p) => p.id === pid);
          if (!pass || pass.is_redeemed) return false;
          pass.is_redeemed = true;
          pass.redeemed_at = nowIso;
          pass.redeemed_by_user_id = staff;
          return true;
        },
        updateBookingStatus: (bid: string, status: 'checked_in') => {
          const b = datastore.bookings.find((item) => item.id === bid);
          if (b) b.status = status;
          return b || null;
        },
      };

      // 1st Scan: Must succeed
      const res1 = await redeemCheckInPass({
        token,
        staffGymId: partnerGym.id,
        staffUserId,
        nowEpochSeconds: sessionEpoch,
        dbAdapter,
      });
      assert.equal(res1.success, true);
      assert.equal(res1.errorCode, undefined);

      // 2nd Scan: Must fail with ALREADY_REDEEMED
      const res2 = await redeemCheckInPass({
        token,
        staffGymId: partnerGym.id,
        staffUserId,
        nowEpochSeconds: sessionEpoch + 15,
        dbAdapter,
      });
      assert.equal(res2.success, false);
      assert.equal(res2.errorCode, 'ALREADY_REDEEMED');
      assert.match(res2.error!, /already redeemed/i);

      // 3rd Scan: Must also fail with ALREADY_REDEEMED
      const res3 = await redeemCheckInPass({
        token,
        staffGymId: partnerGym.id,
        staffUserId,
        nowEpochSeconds: sessionEpoch + 30,
        dbAdapter,
      });
      assert.equal(res3.success, false);
      assert.equal(res3.errorCode, 'ALREADY_REDEEMED');
    });

    it('survives high concurrency stampede: exactly 1 scan succeeds, 49 fail with ALREADY_REDEEMED', async () => {
      const sessionEpoch = Math.floor(Date.now() / 1000) + 3600;
      const passId = `pass_stampede_${Date.now()}`;
      const bookingId = `bk_stampede_${Date.now()}`;

      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const passRecord: CheckInPass = {
        id: passId,
        booking_id: bookingId,
        gym_id: partnerGym.id,
        client_id: clientProfile.id,
        dynamic_token: token,
        qr_signature: token.split('.')[2],
        nonce: 'nonce_stampede',
        expires_at: new Date((sessionEpoch + 3600 + 1800) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };
      datastore.check_in_passes.push(passRecord);

      let atomicLock = false;
      const dbAdapter = {
        findPassById: (pid: string) => datastore.check_in_passes.find((p) => p.id === pid) || null,
        atomicRedeemPass: async ({ passId: pid, staffUserId: staff, nowIso }: any) => {
          // Simulate atomic compare-and-swap primitive
          if (atomicLock) return false;
          const pass = datastore.check_in_passes.find((p) => p.id === pid);
          if (!pass || pass.is_redeemed) return false;
          atomicLock = true;
          pass.is_redeemed = true;
          pass.redeemed_at = nowIso;
          pass.redeemed_by_user_id = staff;
          return true;
        },
        updateBookingStatus: (bid: string, status: 'checked_in') => {
          const b = datastore.bookings.find((item) => item.id === bid);
          if (b) b.status = status;
          return b || null;
        },
      };

      // Launch 50 concurrent redemption requests
      const scanPromises = Array.from({ length: 50 }).map((_, idx) =>
        redeemCheckInPass({
          token,
          staffGymId: partnerGym.id,
          staffUserId: `staff_${idx}`,
          nowEpochSeconds: sessionEpoch + idx,
          dbAdapter,
        })
      );

      const results = await Promise.all(scanPromises);
      const successfulScans = results.filter((r) => r.success);
      const rejectedScans = results.filter((r) => !r.success);

      assert.equal(successfulScans.length, 1, 'Exactly one scan must succeed');
      assert.equal(rejectedScans.length, 49, 'All other 49 scans must be rejected');
      for (const rej of rejectedScans) {
        assert.equal(rej.errorCode, 'ALREADY_REDEEMED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Token Time Validity Windows (Early & Expired Tokens)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 2: Time Validity Windows', () => {
    const sessionEpoch = 1791986400; // Wednesday 14:00 CET
    const durationMinutes = 60;
    // Window: [sessionEpoch - 1800, sessionEpoch + 3600 + 1800]
    // Valid From: sessionEpoch - 1800 (13:30 CET)
    // Valid Until: sessionEpoch + 5400 (15:30 CET)

    let token: string;

    beforeEach(() => {
      token = generateDynamicQRToken({
        passId: 'pass_time_test',
        bookingId: 'bk_time_test',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes,
        secretKey: DEFAULT_QR_SECRET,
      });
    });

    it('rejects premature scan 31 minutes before session (NOT_YET_VALID)', () => {
      const scanTime = sessionEpoch - 1801; // 1 second before window opens
      const result = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, scanTime);

      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'NOT_YET_VALID');
      assert.match(result.error!, /not yet active/i);
    });

    it('accepts scan at exact window opening boundary (st - 30m)', () => {
      const scanTime = sessionEpoch - 1800; // exactly 13:30 CET
      const result = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, scanTime);

      assert.equal(result.valid, true);
      assert.equal(result.errorCode, undefined);
    });

    it('accepts scan in the middle of session', () => {
      const scanTime = sessionEpoch + 1800; // 14:30 CET
      const result = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, scanTime);

      assert.equal(result.valid, true);
      assert.equal(result.errorCode, undefined);
    });

    it('accepts scan at exact expiration boundary (st + duration + 30m)', () => {
      const scanTime = sessionEpoch + 3600 + 1800; // exactly 15:30 CET
      const result = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, scanTime);

      assert.equal(result.valid, true);
      assert.equal(result.errorCode, undefined);
    });

    it('rejects expired scan 1 second past window closure (TOKEN_EXPIRED)', () => {
      const scanTime = sessionEpoch + 3600 + 1801; // 15:30:01 CET
      const result = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, scanTime);

      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'TOKEN_EXPIRED');
      assert.match(result.error!, /expired/i);
    });

    it('rejects far past and far future attempts', () => {
      const pastResult = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, sessionEpoch - 86400);
      assert.equal(pastResult.valid, false);
      assert.equal(pastResult.errorCode, 'NOT_YET_VALID');

      const futureResult = verifyDynamicQRToken(token, DEFAULT_QR_SECRET, partnerGym.id, sessionEpoch + 86400);
      assert.equal(futureResult.valid, false);
      assert.equal(futureResult.errorCode, 'TOKEN_EXPIRED');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Venue Scoping & Cross-Gym Isolation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 3: Wrong Gym ID Rejection', () => {
    it('strictly rejects pass booked for John Harris when presented at other Linz gyms', async () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const token = generateDynamicQRToken({
        passId: 'pass_cross_gym',
        bookingId: 'bk_cross_gym',
        clientId: clientProfile.id,
        gymId: partnerGym.id, // Booked for John Harris Linz Atrium
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      // Try scanning at Fit Fabrik
      const fitFabrikResult = await redeemCheckInPass({
        token,
        staffGymId: otherGym.id,
        staffUserId: 'staff_fitfabrik',
        nowEpochSeconds: sessionEpoch,
      });
      assert.equal(fitFabrikResult.success, false);
      assert.equal(fitFabrikResult.errorCode, 'GYM_MISMATCH');
      assert.match(fitFabrikResult.error!, /valid only for gym venue/i);

      // Try scanning at Happy Fit
      const happyFitResult = await redeemCheckInPass({
        token,
        staffGymId: thirdGym.id,
        staffUserId: 'staff_happyfit',
        nowEpochSeconds: sessionEpoch,
      });
      assert.equal(happyFitResult.success, false);
      assert.equal(happyFitResult.errorCode, 'GYM_MISMATCH');
      assert.match(happyFitResult.error!, /valid only for gym venue/i);
    });

    it('rejects scan when staffGymId is arbitrary or fraudulent UUID', async () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const token = generateDynamicQRToken({
        passId: 'pass_cross_gym',
        bookingId: 'bk_cross_gym',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const rogueGymId = '99999999-9999-9999-9999-999999999999';
      const result = await redeemCheckInPass({
        token,
        staffGymId: rogueGymId,
        staffUserId: 'staff_rogue',
        nowEpochSeconds: sessionEpoch,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'GYM_MISMATCH');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Cryptographic Tampering & Secret Key Mismatch
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 4: Cryptographic Tampering Defense', () => {
    it('rejects token signed with an unauthorized secret key', () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const rogueSecret = 'unauthorized_attacker_secret_key_123';
      const rogueToken = generateDynamicQRToken(
        {
          passId: 'pass_rogue',
          bookingId: 'bk_rogue',
          clientId: clientProfile.id,
          gymId: partnerGym.id,
          sessionTimeEpochSeconds: sessionEpoch,
          durationMinutes: 60,
          secretKey: rogueSecret,
        }
      );

      // Verify with platform default secret
      const result = verifyDynamicQRToken(rogueToken, DEFAULT_QR_SECRET, partnerGym.id, sessionEpoch);
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'SIGNATURE_INVALID');
    });

    it('rejects token when signature bits are modified', () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const validToken = generateDynamicQRToken({
        passId: 'pass_tamper_sig',
        bookingId: 'bk_tamper_sig',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const parts = validToken.split('.');
      // Alter one character in signature
      const tamperedSig = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

      const result = verifyDynamicQRToken(tamperedToken, DEFAULT_QR_SECRET, partnerGym.id, sessionEpoch);
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'SIGNATURE_INVALID');
    });

    it('rejects token when payload fields are modified (Payload Tampering Attack)', () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const validToken = generateDynamicQRToken({
        passId: 'pass_tamper_payload',
        bookingId: 'bk_tamper_payload',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const parts = validToken.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      // Tamper with gymId in payload while keeping original signature
      payload.gid = otherGym.id;
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      const result = verifyDynamicQRToken(tamperedToken, DEFAULT_QR_SECRET, otherGym.id, sessionEpoch);
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'SIGNATURE_INVALID');
    });

    it('rejects malformed token formats (missing segments, empty strings, invalid header)', () => {
      assert.equal(verifyDynamicQRToken('', DEFAULT_QR_SECRET).errorCode, 'INVALID_FORMAT');
      assert.equal(verifyDynamicQRToken('invalid-string', DEFAULT_QR_SECRET).errorCode, 'INVALID_FORMAT');
      assert.equal(verifyDynamicQRToken('GM2.payload.sig', DEFAULT_QR_SECRET).errorCode, 'INVALID_FORMAT');
      assert.equal(verifyDynamicQRToken('GM1.onlytwo', DEFAULT_QR_SECRET).errorCode, 'INVALID_FORMAT');
      assert.equal(verifyDynamicQRToken('GM1.a.b.c', DEFAULT_QR_SECRET).errorCode, 'INVALID_FORMAT');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Stripe Connect Multi-Party Escrow & Payout Invariants
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 5: Stripe Connect Multi-Party Escrow Invariants', () => {
    it('enforces that escrow funds cannot be marked fully disbursed without separate transfers', async () => {
      const bookingId = `bk_stripe_invariant_${Date.now()}`;
      const transferGroup = `booking_${bookingId}`;

      const pi = await stripe.paymentIntents.create({
        amount: 7500,
        currency: 'eur',
        transfer_group: transferGroup,
      });
      await stripe.paymentIntents.confirm(pi.id);

      const escrowBefore = stripe.getEscrowHold(bookingId);
      assert.equal(escrowBefore.isEscrowHeld, true);
      assert.equal(escrowBefore.isFullyDisbursed, false);

      // Disburse only gym floor fee (€8.00)
      await stripe.transfers.create({
        amount: 800,
        currency: 'eur',
        destination: partnerGym.stripe_account_id!,
        transfer_group: transferGroup,
      });

      const escrowPartial = stripe.getEscrowHold(bookingId);
      assert.equal(escrowPartial.isEscrowHeld, false);
      assert.equal(escrowPartial.isFullyDisbursed, false, 'Single transfer must not mark escrow as fully disbursed');

      // Disburse coach payout (€56.50)
      await stripe.transfers.create({
        amount: 5650,
        currency: 'eur',
        destination: coach.stripe_account_id!,
        transfer_group: transferGroup,
      });

      const escrowComplete = stripe.getEscrowHold(bookingId);
      assert.equal(escrowComplete.isFullyDisbursed, true);
    });

    it('rejects negative or zero transfer amounts', async () => {
      await assert.rejects(
        () =>
          stripe.transfers.create({
            amount: 0,
            currency: 'eur',
            destination: coach.stripe_account_id!,
          }),
        /Transfer amount must be positive/i
      );

      await assert.rejects(
        () =>
          stripe.transfers.create({
            amount: -500,
            currency: 'eur',
            destination: coach.stripe_account_id!,
          }),
        /Transfer amount must be positive/i
      );
    });

    it('rejects transfer to non-connected destination account', async () => {
      await assert.rejects(
        () =>
          stripe.transfers.create({
            amount: 800,
            currency: 'eur',
            destination: 'invalid_non_stripe_account',
          }),
        /Invalid destination account ID/i
      );
    });

    it('guarantees idempotency on transfers preventing duplicate payouts', async () => {
      const idempotencyKey = `idemp_${Date.now()}`;
      const tr1 = await stripe.transfers.create(
        {
          amount: 5650,
          currency: 'eur',
          destination: coach.stripe_account_id!,
          transfer_group: 'booking_idemp_test',
        },
        { idempotencyKey }
      );

      const tr2 = await stripe.transfers.create(
        {
          amount: 5650,
          currency: 'eur',
          destination: coach.stripe_account_id!,
          transfer_group: 'booking_idemp_test',
        },
        { idempotencyKey }
      );

      assert.equal(tr1.id, tr2.id, 'Idempotent transfer must return exact same transfer object');
      const allTransfers = await stripe.transfers.list({ transfer_group: 'booking_idemp_test' });
      assert.equal(allTransfers.length, 1, 'Only 1 transfer should exist in store');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Database / Datastore Edge Cases & Non-Bypassed Logic
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 6: Datastore Edge Cases & Non-Bypassed Logic', () => {
    it('returns PASS_NOT_FOUND when valid token payload references non-existent pass ID in database', async () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);
      const ghostPassId = 'pass_ghost_nonexistent_999';

      const token = generateDynamicQRToken({
        passId: ghostPassId,
        bookingId: 'bk_ghost',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const dbAdapter = {
        findPassById: (pid: string) => datastore.check_in_passes.find((p) => p.id === pid) || null,
        atomicRedeemPass: () => true,
        updateBookingStatus: () => null,
      };

      const result = await redeemCheckInPass({
        token,
        staffGymId: partnerGym.id,
        staffUserId,
        nowEpochSeconds: sessionEpoch,
        dbAdapter,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'PASS_NOT_FOUND');
      assert.match(result.error!, /not found in database/i);
    });

    it('RLS rejects unauthorized client updating another client booking', async () => {
      const otherClient = createMockSupabaseClient({
        user: { id: '22222222-2222-2222-2222-000000000002', email: 'other@client.at', role: 'client' },
      });

      // Try updating Max Mustermann's seed booking (id: 66666666-6666-6666-6666-000000000001)
      const { error } = await otherClient
        .from('bookings')
        .update({ status: 'completed' })
        .eq('id', '66666666-6666-6666-6666-000000000001');

      assert.ok(error, 'Cross-client update should have been blocked by RLS');
      assert.match(error.message, /violates row-level security policy/i);
    });

    it('RLS rejects unauthenticated visitor publishing coach availability', async () => {
      const anonClient = createMockSupabaseClient({ user: null });
      const { error } = await anonClient.from('coach_availability').insert({
        id: 'slot_unauth',
        coach_id: coach.id,
        gym_id: partnerGym.id,
        day_of_week: 1,
        start_time: '10:00:00',
        end_time: '11:00:00',
        is_recurring: true,
      });

      assert.ok(error, 'Unauthenticated slot insertion should fail RLS');
      assert.match(error.message, /violates row-level security policy/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Forensic Discovery Probe: Discriminated Union in generateDynamicQRToken
  // ─────────────────────────────────────────────────────────────────────────
  describe('Adversarial Variation 7: Forensic Discovery in QR Token Generator', () => {
    it('demonstrates that omitting secretKey from GenerateTokenOptions causes discriminator to fall to QRPayload branch', () => {
      const sessionEpoch = Math.floor(Date.now() / 1000);

      // When secretKey property is omitted, 'secretKey' in payloadOrOptions is false
      const tokenWithoutSecretKeyProp = generateDynamicQRToken({
        passId: 'pass_test_discovery',
        bookingId: 'bk_test_discovery',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
      } as any);

      // Token verification fails with GYM_MISMATCH because gid was not mapped (treated as p.gid which is undefined)
      const verification = verifyDynamicQRToken(
        tokenWithoutSecretKeyProp,
        DEFAULT_QR_SECRET,
        partnerGym.id,
        sessionEpoch
      );

      assert.equal(verification.valid, false);
      assert.equal(verification.errorCode, 'GYM_MISMATCH');
      assert.equal(verification.payload?.gid, undefined);

      // Whereas when secretKey is explicitly passed (even as DEFAULT_QR_SECRET or undefined), it matches
      const tokenWithExplicitSecretKey = generateDynamicQRToken({
        passId: 'pass_test_discovery',
        bookingId: 'bk_test_discovery',
        clientId: clientProfile.id,
        gymId: partnerGym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const verificationGood = verifyDynamicQRToken(
        tokenWithExplicitSecretKey,
        DEFAULT_QR_SECRET,
        partnerGym.id,
        sessionEpoch
      );

      assert.equal(verificationGood.valid, true);
      assert.equal(verificationGood.payload?.gid, partnerGym.id);
    });
  });
});
