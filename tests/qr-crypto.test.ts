import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateDynamicQRToken, verifyDynamicQRToken } from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';

describe('Cryptographic Dynamic QR Token & Validation Engine (GM1 Protocol)', () => {
  const secretKey = 'test_secret_linz_key_hmac_256';
  const gymIdJohnHarris = '00000000-0000-0000-0000-000000000001';
  const gymIdFitFabrik = '00000000-0000-0000-0000-000000000002';
  const passId = '77777777-7777-7777-7777-000000000001';
  const bookingId = '66666666-6666-6666-6666-000000000001';
  const clientId = '11111111-1111-1111-1111-000000000001';
  const sessionEpoch = 1792054800; // scheduled session start

  it('Generates valid GM1 signed token format (GM1.<payload>.<sig>)', () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      durationMinutes: 60,
      secretKey,
    });

    assert.ok(token.startsWith('GM1.'));
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    assert.equal(parts[0], 'GM1');
    assert.ok(parts[1].length > 20); // base64url payload
    assert.ok(parts[2].length > 20); // base64url signature
  });

  it('Verifies authentic token successfully within active window and matching gym', () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      secretKey,
    });

    // Verification exactly at session start
    const result = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch);
    assert.equal(result.valid, true);
    assert.equal(result.payload?.pid, passId);
    assert.equal(result.payload?.bid, bookingId);
    assert.equal(result.payload?.gid, gymIdJohnHarris);
  });

  it('Rejects tampered tokens and altered signatures', () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      secretKey,
    });

    const tampered = token.slice(0, -3) + 'abc';
    const result = verifyDynamicQRToken(tampered, secretKey, gymIdJohnHarris, sessionEpoch);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'SIGNATURE_INVALID');
  });

  it('Rejects scans at wrong gym facility (Cross-Gym Abuse Prevention)', () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      secretKey,
    });

    // Scanned at Fit Fabrik reception instead of John Harris
    const result = verifyDynamicQRToken(token, secretKey, gymIdFitFabrik, sessionEpoch);
    assert.equal(result.valid, false);
    assert.equal(result.errorCode, 'GYM_MISMATCH');
  });

  it('Enforces time validity window boundaries ([-30 min, +30 min after slot])', () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      durationMinutes: 60,
      secretKey,
    });

    // 1. 40 minutes before session start -> NOT YET VALID
    const earlyRes = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch - 40 * 60);
    assert.equal(earlyRes.valid, false);
    assert.equal(earlyRes.errorCode, 'NOT_YET_VALID');

    // 2. 20 minutes before session start -> VALID (window open)
    const validPreRes = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch - 20 * 60);
    assert.equal(validPreRes.valid, true);

    // 3. 20 minutes after session end (total 80 mins from start) -> VALID
    const validPostRes = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch + 80 * 60);
    assert.equal(validPostRes.valid, true);

    // 4. 100 minutes after session start (session was 60m + 30m grace = 90m) -> EXPIRED
    const expiredRes = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch + 100 * 60);
    assert.equal(expiredRes.valid, false);
    assert.equal(expiredRes.errorCode, 'TOKEN_EXPIRED');
  });

  it('Performs atomic compare-and-swap (CAS) preventing double redemption / replay attacks', async () => {
    const token = generateDynamicQRToken({
      passId,
      bookingId,
      clientId,
      gymId: gymIdJohnHarris,
      sessionTimeEpochSeconds: sessionEpoch,
      secretKey,
    });

    // Simulated atomic DB state
    const simulatedPassStore = {
      id: passId,
      is_redeemed: false,
      redeemed_at: null as string | null,
    };

    const mockAdapter = {
      findPassById: async (id: string) => {
        if (id !== passId) return null;
        return {
          id: simulatedPassStore.id,
          booking_id: bookingId,
          gym_id: gymIdJohnHarris,
          client_id: clientId,
          dynamic_token: token,
          qr_signature: 'sig',
          nonce: 'nce',
          expires_at: new Date((sessionEpoch + 5400) * 1000).toISOString(),
          is_redeemed: simulatedPassStore.is_redeemed,
          redeemed_at: simulatedPassStore.redeemed_at,
          created_at: new Date().toISOString(),
        };
      },
      atomicRedeemPass: async (params: { passId: string; nowIso: string }) => {
        // Atomic CAS simulation: WHERE id = $id AND is_redeemed = FALSE
        if (simulatedPassStore.is_redeemed) return false;
        simulatedPassStore.is_redeemed = true;
        simulatedPassStore.redeemed_at = params.nowIso;
        return true;
      },
      updateBookingStatus: async (bid: string, status: 'checked_in') => {
        return null;
      },
    };

    // First scan attempt: MUST SUCCEED
    const scan1 = await redeemCheckInPass({
      token,
      staffGymId: gymIdJohnHarris,
      staffUserId: '33333333-3333-3333-3333-000000000001',
      secretKey,
      nowEpochSeconds: sessionEpoch,
      dbAdapter: mockAdapter,
    });

    assert.equal(scan1.success, true);
    assert.equal(scan1.floorFeeCents, 800);
    assert.ok(scan1.redeemedAt);

    // Second scan attempt: MUST BE REJECTED as ALREADY_REDEEMED
    const scan2 = await redeemCheckInPass({
      token,
      staffGymId: gymIdJohnHarris,
      staffUserId: '33333333-3333-3333-3333-000000000001',
      secretKey,
      nowEpochSeconds: sessionEpoch,
      dbAdapter: mockAdapter,
    });

    assert.equal(scan2.success, false);
    assert.equal(scan2.errorCode, 'ALREADY_REDEEMED');
  });
});
