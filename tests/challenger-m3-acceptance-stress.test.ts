import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSplitPayment,
  calculateCancellationRefund,
  formatCentsToEur,
  eurToCents,
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
} from '../src/lib/data/linz-seed';
import { Booking, CheckInPass, CoachAvailability } from '../src/types/database';
import fs from 'node:fs';
import path from 'node:path';

describe('Adversarial Acceptance Suite (Milestone 3 Challenger)', () => {
  beforeEach(() => {
    resetMockDatastore();
  });

  // =========================================================================
  // SUITE 1: Cryptographic GM1 Boundary & Tamper Defense Oracle
  // =========================================================================
  describe('1. Cryptographic GM1 Boundary & Tamper Defense Oracle', () => {
    const validGymId = LINZ_GYMS[0].id;
    const sessionEpoch = 1791652477; // Wednesday 14:00 CET
    const durationMinutes = 60;
    const vf = sessionEpoch - 30 * 60; // 14:00 - 30m = 13:30
    const vu = sessionEpoch + 60 * 60 + 30 * 60; // 14:00 + 60m + 30m = 15:30

    const validToken = generateDynamicQRToken({
      passId: 'pass_adv_001',
      bookingId: 'bk_adv_001',
      clientId: 'cli_adv_001',
      gymId: validGymId,
      sessionTimeEpochSeconds: sessionEpoch,
      durationMinutes,
      secretKey: DEFAULT_QR_SECRET,
    });

    it('Verifies authentic token within exact boundary: [vf, vu]', () => {
      // Exactly at valid_from
      const atVf = verifyDynamicQRToken(validToken, DEFAULT_QR_SECRET, validGymId, vf);
      assert.equal(atVf.valid, true, `Expected valid at start boundary ${vf}`);

      // Exactly at valid_until
      const atVu = verifyDynamicQRToken(validToken, DEFAULT_QR_SECRET, validGymId, vu);
      assert.equal(atVu.valid, true, `Expected valid at end boundary ${vu}`);
    });

    it('Rejects token 1 second before vf (NOT_YET_VALID)', () => {
      const tooEarly = verifyDynamicQRToken(validToken, DEFAULT_QR_SECRET, validGymId, vf - 1);
      assert.equal(tooEarly.valid, false);
      assert.equal(tooEarly.errorCode, 'NOT_YET_VALID');
    });

    it('Rejects token 1 second after vu (TOKEN_EXPIRED)', () => {
      const tooLate = verifyDynamicQRToken(validToken, DEFAULT_QR_SECRET, validGymId, vu + 1);
      assert.equal(tooLate.valid, false);
      assert.equal(tooLate.errorCode, 'TOKEN_EXPIRED');
    });

    it('Rejects malformed tokens across all segment mutations', () => {
      const malformedVectors = [
        '',
        'INVALID',
        'GM1',
        'GM1.part1',
        'GM1.part1.part2.part3',
        'GM2.something.something',
        'GM1..sig',
        'GM1.payload.',
        'GM1.notbase64!@#.sig',
      ];

      for (const vector of malformedVectors) {
        const res = verifyDynamicQRToken(vector, DEFAULT_QR_SECRET, validGymId, sessionEpoch);
        assert.equal(res.valid, false, `Vector "${vector}" should have been rejected`);
        assert.ok(res.errorCode, `Missing errorCode for vector "${vector}"`);
      }
    });

    it('Rejects payload tampering when claim fields are modified with original signature', () => {
      const parts = validToken.split('.');
      const originalPayloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payloadObj = JSON.parse(originalPayloadJson);

      // Attack: Swapping target gym ID
      const tamperedObj = { ...payloadObj, gid: LINZ_GYMS[1].id };
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedObj)).toString('base64url');
      const tamperedToken = `GM1.${tamperedPayloadB64}.${parts[2]}`;

      const res = verifyDynamicQRToken(tamperedToken, DEFAULT_QR_SECRET, LINZ_GYMS[1].id, sessionEpoch);
      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'SIGNATURE_INVALID');
    });
  });

  // =========================================================================
  // SUITE 2: Multi-Role Atomic CAS Concurrency & Anti-Replay Stress
  // =========================================================================
  describe('2. Multi-Role Atomic CAS Concurrency & Anti-Replay Stress', () => {
    it('Concurrent parallel scan race: exactly 1 succeeds and N-1 fail with ALREADY_REDEEMED', async () => {
      const datastore = getMockDatastore();
      const gym = LINZ_GYMS[0];
      const passId = 'pass_concurrency_race';
      const bookingId = 'bk_concurrency_race';
      const sessionEpoch = Math.floor(Date.now() / 1000);

      const token = generateDynamicQRToken({
        passId,
        bookingId,
        clientId: 'cli_race',
        gymId: gym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      // Insert fresh unredeemed pass
      const testPass: CheckInPass = {
        id: passId,
        booking_id: bookingId,
        gym_id: gym.id,
        client_id: 'cli_race',
        dynamic_token: token,
        qr_signature: token.split('.')[2],
        nonce: 'nonce_race',
        expires_at: new Date((sessionEpoch + 7200) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };
      datastore.check_in_passes.push(testPass);

      // Concurrent atomic CAS adapter simulator
      const dbAdapter = {
        findPassById: (pid: string) => {
          return datastore.check_in_passes.find((p) => p.id === pid) || null;
        },
        atomicRedeemPass: ({ passId: pid, staffUserId, nowIso }: any) => {
          const p = datastore.check_in_passes.find((item) => item.id === pid);
          if (!p || p.is_redeemed) return false;
          // Synchronous atomic test CAS
          p.is_redeemed = true;
          p.redeemed_at = nowIso;
          p.redeemed_by_user_id = staffUserId;
          return true;
        },
        updateBookingStatus: (bid: string, status: any) => null,
      };

      // Launch 25 concurrent scan requests
      const concurrentScans = 25;
      const scanPromises = Array.from({ length: concurrentScans }).map((_, idx) =>
        redeemCheckInPass({
          token,
          staffGymId: gym.id,
          staffUserId: `staff_scanner_${idx}`,
          secretKey: DEFAULT_QR_SECRET,
          nowEpochSeconds: sessionEpoch,
          dbAdapter,
        })
      );

      const results = await Promise.all(scanPromises);
      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      assert.equal(successes.length, 1, 'Exactly one scan must succeed');
      assert.equal(failures.length, concurrentScans - 1, 'All other scans must fail');
      for (const f of failures) {
        assert.equal(f.errorCode, 'ALREADY_REDEEMED');
      }
    });
  });

  // =========================================================================
  // SUITE 3: Financial Conservation Invariant Sweep
  // =========================================================================
  describe('3. Financial Conservation Invariant Sweep', () => {
    it('Exhaustive Cent Sweep: €20.00 to €200.00 preserves GBV === Gym + Platform + Coach', () => {
      for (let cents = 2000; cents <= 20000; cents += 50) {
        const split = calculateSplitPayment({
          grossAmountCents: cents,
          gymFloorFeeCents: 800,
          platformFeeRateBps: 1400,
        });

        assert.equal(
          split.grossAmountCents,
          split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents,
          `Conservation failed at ${cents} cents`
        );
        assert.equal(split.gymFloorFeeCents, 800);
        assert.ok(split.coachPayoutCents >= 0, `Negative coach payout at ${cents} cents`);
      }
    });

    it('Cancellation Refund Invariant: 100% refund for >24h cancellation', () => {
      const sessionEpoch = 1791652477;
      const refundEarly = calculateCancellationRefund({
        grossAmountCents: 7500,
        sessionStartEpochSeconds: sessionEpoch,
        cancelledAtEpochSeconds: sessionEpoch - (24 * 3600 + 1), // 24h + 1s before
        cancelledBy: 'client',
      });

      assert.equal(refundEarly.isEarlyCancellation, true);
      assert.equal(refundEarly.clientRefundCents, 7500);
      assert.equal(refundEarly.gymFloorFeeCents, 0);
      assert.equal(refundEarly.platformFeeCents, 0);
      assert.equal(refundEarly.coachPayoutCents, 0);
    });

    it('Cancellation Refund Invariant: Late cancellation (<=24h) protects coach & venue', () => {
      const sessionEpoch = 1791652477;
      const refundLate = calculateCancellationRefund({
        grossAmountCents: 7500,
        sessionStartEpochSeconds: sessionEpoch,
        cancelledAtEpochSeconds: sessionEpoch - (24 * 3600 - 1), // 24h - 1s before
        cancelledBy: 'client',
      });

      assert.equal(refundLate.isEarlyCancellation, false);
      assert.equal(refundLate.clientRefundCents, 0);
      assert.equal(refundLate.gymFloorFeeCents, 800);
      assert.equal(refundLate.platformFeeCents, 1050);
      assert.equal(refundLate.coachPayoutCents, 5650);
    });
  });

  // =========================================================================
  // SUITE 4: Offline Readiness & PWA Manifest Forensic Validation
  // =========================================================================
  describe('4. Offline Readiness & PWA Manifest Forensic Validation', () => {
    it('Validates public/manifest.json presence and schema compliance', () => {
      const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json missing in public/');

      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);

      assert.equal(manifest.name, 'GymMatch Linz');
      assert.equal(manifest.short_name, 'GymMatch');
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      assert.ok(manifest.icons && manifest.icons.length >= 2, 'Must have at least 2 icons');

      // Verify referenced icon files actually exist on disk
      for (const icon of manifest.icons) {
        const iconPath = path.resolve(process.cwd(), 'public', icon.src.replace(/^\//, ''));
        assert.ok(fs.existsSync(iconPath), `Referenced icon file missing: ${icon.src}`);
      }
    });

    it('Validates public/sw.js presence and offline fallback handler', () => {
      const swPath = path.resolve(process.cwd(), 'public/sw.js');
      assert.ok(fs.existsSync(swPath), 'sw.js missing in public/');

      const content = fs.readFileSync(swPath, 'utf8');
      assert.ok(content.includes('caches.open'), 'Service worker must cache shell assets');
      assert.ok(content.includes('gymmatch-v1'), 'Service worker must specify cache name');
      assert.ok(content.includes('install'), 'Service worker must handle install event');
      assert.ok(content.includes('fetch'), 'Service worker must handle fetch event');
    });

    it('Validates database schema migrations exist and contain RLS policies', () => {
      const ddl1 = path.resolve(process.cwd(), 'supabase/migrations/20261010000001_initial_schema.sql');
      const ddl2 = path.resolve(process.cwd(), 'supabase/migrations/20261010000002_rls_policies.sql');

      assert.ok(fs.existsSync(ddl1), 'Initial schema migration missing');
      assert.ok(fs.existsSync(ddl2), 'RLS policies migration missing');

      const ddl2Content = fs.readFileSync(ddl2, 'utf8');
      assert.ok(ddl2Content.includes('ENABLE ROW LEVEL SECURITY'));
      assert.ok(ddl2Content.includes('Client view own bookings'));
      assert.ok(ddl2Content.includes('Coach view own bookings'));
      assert.ok(ddl2Content.includes('Gym staff view venue bookings'));
    });
  });
});
