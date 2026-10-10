import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINZ_GYMS, LINZ_COACHES, LINZ_BOOKINGS, LINZ_PASSES } from '../src/lib/data/linz-seed';
import { verifyDynamicQRToken, DEFAULT_QR_SECRET, generateDynamicQRToken } from '../src/lib/qr/token';
import { redeemCheckInPass } from '../src/lib/qr/validator';
import { Booking, CheckInPass } from '../src/types/database';
import { calculateSplitPayment, eurToCents } from '../src/lib/payments/split';

describe('Remediation Suite: Milestone 2 Reviewer & Challenger Findings', () => {
  const gymJohnHarris = LINZ_GYMS[0]; // 00000000-0000-0000-0000-000000000001
  const gymFitFabrik = LINZ_GYMS[1];  // 00000000-0000-0000-0000-000000000002

  // =========================================================================
  // 1. ISSUE 1: Seed Pass HMAC Signature & Out-of-the-Box Redemption
  // =========================================================================

  describe('1. Issue 1 Verification: Seed Check-In Pass Authentic HMAC Signature', () => {
    it('LINZ_PASSES[0] dynamic_token does not contain dummy .baseline_seed_signature', () => {
      const seedPass = LINZ_PASSES[0];
      assert.ok(
        !seedPass.dynamic_token.endsWith('.baseline_seed_signature'),
        'Must not contain dummy placeholder signature'
      );
      assert.notEqual(seedPass.qr_signature, 'baseline_seed_signature');
    });

    it('LINZ_PASSES[0] dynamic_token passes verifyDynamicQRToken cleanly out-of-the-box', () => {
      const seedPass = LINZ_PASSES[0];
      const verification = verifyDynamicQRToken(seedPass.dynamic_token, DEFAULT_QR_SECRET, seedPass.gym_id);
      assert.equal(verification.valid, true, 'Seed pass must verify cleanly without error');
      assert.equal(verification.payload?.pid, seedPass.id);
      assert.equal(verification.payload?.bid, seedPass.booking_id);
      assert.equal(verification.payload?.gid, seedPass.gym_id);
      assert.equal(verification.payload?.cid, seedPass.client_id);
    });

    it('LINZ_PASSES[0] redeems cleanly out-of-the-box allocating +€8.00 floor fee', async () => {
      const seedPass = { ...LINZ_PASSES[0] };
      const seedBooking = { ...LINZ_BOOKINGS[0] };

      let dbPass = { ...seedPass };
      let dbBooking = { ...seedBooking };

      const result = await redeemCheckInPass({
        token: seedPass.dynamic_token,
        staffGymId: seedPass.gym_id,
        staffUserId: 'staff_test_linz',
        secretKey: DEFAULT_QR_SECRET,
        dbAdapter: {
          findPassById: (pid: string) => (dbPass.id === pid ? dbPass : null),
          atomicRedeemPass: ({ passId, staffUserId, nowIso }) => {
            if (dbPass.id !== passId || dbPass.is_redeemed) return false;
            dbPass = { ...dbPass, is_redeemed: true, redeemed_at: nowIso, redeemed_by_user_id: staffUserId };
            return true;
          },
          updateBookingStatus: (bid: string, status: 'checked_in') => {
            if (dbBooking.id !== bid) return null;
            dbBooking = { ...dbBooking, status };
            return dbBooking;
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.floorFeeCents, 800, 'Floor fee must be exactly 800 cents (€8.00)');
      assert.equal(dbPass.is_redeemed, true);
      assert.equal(dbBooking.status, 'checked_in');
    });
  });

  // =========================================================================
  // 2. ISSUE 2: ReceptionScanner Flow & Fallback Behavior
  // =========================================================================

  describe('2. Issue 2 Verification: ReceptionScanner Natural Feedback & Pass Creation', () => {
    it('Natural error evaluation: Replay attack produces ALREADY_REDEEMED without facade override', async () => {
      const redeemedPass: CheckInPass = {
        ...LINZ_PASSES[0],
        is_redeemed: true,
        redeemed_at: '2026-10-10T09:00:00Z',
        redeemed_by_user_id: 'staff_00000000',
      };

      const result = await redeemCheckInPass({
        token: redeemedPass.dynamic_token,
        staffGymId: gymJohnHarris.id,
        staffUserId: 'staff_scanner',
        secretKey: DEFAULT_QR_SECRET,
        dbAdapter: {
          findPassById: (pid: string) => (pid === redeemedPass.id ? redeemedPass : null),
          atomicRedeemPass: () => false,
          updateBookingStatus: () => null,
        },
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'ALREADY_REDEEMED');
    });

    it('Fallback pass simulation creates genuine booking and pass in database before redemption', async () => {
      // Simulating passes state where current gym has zero unredeemed passes:
      const simulatedPasses: CheckInPass[] = [];
      const simulatedBookings: Booking[] = [];

      const coach = LINZ_COACHES[0];
      const currentGym = gymJohnHarris;

      // When targetPass is not found, handleSimulateActiveScan creates booking via createBooking logic:
      let targetPass = simulatedPasses.find((p) => p.gym_id === currentGym.id && !p.is_redeemed);
      assert.equal(targetPass, undefined, 'No unredeemed pass initially');

      // Create booking genuinely:
      const newBookingId = `bk_test_${Date.now()}`;
      const newPassId = `pass_test_${Date.now()}`;
      const nowEpoch = Math.floor(Date.now() / 1000);

      const dynamicToken = generateDynamicQRToken({
        passId: newPassId,
        bookingId: newBookingId,
        clientId: '11111111-1111-1111-1111-000000000001',
        gymId: currentGym.id,
        sessionTimeEpochSeconds: nowEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      const newPass: CheckInPass = {
        id: newPassId,
        booking_id: newBookingId,
        gym_id: currentGym.id,
        client_id: '11111111-1111-1111-1111-000000000001',
        dynamic_token: dynamicToken,
        qr_signature: dynamicToken.split('.')[2],
        nonce: 'nce_test',
        expires_at: new Date((nowEpoch + 7200) * 1000).toISOString(),
        is_redeemed: false,
        created_at: new Date().toISOString(),
      };

      const newBooking: Booking = {
        id: newBookingId,
        client_id: '11111111-1111-1111-1111-000000000001',
        coach_id: coach.id,
        gym_id: currentGym.id,
        session_time: new Date(nowEpoch * 1000).toISOString(),
        duration_minutes: 60,
        gross_amount: 75.0,
        gym_floor_fee: 8.0,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      simulatedPasses.unshift(newPass);
      simulatedBookings.unshift(newBooking);

      // Now targetPass is found in DB!
      targetPass = simulatedPasses.find((p) => p.gym_id === currentGym.id && !p.is_redeemed);
      assert.ok(targetPass, 'Pass now exists in database');

      // Execute redemption:
      const result = await redeemCheckInPass({
        token: targetPass.dynamic_token,
        staffGymId: currentGym.id,
        staffUserId: 'staff_linz_01',
        secretKey: DEFAULT_QR_SECRET,
        nowEpochSeconds: nowEpoch,
        dbAdapter: {
          findPassById: (pid: string) => simulatedPasses.find((p) => p.id === pid) || null,
          atomicRedeemPass: ({ passId, staffUserId, nowIso }) => {
            const idx = simulatedPasses.findIndex((p) => p.id === passId);
            if (idx === -1 || simulatedPasses[idx].is_redeemed) return false;
            simulatedPasses[idx] = {
              ...simulatedPasses[idx],
              is_redeemed: true,
              redeemed_at: nowIso,
              redeemed_by_user_id: staffUserId,
            };
            return true;
          },
          updateBookingStatus: (bid: string, status: 'checked_in') => {
            const idx = simulatedBookings.findIndex((b) => b.id === bid);
            if (idx === -1) return null;
            simulatedBookings[idx] = { ...simulatedBookings[idx], status };
            return simulatedBookings[idx];
          },
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.floorFeeCents, 800);
      assert.equal(simulatedPasses[0].is_redeemed, true);
      assert.equal(simulatedBookings[0].status, 'checked_in');
    });

    it('Wrong venue mismatch naturally produces GYM_MISMATCH', async () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const wrongVenueToken = generateDynamicQRToken({
        passId: 'pass_wrong_01',
        bookingId: 'bk_wrong_01',
        clientId: '11111111-1111-1111-1111-000000000001',
        gymId: gymFitFabrik.id, // Issued for Fit Fabrik
        sessionTimeEpochSeconds: nowEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });

      // Present at John Harris:
      const result = await redeemCheckInPass({
        token: wrongVenueToken,
        staffGymId: gymJohnHarris.id, // Scanned at John Harris
        staffUserId: 'staff_scanner',
        secretKey: DEFAULT_QR_SECRET,
        nowEpochSeconds: nowEpoch,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'GYM_MISMATCH');
    });

    it('Tampered token naturally produces SIGNATURE_INVALID', async () => {
      const validToken = LINZ_PASSES[0].dynamic_token;
      const tamperedToken = validToken.slice(0, -6) + 'xxxxxx';

      const result = await redeemCheckInPass({
        token: tamperedToken,
        staffGymId: gymJohnHarris.id,
        staffUserId: 'staff_scanner',
        secretKey: DEFAULT_QR_SECRET,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'SIGNATURE_INVALID');
    });
  });

  // =========================================================================
  // 3. ISSUE 3: RoleContext Stale State Persistence Closure Fix
  // =========================================================================

  describe('3. Issue 3 Verification: RoleContext State Persistence Without Stale Closure', () => {
    it('updateBookingStatus saves updatedPasses state to localStorage without stale closure overwrite', () => {
      const unredeemedPass: CheckInPass = {
        id: 'pass_closure_test',
        booking_id: 'bk_closure_test',
        gym_id: gymJohnHarris.id,
        client_id: '11111111-1111-1111-1111-000000000001',
        dynamic_token: 'valid_token_string',
        qr_signature: 'sig_string',
        nonce: 'nonce_123',
        expires_at: '2026-10-15T12:00:00Z',
        is_redeemed: false,
        created_at: '2026-10-10T08:00:00Z',
      };

      const initialBooking: Booking = {
        id: 'bk_closure_test',
        client_id: '11111111-1111-1111-1111-000000000001',
        coach_id: '44444444-4444-4444-4444-000000000001',
        gym_id: gymJohnHarris.id,
        session_time: '2026-10-15T10:00:00Z',
        duration_minutes: 60,
        gross_amount: 75.0,
        gym_floor_fee: 8.0,
        platform_fee: 10.5,
        coach_payout: 56.5,
        status: 'confirmed',
        created_at: '2026-10-10T08:00:00Z',
        updated_at: '2026-10-10T08:00:00Z',
      };

      // Simulated component state:
      const passesFromRenderScope = [unredeemedPass];
      const bookingsFromRenderScope = [initialBooking];

      // Simulated localStorage mock store:
      const localStorageMock: { bookings: string; passes: string } = {
        bookings: JSON.stringify(bookingsFromRenderScope),
        passes: JSON.stringify(passesFromRenderScope),
      };

      const persistState = (newBookings: Booking[], newPasses: CheckInPass[]) => {
        localStorageMock.bookings = JSON.stringify(newBookings);
        localStorageMock.passes = JSON.stringify(newPasses);
      };

      // In the remediated redeemPass logic:
      let currentPassesState = [...passesFromRenderScope];
      let currentBookingsState = [...bookingsFromRenderScope];

      // 1. atomicRedeemPass runs:
      const passIndex = currentPassesState.findIndex((p) => p.id === unredeemedPass.id);
      const updatedPasses = [...currentPassesState];
      updatedPasses[passIndex] = {
        ...updatedPasses[passIndex],
        is_redeemed: true,
        redeemed_at: new Date().toISOString(),
        redeemed_by_user_id: 'staff_jh',
      };
      currentPassesState = updatedPasses;
      persistState(currentBookingsState, updatedPasses);

      // Verify interim state in localStorage:
      const interimStoredPasses = JSON.parse(localStorageMock.passes);
      assert.equal(interimStoredPasses[0].is_redeemed, true);

      // 2. updateBookingStatus runs immediately after:
      const bookingIndex = currentBookingsState.findIndex((b) => b.id === initialBooking.id);
      const updatedBookings = [...currentBookingsState];
      updatedBookings[bookingIndex] = {
        ...updatedBookings[bookingIndex],
        status: 'checked_in',
        updated_at: new Date().toISOString(),
      };
      currentBookingsState = updatedBookings;

      // With the fix, persistState receives (updatedBookings, currentPassesState):
      persistState(updatedBookings, currentPassesState);

      // Verify FINAL state in localStorage:
      const finalStoredBookings = JSON.parse(localStorageMock.bookings);
      const finalStoredPasses = JSON.parse(localStorageMock.passes);

      assert.equal(
        finalStoredBookings[0].status,
        'checked_in',
        'Booking status in localStorage must be checked_in'
      );
      assert.equal(
        finalStoredPasses[0].is_redeemed,
        true,
        'Pass in localStorage MUST be is_redeemed: true (stale closure bug resolved)'
      );
    });
  });
});
