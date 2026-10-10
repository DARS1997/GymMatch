export interface QRPayload {
  v: 1; // Protocol version
  pid: string; // check_in_passes.id
  bid: string; // bookings.id
  cid: string; // client_id (auth.users.id)
  gid: string; // gym_id (gyms.id)
  st: number; // session start unix timestamp (epoch seconds)
  vf: number; // valid from unix timestamp (epoch seconds)
  vu: number; // valid until unix timestamp (epoch seconds)
  nce: string; // 16-byte random hex nonce
  iat: number; // token issued at timestamp (epoch seconds)
}

export type QRErrorCode =
  | 'INVALID_FORMAT'
  | 'SIGNATURE_INVALID'
  | 'GYM_MISMATCH'
  | 'TOKEN_EXPIRED'
  | 'NOT_YET_VALID'
  | 'ALREADY_REDEEMED'
  | 'PASS_NOT_FOUND';

export interface QRVerificationResult {
  valid: boolean;
  payload?: QRPayload;
  error?: string;
  errorCode?: QRErrorCode;
}

export interface GenerateTokenOptions {
  passId: string;
  bookingId: string;
  clientId: string;
  gymId: string;
  sessionTimeEpochSeconds: number;
  durationMinutes?: number; // default 60
  secretKey: string;
}

export interface VerifyTokenOptions {
  token: string;
  secretKey: string;
  expectedGymId: string;
  nowEpochSeconds?: number;
}
