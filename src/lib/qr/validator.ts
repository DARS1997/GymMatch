import { verifyDynamicQRToken, DEFAULT_QR_SECRET } from './token';
import { QRErrorCode, QRPayload } from '@/types/qr';
import { Booking, CheckInPass } from '@/types/database';

export interface RedeemPassParams {
  token: string;
  staffGymId: string;
  staffUserId: string;
  secretKey?: string;
  nowEpochSeconds?: number;
  /**
   * Optional custom DB provider or callback to execute atomic CAS redemption
   */
  dbAdapter?: {
    findPassById: (passId: string) => Promise<CheckInPass | null> | CheckInPass | null;
    atomicRedeemPass: (params: {
      passId: string;
      gymId: string;
      staffUserId: string;
      nowIso: string;
    }) => Promise<boolean> | boolean;
    updateBookingStatus: (bookingId: string, status: 'checked_in') => Promise<Booking | null> | Booking | null;
  };
}

export interface RedemptionResult {
  success: boolean;
  passId?: string;
  bookingId?: string;
  gymId?: string;
  clientId?: string;
  floorFeeCents?: number;
  redeemedAt?: string;
  error?: string;
  errorCode?: QRErrorCode;
  booking?: Booking | null;
  payload?: QRPayload;
}

/**
 * Validate and redeem a dynamic QR check-in token at gym reception.
 * Enforces:
 * 1. HMAC-SHA256 signature authenticity via constant-time timingSafeEqual.
 * 2. Scoped gym ID match (token issued for this specific reception gym venue).
 * 3. Time validity window ([-30 min, +30 min after slot]).
 * 4. Atomic compare-and-swap anti-replay protection (cannot be redeemed twice).
 */
export async function redeemCheckInPass(params: RedeemPassParams): Promise<RedemptionResult> {
  const {
    token,
    staffGymId,
    staffUserId,
    secretKey = DEFAULT_QR_SECRET,
    nowEpochSeconds,
    dbAdapter,
  } = params;

  // 1. Verify token cryptographic integrity, gym venue, and validity window
  const verification = verifyDynamicQRToken(token, secretKey, staffGymId, nowEpochSeconds);

  if (!verification.valid || !verification.payload) {
    return {
      success: false,
      error: verification.error,
      errorCode: verification.errorCode,
      payload: verification.payload,
    };
  }

  const payload = verification.payload;

  // 2. Execute DB Atomic CAS check and update if dbAdapter is provided
  const nowIso = new Date((nowEpochSeconds ? nowEpochSeconds * 1000 : Date.now())).toISOString();

  if (dbAdapter) {
    const existingPass = await dbAdapter.findPassById(payload.pid);
    if (!existingPass) {
      return {
        success: false,
        passId: payload.pid,
        bookingId: payload.bid,
        gymId: payload.gid,
        clientId: payload.cid,
        error: `Check-in pass ${payload.pid} not found in database`,
        errorCode: 'PASS_NOT_FOUND',
      };
    }

    if (existingPass.is_redeemed) {
      return {
        success: false,
        passId: payload.pid,
        bookingId: payload.bid,
        gymId: payload.gid,
        clientId: payload.cid,
        error: `Token was already redeemed at ${existingPass.redeemed_at || 'prior scan'}`,
        errorCode: 'ALREADY_REDEEMED',
      };
    }

    // Atomic CAS redemption
    const didRedeem = await dbAdapter.atomicRedeemPass({
      passId: payload.pid,
      gymId: staffGymId,
      staffUserId,
      nowIso,
    });

    if (!didRedeem) {
      return {
        success: false,
        passId: payload.pid,
        bookingId: payload.bid,
        gymId: payload.gid,
        clientId: payload.cid,
        error: 'Concurrent redemption conflict: token was already redeemed by another scanner',
        errorCode: 'ALREADY_REDEEMED',
      };
    }

    // Advance booking status to 'checked_in'
    const updatedBooking = await dbAdapter.updateBookingStatus(payload.bid, 'checked_in');

    return {
      success: true,
      passId: payload.pid,
      bookingId: payload.bid,
      gymId: payload.gid,
      clientId: payload.cid,
      floorFeeCents: 800,
      redeemedAt: nowIso,
      booking: updatedBooking,
      payload,
    };
  }

  // If no dbAdapter provided (e.g. stateless crypto verification and simulation)
  return {
    success: true,
    passId: payload.pid,
    bookingId: payload.bid,
    gymId: payload.gid,
    clientId: payload.cid,
    floorFeeCents: 800,
    redeemedAt: nowIso,
    payload,
  };
}
