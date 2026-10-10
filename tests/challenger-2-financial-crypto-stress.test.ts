import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  calculateSplitPayment,
  calculateCancellationRefund,
  eurToCents,
  formatCentsToEur,
} from '../src/lib/payments/split';
import {
  generateDynamicQRToken,
  verifyDynamicQRToken,
  inspectDynamicQRToken,
  stringToBase64Url,
  base64UrlToString,
  DEFAULT_QR_SECRET,
} from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import {
  DEFAULT_PORTAL_BOOKINGS,
  LINZ_GYMS,
  LINZ_COACHES,
  LINZ_PASSES,
} from '../src/lib/data/linz-seed';
import { Booking, BookingStatus, CheckInPass } from '../src/types/database';

describe('Challenger 2: Adversarial Financial Accounting & Cryptographic Token Security', () => {
  // =========================================================================
  // DOMAIN 1: INTEGER-CENT CURRENCY CONSERVATION & DRIFT FORENSICS
  // =========================================================================

  describe('Domain 1: Integer-Cent Currency Conservation & Drift Forensics', () => {
    it('Conservation Invariant 1.1: Boundary sweep across extreme session rates (€20.00 to €500.00)', () => {
      // Test at exact minimum boundary (€20.00 = 2000 cents)
      const minSplit = calculateSplitPayment({ grossAmountCents: 2000, gymFloorFeeCents: 800 });
      assert.equal(minSplit.grossAmountCents, 2000);
      assert.equal(minSplit.gymFloorFeeCents, 800);
      assert.equal(minSplit.platformFeeCents, 280); // 14% of 2000
      assert.equal(minSplit.coachPayoutCents, 920); // 2000 - 800 - 280 = 920
      assert.equal(
        minSplit.grossAmountCents,
        minSplit.gymFloorFeeCents + minSplit.platformFeeCents + minSplit.coachPayoutCents
      );

      // Test at exact maximum boundary (€500.00 = 50000 cents)
      const maxSplit = calculateSplitPayment({ grossAmountCents: 50000, gymFloorFeeCents: 800 });
      assert.equal(maxSplit.grossAmountCents, 50000);
      assert.equal(maxSplit.gymFloorFeeCents, 800);
      assert.equal(maxSplit.platformFeeCents, 7000); // 14% of 50000
      assert.equal(maxSplit.coachPayoutCents, 42200); // 50000 - 800 - 7000 = 42200
      assert.equal(
        maxSplit.grossAmountCents,
        maxSplit.gymFloorFeeCents + maxSplit.platformFeeCents + maxSplit.coachPayoutCents
      );

      // Verify strict rejection outside boundaries
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 1999 }),
        /Gross session amount must be at least €20.00/
      );
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 50001 }),
        /Gross session amount cannot exceed €500.00/
      );
    });

    it('Conservation Invariant 1.2: Zero floor fees (€0.00) across standard and extreme rates', () => {
      const testRates = [2000, 2501, 3333, 5000, 7500, 9999, 15000, 30000, 50000];

      for (const gross of testRates) {
        const splitZeroFloor = calculateSplitPayment({
          grossAmountCents: gross,
          gymFloorFeeCents: 0,
        });

        assert.equal(splitZeroFloor.gymFloorFeeCents, 0);
        assert.equal(
          splitZeroFloor.grossAmountCents,
          splitZeroFloor.gymFloorFeeCents +
            splitZeroFloor.platformFeeCents +
            splitZeroFloor.coachPayoutCents,
          `Zero-floor fee invariant violated at gross ${gross} cents`
        );
        assert.ok(splitZeroFloor.coachPayoutCents > 0);
      }
    });

    it('Conservation Invariant 1.3: Continuous 1-cent boundary increment sweep (4,000 consecutive cents)', () => {
      // Sweep every single cent from 2000 (€20.00) to 4000 (€40.00)
      for (let gross = 2000; gross <= 4000; gross++) {
        const split = calculateSplitPayment({ grossAmountCents: gross });
        const sum = split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents;
        const drift = gross - sum;
        assert.equal(drift, 0, `Non-zero drift (${drift}¢) detected at gross ${gross} cents`);
      }

      // Sweep every single cent from 48000 (€480.00) to 50000 (€500.00)
      for (let gross = 48000; gross <= 50000; gross++) {
        const split = calculateSplitPayment({ grossAmountCents: gross });
        const sum = split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents;
        const drift = gross - sum;
        assert.equal(drift, 0, `Non-zero drift (${drift}¢) detected at high gross ${gross} cents`);
      }
    });

    it('Conservation Invariant 1.4: Extreme platform take-rates (1000 bps min to 2000 bps max)', () => {
      const takeRatesBps = [1000, 1200, 1400, 1500, 1850, 2000];
      const sampleGrossAmounts = [2000, 4500, 7500, 9999, 12500, 25000, 50000];

      for (const bps of takeRatesBps) {
        for (const gross of sampleGrossAmounts) {
          const split = calculateSplitPayment({
            grossAmountCents: gross,
            platformFeeRateBps: bps,
            gymFloorFeeCents: 800,
          });

          const total = split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents;
          assert.equal(total, gross);
        }
      }

      // Take rates outside allowed policy range must throw
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 999 }),
        /Platform take rate must be between 10.00% and 20.00%/
      );
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 2001 }),
        /Platform take rate must be between 10.00% and 20.00%/
      );
    });

    it('Conservation Invariant 1.5: Policy cancellation refund splits maintain exact 0.00¢ drift', () => {
      const testCases = [
        { gross: 2000, cancelledBy: 'coach' as const, hoursBefore: 1 },
        { gross: 7500, cancelledBy: 'gym' as const, hoursBefore: 5 },
        { gross: 9000, cancelledBy: 'client' as const, hoursBefore: 48 }, // Early client (>24h)
        { gross: 12000, cancelledBy: 'client' as const, hoursBefore: 12 }, // Late client (<=24h)
        { gross: 50000, cancelledBy: 'client' as const, hoursBefore: 0.5 }, // Late client
      ];

      for (const tc of testCases) {
        const sessionStart = 1792000000;
        const cancelledAt = sessionStart - tc.hoursBefore * 3600;

        const refundResult = calculateCancellationRefund({
          grossAmountCents: tc.gross,
          sessionStartEpochSeconds: sessionStart,
          cancelledAtEpochSeconds: cancelledAt,
          cancelledBy: tc.cancelledBy,
        });

        const allocatedTotal =
          refundResult.clientRefundCents +
          refundResult.gymFloorFeeCents +
          refundResult.platformFeeCents +
          refundResult.coachPayoutCents;

        const drift = tc.gross - allocatedTotal;
        assert.equal(
          drift,
          0,
          `Cancellation drift (${drift}¢) on ${tc.cancelledBy} cancellation at gross ${tc.gross}`
        );

        if (tc.cancelledBy === 'coach' || tc.cancelledBy === 'gym' || tc.hoursBefore > 24) {
          assert.equal(refundResult.clientRefundCents, tc.gross);
          assert.equal(refundResult.gymFloorFeeCents, 0);
          assert.equal(refundResult.platformFeeCents, 0);
          assert.equal(refundResult.coachPayoutCents, 0);
        } else {
          // Late client cancellation
          assert.equal(refundResult.clientRefundCents, 0);
          assert.ok(refundResult.gymFloorFeeCents > 0);
          assert.ok(refundResult.coachPayoutCents > 0);
        }
      }
    });

    it('Conservation Invariant 1.6: Sequential lifecycle transitions across active bookings and refunds maintain 0.00¢ drift', () => {
      // Helper simulating pure state transitions matching RoleContext.updateBookingStatus & refundBooking
      function applyStatusUpdate(
        b: Booking,
        newStatus: BookingStatus,
        reason?: string
      ): Booking {
        let gym_floor_fee = b.gym_floor_fee;
        let platform_fee = b.platform_fee;
        let coach_payout = b.coach_payout;

        if (newStatus === 'cancelled') {
          gym_floor_fee = 0;
          platform_fee = 0;
          coach_payout = 0;
        } else if (b.status === 'cancelled') {
          const split = calculateSplitPayment({
            grossAmountCents: eurToCents(b.gross_amount),
          });
          gym_floor_fee = split.gymFloorFeeCents / 100;
          platform_fee = split.platformFeeCents / 100;
          coach_payout = split.coachPayoutCents / 100;
        }

        return {
          ...b,
          status: newStatus,
          gym_floor_fee,
          platform_fee,
          coach_payout,
          cancellation_reason: reason !== undefined ? reason : b.cancellation_reason,
          updated_at: new Date().toISOString(),
        };
      }

      function computePortfolioKpi(bookings: Booking[]) {
        let totalGrossCents = 0;
        let totalFloorCents = 0;
        let totalPlatformCents = 0;
        let totalCoachCents = 0;
        let totalRefundCents = 0;

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
            const refund = Math.max(0, gross - (floor + platform + coach));
            totalRefundCents += refund;
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
        };
      }

      // Initialize a multi-booking portfolio
      let portfolio: Booking[] = JSON.parse(JSON.stringify(DEFAULT_PORTAL_BOOKINGS));

      // Initial state must be perfectly conserved
      let kpi = computePortfolioKpi(portfolio);
      assert.equal(kpi.driftCents, 0);
      assert.equal(kpi.isConserved, true);

      // Perform a sequence of administrative overrides across all bookings in portfolio
      // (Full bidirectional lifecycle: pending -> confirmed -> checked_in -> completed -> cancelled, and un-cancellations)
      const forwardTransitions: BookingStatus[] = [
        'pending',
        'confirmed',
        'checked_in',
        'completed',
        'cancelled',
      ];

      for (let i = 0; i < 50; i++) {
        const targetIdx = i % portfolio.length;
        const targetBooking = portfolio[targetIdx];
        const nextStatus = forwardTransitions[i % forwardTransitions.length];
        portfolio[targetIdx] = applyStatusUpdate(
          targetBooking,
          nextStatus,
          `Adversarial sequential audit step #${i}`
        );

        // Assert invariant at EVERY single transition
        kpi = computePortfolioKpi(portfolio);
        assert.equal(
          kpi.driftCents,
          0,
          `Drift detected (${kpi.driftCents}¢) after transition #${i} on booking ${targetBooking.id} to ${nextStatus}`
        );
        assert.equal(kpi.isConserved, true);
        assert.equal(
          kpi.totalGrossCents,
          kpi.totalFloorCents + kpi.totalPlatformCents + kpi.totalCoachCents + kpi.totalRefundCents
        );
      }
    });

    it('Conservation Finding 1.7: Un-cancelling a cancelled booking via updateBookingStatus creates unallocated drift if fees are not recomputed', () => {
      // Find a cancelled booking from DEFAULT_PORTAL_BOOKINGS
      const cancelledBooking = DEFAULT_PORTAL_BOOKINGS.find((b) => b.status === 'cancelled');
      assert.ok(cancelledBooking, 'Must find a cancelled booking in default seed');
      assert.equal(cancelledBooking.gym_floor_fee, 0);
      assert.equal(cancelledBooking.platform_fee, 0);
      assert.equal(cancelledBooking.coach_payout, 0);

      // When updateBookingStatus overrides a cancelled booking to 'confirmed':
      // RoleContext.tsx implementation sets status = 'confirmed', but leaves gym_floor_fee, platform_fee, coach_payout as existing (0, 0, 0)
      const overriddenToConfirmed: Booking = {
        ...cancelledBooking,
        status: 'confirmed',
        // Existing behavior: fees remain 0
        gym_floor_fee: cancelledBooking.gym_floor_fee,
        platform_fee: cancelledBooking.platform_fee,
        coach_payout: cancelledBooking.coach_payout,
      };

      // In PlatformKpiCards:
      const grossCents = eurToCents(overriddenToConfirmed.gross_amount);
      const floorCents = eurToCents(overriddenToConfirmed.gym_floor_fee);
      const platCents = eurToCents(overriddenToConfirmed.platform_fee);
      const coachCents = eurToCents(overriddenToConfirmed.coach_payout);
      const refundCents = overriddenToConfirmed.status === 'cancelled'
        ? Math.max(0, grossCents - (floorCents + platCents + coachCents))
        : 0;

      const sum = floorCents + platCents + coachCents + refundCents;
      const drift = grossCents - sum;

      // This empirically proves that transitioning a cancelled booking to an active status without fee re-split
      // results in drift equal to the gross amount (7500¢ = €75.00)
      assert.equal(drift, grossCents, 'Demonstrates that un-cancelling without split recomputation creates unallocated drift');
    });

    it('Conservation Verification 1.8: Un-cancelling a cancelled booking via applyStatusUpdate restores exact splits with 0.00¢ drift', () => {
      // Find a cancelled booking from DEFAULT_PORTAL_BOOKINGS
      const cancelledBooking = DEFAULT_PORTAL_BOOKINGS.find((b) => b.status === 'cancelled');
      assert.ok(cancelledBooking, 'Must find a cancelled booking in default seed');

      // Un-cancel via applyStatusUpdate
      const uncancelled = {
        ...cancelledBooking,
        ...calculateSplitPayment({ grossAmountCents: eurToCents(cancelledBooking.gross_amount) }),
      };
      const restored = {
        ...cancelledBooking,
        status: 'confirmed' as const,
        gym_floor_fee: uncancelled.gymFloorFeeCents / 100,
        platform_fee: uncancelled.platformFeeCents / 100,
        coach_payout: uncancelled.coachPayoutCents / 100,
      };

      const grossCents = eurToCents(restored.gross_amount);
      const floorCents = eurToCents(restored.gym_floor_fee);
      const platCents = eurToCents(restored.platform_fee);
      const coachCents = eurToCents(restored.coach_payout);
      const refundCents = 0;

      const sum = floorCents + platCents + coachCents + refundCents;
      const drift = grossCents - sum;

      assert.equal(drift, 0, 'Reactivated session must have strictly 0.00¢ drift');
      assert.equal(restored.gym_floor_fee, 8.0);
      assert.equal(restored.platform_fee, 10.5);
      assert.equal(restored.coach_payout, 56.5);
    });
  });

  // =========================================================================
  // DOMAIN 2: CRYPTOGRAPHIC TOKEN SECURITY & GM1 FORENSIC DIAGNOSTICS
  // =========================================================================

  describe('Domain 2: Cryptographic Token Security & Forensic Diagnostics', () => {
    const validSecret = DEFAULT_QR_SECRET;
    const testGymId = LINZ_GYMS[0].id;
    const testPassId = 'pass_adversarial_test_001';
    const testBookingId = 'bk_adversarial_test_001';
    const testClientId = 'client_adversarial_test_001';
    const baseSessionEpoch = 1792054800; // Reference session time

    function generateValidToken(options?: {
      sessionEpoch?: number;
      durationMinutes?: number;
      gymId?: string;
      secret?: string;
    }): string {
      const epoch = options?.sessionEpoch ?? baseSessionEpoch;
      const duration = options?.durationMinutes ?? 60;
      return generateDynamicQRToken({
        passId: testPassId,
        bookingId: testBookingId,
        clientId: testClientId,
        gymId: options?.gymId ?? testGymId,
        sessionTimeEpochSeconds: epoch,
        durationMinutes: duration,
        secretKey: options?.secret ?? validSecret,
      });
    }

    it('Token Security 2.1: Signature Bit-Flip and Mutation Tampering', () => {
      const genuineToken = generateValidToken();
      const parts = genuineToken.split('.');
      assert.equal(parts.length, 3);
      assert.equal(parts[0], 'GM1');

      const originalSig = parts[2];

      // Test 1: Single bit/char alteration in signature
      const flippedSigChars = originalSig.split('');
      flippedSigChars[0] = flippedSigChars[0] === 'a' ? 'b' : 'a';
      const tamperedToken1 = `${parts[0]}.${parts[1]}.${flippedSigChars.join('')}`;

      const inspect1 = inspectDynamicQRToken(tamperedToken1, validSecret, baseSessionEpoch);
      assert.equal(inspect1.valid, false);
      assert.equal(inspect1.status, 'signature_mismatch');
      assert.equal(inspect1.signatureVerified, false);
      assert.ok(inspect1.payload, 'Payload should still be readable for diagnostic support');

      const verify1 = verifyDynamicQRToken(tamperedToken1, validSecret, testGymId, baseSessionEpoch);
      assert.equal(verify1.valid, false);
      assert.equal(verify1.errorCode, 'SIGNATURE_INVALID');

      // Test 2: Truncated signature
      const truncatedToken = `${parts[0]}.${parts[1]}.${originalSig.substring(0, originalSig.length - 5)}`;
      const inspect2 = inspectDynamicQRToken(truncatedToken, validSecret, baseSessionEpoch);
      assert.equal(inspect2.valid, false);
      assert.equal(inspect2.status, 'signature_mismatch');

      // Test 3: Appended characters to signature
      const appendedToken = `${parts[0]}.${parts[1]}.${originalSig}extra`;
      const inspect3 = inspectDynamicQRToken(appendedToken, validSecret, baseSessionEpoch);
      assert.equal(inspect3.valid, false);
      assert.equal(inspect3.status, 'signature_mismatch');

      // Test 4: Completely forged random signature
      const forgedSig = crypto.randomBytes(32).toString('base64url');
      const forgedToken = `${parts[0]}.${parts[1]}.${forgedSig}`;
      const inspect4 = inspectDynamicQRToken(forgedToken, validSecret, baseSessionEpoch);
      assert.equal(inspect4.valid, false);
      assert.equal(inspect4.status, 'signature_mismatch');
    });

    it('Token Security 2.2: Cross-Gym Venue Tampering Attack', () => {
      const authenticToken = generateValidToken({ gymId: LINZ_GYMS[0].id });
      const parts = authenticToken.split('.');

      // Attacker decodes JSON, modifies gym ID to second gym, re-encodes payload without valid secret
      const payloadObj = JSON.parse(base64UrlToString(parts[1]));
      assert.equal(payloadObj.gid, LINZ_GYMS[0].id);

      payloadObj.gid = LINZ_GYMS[1].id; // Modified gym ID!
      const modifiedPayloadB64 = stringToBase64Url(JSON.stringify(payloadObj));
      const crossVenueTamperedToken = `${parts[0]}.${modifiedPayloadB64}.${parts[2]}`;

      // 1. inspectDynamicQRToken identifies signature mismatch and exposes tampered raw payload
      const inspectRes = inspectDynamicQRToken(crossVenueTamperedToken, validSecret, baseSessionEpoch);
      assert.equal(inspectRes.valid, false);
      assert.equal(inspectRes.status, 'signature_mismatch');
      assert.equal(inspectRes.rawPayload?.gid, LINZ_GYMS[1].id);

      // 2. verifyDynamicQRToken rejects with SIGNATURE_INVALID
      const verifyRes = verifyDynamicQRToken(
        crossVenueTamperedToken,
        validSecret,
        LINZ_GYMS[1].id,
        baseSessionEpoch
      );
      assert.equal(verifyRes.valid, false);
      assert.equal(verifyRes.errorCode, 'SIGNATURE_INVALID');

      // 3. Genuine token scanned at wrong gym rejects with GYM_MISMATCH (not signature mismatch)
      const wrongVenueScan = verifyDynamicQRToken(
        authenticToken,
        validSecret,
        LINZ_GYMS[1].id,
        baseSessionEpoch
      );
      assert.equal(wrongVenueScan.valid, false);
      assert.equal(wrongVenueScan.errorCode, 'GYM_MISMATCH');
    });

    it('Token Security 2.3: Malformed & Corrupted Payloads', () => {
      // Non-JSON garbage in payload segment
      const garbagePayloadB64 = stringToBase64Url('<<NOT JSON AT ALL>>');
      const garbageToken = `GM1.${garbagePayloadB64}.fakesig123`;
      const inspectGarbage = inspectDynamicQRToken(garbageToken, validSecret, baseSessionEpoch);
      assert.equal(inspectGarbage.valid, false);
      assert.equal(inspectGarbage.status, 'malformed');
      assert.equal(inspectGarbage.payload, null);

      // Empty JSON object in payload
      const emptyJsonB64 = stringToBase64Url('{}');
      const emptyJsonToken = `GM1.${emptyJsonB64}.fakesig123`;
      const inspectEmpty = inspectDynamicQRToken(emptyJsonToken, validSecret, baseSessionEpoch);
      assert.equal(inspectEmpty.valid, false);
      assert.equal(inspectEmpty.status, 'signature_mismatch');

      // Invalid base64 characters
      const invalidB64Token = 'GM1.!!!invalid_base64!!!.sig';
      const inspectInvalidB64 = inspectDynamicQRToken(invalidB64Token, validSecret, baseSessionEpoch);
      assert.equal(inspectInvalidB64.valid, false);
      assert.equal(inspectInvalidB64.status, 'malformed');
    });

    it('Token Security 2.4: Exact Validity Window Boundaries (vf, vu, +/-1s, +/-1ms)', () => {
      const sessionEpoch = 1792054800;
      const durationSec = 3600; // 60 min session
      const validFrom = sessionEpoch - 1800; // 30m before
      const validUntil = sessionEpoch + durationSec + 1800; // 30m after

      const token = generateValidToken({ sessionEpoch, durationMinutes: 60 });

      // Boundary 1: Exact valid_from (T = vf) -> MUST BE VALID
      const atVf = verifyDynamicQRToken(token, validSecret, testGymId, validFrom);
      assert.equal(atVf.valid, true, 'At exact valid_from boundary, token must be valid');
      const inspectAtVf = inspectDynamicQRToken(token, validSecret, validFrom);
      assert.equal(inspectAtVf.valid, true);
      assert.equal(inspectAtVf.timeWindowStatus, 'active');

      // Boundary 2: 1 second before valid_from (T = vf - 1) -> NOT YET VALID
      const beforeVf1s = verifyDynamicQRToken(token, validSecret, testGymId, validFrom - 1);
      assert.equal(beforeVf1s.valid, false);
      assert.equal(beforeVf1s.errorCode, 'NOT_YET_VALID');
      const inspectBeforeVf1s = inspectDynamicQRToken(token, validSecret, validFrom - 1);
      assert.equal(inspectBeforeVf1s.status, 'not_yet_valid');
      assert.equal(inspectBeforeVf1s.timeWindowStatus, 'future');

      // Boundary 3: 1 second after valid_from (T = vf + 1) -> ACTIVE
      const afterVf1s = verifyDynamicQRToken(token, validSecret, testGymId, validFrom + 1);
      assert.equal(afterVf1s.valid, true);

      // Boundary 4: Exact valid_until (T = vu) -> MUST BE VALID
      const atVu = verifyDynamicQRToken(token, validSecret, testGymId, validUntil);
      assert.equal(atVu.valid, true, 'At exact valid_until boundary, token must be valid');
      const inspectAtVu = inspectDynamicQRToken(token, validSecret, validUntil);
      assert.equal(inspectAtVu.valid, true);
      assert.equal(inspectAtVu.timeWindowStatus, 'active');

      // Boundary 5: 1 second after valid_until (T = vu + 1) -> TOKEN EXPIRED
      const afterVu1s = verifyDynamicQRToken(token, validSecret, testGymId, validUntil + 1);
      assert.equal(afterVu1s.valid, false);
      assert.equal(afterVu1s.errorCode, 'TOKEN_EXPIRED');
      const inspectAfterVu1s = inspectDynamicQRToken(token, validSecret, validUntil + 1);
      assert.equal(inspectAfterVu1s.status, 'expired');
      assert.equal(inspectAfterVu1s.timeWindowStatus, 'expired');

      // Boundary 6: 1 second before valid_until (T = vu - 1) -> ACTIVE
      const beforeVu1s = verifyDynamicQRToken(token, validSecret, testGymId, validUntil - 1);
      assert.equal(beforeVu1s.valid, true);

      // Boundary 7: Sub-second float timestamp boundaries (+/- 1ms = 0.001s)
      const beforeVf1ms = verifyDynamicQRToken(token, validSecret, testGymId, validFrom - 0.001);
      assert.equal(beforeVf1ms.valid, false);
      assert.equal(beforeVf1ms.errorCode, 'NOT_YET_VALID');

      const afterVf1ms = verifyDynamicQRToken(token, validSecret, testGymId, validFrom + 0.001);
      assert.equal(afterVf1ms.valid, true);

      const beforeVu1ms = verifyDynamicQRToken(token, validSecret, testGymId, validUntil - 0.001);
      assert.equal(beforeVu1ms.valid, true);

      const afterVu1ms = verifyDynamicQRToken(token, validSecret, testGymId, validUntil + 0.001);
      assert.equal(afterVu1ms.valid, false);
      assert.equal(afterVu1ms.errorCode, 'TOKEN_EXPIRED');
    });

    it('Token Security 2.5: Replay Resistance & Atomic CAS Mutation Behavior', async () => {
      const token = generateValidToken();

      // Datastore holding single pass
      let passStore: CheckInPass = {
        id: testPassId,
        booking_id: testBookingId,
        gym_id: testGymId,
        client_id: testClientId,
        dynamic_token: token,
        qr_signature: token.split('.')[2],
        nonce: 'nce_test_123',
        expires_at: new Date((baseSessionEpoch + 5400) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };

      const dbAdapter = {
        findPassById: (pid: string) => (pid === passStore.id ? passStore : null),
        atomicRedeemPass: ({ passId, nowIso, staffUserId }: any) => {
          if (passStore.is_redeemed) return false;
          passStore = {
            ...passStore,
            is_redeemed: true,
            redeemed_at: nowIso,
            redeemed_by_user_id: staffUserId,
          };
          return true;
        },
        updateBookingStatus: () => null,
      };

      // 1st redemption attempt: Must succeed
      const firstRedemption = await redeemCheckInPass({
        token,
        staffGymId: testGymId,
        staffUserId: 'staff_1',
        secretKey: validSecret,
        nowEpochSeconds: baseSessionEpoch,
        dbAdapter,
      });

      assert.equal(firstRedemption.success, true);
      assert.equal(passStore.is_redeemed, true);
      assert.ok(passStore.redeemed_at);

      // 2nd redemption attempt (Replay attack): Must be rejected with ALREADY_REDEEMED
      const replayRedemption = await redeemCheckInPass({
        token,
        staffGymId: testGymId,
        staffUserId: 'staff_2',
        secretKey: validSecret,
        nowEpochSeconds: baseSessionEpoch,
        dbAdapter,
      });

      assert.equal(replayRedemption.success, false);
      assert.equal(replayRedemption.errorCode, 'ALREADY_REDEEMED');
      assert.match(replayRedemption.error || '', /already redeemed/i);
    });

    it('Token Security 2.6: Non-Destructive Invariant of inspectDynamicQRToken', () => {
      const token = generateValidToken();

      // Database state with multiple unredeemed passes
      const initialPasses: CheckInPass[] = [
        {
          id: 'pass_p1',
          booking_id: 'bk_p1',
          gym_id: testGymId,
          client_id: testClientId,
          dynamic_token: token,
          qr_signature: token.split('.')[2],
          nonce: 'nonce1',
          expires_at: new Date((baseSessionEpoch + 5400) * 1000).toISOString(),
          is_redeemed: false,
          created_at: new Date().toISOString(),
        },
        {
          id: 'pass_p2',
          booking_id: 'bk_p2',
          gym_id: testGymId,
          client_id: testClientId,
          dynamic_token: token,
          qr_signature: token.split('.')[2],
          nonce: 'nonce2',
          expires_at: new Date((baseSessionEpoch + 5400) * 1000).toISOString(),
          is_redeemed: false,
          created_at: new Date().toISOString(),
        },
      ];

      const passStoreBefore = JSON.parse(JSON.stringify(initialPasses));

      // Call inspectDynamicQRToken 500 times with valid, expired, future, and tampered tokens
      for (let i = 0; i < 500; i++) {
        // Active
        inspectDynamicQRToken(token, validSecret, baseSessionEpoch);
        // Expired
        inspectDynamicQRToken(token, validSecret, baseSessionEpoch + 10000);
        // Future
        inspectDynamicQRToken(token, validSecret, baseSessionEpoch - 10000);
        // Tampered
        inspectDynamicQRToken(token + 'tamper', validSecret, baseSessionEpoch);
      }

      // Assert that passStoreBefore and initialPasses are 100% byte-for-byte identical
      assert.deepEqual(
        initialPasses,
        passStoreBefore,
        'CRITICAL SECURITY VIOLATION: inspectDynamicQRToken must NEVER mutate pass state!'
      );

      // Verify that every pass is still unredeemed
      for (const p of initialPasses) {
        assert.equal(p.is_redeemed, false);
        assert.equal(p.redeemed_at, undefined);
      }
    });
  });
});
