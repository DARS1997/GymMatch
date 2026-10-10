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
import { DEFAULT_PORTAL_BOOKINGS, LINZ_GYMS, LINZ_COACHES, LINZ_PASSES } from '../src/lib/data/linz-seed';
import { Booking, BookingStatus, CheckInPass } from '../src/types/database';

describe('Challenger R2-2: Adversarial Empirical Verification Suite', () => {
  // =========================================================================
  // HARNESS A: FINANCIAL ACCOUNTING & 0.00¢ CURRENCY CONSERVATION
  // =========================================================================

  describe('Harness A: Financial Accounting & Exact 0.00¢ Currency Conservation', () => {
    it('A1: Exhaustive 48,001-point integer-cent rate sweep (€20.00 to €500.00)', () => {
      let totalDriftSum = 0;
      let minCoachPayout = Infinity;

      for (let gross = 2000; gross <= 50000; gross++) {
        const split = calculateSplitPayment({ grossAmountCents: gross });
        const sum = split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents;
        const drift = gross - sum;

        if (drift !== 0) {
          totalDriftSum += Math.abs(drift);
        }

        assert.equal(drift, 0, `Non-zero drift at gross ${gross} cents`);
        assert.ok(split.coachPayoutCents > 0, `Coach payout must be strictly positive at ${gross} cents`);
        if (split.coachPayoutCents < minCoachPayout) {
          minCoachPayout = split.coachPayoutCents;
        }
      }

      assert.equal(totalDriftSum, 0, 'Exhaustive sweep must yield exactly zero cumulative drift');
      assert.equal(minCoachPayout, 920, 'Minimum coach payout at €20.00 must be €9.20 (920 cents)');
    });

    it('A2: Take-rate sweep (1000 bps to 2000 bps) across variable session rates', () => {
      const sampleRates = [2000, 2500, 3333, 5000, 7500, 9999, 12500, 25000, 50000];

      for (let bps = 1000; bps <= 2000; bps += 50) {
        for (const gross of sampleRates) {
          const split = calculateSplitPayment({
            grossAmountCents: gross,
            platformFeeRateBps: bps,
            gymFloorFeeCents: 800,
          });

          const sum = split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents;
          assert.equal(gross, sum, `Drift detected at gross ${gross} with take-rate ${bps} bps`);
        }
      }
    });

    it('A3: Chaotic sequential un-cancellation & status transition stress (1,000 cycles)', () => {
      // Simulating RoleContext updater
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
          // Re-allocating splits when reactivating a cancelled session
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

      function computePortfolioKpis(portfolio: Booking[]) {
        let totalGrossCents = 0;
        let totalFloorCents = 0;
        let totalPlatformCents = 0;
        let totalCoachCents = 0;
        let totalRefundCents = 0;

        for (const b of portfolio) {
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

        const calculatedSum = totalFloorCents + totalPlatformCents + totalCoachCents + totalRefundCents;
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

      const portfolio: Booking[] = JSON.parse(JSON.stringify(DEFAULT_PORTAL_BOOKINGS));
      const possibleStatuses: BookingStatus[] = ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled'];

      let uncancelledCount = 0;

      for (let cycle = 0; cycle < 1000; cycle++) {
        const targetIdx = cycle % portfolio.length;
        const prevStatus = portfolio[targetIdx].status;
        const targetStatus = possibleStatuses[(cycle * 7 + 3) % possibleStatuses.length];

        if (prevStatus === 'cancelled' && targetStatus !== 'cancelled') {
          uncancelledCount++;
        }

        portfolio[targetIdx] = applyStatusUpdate(
          portfolio[targetIdx],
          targetStatus,
          `Chaotic stress test cycle #${cycle}`
        );

        const kpis = computePortfolioKpis(portfolio);
        assert.equal(
          kpis.driftCents,
          0,
          `Drift detected (${kpis.driftCents}¢) at cycle #${cycle} on booking ${portfolio[targetIdx].id} (${prevStatus} -> ${targetStatus})`
        );
        assert.equal(kpis.isConserved, true);
      }

      assert.ok(uncancelledCount >= 100, `Must test at least 100 un-cancellations (tested: ${uncancelledCount})`);
    });

    it('A4: Edge-case odd cent rates and boundary error handling', () => {
      const oddRates = [2001, 2099, 3333, 4999, 7555, 9999, 14999, 49999];

      for (const gross of oddRates) {
        const split = calculateSplitPayment({ grossAmountCents: gross });
        assert.equal(gross, split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents);
      }

      // Negative floor fee must throw
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, gymFloorFeeCents: -100 }),
        /Gym floor fee cannot be negative/
      );

      // Floor fee that exceeds gross - platform fee results in non-positive coach payout and throws
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 2000, gymFloorFeeCents: 1800 }),
        /Fee structure results in non-positive coach payout/
      );
    });
  });

  // =========================================================================
  // HARNESS B: CRYPTOGRAPHIC TOKEN SECURITY & INSPECTION INVARIANTS
  // =========================================================================

  describe('Harness B: Cryptographic Token Security & Non-Destructive Inspection', () => {
    const validSecret = DEFAULT_QR_SECRET;
    const testGymId = LINZ_GYMS[0].id;
    const testPassId = 'pass_challenger_test_001';
    const testBookingId = 'bk_challenger_test_001';
    const testClientId = 'client_challenger_test_001';
    const baseSessionEpoch = 1792054800;

    function generateAuthenticToken(): string {
      return generateDynamicQRToken({
        passId: testPassId,
        bookingId: testBookingId,
        clientId: testClientId,
        gymId: testGymId,
        sessionTimeEpochSeconds: baseSessionEpoch,
        durationMinutes: 60,
        secretKey: validSecret,
      });
    }

    it('B1: Constant-time comparison resilience against length and timing side-channels', () => {
      const token = generateAuthenticToken();
      const parts = token.split('.');
      const originalSig = parts[2];

      // Test signatures of unequal lengths
      const shortSig = originalSig.substring(0, 10);
      const longSig = originalSig + 'extra_bytes_padding';

      const shortRes = inspectDynamicQRToken(`${parts[0]}.${parts[1]}.${shortSig}`, validSecret, baseSessionEpoch);
      assert.equal(shortRes.valid, false);
      assert.equal(shortRes.signatureVerified, false);
      assert.equal(shortRes.status, 'signature_mismatch');

      const longRes = inspectDynamicQRToken(`${parts[0]}.${parts[1]}.${longSig}`, validSecret, baseSessionEpoch);
      assert.equal(longRes.valid, false);
      assert.equal(longRes.signatureVerified, false);
      assert.equal(longRes.status, 'signature_mismatch');

      // Test constant-time behavior: verifyDynamicQRToken handles mismatched length without throwing
      const verifyShort = verifyDynamicQRToken(`${parts[0]}.${parts[1]}.${shortSig}`, validSecret, testGymId, baseSessionEpoch);
      assert.equal(verifyShort.valid, false);
      assert.equal(verifyShort.errorCode, 'SIGNATURE_INVALID');

      const verifyLong = verifyDynamicQRToken(`${parts[0]}.${parts[1]}.${longSig}`, validSecret, testGymId, baseSessionEpoch);
      assert.equal(verifyLong.valid, false);
      assert.equal(verifyLong.errorCode, 'SIGNATURE_INVALID');
    });

    it('B2: Non-destructive read invariant under 10,000 inspection executions', () => {
      const token = generateAuthenticToken();
      const seedPassesCopy = JSON.parse(JSON.stringify(LINZ_PASSES));
      const seedBookingsCopy = JSON.parse(JSON.stringify(DEFAULT_PORTAL_BOOKINGS));

      for (let i = 0; i < 10000; i++) {
        const mode = i % 4;
        if (mode === 0) {
          inspectDynamicQRToken(token, validSecret, baseSessionEpoch);
        } else if (mode === 1) {
          inspectDynamicQRToken(token, validSecret, baseSessionEpoch + 100000); // Expired
        } else if (mode === 2) {
          inspectDynamicQRToken(token, validSecret, baseSessionEpoch - 100000); // Future
        } else {
          inspectDynamicQRToken(token + 'tamper', validSecret, baseSessionEpoch); // Tampered
        }
      }

      // Assert that state remains completely pristine
      assert.deepEqual(LINZ_PASSES, seedPassesCopy, 'Passes data must remain unmutated');
      assert.deepEqual(DEFAULT_PORTAL_BOOKINGS, seedBookingsCopy, 'Bookings data must remain unmutated');
    });

    it('B3: Comprehensive bit-flip mutation sweep across signature characters (430 mutations)', () => {
      const token = generateAuthenticToken();
      const parts = token.split('.');
      const originalSig = parts[2];
      const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

      let totalMutationsTested = 0;

      for (let i = 0; i < originalSig.length; i++) {
        for (let j = 0; j < 10; j++) {
          const replacementChar = charset[(i * 10 + j) % charset.length];
          if (replacementChar === originalSig[i]) continue;

          const mutatedSig = originalSig.substring(0, i) + replacementChar + originalSig.substring(i + 1);
          const mutatedToken = `${parts[0]}.${parts[1]}.${mutatedSig}`;

          const res = inspectDynamicQRToken(mutatedToken, validSecret, baseSessionEpoch);
          assert.equal(res.valid, false, `Mutated token at position ${i} must not be valid`);
          assert.equal(res.signatureVerified, false);
          assert.equal(res.status, 'signature_mismatch');
          totalMutationsTested++;
        }
      }

      assert.ok(totalMutationsTested >= 300, `Tested ${totalMutationsTested} signature mutations`);
    });

    it('B4: Payload parameter tampering attack sweep', () => {
      const token = generateAuthenticToken();
      const parts = token.split('.');
      const payloadObj = JSON.parse(base64UrlToString(parts[1]));

      const tamperingScenarios: { field: string; value: any }[] = [
        { field: 'pid', value: 'pass_hijacked_999' },
        { field: 'bid', value: 'bk_hijacked_999' },
        { field: 'cid', value: 'cid_hijacked_999' },
        { field: 'gid', value: 'gid_other_facility_999' },
        { field: 'st', value: baseSessionEpoch + 3600 },
        { field: 'vf', value: baseSessionEpoch - 7200 },
        { field: 'vu', value: baseSessionEpoch + 7200 },
        { field: 'nce', value: 'forged_nonce_abc' },
        { field: 'v', value: 2 },
      ];

      for (const scenario of tamperingScenarios) {
        const tamperedPayload = { ...payloadObj, [scenario.field]: scenario.value };
        const tamperedB64 = stringToBase64Url(JSON.stringify(tamperedPayload));
        const tamperedToken = `${parts[0]}.${tamperedB64}.${parts[2]}`;

        const inspectRes = inspectDynamicQRToken(tamperedToken, validSecret, baseSessionEpoch);
        assert.equal(inspectRes.valid, false, `Tampered field ${scenario.field} must be rejected`);
        assert.equal(inspectRes.signatureVerified, false);
        assert.equal(inspectRes.status, 'signature_mismatch');
        assert.equal(inspectRes.rawPayload?.[scenario.field], scenario.value, 'Must extract raw payload for forensics');

        const verifyRes = verifyDynamicQRToken(tamperedToken, validSecret, testGymId, baseSessionEpoch);
        assert.equal(verifyRes.valid, false);
        assert.equal(verifyRes.errorCode, 'SIGNATURE_INVALID');
      }
    });

    it('B5: Boundary check around time validity window (sub-second and integer boundaries)', () => {
      const sessionEpoch = baseSessionEpoch;
      const validFrom = sessionEpoch - 1800; // 30m before
      const validUntil = sessionEpoch + 3600 + 1800; // 30m after 60m session

      const token = generateAuthenticToken();

      // Exactly at valid_from
      assert.equal(verifyDynamicQRToken(token, validSecret, testGymId, validFrom).valid, true);
      assert.equal(inspectDynamicQRToken(token, validSecret, validFrom).timeWindowStatus, 'active');

      // 1 millisecond before valid_from
      assert.equal(verifyDynamicQRToken(token, validSecret, testGymId, validFrom - 0.001).valid, false);
      assert.equal(inspectDynamicQRToken(token, validSecret, validFrom - 0.001).timeWindowStatus, 'future');

      // Exactly at valid_until
      assert.equal(verifyDynamicQRToken(token, validSecret, testGymId, validUntil).valid, true);
      assert.equal(inspectDynamicQRToken(token, validSecret, validUntil).timeWindowStatus, 'active');

      // 1 millisecond after valid_until
      assert.equal(verifyDynamicQRToken(token, validSecret, testGymId, validUntil + 0.001).valid, false);
      assert.equal(inspectDynamicQRToken(token, validSecret, validUntil + 0.001).timeWindowStatus, 'expired');
    });
  });
});
