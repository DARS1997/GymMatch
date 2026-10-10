import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { generateDynamicQRToken, verifyDynamicQRToken, DEFAULT_QR_SECRET } from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import { createMockSupabaseClient, resetMockDatastore } from '../src/lib/supabase/mock-db';

describe('Adversarial Challenger: Cryptographic QR & Anti-Replay Stress Suite', () => {
  const secretKey = 'test_secret_linz_key_hmac_256';
  const gymIdJohnHarris = '00000000-0000-0000-0000-000000000001';
  const gymIdFitFabrik = '00000000-0000-0000-0000-000000000002';
  const gymIdHappyFit = '00000000-0000-0000-0000-000000000003';
  const gymIdKieser = '00000000-0000-0000-0000-000000000004';
  const passId = '77777777-7777-7777-7777-000000000001';
  const bookingId = '66666666-6666-6666-6666-000000000001';
  const clientId = '11111111-1111-1111-1111-000000000001';
  const sessionEpoch = 1792054800; // scheduled session start (epoch seconds)

  // ---------------------------------------------------------------------------
  // 1. FORGED SIGNATURES & CRYPTOGRAPHIC TAMPERING
  // ---------------------------------------------------------------------------
  describe('1. Forged Signatures & Cryptographic Tampering', () => {
    it('Rejects token forged with an unauthorized attacker secret key', () => {
      const attackerSecret = 'malicious_attacker_key_forged_999';
      const forgedToken = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey: attackerSecret,
      });

      const result = verifyDynamicQRToken(forgedToken, secretKey, gymIdJohnHarris, sessionEpoch);
      assert.equal(result.valid, false);
      assert.equal(result.errorCode, 'SIGNATURE_INVALID');
      assert.match(result.error!, /signature mismatch|tampered/i);
    });

    it('Rejects bit-flipped signature tampering across multiple positions', () => {
      const validToken = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const parts = validToken.split('.');
      const sig = parts[2];

      // Flip first char, middle char, last char
      const tamperPositions = [0, Math.floor(sig.length / 2), sig.length - 1];
      for (const pos of tamperPositions) {
        const replacement = sig[pos] === 'A' ? 'B' : 'A';
        const tamperedSig = sig.substring(0, pos) + replacement + sig.substring(pos + 1);
        const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

        const res = verifyDynamicQRToken(tamperedToken, secretKey, gymIdJohnHarris, sessionEpoch);
        assert.equal(res.valid, false, `Failed to reject tampered signature at position ${pos}`);
        assert.equal(res.errorCode, 'SIGNATURE_INVALID');
      }
    });

    it('Safely handles variable-length signatures without throwing RangeError in timingSafeEqual', () => {
      const validToken = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const parts = validToken.split('.');

      // Test cases: empty, truncated (1 byte, 10 bytes), expanded (50 bytes, 128 bytes)
      const irregularSignatures = [
        '',
        'x',
        'shortsig123',
        parts[2].slice(0, 10),
        parts[2].slice(0, -1), // 1 byte short
        parts[2] + 'extra',     // longer
        'a'.repeat(64),
        'a'.repeat(256),
      ];

      for (const badSig of irregularSignatures) {
        const testToken = `${parts[0]}.${parts[1]}.${badSig}`;
        assert.doesNotThrow(() => {
          const res = verifyDynamicQRToken(testToken, secretKey, gymIdJohnHarris, sessionEpoch);
          assert.equal(res.valid, false);
          assert.equal(res.errorCode, 'SIGNATURE_INVALID');
        }, `Threw exception on signature length ${badSig.length}`);
      }
    });

    it('Rejects payload tampering when original signature is reused', () => {
      const validToken = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const parts = validToken.split('.');
      const payloadObj = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

      // Attack: Attacker tries to alter gym_id to another gym without resigning
      payloadObj.gid = gymIdFitFabrik;
      const tamperedB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedB64}.${parts[2]}`;

      const res = verifyDynamicQRToken(tamperedToken, secretKey, gymIdFitFabrik, sessionEpoch);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'SIGNATURE_INVALID');
    });

    it('Rejects extension of token validity window via payload modification', () => {
      const validToken = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const parts = validToken.split('.');
      const payloadObj = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

      // Attack: Extend validity by 1 year
      payloadObj.vu += 365 * 86400;
      const tamperedB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedB64}.${parts[2]}`;

      const res = verifyDynamicQRToken(tamperedToken, secretKey, gymIdJohnHarris, sessionEpoch);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'SIGNATURE_INVALID');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. TEMPORAL VALIDITY WINDOW ENFORCEMENT ([-30 min, +duration+30min])
  // ---------------------------------------------------------------------------
  describe('2. Temporal Validity Window Enforcement ([-30 min, +duration+30min])', () => {
    const durationMin = 60; // 3600s
    // Window: vf = sessionEpoch - 1800; vu = sessionEpoch + 3600 + 1800 = sessionEpoch + 5400
    const vf = sessionEpoch - 1800;
    const vu = sessionEpoch + 5400;

    let token60m: string;

    it('Prepares 60m session token with exact window metadata', () => {
      token60m = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: durationMin,
        secretKey,
      });
      const parts = token60m.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      assert.equal(payload.vf, vf);
      assert.equal(payload.vu, vu);
    });

    it('Rejects presentation 1 second before window opens (vf - 1)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, vf - 1);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'NOT_YET_VALID');
    });

    it('Accepts presentation at exact lower bound (vf)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, vf);
      assert.equal(res.valid, true);
    });

    it('Accepts presentation at session start (sessionEpoch)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, sessionEpoch);
      assert.equal(res.valid, true);
    });

    it('Accepts presentation at session end (sessionEpoch + 3600)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, sessionEpoch + 3600);
      assert.equal(res.valid, true);
    });

    it('Accepts presentation at exact upper bound (vu)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, vu);
      assert.equal(res.valid, true);
    });

    it('Rejects presentation 1 second after window closes (vu + 1)', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, vu + 1);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'TOKEN_EXPIRED');
    });

    it('Rejects presentation days after expiration', () => {
      const res = verifyDynamicQRToken(token60m, secretKey, gymIdJohnHarris, vu + 86400 * 7);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'TOKEN_EXPIRED');
    });

    it('Enforces variable duration window for 90-minute session', () => {
      const token90m = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 90,
        secretKey,
      });

      const vu90 = sessionEpoch + (90 * 60) + 1800; // sessionEpoch + 5400 + 1800 = sessionEpoch + 7200
      // At sessionEpoch + 6000 (100 min from start): VALID (session is 90m, grace is 30m)
      const validRes = verifyDynamicQRToken(token90m, secretKey, gymIdJohnHarris, sessionEpoch + 6000);
      assert.equal(validRes.valid, true);

      // At exact upper bound vu90: VALID
      const boundRes = verifyDynamicQRToken(token90m, secretKey, gymIdJohnHarris, vu90);
      assert.equal(boundRes.valid, true);

      // At vu90 + 1: EXPIRED
      const expiredRes = verifyDynamicQRToken(token90m, secretKey, gymIdJohnHarris, vu90 + 1);
      assert.equal(expiredRes.valid, false);
      assert.equal(expiredRes.errorCode, 'TOKEN_EXPIRED');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. MULTI-TENANT GYM ID MISMATCH (CROSS-GYM FRAUD PREVENTION)
  // ---------------------------------------------------------------------------
  describe('3. Multi-Tenant Gym ID Mismatch (Cross-Gym Fraud Prevention)', () => {
    it('Rejects a John Harris pass when presented at all other Linz partner gyms', () => {
      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const foreignGyms = [
        { id: gymIdFitFabrik, name: 'Fit Fabrik Linz' },
        { id: gymIdHappyFit, name: 'Happy Fit Linz Urfahr' },
        { id: gymIdKieser, name: 'Kieser Training Linz Zentrum' },
        { id: '99999999-9999-9999-9999-999999999999', name: 'Alien Gym' },
      ];

      for (const gym of foreignGyms) {
        const res = verifyDynamicQRToken(token, secretKey, gym.id, sessionEpoch);
        assert.equal(res.valid, false, `Failed to reject scan at ${gym.name}`);
        assert.equal(res.errorCode, 'GYM_MISMATCH');
        assert.match(res.error!, new RegExp(gymIdJohnHarris));
        assert.match(res.error!, new RegExp(gym.id));
      }
    });

    it('Rejects redemption via redeemCheckInPass when staff belongs to a mismatched gym', async () => {
      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const res = await redeemCheckInPass({
        token,
        staffGymId: gymIdFitFabrik, // Receptionist from Fit Fabrik attempting to redeem John Harris pass
        staffUserId: '33333333-3333-3333-3333-000000000002',
        secretKey,
        nowEpochSeconds: sessionEpoch,
      });

      assert.equal(res.success, false);
      assert.equal(res.errorCode, 'GYM_MISMATCH');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. REPLAY ATTACKS & ATOMIC COMPARE-AND-SWAP (CAS) CONCURRENCY
  // ---------------------------------------------------------------------------
  describe('4. Replay Attacks & Atomic Compare-and-Swap (CAS) Concurrency', () => {
    it('Blocks sequential double redemption replay attempt', async () => {
      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      let isRedeemedInDb = false;
      let redeemedAtInDb: string | null = null;

      const dbAdapter = {
        findPassById: async (id: string) => {
          return {
            id,
            booking_id: bookingId,
            gym_id: gymIdJohnHarris,
            client_id: clientId,
            dynamic_token: token,
            qr_signature: 'sig',
            nonce: 'nce',
            expires_at: new Date((sessionEpoch + 5400) * 1000).toISOString(),
            is_redeemed: isRedeemedInDb,
            redeemed_at: redeemedAtInDb,
            created_at: new Date().toISOString(),
          };
        },
        atomicRedeemPass: async (params: { passId: string; nowIso: string }) => {
          // Atomic CAS: WHERE id = $passId AND is_redeemed = FALSE
          if (isRedeemedInDb) return false;
          isRedeemedInDb = true;
          redeemedAtInDb = params.nowIso;
          return true;
        },
        updateBookingStatus: async () => null,
      };

      // Scan 1: First redemption -> SUCCESS
      const scan1 = await redeemCheckInPass({
        token,
        staffGymId: gymIdJohnHarris,
        staffUserId: '33333333-3333-3333-3333-000000000001',
        secretKey,
        nowEpochSeconds: sessionEpoch,
        dbAdapter,
      });
      assert.equal(scan1.success, true);
      assert.equal(scan1.floorFeeCents, 800);
      assert.ok(scan1.redeemedAt);

      // Scan 2: Immediate duplicate scan -> REJECTED (ALREADY_REDEEMED)
      const scan2 = await redeemCheckInPass({
        token,
        staffGymId: gymIdJohnHarris,
        staffUserId: '33333333-3333-3333-3333-000000000001',
        secretKey,
        nowEpochSeconds: sessionEpoch + 5,
        dbAdapter,
      });
      assert.equal(scan2.success, false);
      assert.equal(scan2.errorCode, 'ALREADY_REDEEMED');

      // Scan 3: Scan minutes later -> REJECTED (ALREADY_REDEEMED)
      const scan3 = await redeemCheckInPass({
        token,
        staffGymId: gymIdJohnHarris,
        staffUserId: '33333333-3333-3333-3333-000000000001',
        secretKey,
        nowEpochSeconds: sessionEpoch + 600,
        dbAdapter,
      });
      assert.equal(scan3.success, false);
      assert.equal(scan3.errorCode, 'ALREADY_REDEEMED');
    });

    it('Stress Test: 50 concurrent redemption requests on single pass allow EXACTLY 1 winner and 49 rejections', async () => {
      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      let isRedeemed = false;
      let redeemedAt: string | null = null;
      let successfulRedemptions = 0;

      // Realistic mock DB adapter with async microtask jitter simulating network/disk I/O
      const concurrentDbAdapter = {
        findPassById: async (id: string) => {
          // Simulate 1-5ms database latency
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5) + 1));
          return {
            id,
            booking_id: bookingId,
            gym_id: gymIdJohnHarris,
            client_id: clientId,
            dynamic_token: token,
            qr_signature: 'sig',
            nonce: 'nce',
            expires_at: new Date((sessionEpoch + 5400) * 1000).toISOString(),
            is_redeemed: isRedeemed,
            redeemed_at: redeemedAt,
            created_at: new Date().toISOString(),
          };
        },
        atomicRedeemPass: async (params: { passId: string; nowIso: string }) => {
          // Simulated atomic CAS in database engine
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5) + 1));
          if (isRedeemed) {
            return false;
          }
          isRedeemed = true;
          redeemedAt = params.nowIso;
          successfulRedemptions++;
          return true;
        },
        updateBookingStatus: async () => null,
      };

      // Launch 50 concurrent scans simultaneously
      const concurrency = 50;
      const scanPromises = Array.from({ length: concurrency }).map((_, i) =>
        redeemCheckInPass({
          token,
          staffGymId: gymIdJohnHarris,
          staffUserId: `staff_scanner_${i}`,
          secretKey,
          nowEpochSeconds: sessionEpoch,
          dbAdapter: concurrentDbAdapter,
        })
      );

      const results = await Promise.all(scanPromises);

      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      assert.equal(winners.length, 1, `Expected exactly 1 winning scan, got ${winners.length}`);
      assert.equal(losers.length, 49, `Expected exactly 49 rejected scans, got ${losers.length}`);
      assert.equal(successfulRedemptions, 1, `DB mutated more than once: ${successfulRedemptions}`);

      for (const loser of losers) {
        assert.equal(loser.errorCode, 'ALREADY_REDEEMED');
      }
    });

    it('Enforces anti-replay through Mock Supabase DB RLS policies', async () => {
      resetMockDatastore();
      const receptionStaff = createMockSupabaseClient({
        user: {
          id: '33333333-3333-3333-3333-000000000001',
          email: 'empfang.johnharris@linz.at',
          role: 'gym_receptionist',
        },
      });

      // Target baseline pass
      const targetPassId = '77777777-7777-7777-7777-000000000001';

      // First update via Supabase: Mark as redeemed
      const { data: update1, error: err1 } = await receptionStaff
        .from('check_in_passes')
        .update({
          is_redeemed: true,
          redeemed_at: new Date().toISOString(),
          redeemed_by_user_id: '33333333-3333-3333-3333-000000000001',
        })
        .eq('id', targetPassId);

      assert.equal(err1, null);
      assert.ok(update1 && update1.length === 1);
      assert.equal(update1[0].is_redeemed, true);

      // Second update attempt on the now-redeemed pass: REJECTED by RLS Policy
      const { data: update2, error: err2 } = await receptionStaff
        .from('check_in_passes')
        .update({
          is_redeemed: true,
          redeemed_at: new Date().toISOString(),
          redeemed_by_user_id: '33333333-3333-3333-3333-000000000001',
        })
        .eq('id', targetPassId);

      assert.ok(err2, 'Expected RLS error on double redemption update');
      assert.equal(err2.code, '42501');
      assert.match(err2.message, /already been redeemed/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. FUZZING & MALFORMED TOKEN INJECTION
  // ---------------------------------------------------------------------------
  describe('5. Fuzzing & Malformed Token Injection', () => {
    it('Gracefully rejects empty, nullish, or non-string inputs', () => {
      const invalidInputs: any[] = [
        null,
        undefined,
        '',
        '   ',
        12345,
        true,
        {},
        [],
      ];

      for (const input of invalidInputs) {
        const res = verifyDynamicQRToken(input, secretKey, gymIdJohnHarris, sessionEpoch);
        assert.equal(res.valid, false);
        assert.equal(res.errorCode, 'INVALID_FORMAT');
      }
    });

    it('Gracefully rejects invalid header or protocol format', () => {
      const invalidHeaders = [
        'JWT.payload.sig',
        'GM2.payload.sig',
        'gm1.payload.sig', // lowercase
        'V1.payload.sig',
        'PLAIN.payload.sig',
        'GM1',
        'GM1.onlypayload',
        'GM1.payload.sig.extrapart',
        'GM1.payload.sig.extra1.extra2',
      ];

      for (const input of invalidHeaders) {
        const res = verifyDynamicQRToken(input, secretKey, gymIdJohnHarris, sessionEpoch);
        assert.equal(res.valid, false);
        assert.equal(res.errorCode, 'INVALID_FORMAT');
      }
    });

    it('Gracefully rejects corrupt or non-JSON payloads signed with valid secret', () => {
      const nonJsonPayloads = [
        'plain_non_json_string',
        '<<<XML><NOT_JSON/></XML>',
        '{broken_json:',
        '',
      ];

      for (const rawPayload of nonJsonPayloads) {
        const payloadB64 = Buffer.from(rawPayload).toString('base64url');
        const message = `GM1.${payloadB64}`;
        const sig = crypto.createHmac('sha256', secretKey).update(message).digest('base64url');
        const token = `${message}.${sig}`;

        const res = verifyDynamicQRToken(token, secretKey, gymIdJohnHarris, sessionEpoch);
        assert.equal(res.valid, false);
        assert.equal(res.errorCode, 'INVALID_FORMAT');
      }
    });

    it('Survives ultra-long oversized payloads without crashing (DoS resilience)', () => {
      // 100 KB payload string
      const oversizedPayload = 'A'.repeat(100 * 1024);
      const oversizedToken = `GM1.${Buffer.from(oversizedPayload).toString('base64url')}.invalidsig`;

      assert.doesNotThrow(() => {
        const res = verifyDynamicQRToken(oversizedToken, secretKey, gymIdJohnHarris, sessionEpoch);
        assert.equal(res.valid, false);
      });
    });

    it('Handles unknown pass ID lookup gracefully in redeemCheckInPass', async () => {
      const nonExistentPassId = '99999999-9999-9999-9999-999999999999';
      const token = generateDynamicQRToken({
        passId: nonExistentPassId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const emptyDbAdapter = {
        findPassById: async () => null,
        atomicRedeemPass: async () => false,
        updateBookingStatus: async () => null,
      };

      const res = await redeemCheckInPass({
        token,
        staffGymId: gymIdJohnHarris,
        staffUserId: '33333333-3333-3333-3333-000000000001',
        secretKey,
        nowEpochSeconds: sessionEpoch,
        dbAdapter: emptyDbAdapter,
      });

      assert.equal(res.success, false);
      assert.equal(res.errorCode, 'PASS_NOT_FOUND');
    });

    it('Verifies 128-bit nonce entropy guarantees distinct tokens across multiple generations', () => {
      const tokens = new Set<string>();
      const nonces = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const t = generateDynamicQRToken({
          passId,
          bookingId,
          clientId,
          gymId: gymIdJohnHarris,
          sessionTimeEpochSeconds: sessionEpoch,
          secretKey,
        });
        tokens.add(t);
        const payload = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf-8'));
        assert.equal(payload.nce.length, 32, 'Nonce must be 32 hex chars (16 bytes)');
        nonces.add(payload.nce);
      }

      assert.equal(tokens.size, 20, 'Tokens must all be unique due to random nonces');
      assert.equal(nonces.size, 20, 'Nonces must all be unique');
    });

    it('Prevents pass redemption reuse even when attacker generates a fresh token with a new nonce', async () => {
      // First token generated and redeemed
      const token1 = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      const passState = {
        is_redeemed: false,
        redeemed_at: null as string | null,
      };

      const dbAdapter = {
        findPassById: async (id: string) => ({
          id,
          booking_id: bookingId,
          gym_id: gymIdJohnHarris,
          client_id: clientId,
          dynamic_token: token1,
          qr_signature: 'sig',
          nonce: 'nonce1',
          expires_at: new Date((sessionEpoch + 5400) * 1000).toISOString(),
          is_redeemed: passState.is_redeemed,
          redeemed_at: passState.redeemed_at,
          created_at: new Date().toISOString(),
        }),
        atomicRedeemPass: async (params: { passId: string; nowIso: string }) => {
          if (passState.is_redeemed) return false;
          passState.is_redeemed = true;
          passState.redeemed_at = params.nowIso;
          return true;
        },
        updateBookingStatus: async () => null,
      };

      // Redeem pass using Token 1
      const res1 = await redeemCheckInPass({
        token: token1,
        staffGymId: gymIdJohnHarris,
        staffUserId: 'staff_1',
        secretKey,
        nowEpochSeconds: sessionEpoch,
        dbAdapter,
      });
      assert.equal(res1.success, true);

      // Client or attacker generates Token 2 for the exact same pass with a brand new nonce
      const token2 = generateDynamicQRToken({
        passId,
        bookingId,
        clientId,
        gymId: gymIdJohnHarris,
        sessionTimeEpochSeconds: sessionEpoch,
        secretKey,
      });

      assert.notEqual(token1, token2, 'Tokens should differ due to nonce');

      // Attempt redemption with Token 2: MUST FAIL because passId is already redeemed in DB
      const res2 = await redeemCheckInPass({
        token: token2,
        staffGymId: gymIdJohnHarris,
        staffUserId: 'staff_1',
        secretKey,
        nowEpochSeconds: sessionEpoch + 30,
        dbAdapter,
      });

      assert.equal(res2.success, false);
      assert.equal(res2.errorCode, 'ALREADY_REDEEMED');
    });

    it('Documents failure mode: verifyDynamicQRToken throws TypeError if signed payload is JSON null (Vulnerability Finding)', () => {
      // Craft a token where message signs valid JSON 'null'
      const payloadB64 = Buffer.from('null').toString('base64url');
      const message = `GM1.${payloadB64}`;
      const sig = crypto.createHmac('sha256', secretKey).update(message).digest('base64url');
      const tokenWithNullPayload = `${message}.${sig}`;

      // Empirical proof: throws uncaught TypeError when accessing payload.gid
      assert.throws(
        () => {
          verifyDynamicQRToken(tokenWithNullPayload, secretKey, gymIdJohnHarris, sessionEpoch);
        },
        {
          name: 'TypeError',
          message: /Cannot read properties of null/i,
        }
      );
    });
  });
});

