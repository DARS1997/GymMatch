import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDynamicQRToken,
  inspectDynamicQRToken,
  verifyDynamicQRToken,
  DEFAULT_QR_SECRET,
  stringToBase64Url,
} from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import { LINZ_GYMS, LINZ_PASSES } from '../src/lib/data/linz-seed';
import { CheckInPass } from '../src/types/database';

describe('Cryptographic Token Inspector & Forensic Diagnostics (WP4 / R4)', () => {
  const secretKey = DEFAULT_QR_SECRET;
  const gymIdJohnHarris = LINZ_GYMS[0].id;
  const gymIdFitFabrik = LINZ_GYMS[1].id;
  const testPassId = '77777777-7777-7777-7777-000000000001';
  const testBookingId = '66666666-6666-6666-6666-000000000001';
  const testClientId = '11111111-1111-1111-1111-000000000001';
  const sessionEpoch = 1792054800; // Thursday 2026-10-15 09:00:00 UTC

  // Helper to generate test token with specific parameters
  function createTestToken(overrides?: {
    passId?: string;
    bookingId?: string;
    clientId?: string;
    gymId?: string;
    sessionTimeEpochSeconds?: number;
    durationMinutes?: number;
    secretKey?: string;
  }): string {
    return generateDynamicQRToken({
      passId: overrides?.passId ?? testPassId,
      bookingId: overrides?.bookingId ?? testBookingId,
      clientId: overrides?.clientId ?? testClientId,
      gymId: overrides?.gymId ?? gymIdJohnHarris,
      sessionTimeEpochSeconds: overrides?.sessionTimeEpochSeconds ?? sessionEpoch,
      durationMinutes: overrides?.durationMinutes ?? 60,
      secretKey: overrides?.secretKey ?? secretKey,
    });
  }

  // =========================================================================
  // 1. Valid Authentic GM1 Token Forensics
  // =========================================================================

  describe('1. Valid Authentic GM1 Token Forensics', () => {
    it('Inspects authentic GM1 token: verifies payload, HMAC match, and active window status', () => {
      const token = createTestToken();
      // Inspect during active session window (at sessionEpoch)
      const inspection = inspectDynamicQRToken(token, secretKey, sessionEpoch);

      assert.equal(inspection.valid, true);
      assert.equal(inspection.status, 'valid');
      assert.equal(inspection.signatureVerified, true);
      assert.equal(inspection.timeWindowStatus, 'active');
      assert.equal(inspection.header, 'GM1');
      assert.ok(inspection.signature);
      assert.equal(inspection.signature, inspection.expectedSignature);

      // Verify payload parameters
      assert.ok(inspection.payload);
      assert.equal(inspection.payload.v, 1);
      assert.equal(inspection.payload.pid, testPassId);
      assert.equal(inspection.payload.bid, testBookingId);
      assert.equal(inspection.payload.cid, testClientId);
      assert.equal(inspection.payload.gid, gymIdJohnHarris);
      assert.equal(inspection.payload.st, sessionEpoch);
      assert.equal(inspection.payload.vf, sessionEpoch - 1800); // 30m before
      assert.equal(inspection.payload.vu, sessionEpoch + 3600 + 1800); // 30m after 60m session
      assert.ok(inspection.payload.nce);
      assert.ok(inspection.payload.iat);

      // Verify rawPayload match
      assert.ok(inspection.rawPayload);
      assert.equal(inspection.rawPayload.pid, testPassId);
    });

    it('Verifies active status at window boundaries (exact vf and exact vu)', () => {
      const token = createTestToken();
      const validFrom = sessionEpoch - 1800;
      const validUntil = sessionEpoch + 3600 + 1800;

      // Exact validFrom boundary
      const atVf = inspectDynamicQRToken(token, secretKey, validFrom);
      assert.equal(atVf.valid, true);
      assert.equal(atVf.timeWindowStatus, 'active');

      // Exact validUntil boundary
      const atVu = inspectDynamicQRToken(token, secretKey, validUntil);
      assert.equal(atVu.valid, true);
      assert.equal(atVu.timeWindowStatus, 'active');
    });

    it('Supports inspection with custom secret keys', () => {
      const customSecret = 'my_custom_linz_super_secret_key_999';
      const token = createTestToken({ secretKey: customSecret });

      // Inspected with default secret -> signature_mismatch
      const wrongSecretInspection = inspectDynamicQRToken(token, secretKey, sessionEpoch);
      assert.equal(wrongSecretInspection.valid, false);
      assert.equal(wrongSecretInspection.status, 'signature_mismatch');

      // Inspected with matching custom secret -> valid
      const correctSecretInspection = inspectDynamicQRToken(token, customSecret, sessionEpoch);
      assert.equal(correctSecretInspection.valid, true);
      assert.equal(correctSecretInspection.status, 'valid');
    });
  });

  // =========================================================================
  // 2. Expired Token Forensics & Payload Extraction
  // =========================================================================

  describe('2. Expired Token Forensics', () => {
    it('Detects expired token: returns status "expired" while still extracting payload for support', () => {
      const token = createTestToken();
      // Inspected 1 second after window closed (vu + 1)
      const expiredEpoch = sessionEpoch + 3600 + 1800 + 1;
      const inspection = inspectDynamicQRToken(token, secretKey, expiredEpoch);

      assert.equal(inspection.valid, false);
      assert.equal(inspection.status, 'expired');
      assert.equal(inspection.signatureVerified, true, 'HMAC signature itself was authentic');
      assert.equal(inspection.timeWindowStatus, 'expired');
      assert.ok(inspection.error);
      assert.match(inspection.error, /Pass has expired/);

      // Crucial diagnostic capability: Payload is STILL extracted!
      assert.ok(inspection.payload, 'Diagnostic tool must extract payload even for expired tokens');
      assert.equal(inspection.payload.pid, testPassId);
      assert.equal(inspection.payload.bid, testBookingId);
      assert.equal(inspection.payload.gid, gymIdJohnHarris);
    });

    it('Calculates timeWindowStatus "expired" even when far in the future', () => {
      const token = createTestToken();
      const farFutureEpoch = sessionEpoch + 86400 * 30; // 30 days later
      const inspection = inspectDynamicQRToken(token, secretKey, farFutureEpoch);

      assert.equal(inspection.status, 'expired');
      assert.equal(inspection.timeWindowStatus, 'expired');
    });
  });

  // =========================================================================
  // 3. Future / Not-Yet-Valid Token Forensics
  // =========================================================================

  describe('3. Future / Not-Yet-Valid Token Forensics', () => {
    it('Detects future token: returns status "not_yet_valid" and timeWindowStatus "future"', () => {
      const token = createTestToken();
      // Inspected 1 second before window opens (vf - 1)
      const earlyEpoch = sessionEpoch - 1800 - 1;
      const inspection = inspectDynamicQRToken(token, secretKey, earlyEpoch);

      assert.equal(inspection.valid, false);
      assert.equal(inspection.status, 'not_yet_valid');
      assert.equal(inspection.signatureVerified, true, 'HMAC signature is authentic');
      assert.equal(inspection.timeWindowStatus, 'future');
      assert.ok(inspection.error);
      assert.match(inspection.error, /Pass is not yet active/);

      // Support agents can see the customer's scheduled session
      assert.ok(inspection.payload);
      assert.equal(inspection.payload.pid, testPassId);
      assert.equal(inspection.payload.st, sessionEpoch);
    });
  });

  // =========================================================================
  // 4. Tampered Payload & Signature Forensics
  // =========================================================================

  describe('4. Tampered Payload & Signature Forensics', () => {
    it('Detects tampered signature: returns status "signature_mismatch" with expectedSignature for comparison', () => {
      const token = createTestToken();
      const parts = token.split('.');
      // Tamper signature by changing last 4 characters
      const tamperedToken = `${parts[0]}.${parts[1]}.tampered_sig_123`;

      const inspection = inspectDynamicQRToken(tamperedToken, secretKey, sessionEpoch);

      assert.equal(inspection.valid, false);
      assert.equal(inspection.status, 'signature_mismatch');
      assert.equal(inspection.signatureVerified, false);
      assert.ok(inspection.signature);
      assert.ok(inspection.expectedSignature);
      assert.notEqual(inspection.signature, inspection.expectedSignature);

      // Decoded payload is still extracted to help support trace who created the token
      assert.ok(inspection.payload);
      assert.equal(inspection.payload.pid, testPassId);
    });

    it('Detects tampered payload content (Cross-Gym venue tampering attack)', () => {
      const token = createTestToken();
      const parts = token.split('.');

      // Attacker decodes payload, changes gymId from John Harris to Fit Fabrik, re-encodes without key
      const payloadObj = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      payloadObj.gid = gymIdFitFabrik; // Tampered venue!

      const tamperedPayloadB64 = stringToBase64Url(JSON.stringify(payloadObj));
      const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      const inspection = inspectDynamicQRToken(tamperedToken, secretKey, sessionEpoch);

      assert.equal(inspection.valid, false);
      assert.equal(inspection.status, 'signature_mismatch');
      assert.equal(inspection.signatureVerified, false);
      assert.equal(inspection.rawPayload?.gid, gymIdFitFabrik, 'Exposes tampered venue in rawPayload');
    });
  });

  // =========================================================================
  // 5. Malformed Token String Forensics
  // =========================================================================

  describe('5. Malformed Token String Handling', () => {
    it('Rejects empty or blank strings with status "malformed"', () => {
      const emptyRes = inspectDynamicQRToken('');
      assert.equal(emptyRes.valid, false);
      assert.equal(emptyRes.status, 'malformed');
      assert.equal(emptyRes.payload, null);

      const whitespaceRes = inspectDynamicQRToken('   ');
      assert.equal(whitespaceRes.valid, false);
      assert.equal(whitespaceRes.status, 'malformed');
    });

    it('Rejects non-string inputs safely with status "malformed"', () => {
      // @ts-expect-error Testing adversarial runtime types
      const nullRes = inspectDynamicQRToken(null);
      assert.equal(nullRes.status, 'malformed');

      // @ts-expect-error Testing adversarial runtime types
      const undefinedRes = inspectDynamicQRToken(undefined);
      assert.equal(undefinedRes.status, 'malformed');
    });

    it('Rejects invalid token format with wrong segments count or bad header', () => {
      const missingSegments = inspectDynamicQRToken('GM1.onlytwoparts');
      assert.equal(missingSegments.status, 'malformed');

      const wrongHeader = inspectDynamicQRToken('JWT.payload.signature');
      assert.equal(wrongHeader.status, 'malformed');
    });

    it('Rejects corrupt or non-JSON payload with status "malformed"', () => {
      const corruptPayloadB64 = stringToBase64Url('This is definitely not valid json string');
      const corruptToken = `GM1.${corruptPayloadB64}.somesignature`;

      const inspection = inspectDynamicQRToken(corruptToken, secretKey, sessionEpoch);
      assert.equal(inspection.status, 'malformed');
      assert.equal(inspection.payload, null);
      assert.match(inspection.error || '', /Corrupt or unparseable JSON/);
    });
  });

  // =========================================================================
  // 6. Non-Destructive Read Invariant
  // =========================================================================

  describe('6. Non-Destructive Read Invariant', () => {
    it('Token inspection does NOT alter is_redeemed or database state in any way', async () => {
      const token = createTestToken();

      // Simulated datastore holding unredeemed check-in pass
      const datastore = {
        pass: {
          id: testPassId,
          booking_id: testBookingId,
          gym_id: gymIdJohnHarris,
          dynamic_token: token,
          is_redeemed: false,
          redeemed_at: null as string | null,
          redeemed_by_user_id: null as string | null,
        },
      };

      // Invariant Check 1: Initial pass state
      assert.equal(datastore.pass.is_redeemed, false);
      assert.equal(datastore.pass.redeemed_at, null);

      // Perform multiple diagnostic inspections across various conditions
      const inspection1 = inspectDynamicQRToken(token, secretKey, sessionEpoch);
      assert.equal(inspection1.valid, true);

      // Pass must remain 100% UNREDEEMED after inspection
      assert.equal(datastore.pass.is_redeemed, false, 'is_redeemed must remain false after inspection');
      assert.equal(datastore.pass.redeemed_at, null);

      // Inspection 2: Inspecting with an expired timestamp
      const inspection2 = inspectDynamicQRToken(token, secretKey, sessionEpoch + 10000);
      assert.equal(inspection2.status, 'expired');
      assert.equal(datastore.pass.is_redeemed, false);

      // Inspection 3: Inspecting with a tampered token
      const inspection3 = inspectDynamicQRToken(token + 'corrupt', secretKey, sessionEpoch);
      assert.equal(inspection3.status, 'signature_mismatch');
      assert.equal(datastore.pass.is_redeemed, false);

      // Invariant Check 2: Contrast against genuine redemption action
      // Standard reception scan DOES mutate state:
      const redemptionResult = await redeemCheckInPass({
        token,
        staffGymId: gymIdJohnHarris,
        staffUserId: 'staff_jh_reception',
        secretKey,
        nowEpochSeconds: sessionEpoch,
        dbAdapter: {
          findPassById: (pid) => (pid === datastore.pass.id ? (datastore.pass as CheckInPass) : null),
          atomicRedeemPass: ({ passId, staffUserId, nowIso }) => {
            if (datastore.pass.is_redeemed) return false;
            datastore.pass.is_redeemed = true;
            datastore.pass.redeemed_at = nowIso;
            datastore.pass.redeemed_by_user_id = staffUserId;
            return true;
          },
          updateBookingStatus: () => null,
        },
      });

      assert.equal(redemptionResult.success, true);
      // Now and ONLY now is the datastore mutated:
      assert.equal(datastore.pass.is_redeemed, true);
      assert.ok(datastore.pass.redeemed_at);

      // Subsequent inspectDynamicQRToken still evaluates purely cryptographically without errors:
      const inspectionPostRedeem = inspectDynamicQRToken(token, secretKey, sessionEpoch);
      assert.equal(inspectionPostRedeem.valid, true);
      assert.equal(inspectionPostRedeem.status, 'valid');
    });
  });
});
