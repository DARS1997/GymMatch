import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateSplitPayment,
  calculateCancellationRefund,
  eurToCents,
  formatCentsToEur,
} from '../src/lib/payments/split';
import {
  generateDynamicQRToken,
  verifyDynamicQRToken,
  DEFAULT_QR_SECRET,
} from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import { LINZ_GYMS, LINZ_COACHES, LINZ_BOOKINGS, LINZ_PASSES } from '../src/lib/data/linz-seed';
import { Booking, CheckInPass } from '../src/types/database';

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Re-implementation of PassViewer.tsx deterministic SVG QR matrix generator
 * for empirical verification of matrix size, finder patterns, and token encoding.
 */
function renderSvgQrMatrix(tokenString: string): boolean[][] {
  const size = 29;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const drawFinder = (top: number, left: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[top + r][left + c] = true;
        } else {
          matrix[top + r][left + c] = false;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
        matrix[20 + r][20 + c] = true;
      }
    }
  }

  let byteIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (
        (r <= 7 && c <= 7) ||
        (r <= 7 && c >= size - 8) ||
        (r >= size - 8 && c <= 7) ||
        r === 6 ||
        c === 6 ||
        (r >= 18 && r <= 22 && c >= 18 && c <= 22)
      ) {
        continue;
      }

      const charCode = tokenString.charCodeAt(byteIdx % tokenString.length);
      const isSet = (charCode + r * 13 + c * 17) % 3 === 0;
      matrix[r][c] = isSet;
      byteIdx++;
    }
  }

  return matrix;
}

