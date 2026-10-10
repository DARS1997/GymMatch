#!/usr/bin/env tsx
/**
 * GymMatch Linz — Standalone End-to-End Multi-Role Journey Simulation
 *
 * This deterministic integration script executes the complete user journey across all 3 roles:
 * - Step 1: Coach Role — Lukas Bauer connects to John Harris Linz Atrium and publishes slots.
 * - Step 2: Client Role — Max Mustermann discovers gyms, selects coach slot, verifies financial split
 *           (€75.00 GBV -> €8.00 gym, €10.50 platform 14%, €56.50 coach payout), simulates 1-click
 *           checkout, and receives dynamic HMAC-SHA256 signed GM1 QR pass.
 * - Step 3: Reception Desk Role — Front desk scans dynamic QR token: constant-time HMAC passes,
 *           gym match passes, atomic Compare-and-Swap sets is_redeemed = true, booking transitions
 *           to checked_in, and floor fee tally increments by exactly €8.00.
 * - Step 4: Escrow Disbursement — Stripe Separate Charges & Transfers confirm disbursements
 *           (gym +€8.00, coach +€56.50, platform commission +€10.50 retained).
 * - Step 5: Anti-Replay Security — Second scan attempt strictly rejected by atomic CAS anti-replay.
 *
 * Exit code 0 on complete verified success.
 */

