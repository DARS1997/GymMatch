import crypto from 'crypto';
import {
  QRPayload,
  QRVerificationResult,
  GenerateTokenOptions,
} from '@/types/qr';

export const DEFAULT_QR_SECRET =
  process.env.QR_SIGNING_SECRET || 'gymmatch_dev_linz_secret_key_2026';

/**
 * Universal Base64URL string encoder safe across Node.js and all browser runtimes.
 * Does not rely on 'base64url' Buffer encoding which is unsupported in browser polyfills.
 */
export function stringToBase64Url(strOrBuffer: string | Buffer): string {
  let b64: string;
  if (typeof strOrBuffer === 'string') {
    b64 = Buffer.from(strOrBuffer, 'utf-8').toString('base64');
  } else {
    b64 = strOrBuffer.toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Universal Base64URL string decoder safe across Node.js and all browser runtimes.
 */
export function base64UrlToString(base64url: string): string {
  let b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  b64 += '='.repeat(pad);
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/**
 * Universal HMAC-SHA256 Base64URL generator safe across Node and browser runtimes.
 */
function hmacSha256Base64Url(message: string, secretKey: string): string {
  const digestBuf = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest();
  return digestBuf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a random 16-byte hex nonce safe across Node and browser runtimes.
 */
function generateNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomBytes === 'function') {
    try {
      return crypto.randomBytes(16).toString('hex');
    } catch {
      // Fall through
    }
  }
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

/**
 * Generate a cryptographically signed dynamic QR token under GM1 protocol.
 * GM1 format: GM1.<payload_base64url>.<hmac_sha256_base64url>
 */
export function generateDynamicQRToken(
  payloadOrOptions:
    | (Omit<QRPayload, 'nce'> & { nce?: string })
    | GenerateTokenOptions,
  optionalSecret?: string
): string {
  let payload: QRPayload;
  let secretKey: string;

  if ('secretKey' in payloadOrOptions) {
    const opts = payloadOrOptions as GenerateTokenOptions;
    secretKey = opts.secretKey || DEFAULT_QR_SECRET;
    const durationSec = (opts.durationMinutes ?? 60) * 60;
    const now = Math.floor(Date.now() / 1000);
    const nonce = generateNonce();

    payload = {
      v: 1,
      pid: opts.passId,
      bid: opts.bookingId,
      cid: opts.clientId,
      gid: opts.gymId,
      st: opts.sessionTimeEpochSeconds,
      vf: opts.sessionTimeEpochSeconds - 1800, // Valid 30m before
      vu: opts.sessionTimeEpochSeconds + durationSec + 1800, // Valid 30m after
      nce: nonce,
      iat: now,
    };
  } else {
    secretKey = optionalSecret || DEFAULT_QR_SECRET;
    const p = payloadOrOptions as Omit<QRPayload, 'nce'> & { nce?: string };
    const nonce = p.nce || generateNonce();
    const now = p.iat || Math.floor(Date.now() / 1000);

    payload = {
      v: 1,
      pid: p.pid,
      bid: p.bid,
      cid: p.cid,
      gid: p.gid,
      st: p.st,
      vf: p.vf ?? p.st - 1800,
      vu: p.vu ?? p.st + 3600 + 1800,
      nce: nonce,
      iat: now,
    };
  }

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = stringToBase64Url(payloadJson);
  const message = `GM1.${payloadB64}`;

  const signatureB64 = hmacSha256Base64Url(message, secretKey);

  return `${message}.${signatureB64}`;
}

/**
 * Verify a GM1 dynamic QR token using constant-time HMAC check, gym match, and time window validation.
 */
export function verifyDynamicQRToken(
  token: string,
  secretKey: string = DEFAULT_QR_SECRET,
  expectedGymId?: string,
  nowEpoch?: number
): QRVerificationResult {
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      error: 'Token must be a non-empty string',
      errorCode: 'INVALID_FORMAT',
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'GM1') {
    return {
      valid: false,
      error: 'Invalid QR token header or format, expected GM1.<payload>.<sig>',
      errorCode: 'INVALID_FORMAT',
    };
  }

  const [header, payloadB64, signatureB64] = parts;
  const message = `${header}.${payloadB64}`;

  const expectedSig = hmacSha256Base64Url(message, secretKey);

  // Constant-time comparison preventing timing attacks across Node and browser
  let safeEqual = false;
  if (typeof crypto.timingSafeEqual === 'function') {
    try {
      const sigBuf = Buffer.from(signatureB64);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length === expectedBuf.length) {
        safeEqual = crypto.timingSafeEqual(sigBuf, expectedBuf);
      }
    } catch {
      safeEqual = false;
    }
  } else {
    // Constant-time XOR comparison for environments where timingSafeEqual is unavailable (e.g. crypto-browserify)
    if (signatureB64.length === expectedSig.length) {
      let diff = 0;
      for (let i = 0; i < signatureB64.length; i++) {
        diff |= signatureB64.charCodeAt(i) ^ expectedSig.charCodeAt(i);
      }
      safeEqual = diff === 0;
    }
  }

  if (!safeEqual) {
    return {
      valid: false,
      error: 'Cryptographic signature mismatch or token was tampered with',
      errorCode: 'SIGNATURE_INVALID',
    };
  }

  let payload: QRPayload;
  try {
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    return {
      valid: false,
      error: 'Corrupt or unparseable JSON payload in token',
      errorCode: 'INVALID_FORMAT',
    };
  }

  // Validate gym venue match
  if (expectedGymId && payload.gid !== expectedGymId) {
    return {
      valid: false,
      payload,
      error: `Pass is valid only for gym venue '${payload.gid}', cannot be scanned at '${expectedGymId}'`,
      errorCode: 'GYM_MISMATCH',
    };
  }

  // Validate time validity window
  const now = nowEpoch ?? Math.floor(Date.now() / 1000);

  if (now < payload.vf) {
    const activationDate = new Date(payload.vf * 1000).toISOString();
    return {
      valid: false,
      payload,
      error: `Pass is not yet active. Check-in window opens 30 minutes before session (at ${activationDate})`,
      errorCode: 'NOT_YET_VALID',
    };
  }

  if (now > payload.vu) {
    const expirationDate = new Date(payload.vu * 1000).toISOString();
    return {
      valid: false,
      payload,
      error: `Pass expired 30 minutes after scheduled session end (at ${expirationDate})`,
      errorCode: 'TOKEN_EXPIRED',
    };
  }

  return {
    valid: true,
    payload,
  };
}

export interface TokenInspectionResult {
  valid: boolean;
  payload: QRPayload | null;
  rawPayload: Record<string, unknown> | null;
  error?: string;
  status: 'valid' | 'expired' | 'not_yet_valid' | 'signature_mismatch' | 'malformed';
  signatureVerified: boolean;
  timeWindowStatus: 'active' | 'future' | 'expired' | 'unknown';
  header?: string;
  signature?: string;
  expectedSignature?: string;
}

/**
 * Diagnostic, read-only inspection of dynamic QR tokens without database mutations.
 * Evaluates HMAC-SHA256 signature using constant-time comparison and extracts
 * payload parameters even if expired or tampered.
 */
export function inspectDynamicQRToken(
  token: string,
  secretKey: string = DEFAULT_QR_SECRET,
  nowEpochSeconds?: number
): TokenInspectionResult {
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      payload: null,
      rawPayload: null,
      error: 'Token must be a non-empty string',
      status: 'malformed',
      signatureVerified: false,
      timeWindowStatus: 'unknown',
    };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'GM1') {
    return {
      valid: false,
      payload: null,
      rawPayload: null,
      error: 'Invalid QR token header or format, expected GM1.<payload>.<sig>',
      status: 'malformed',
      signatureVerified: false,
      timeWindowStatus: 'unknown',
      header: parts[0] || '',
    };
  }

  const [header, payloadB64, signatureB64] = parts;
  const message = `${header}.${payloadB64}`;
  const expectedSig = hmacSha256Base64Url(message, secretKey);

  let rawPayload: Record<string, unknown> | null = null;
  let parsedPayload: QRPayload | null = null;
  try {
    const jsonStr = base64UrlToString(payloadB64);
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object') {
      rawPayload = parsed as Record<string, unknown>;
      parsedPayload = parsed as QRPayload;
    }
  } catch {
    return {
      valid: false,
      payload: null,
      rawPayload: null,
      error: 'Corrupt or unparseable JSON payload in token',
      status: 'malformed',
      signatureVerified: false,
      timeWindowStatus: 'unknown',
      header,
      signature: signatureB64,
      expectedSignature: expectedSig,
    };
  }

  // Constant-time HMAC comparison
  let safeEqual = false;
  if (typeof crypto.timingSafeEqual === 'function') {
    try {
      const sigBuf = Buffer.from(signatureB64);
      const expectedBuf = Buffer.from(expectedSig);
      if (sigBuf.length === expectedBuf.length) {
        safeEqual = crypto.timingSafeEqual(sigBuf, expectedBuf);
      }
    } catch {
      safeEqual = false;
    }
  } else {
    if (signatureB64.length === expectedSig.length) {
      let diff = 0;
      for (let i = 0; i < signatureB64.length; i++) {
        diff |= signatureB64.charCodeAt(i) ^ expectedSig.charCodeAt(i);
      }
      safeEqual = diff === 0;
    }
  }

  const now = nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  let timeWindowStatus: 'active' | 'future' | 'expired' | 'unknown' = 'unknown';

  if (parsedPayload && typeof parsedPayload.vf === 'number' && typeof parsedPayload.vu === 'number') {
    if (now < parsedPayload.vf) {
      timeWindowStatus = 'future';
    } else if (now > parsedPayload.vu) {
      timeWindowStatus = 'expired';
    } else {
      timeWindowStatus = 'active';
    }
  }

  if (!safeEqual) {
    return {
      valid: false,
      payload: parsedPayload,
      rawPayload,
      error: 'Cryptographic HMAC signature mismatch or token was tampered with',
      status: 'signature_mismatch',
      signatureVerified: false,
      timeWindowStatus,
      header,
      signature: signatureB64,
      expectedSignature: expectedSig,
    };
  }

  if (timeWindowStatus === 'future') {
    const activationDate = new Date(parsedPayload!.vf * 1000).toISOString();
    return {
      valid: false,
      payload: parsedPayload,
      rawPayload,
      error: `Pass is not yet active (activation window: ${activationDate})`,
      status: 'not_yet_valid',
      signatureVerified: true,
      timeWindowStatus,
      header,
      signature: signatureB64,
      expectedSignature: expectedSig,
    };
  }

  if (timeWindowStatus === 'expired') {
    const expirationDate = new Date(parsedPayload!.vu * 1000).toISOString();
    return {
      valid: false,
      payload: parsedPayload,
      rawPayload,
      error: `Pass has expired (window closed at: ${expirationDate})`,
      status: 'expired',
      signatureVerified: true,
      timeWindowStatus,
      header,
      signature: signatureB64,
      expectedSignature: expectedSig,
    };
  }

  return {
    valid: true,
    payload: parsedPayload,
    rawPayload,
    status: 'valid',
    signatureVerified: true,
    timeWindowStatus: 'active',
    header,
    signature: signatureB64,
    expectedSignature: expectedSig,
  };
}