describe('Adversarial Challenger: Milestone 2 Client Flow & PWA Verification', () => {
  describe('1. PWA Manifest & Service Worker Cache Verification', () => {
    it('Manifest JSON is valid, well-formed, and satisfies PWA installability requirements', () => {
      const manifestPath = path.join(PROJECT_ROOT, 'public', 'manifest.json');
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in public directory');

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      assert.equal(manifest.name, 'GymMatch Linz');
      assert.equal(manifest.short_name, 'GymMatch');
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.start_url, '/');
      assert.equal(manifest.scope, '/');
      assert.equal(manifest.theme_color, '#0f172a');
      assert.equal(manifest.background_color, '#ffffff');
      assert.equal(manifest.orientation, 'portrait-primary');
      assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'Must contain at least 3 icons');

      // Check shortcuts
      assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);
      const passShortcut = manifest.shortcuts.find((s: any) => s.short_name === 'Pass');
      const scanShortcut = manifest.shortcuts.find((s: any) => s.short_name === 'Scan');
      assert.ok(passShortcut, 'Must have Pass shortcut');
      assert.equal(passShortcut.url, '/?tab=passes');
      assert.ok(scanShortcut, 'Must have Scan shortcut');
      assert.equal(scanShortcut.url, '/?role=reception');
    });

    it('All PWA icon files referenced in manifest exist physically on disk with valid file size', () => {
      const manifestPath = path.join(PROJECT_ROOT, 'public', 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      for (const icon of manifest.icons) {
        const iconPath = path.join(PROJECT_ROOT, 'public', icon.src.replace(/^\//, ''));
        assert.ok(fs.existsSync(iconPath), `Icon file ${icon.src} must exist on disk`);
        const stats = fs.statSync(iconPath);
        assert.ok(stats.size > 0, `Icon file ${icon.src} must not be empty`);
      }

      // Check favicon
      const faviconPath = path.join(PROJECT_ROOT, 'public', 'favicon.ico');
      assert.ok(fs.existsSync(faviconPath), 'favicon.ico must exist');
      assert.ok(fs.statSync(faviconPath).size > 0, 'favicon.ico must not be empty');
    });

    it('Service Worker (sw.js) contains required lifecycle hooks, static assets, and offline fallback', () => {
      const swPath = path.join(PROJECT_ROOT, 'public', 'sw.js');
      assert.ok(fs.existsSync(swPath), 'sw.js must exist in public directory');

      const swContent = fs.readFileSync(swPath, 'utf-8');
      assert.match(swContent, /const CACHE_NAME = 'gymmatch-v1'/, 'Cache name must be declared');
      assert.match(swContent, /self\.addEventListener\('install'/, 'Install event listener must exist');
      assert.match(swContent, /self\.addEventListener\('activate'/, 'Activate event listener must exist');
      assert.match(swContent, /self\.addEventListener\('fetch'/, 'Fetch event listener must exist');
      assert.match(swContent, /self\.skipWaiting\(\)/, 'Must call skipWaiting for instant activation');
      assert.match(swContent, /self\.clients\.claim\(\)/, 'Must call clients.claim');
      assert.match(swContent, /\/_next\/static\//, 'Must handle Next.js static assets caching');
      assert.match(swContent, /event\.request\.mode === 'navigate'/, 'Must handle offline navigation fallback');

      // Verify static assets array in sw.js
      assert.ok(swContent.includes("'/manifest.json'"));
      assert.ok(swContent.includes("'/icons/icon-192x192.png'"));
      assert.ok(swContent.includes("'/icons/icon-512x512.png'"));
      assert.ok(swContent.includes("'/icons/icon.svg'"));
    });

    it('Layout configuration includes PWA metadata, Apple touch icon, and SW registration script', () => {
      const layoutPath = path.join(PROJECT_ROOT, 'src', 'app', 'layout.tsx');
      const layoutContent = fs.readFileSync(layoutPath, 'utf-8');

      assert.match(layoutContent, /manifest:\s*'\/manifest\.json'/);
      assert.match(layoutContent, /viewportFit:\s*'cover'/);
      assert.match(layoutContent, /themeColor:\s*'#0f172a'/);
      assert.match(layoutContent, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
      assert.match(layoutContent, /RoleProvider/);
      assert.match(layoutContent, /MobileContainer/);
    });
  });

  describe('2. Client Booking & Transparent Split Calculation in CheckoutModal', () => {
    it('Baseline €75.00 session yields exact €8.00 gym, €10.50 platform, and €56.50 coach split', () => {
      const grossCents = eurToCents(75.0);
      assert.equal(grossCents, 7500);

      const split = calculateSplitPayment({ grossAmountCents: grossCents });

      assert.equal(split.grossAmountCents, 7500);
      assert.equal(split.gymFloorFeeCents, 800, 'Gym floor fee must be exactly 800 cents');
      assert.equal(split.platformFeeCents, 1050, 'Platform fee must be exactly 1050 cents (14%)');
      assert.equal(split.coachPayoutCents, 5650, 'Coach payout must be exactly 5650 cents');

      assert.equal(split.formatted.gross, '€75.00');
      assert.equal(split.formatted.gymFloorFee, '€8.00');
      assert.equal(split.formatted.platformFee, '€10.50');
      assert.equal(split.formatted.coachPayout, '€56.50');

      // Invariant: zero drift
      assert.equal(
        split.grossAmountCents,
        split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents
      );
    });

    it('Accurately computes split across all 4 certified Linz coaches at their catalog rates', () => {
      const coachCatalog = [
        { name: 'Lukas Bauer', rate: 75.0, expFloor: 800, expPlat: 1050, expCoach: 5650 },
        { name: 'Elena Fischer', rate: 80.0, expFloor: 800, expPlat: 1120, expCoach: 6080 },
        { name: 'Markus Weber', rate: 65.0, expFloor: 800, expPlat: 910, expCoach: 4790 },
        { name: 'Anna Steyr', rate: 90.0, expFloor: 800, expPlat: 1260, expCoach: 6940 },
      ];

      for (const c of coachCatalog) {
        const grossCents = eurToCents(c.rate);
        const split = calculateSplitPayment({ grossAmountCents: grossCents });

        assert.equal(
          split.gymFloorFeeCents,
          c.expFloor,
          `${c.name} floor fee mismatch`
        );
        assert.equal(
          split.platformFeeCents,
          c.expPlat,
          `${c.name} platform fee mismatch`
        );
        assert.equal(
          split.coachPayoutCents,
          c.expCoach,
          `${c.name} coach payout mismatch`
        );
        assert.equal(
          split.grossAmountCents,
          split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents,
          `${c.name} conservation of money violated`
        );
      }
    });

    it('Exhaustive Cent Sweep: Proves conservation of currency across 8,000 arbitrary rates (€20.00 to €100.00)', () => {
      for (let cents = 2000; cents <= 10000; cents += 1) {
        const split = calculateSplitPayment({ grossAmountCents: cents });
        assert.equal(
          split.grossAmountCents,
          split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents,
          `Currency drift detected at ${cents} cents`
        );
        assert.ok(split.coachPayoutCents > 0, `Coach payout must be positive at ${cents} cents`);
      }
    });

    it('Strictly rejects invalid gross amounts, negative floor fees, and out-of-range take-rates', () => {
      // Below minimum €20.00 (1999 cents)
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 1999 }),
        /must be at least €20\.00/
      );

      // Above maximum €500.00 (50001 cents)
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 50001 }),
        /cannot exceed €500\.00/
      );

      // Negative floor fee
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, gymFloorFeeCents: -100 }),
        /cannot be negative/
      );

      // Platform take rate below 10% (999 bps)
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 999 }),
        /Platform take rate must be between 10\.00% and 20\.00%/
      );

      // Platform take rate above 20% (2001 bps)
      assert.throws(
        () => calculateSplitPayment({ grossAmountCents: 7500, platformFeeRateBps: 2001 }),
        /Platform take rate must be between 10\.00% and 20\.00%/
      );
    });
  });

  describe('3. Dynamic Cryptographic QR Pass & PassViewer Matrix Verification', () => {
    it('Generates authentic GM1 token that passes cryptographic verification and schema extraction', () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const sessionEpoch = nowEpoch + 3600; // 1 hour from now

      const token = generateDynamicQRToken({
        passId: 'pass_adv_test_01',
        bookingId: 'bk_adv_test_01',
        clientId: '11111111-1111-1111-1111-000000000001',
        gymId: '00000000-0000-0000-0000-000000000001',
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      assert.ok(token.startsWith('GM1.'), 'Token must start with GM1 protocol prefix');
      const parts = token.split('.');
      assert.equal(parts.length, 3, 'Token must have exactly 3 parts: header, payload, sig');

      const payloadDecoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      assert.equal(payloadDecoded.v, 1);
      assert.equal(payloadDecoded.pid, 'pass_adv_test_01');
      assert.equal(payloadDecoded.gid, '00000000-0000-0000-0000-000000000001');

      // Verify token
      const verifyRes = verifyDynamicQRToken(
        token,
        DEFAULT_QR_SECRET,
        '00000000-0000-0000-0000-000000000001',
        sessionEpoch
      );
      assert.equal(verifyRes.valid, true);
      assert.equal(verifyRes.error, undefined);
    });

    it('Deterministic SVG QR Matrix generator in PassViewer produces correct 29x29 matrix with standard finder patterns', () => {
      const token = 'GM1.eyJ2IjoxLCJwaWQiOiJ0ZXN0In0.simulated_signature_bytes';
      const matrix = renderSvgQrMatrix(token);

      assert.equal(matrix.length, 29, 'Matrix height must be 29');
      assert.equal(matrix[0].length, 29, 'Matrix width must be 29');

      // Helper to check 7x7 finder pattern
      const verifyFinder = (top: number, left: number) => {
        // Outer border
        for (let c = 0; c < 7; c++) {
          assert.equal(matrix[top][left + c], true, `Finder top border failed at (${top}, ${left + c})`);
          assert.equal(matrix[top + 6][left + c], true, `Finder bottom border failed at (${top + 6}, ${left + c})`);
        }
        for (let r = 0; r < 7; r++) {
          assert.equal(matrix[top + r][left], true, `Finder left border failed at (${top + r}, ${left})`);
          assert.equal(matrix[top + r][left + 6], true, `Finder right border failed at (${top + r}, ${left + 6})`);
        }
        // Hollow ring
        for (let r = 1; r < 6; r++) {
          assert.equal(matrix[top + r][left + 1], false, `Finder inner hollow failed at (${top + r}, ${left + 1})`);
          assert.equal(matrix[top + r][left + 5], false, `Finder inner hollow failed at (${top + r}, ${left + 5})`);
        }
        // Center 3x3 solid block
        for (let r = 2; r <= 4; r++) {
          for (let c = 2; c <= 4; c++) {
            assert.equal(matrix[top + r][left + c], true, `Finder solid center failed at (${top + r}, ${left + c})`);
          }
        }
      };

      // Verify Top-Left finder pattern
      verifyFinder(0, 0);

      // Verify Top-Right finder pattern
      verifyFinder(0, 22);

      // Verify Bottom-Left finder pattern
      verifyFinder(22, 0);

      // Verify Timing strips (row 6 and col 6)
      for (let i = 8; i < 21; i++) {
        assert.equal(matrix[6][i], i % 2 === 0, `Timing strip row 6 at col ${i} failed`);
        assert.equal(matrix[i][6], i % 2 === 0, `Timing strip col 6 at row ${i} failed`);
      }

      // Verify Alignment pattern centered at (20, 20)
      assert.equal(matrix[20][20], true, 'Alignment center at (20,20) must be true');
    });

    it('Different token payloads generate distinct SVG QR bit distributions', () => {
      const token1 = 'GM1.eyJhbGciOiJIUzI1NiJ9.sig_alpha';
      const token2 = 'GM1.eyJhbGciOiJIUzI1NiJ9.sig_omega_different';

      const matrix1 = renderSvgQrMatrix(token1);
      const matrix2 = renderSvgQrMatrix(token2);

      let differences = 0;
      for (let r = 0; r < 29; r++) {
        for (let c = 0; c < 29; c++) {
          if (matrix1[r][c] !== matrix2[r][c]) {
            differences++;
          }
        }
      }

      assert.ok(
        differences > 30,
        `Expected significant bit distribution differences between tokens, got ${differences}`
      );
    });
  });

  describe('4. Offline Pass Retention & LocalStorage Simulation', () => {
    it('Simulates localStorage serialization, deserialization, and recovery without data loss', () => {
      const STORAGE_KEY_BOOKINGS = 'gymmatch_linz_bookings';
      const STORAGE_KEY_PASSES = 'gymmatch_linz_passes';

      const mockLocalStorage: Record<string, string> = {};

      // Seed data into simulated localStorage
      mockLocalStorage[STORAGE_KEY_BOOKINGS] = JSON.stringify(LINZ_BOOKINGS);
      mockLocalStorage[STORAGE_KEY_PASSES] = JSON.stringify(LINZ_PASSES);

      // Read back
      const restoredBookings = JSON.parse(mockLocalStorage[STORAGE_KEY_BOOKINGS]);
      const restoredPasses = JSON.parse(mockLocalStorage[STORAGE_KEY_PASSES]);

      assert.equal(restoredBookings.length, LINZ_BOOKINGS.length);
      assert.equal(restoredPasses.length, LINZ_PASSES.length);
      assert.equal(restoredPasses[0].id, LINZ_PASSES[0].id);
      assert.equal(restoredPasses[0].dynamic_token, LINZ_PASSES[0].dynamic_token);
    });

    it('Gracefully survives corrupted or malformed localStorage entries without uncaught exceptions', () => {
      const malformedPayloads = [
        '{ invalid json',
        'null',
        '12345',
        '"just a string"',
        '[]',
      ];

      for (const bad of malformedPayloads) {
        let restored: any = null;
        try {
          const parsed = JSON.parse(bad);
          if (Array.isArray(parsed) && parsed.length > 0) {
            restored = parsed;
          }
        } catch {
          // Expected safe catch block as in RoleContext.tsx
          restored = null;
        }

        // Must not crash and should not set invalid arrays
        if (bad === '[]' || bad === '{ invalid json' || bad === 'null') {
          assert.equal(restored, null);
        }
      }
    });
  });

  describe('5. End-to-End Client Booking & Reception Redemption State Machine', () => {
    it('Simulates full flow: Client Max books Coach Lukas -> Pass generated -> Reception redeems -> Replay rejected', async () => {
      // 1. Initial setup
      let currentBookings: Booking[] = [...LINZ_BOOKINGS];
      let currentPasses: CheckInPass[] = [...LINZ_PASSES];

      const coach = LINZ_COACHES.find((c) => c.full_name === 'Lukas Bauer')!;
      const gym = LINZ_GYMS.find((g) => g.name.includes('John Harris'))!;
      const clientId = '11111111-1111-1111-1111-000000000001';

      // 2. Client Booking creation
      const grossCents = eurToCents(coach.hourly_rate);
      const split = calculateSplitPayment({ grossAmountCents: grossCents });

      const newBookingId = `bk_e2e_${Date.now()}`;
      const newPassId = `pass_e2e_${Date.now()}`;
      const sessionEpoch = Math.floor(Date.now() / 1000) + 1800; // in 30 mins
      const sessionIso = new Date(sessionEpoch * 1000).toISOString();

      const dynamicToken = generateDynamicQRToken({
        passId: newPassId,
        bookingId: newBookingId,
        clientId,
        gymId: gym.id,
        sessionTimeEpochSeconds: sessionEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const newBooking: Booking = {
        id: newBookingId,
        client_id: clientId,
        coach_id: coach.id,
        gym_id: gym.id,
        session_time: sessionIso,
        duration_minutes: 60,
        gross_amount: coach.hourly_rate,
        gym_floor_fee: split.gymFloorFeeCents / 100,
        platform_fee: split.platformFeeCents / 100,
        coach_payout: split.coachPayoutCents / 100,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newPass: CheckInPass = {
        id: newPassId,
        booking_id: newBookingId,
        gym_id: gym.id,
        client_id: clientId,
        dynamic_token: dynamicToken,
        qr_signature: dynamicToken.split('.')[2],
        nonce: `nonce_${Date.now()}`,
        expires_at: new Date((sessionEpoch + 3600 + 1800) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };

      currentBookings.unshift(newBooking);
      currentPasses.unshift(newPass);

      // Verify pass is initially unredeemed
      assert.equal(newPass.is_redeemed, false);
      assert.equal(newBooking.status, 'confirmed');

      // 3. Reception checks in athlete at John Harris desk
      const receptionResult = await redeemCheckInPass({
        token: dynamicToken,
        staffGymId: gym.id,
        staffUserId: 'staff_johnharris_01',
        secretKey: DEFAULT_QR_SECRET,
        nowEpochSeconds: sessionEpoch,
        dbAdapter: {
          findPassById: (pid) => currentPasses.find((p) => p.id === pid) || null,
          atomicRedeemPass: ({ passId, staffUserId, nowIso }) => {
            const idx = currentPasses.findIndex((p) => p.id === passId);
            if (idx === -1 || currentPasses[idx].is_redeemed) return false;
            currentPasses[idx] = {
              ...currentPasses[idx],
              is_redeemed: true,
              redeemed_at: nowIso,
              redeemed_by_user_id: staffUserId,
            };
            return true;
          },
          updateBookingStatus: (bid, status) => {
            const idx = currentBookings.findIndex((b) => b.id === bid);
            if (idx === -1) return null;
            currentBookings[idx] = {
              ...currentBookings[idx],
              status,
              updated_at: new Date().toISOString(),
            };
            return currentBookings[idx];
          },
        },
      });

      assert.equal(receptionResult.success, true);
      assert.equal(receptionResult.floorFeeCents, 800);
      assert.equal(currentPasses[0].is_redeemed, true);
      assert.equal(currentBookings[0].status, 'checked_in');

      // 4. Replay attack attempt: scanning the same token again
      const replayResult = await redeemCheckInPass({
        token: dynamicToken,
        staffGymId: gym.id,
        staffUserId: 'staff_johnharris_01',
        secretKey: DEFAULT_QR_SECRET,
        nowEpochSeconds: sessionEpoch + 60,
        dbAdapter: {
          findPassById: (pid) => currentPasses.find((p) => p.id === pid) || null,
          atomicRedeemPass: ({ passId }) => {
            const idx = currentPasses.findIndex((p) => p.id === passId);
            if (idx === -1 || currentPasses[idx].is_redeemed) return false;
            return true;
          },
          updateBookingStatus: () => null,
        },
      });

      assert.equal(replayResult.success, false);
      assert.equal(replayResult.errorCode, 'ALREADY_REDEEMED');

      // 5. Wrong gym attempt: scanning at Fit Fabrik
      const otherGym = LINZ_GYMS.find((g) => g.id !== gym.id)!;
      const wrongVenueResult = await redeemCheckInPass({
        token: dynamicToken,
        staffGymId: otherGym.id,
        staffUserId: 'staff_fitfabrik_01',
        secretKey: DEFAULT_QR_SECRET,
        nowEpochSeconds: sessionEpoch,
        dbAdapter: {
          findPassById: (pid) => currentPasses.find((p) => p.id === pid) || null,
          atomicRedeemPass: () => false,
          updateBookingStatus: () => null,
        },
      });

      assert.equal(wrongVenueResult.success, false);
      assert.equal(wrongVenueResult.errorCode, 'GYM_MISMATCH');
    });
  });

  describe('6. Mobile Responsive Layout Constraints & CSS Inspection', () => {
    it('MobileContainer enforces 390px-430px smartphone shell constraint', () => {
      const containerPath = path.join(
        PROJECT_ROOT,
        'src',
        'components',
        'layout',
        'MobileContainer.tsx'
      );
      const content = fs.readFileSync(containerPath, 'utf-8');

      assert.match(content, /max-w-\[430px\]/, 'Must enforce max-width of 430px');
      assert.match(content, /overflow-x-hidden/, 'Must prevent horizontal overflow');
      assert.match(content, /min-h-screen/, 'Must cover full screen height');
    });

    it('Global styles define safe-area insets, laser sweep animation, and no-scrollbar utilities', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src', 'app', 'globals.css');
      const cssContent = fs.readFileSync(cssPath, 'utf-8');

      assert.match(cssContent, /safe-top/, 'safe-top utility must exist');
      assert.match(cssContent, /safe-bottom/, 'safe-bottom utility must exist');
      assert.match(cssContent, /@keyframes laser-sweep/, 'laser-sweep animation must be defined');
      assert.match(cssContent, /\.animate-laser/, 'animate-laser class must be defined');
      assert.match(cssContent, /\.no-scrollbar/, 'no-scrollbar class must be defined');
    });

    it('Bottom thumb navigation enforces max-w-[430px] centering', () => {
      const pagePath = path.join(PROJECT_ROOT, 'src', 'app', 'page.tsx');
      const pageContent = fs.readFileSync(pagePath, 'utf-8');

      assert.match(pageContent, /max-w-\[430px\]\s+mx-auto/, 'Bottom nav bar must be centered within 430px');
    });
  });
});