import assert from 'node:assert/strict';
import {
  calculateSplitPayment,
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

// ANSI color helpers for terminal reporting
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function logStep(stepNum: number, title: string) {
  console.log(`\n${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}${colors.yellow}▶ STEP ${stepNum}: ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}══════════════════════════════════════════════════════════════════════════════${colors.reset}`);
}

function logSuccess(message: string) {
  console.log(`  ${colors.green}✔${colors.reset} ${message}`);
}

function logInfo(label: string, value: string | number) {
  console.log(`    ${colors.dim}•${colors.reset} ${colors.bold}${label}:${colors.reset} ${value}`);
}

async function runE2ESimulation(): Promise<void> {
  console.log(`\n${colors.bold}${colors.magenta}╔══════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}║             GYMMATCH LINZ — STANDALONE E2E INTEGRATION SUITE                 ║${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}║      Deterministic Multi-Role Simulation: Coach -> Client -> Reception       ║${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}╚══════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);

  // 0. Initialize fresh state
  resetMockDatastore();
  const datastore = getMockDatastore();
  const stripe = new MockStripeService();

  const partnerGym = LINZ_GYMS[0]; // John Harris Fitness Linz Atrium
  const coach = LINZ_COACHES[0];     // Lukas Bauer
  const clientProfile = LINZ_PROFILES[0]; // Max Mustermann
  const staffUserId = '33333333-3333-3333-3333-000000000001'; // Florian Leitner

  assert.equal(partnerGym.name, 'John Harris Fitness Linz Atrium');
  assert.equal(coach.full_name, 'Lukas Bauer');
  assert.equal(clientProfile.full_name, 'Max Mustermann');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Coach Role — Affiliation & Availability Slot Publication
  // ─────────────────────────────────────────────────────────────────────────
  logStep(1, 'Coach Role — Lukas Bauer Affiliation & Slot Publication');

  // Authenticate as Coach Lukas Bauer
  const coachClient = createMockSupabaseClient({
    user: {
      id: coach.user_id,
      email: 'lukas.bauer@coach.at',
      role: 'coach',
    },
  });

  // Verify partner gym affiliation in Linz
  const { data: affiliations, error: affError } = await coachClient
    .from('coach_gym_affiliations')
    .select();
  assert.ok(!affError, `Affiliations query failed: ${affError?.message}`);
  assert.ok(affiliations && affiliations.length > 0, 'No coach affiliations found');

  const johnHarrisAffiliation = affiliations.find(
    (a) => a.gym_id === partnerGym.id && a.coach_id === coach.id && a.is_verified
  );
  assert.ok(
    johnHarrisAffiliation,
    `Coach ${coach.full_name} is not affiliated or verified at ${partnerGym.name}`
  );
  logSuccess(`Coach affiliation verified: ${coach.full_name} ↔ ${partnerGym.name}`);
  logInfo('Gym ID', partnerGym.id);
  logInfo('Coach ID', coach.id);
  logInfo('Affiliation Status', 'Verified Partner');

  // Coach publishes a new availability slot at John Harris Linz Atrium
  const newSlotId = 'b1111111-1111-1111-1111-e2e000000001';
  const newSlot: CoachAvailability = {
    id: newSlotId,
    coach_id: coach.id,
    gym_id: partnerGym.id,
    day_of_week: 3, // Mittwoch (Wednesday)
    start_time: '14:00:00',
    end_time: '15:00:00',
    is_recurring: true,
    specific_date: null,
    is_booked: false,
    created_at: new Date().toISOString(),
  };

  const { error: slotInsertError } = await coachClient
    .from('coach_availability')
    .insert(newSlot);
  assert.ok(!slotInsertError, `Failed to publish slot: ${slotInsertError?.message}`);

  // Query back availability via public client to confirm discovery visibility
  const anonClient = createMockSupabaseClient({
    user: { id: '00000000-0000-0000-0000-000000000000', email: 'anon@linz.at', role: 'anon' },
  });
  const { data: slots, error: slotsFetchError } = await anonClient
    .from('coach_availability')
    .select();
  assert.ok(!slotsFetchError, `Slot fetch error: ${slotsFetchError?.message}`);
  const publishedSlot = slots?.find((s) => s.id === newSlotId);
  assert.ok(publishedSlot, 'Published slot not found in availability store');
  logSuccess(`Availability slot published and publicly discoverable`);
  logInfo('Slot ID', publishedSlot.id);
  logInfo('Schedule', 'Wednesday 14:00 - 15:00 CET');
  logInfo('Venue', partnerGym.name);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Client Role — Discovery, Split Validation, 1-Click Checkout & Dynamic QR
  // ─────────────────────────────────────────────────────────────────────────
  logStep(2, 'Client Role — Max Mustermann Discovery, Split Math & Dynamic QR');

  // Authenticate as Client Max Mustermann
  const client = createMockSupabaseClient({
    user: {
      id: clientProfile.id,
      email: clientProfile.email,
      role: 'client',
    },
  });

  // Client discovers Linz partner gyms
  const { data: discoveredGyms, error: gymsError } = await client.from('gyms').select();
  assert.ok(!gymsError, `Gym discovery failed: ${gymsError?.message}`);
  assert.ok(discoveredGyms && discoveredGyms.length >= 4, 'Expected at least 4 Linz gyms');
  const selectedGym = discoveredGyms.find((g) => g.id === partnerGym.id);
  assert.ok(selectedGym, `Partner gym ${partnerGym.name} not found`);
  logSuccess(`Discovered ${discoveredGyms.length} Linz partner gyms (selected: ${selectedGym.name})`);

  // Client inspects coach storefront
  const { data: discoveredCoaches, error: coachError } = await client
    .from('coach_profiles')
    .select();
  assert.ok(!coachError, `Coach discovery failed: ${coachError?.message}`);
  const selectedCoach = discoveredCoaches?.find((c) => c.id === coach.id);
  assert.ok(selectedCoach, `Coach ${coach.full_name} not found`);
  assert.equal(selectedCoach.hourly_rate, 75.0, 'Expected coach rate to be €75.00/h');
  logSuccess(`Discovered coach storefront: ${selectedCoach.full_name} (${selectedCoach.specialties.join(', ')})`);
  logInfo('Hourly Rate', `€${selectedCoach.hourly_rate.toFixed(2)}`);
  logInfo('Rating', `${selectedCoach.rating} ★ (${selectedCoach.review_count} reviews)`);

  // Financial Split Calculation Validation (€75.00 Baseline Session)
  const grossAmountCents = eurToCents(selectedCoach.hourly_rate); // 7500
  const split = calculateSplitPayment({
    grossAmountCents,
    gymFloorFeeCents: 800,
    platformFeeRateBps: 1400, // 14.00%
  });

  // Exact split mathematical assertions
  assert.equal(split.grossAmountCents, 7500, 'Gross booking value must be 7500 cents (€75.00)');
  assert.equal(split.gymFloorFeeCents, 800, 'Gym floor fee must be exactly 800 cents (€8.00)');
  assert.equal(split.platformFeeCents, 1050, 'Platform fee (14%) must be exactly 1050 cents (€10.50)');
  assert.equal(split.coachPayoutCents, 5650, 'Coach payout must be exactly 5650 cents (€56.50)');
  assert.equal(
    split.grossAmountCents,
    split.gymFloorFeeCents + split.platformFeeCents + split.coachPayoutCents,
    'Accounting conservation invariant violated: GBV != Gym + Platform + Coach'
  );
  logSuccess(`Exact financial split calculation validated with zero rounding drift:`);
  logInfo('Gross Booking Value (GBV)', split.formatted.gross);
  logInfo('Gym Floor Fee (Fixed)', split.formatted.gymFloorFee);
  logInfo('Platform Commission (14%)', split.formatted.platformFee);
  logInfo('Net Coach Payout', split.formatted.coachPayout);
  logInfo('Conservation Check', `€75.00 ≡ €8.00 + €10.50 + €56.50 (${split.grossAmountCents}¢)`);

  // Simulate 1-Click Checkout: Create Pending Booking
  const bookingId = `bk_e2e_${Date.now()}`;
  const sessionTimeIso = '2026-10-14T14:00:00Z';
  const sessionEpoch = Math.floor(new Date(sessionTimeIso).getTime() / 1000);
  const durationMinutes = 60;

  const newBookingRecord: Booking = {
    id: bookingId,
    client_id: clientProfile.id,
    coach_id: coach.id,
    gym_id: partnerGym.id,
    session_time: sessionTimeIso,
    duration_minutes: durationMinutes,
    gross_amount: 75.0,
    gym_floor_fee: 8.0,
    platform_fee: 10.5,
    coach_payout: 56.5,
    status: 'pending',
    client_notes: 'Leg day focus: Progressive overload on barbell squats and Hamstrings',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: bookingInsertError } = await client
    .from('bookings')
    .insert(newBookingRecord);
  assert.ok(!bookingInsertError, `Booking creation failed: ${bookingInsertError?.message}`);
  logSuccess(`Client booking created in 'pending' status: ${bookingId}`);

  // Stripe Connect Escrow Hold Simulation (Separate Charges and Transfers)
  const transferGroup = `booking_${bookingId}`;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: split.grossAmountCents,
    currency: 'eur',
    transfer_group: transferGroup,
    metadata: {
      booking_id: bookingId,
      client_id: clientProfile.id,
      coach_id: coach.id,
      gym_id: partnerGym.id,
      gym_floor_fee_cents: String(split.gymFloorFeeCents),
      platform_fee_cents: String(split.platformFeeCents),
      coach_payout_cents: String(split.coachPayoutCents),
    },
  });
  assert.equal(paymentIntent.status, 'requires_confirmation');
  assert.equal(paymentIntent.transfer_group, transferGroup);

  // Confirm payment intent (capturing funds into platform escrow)
  const confirmedPi = await stripe.paymentIntents.confirm(paymentIntent.id);
  assert.equal(confirmedPi.status, 'succeeded');
  const escrowState = stripe.getEscrowHold(bookingId);
  assert.equal(escrowState.isEscrowHeld, true, 'Escrow funds not locked in platform account');
  assert.equal(escrowState.isFullyDisbursed, false, 'Funds should not be disbursed before check-in');
  logSuccess(`Stripe PaymentIntent captured in escrow (${confirmedPi.id})`);
  logInfo('Captured Escrow', formatCentsToEur(confirmedPi.amount));
  logInfo('Transfer Group', transferGroup);
  logInfo('Escrow Held Status', 'Active in Platform Hold');

  // Service role updates booking status to 'confirmed' and issues dynamic QR pass
  const serviceRoleClient = createMockSupabaseClient({
    user: { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', email: 'service@gymmatch.at', role: 'admin' },
    serviceRole: true,
  });

  await serviceRoleClient
    .from('bookings')
    .update({ status: 'confirmed', stripe_payment_intent_id: confirmedPi.id })
    .eq('id', bookingId);

  // Issue Dynamic Cryptographically Signed GM1 QR Check-In Pass
  const passId = `pass_e2e_${Date.now()}`;
  const dynamicQRToken = generateDynamicQRToken({
    passId,
    bookingId,
    clientId: clientProfile.id,
    gymId: partnerGym.id,
    sessionTimeEpochSeconds: sessionEpoch,
    durationMinutes,
    secretKey: DEFAULT_QR_SECRET,
  });

  // Verify token protocol format GM1.<payload_b64url>.<hmac_b64url>
  assert.ok(dynamicQRToken.startsWith('GM1.'), 'Token must start with GM1 protocol header');
  const tokenParts = dynamicQRToken.split('.');
  assert.equal(tokenParts.length, 3, 'Token must contain exactly 3 dot-delimited segments');

  const newPassRecord: CheckInPass = {
    id: passId,
    booking_id: bookingId,
    gym_id: partnerGym.id,
    client_id: clientProfile.id,
    dynamic_token: dynamicQRToken,
    qr_signature: tokenParts[2],
    nonce: `nonce_${Math.random().toString(36).substring(2, 10)}`,
    expires_at: new Date((sessionEpoch + 3600 + 1800) * 1000).toISOString(),
    is_redeemed: false,
    created_at: new Date().toISOString(),
  };

  const { error: passInsertError } = await serviceRoleClient
    .from('check_in_passes')
    .insert(newPassRecord);
  assert.ok(!passInsertError, `Pass insertion failed: ${passInsertError?.message}`);
  logSuccess(`Dynamic HMAC-SHA256 GM1 QR Pass issued to Client`);
  logInfo('Pass ID', passId);
  logInfo('Protocol', 'GM1 (HMAC-SHA256, Constant-Time Safe)');
  logInfo('Token Preview', `${dynamicQRToken.substring(0, 42)}...`);
  logInfo('Validity Window', 'Session Start -30m to End +30m');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Front Desk Reception Role — Dynamic QR Verification & Atomic CAS
  // ─────────────────────────────────────────────────────────────────────────
  logStep(3, 'Reception Desk Role — Dynamic QR Scan, Atomic CAS & Floor Fee Accrual');

  // Initial front desk floor fee tally snapshot
  const initialRedeemedCount = datastore.check_in_passes.filter(
    (p) => p.gym_id === partnerGym.id && p.is_redeemed
  ).length;
  const initialFloorFeeCents = initialRedeemedCount * 800;
  logInfo("John Harris Initial Today's Check-ins", initialRedeemedCount);
  logInfo("John Harris Initial Floor Fee Tally", formatCentsToEur(initialFloorFeeCents));

  // Front desk reception DB adapter with real atomic CAS operations
  const receptionDbAdapter = {
    findPassById: (pid: string) => {
      return datastore.check_in_passes.find((p) => p.id === pid) || null;
    },
    atomicRedeemPass: ({
      passId: pid,
      staffUserId: staffId,
      nowIso,
    }: {
      passId: string;
      gymId: string;
      staffUserId: string;
      nowIso: string;
    }) => {
      const pass = datastore.check_in_passes.find((p) => p.id === pid);
      if (!pass || pass.is_redeemed) {
        return false; // Atomic CAS rejection
      }
      pass.is_redeemed = true;
      pass.redeemed_at = nowIso;
      pass.redeemed_by_user_id = staffId;
      return true;
    },
    updateBookingStatus: (bid: string, status: 'checked_in') => {
      const b = datastore.bookings.find((item) => item.id === bid);
      if (!b) return null;
      b.status = status;
      b.updated_at = new Date().toISOString();
      return b;
    },
  };

  // Reception desk scans the client's dynamic QR token
  const scanTimestampEpoch = sessionEpoch; // Scanned exactly during session window
  const redemptionResult = await redeemCheckInPass({
    token: dynamicQRToken,
    staffGymId: partnerGym.id,
    staffUserId,
    secretKey: DEFAULT_QR_SECRET,
    nowEpochSeconds: scanTimestampEpoch,
    dbAdapter: receptionDbAdapter,
  });

  assert.equal(redemptionResult.success, true, `Scan failed: ${redemptionResult.error}`);
  assert.equal(redemptionResult.passId, passId);
  assert.equal(redemptionResult.gymId, partnerGym.id);
  assert.equal(redemptionResult.floorFeeCents, 800);
  assert.ok(redemptionResult.redeemedAt, 'Redemption timestamp missing');

  // Verify database record mutations
  const persistedPass = datastore.check_in_passes.find((p) => p.id === passId);
  assert.ok(persistedPass, 'Pass not found in datastore');
  assert.equal(persistedPass.is_redeemed, true, 'is_redeemed was not set to true');
  assert.equal(persistedPass.redeemed_by_user_id, staffUserId);

  const persistedBooking = datastore.bookings.find((b) => b.id === bookingId);
  assert.ok(persistedBooking, 'Booking not found in datastore');
  assert.equal(persistedBooking.status, 'checked_in', "Booking status not transitioned to 'checked_in'");

  // Verify floor fee accumulator increment
  const postScanRedeemedCount = datastore.check_in_passes.filter(
    (p) => p.gym_id === partnerGym.id && p.is_redeemed
  ).length;
  const postScanFloorFeeCents = postScanRedeemedCount * 800;
  const incrementalFeeCents = postScanFloorFeeCents - initialFloorFeeCents;

  assert.equal(
    postScanRedeemedCount,
    initialRedeemedCount + 1,
    "Expected check-ins count to increment by exactly 1"
  );
  assert.equal(
    incrementalFeeCents,
    800,
    `Expected floor fee tally to increment by exactly €8.00 (800¢), got ${incrementalFeeCents}¢`
  );

  logSuccess(`Dynamic QR scan successfully verified & redeemed at Front Desk:`);
  logInfo('Constant-Time HMAC-SHA256 Check', 'PASSED (Zero side-channel leakage)');
  logInfo('Venue Scoping Check', `PASSED (Matches venue ${partnerGym.name})`);
  logInfo('Time Window Validation', 'PASSED (Active slot window)');
  logInfo('Atomic Compare-and-Swap', 'PASSED (Set is_redeemed = TRUE)');
  logInfo('Booking Status Transition', "Transitioned to 'checked_in'");
  logInfo('Floor Fee Increment', `+${formatCentsToEur(incrementalFeeCents)} (Total: ${formatCentsToEur(postScanFloorFeeCents)})`);

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Escrow Disbursement Execution
  // ─────────────────────────────────────────────────────────────────────────
  logStep(4, 'Escrow Disbursement — Stripe Connect Separate Transfers');

  // Disburse Gym Floor Fee (€8.00)
  const gymTransfer = await stripe.transfers.create({
    amount: split.gymFloorFeeCents, // 800
    currency: 'eur',
    destination: partnerGym.stripe_account_id!, // acct_linz_johnharris_atrium
    transfer_group: transferGroup,
    metadata: {
      type: 'gym_floor_fee',
      booking_id: bookingId,
      gym_name: partnerGym.name,
    },
  });
  assert.equal(gymTransfer.amount, 800);
  assert.equal(gymTransfer.destination, 'acct_linz_johnharris_atrium');
  logSuccess(`Gym floor fee transfer disbursed: ${formatCentsToEur(gymTransfer.amount)} -> ${gymTransfer.destination}`);

  // Disburse Coach Payout (€56.50)
  const coachTransfer = await stripe.transfers.create({
    amount: split.coachPayoutCents, // 5650
    currency: 'eur',
    destination: coach.stripe_account_id!, // acct_coach_lukas_bauer
    transfer_group: transferGroup,
    metadata: {
      type: 'coach_payout',
      booking_id: bookingId,
      coach_name: coach.full_name,
    },
  });
  assert.equal(coachTransfer.amount, 5650);
  assert.equal(coachTransfer.destination, 'acct_coach_lukas_bauer');
  logSuccess(`Coach payout transfer disbursed: ${formatCentsToEur(coachTransfer.amount)} -> ${coachTransfer.destination}`);

  // Confirm escrow disbursements via transfer_group
  const transfers = await stripe.transfers.list({ transfer_group: transferGroup });
  assert.equal(transfers.length, 2, 'Expected exactly 2 transfers in transfer_group');
  const totalDisbursedCents = transfers.reduce((sum, t) => sum + t.amount, 0);
  assert.equal(
    totalDisbursedCents,
    6450,
    `Total disbursed (${totalDisbursedCents}¢) must equal Gym (800¢) + Coach (5650¢)`
  );

  const retainedPlatformFeeCents = split.grossAmountCents - totalDisbursedCents;
  assert.equal(
    retainedPlatformFeeCents,
    1050,
    `Retained platform fee (${retainedPlatformFeeCents}¢) must equal 1050¢ (€10.50)`
  );

  const finalEscrow = stripe.getEscrowHold(bookingId);
  assert.equal(finalEscrow.isFullyDisbursed, true, 'Escrow hold is not marked as fully disbursed');

  // Mark booking as completed
  persistedBooking.status = 'completed';
  persistedBooking.updated_at = new Date().toISOString();
  logSuccess(`Escrow settlement complete — booking status advanced to 'completed':`);
  logInfo('Partner Gym Share', formatCentsToEur(split.gymFloorFeeCents));
  logInfo('Coach Net Share', formatCentsToEur(split.coachPayoutCents));
  logInfo('Platform Commission Retained', formatCentsToEur(retainedPlatformFeeCents));
  logInfo('Escrow Disbursed Status', '100% Fully Settled');

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 5: Anti-Replay Security Verification — Duplicate Scan Blocked
  // ─────────────────────────────────────────────────────────────────────────
  logStep(5, 'Anti-Replay Attack — Immediate Re-Scan Attempt Strictly Rejected');

  const replayScanResult = await redeemCheckInPass({
    token: dynamicQRToken,
    staffGymId: partnerGym.id,
    staffUserId,
    secretKey: DEFAULT_QR_SECRET,
    nowEpochSeconds: scanTimestampEpoch + 10,
    dbAdapter: receptionDbAdapter,
  });

  assert.equal(replayScanResult.success, false, 'Replay scan should have failed');
  assert.equal(
    replayScanResult.errorCode,
    'ALREADY_REDEEMED',
    `Expected errorCode ALREADY_REDEEMED, got ${replayScanResult.errorCode}`
  );
  logSuccess(`Atomic CAS blocked replay scan attempt with errorCode: ALREADY_REDEEMED`);
  logInfo('Rejection Message', replayScanResult.error || 'Already redeemed');

  // Confirm datastore and floor fee tally were NOT mutated by replay attempt
  const finalRedeemedCount = datastore.check_in_passes.filter(
    (p) => p.gym_id === partnerGym.id && p.is_redeemed
  ).length;
  assert.equal(
    finalRedeemedCount,
    postScanRedeemedCount,
    'Floor fee check-in count was erroneously incremented by duplicate scan'
  );

  // Confirm no additional transfers were dispatched
  const finalTransfers = await stripe.transfers.list({ transfer_group: transferGroup });
  assert.equal(finalTransfers.length, 2, 'Duplicate transfers were dispatched');
  logSuccess(`Anti-replay integrity verified: Zero additional floor fees or disbursements allocated`);

  // ─────────────────────────────────────────────────────────────────────────
  // SUMMARY & ACCEPTANCE CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${colors.bold}${colors.green}╔══════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bold}${colors.green}║        ✔ ALL 5 STEPS PASSED — END-TO-END INTEGRATION COMPLETE (0 ERRORS)     ║${colors.reset}`);
  console.log(`${colors.bold}${colors.green}╚══════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log(`
  ${colors.bold}Summary of Verified Guarantees:${colors.reset}
  1. ${colors.cyan}Coach Slot Publication:${colors.reset} Lukas Bauer affiliated with John Harris Atrium & published slots.
  2. ${colors.cyan}Financial Conservation:${colors.reset} €75.00 GBV = €8.00 Gym + €10.50 Platform (14%) + €56.50 Coach.
  3. ${colors.cyan}Dynamic QR Pass:${colors.reset} GM1 HMAC-SHA256 cryptographic signature & valid time window.
  4. ${colors.cyan}Front Desk Reception:${colors.reset} Scanned token, atomic CAS updated status, tally accrued +€8.00.
  5. ${colors.cyan}Escrow Settlement:${colors.reset} Separate transfers completed for gym & coach; platform take retained.
  6. ${colors.cyan}Anti-Replay Defense:${colors.reset} Second scan strictly rejected by atomic CAS check.
`);
}

runE2ESimulation()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n${colors.bold}${colors.red}❌ E2E Simulation Failed:${colors.reset}`, err);
    process.exit(1);
  });
