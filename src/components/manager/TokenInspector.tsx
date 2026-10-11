'use client';

import React, { useState, useMemo } from 'react';
import { useRole } from '@/context/RoleContext';
import {
  inspectDynamicQRToken,
  generateDynamicQRToken,
  DEFAULT_QR_SECRET,
  TokenInspectionResult,
} from '@/lib/qr/token';
import {
  QrCode,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  Search,
  Database,
  Lock,
} from 'lucide-react';

export const TokenInspector: React.FC = () => {
  const { passes, bookings, gyms } = useRole();

  // Baseline authentic token from seed passes
  const initialToken = passes[0]?.dynamic_token || '';

  const [tokenInput, setTokenInput] = useState<string>(initialToken);
  const [copied, setCopied] = useState<boolean>(false);

  // Generate presets on-the-fly for interactive testing
  const presets = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);

    // 1. Authentic valid token (within active window)
    const authenticToken = initialToken;

    // 2. Expired token (session was 3 days ago)
    const expiredToken = generateDynamicQRToken(
      {
        v: 1,
        pid: 'pass_diag_expired_001',
        bid: 'bk_diag_expired_001',
        cid: '11111111-1111-1111-1111-000000000001',
        gid: '00000000-0000-0000-0000-000000000001',
        st: now - 86400 * 3,
        vf: now - 86400 * 3 - 1800,
        vu: now - 86400 * 3 + 5400,
        nce: 'expired_nonce_123',
        iat: now - 86400 * 4,
      },
      DEFAULT_QR_SECRET
    );

    // 3. Tampered signature token
    const tamperedSigToken =
      authenticToken.length > 10
        ? authenticToken.substring(0, authenticToken.length - 6) + 'TAMPER'
        : 'GM1.eyJ2IjoxfQ.tampered_invalid_sig';

    // 4. Future token (valid next week)
    const futureToken = generateDynamicQRToken(
      {
        v: 1,
        pid: 'pass_diag_future_001',
        bid: 'bk_diag_future_001',
        cid: '11111111-1111-1111-1111-000000000001',
        gid: '00000000-0000-0000-0000-000000000001',
        st: now + 86400 * 7,
        vf: now + 86400 * 7 - 1800,
        vu: now + 86400 * 7 + 5400,
        nce: 'future_nonce_456',
        iat: now,
      },
      DEFAULT_QR_SECRET
    );

    // 5. Malformed format token
    const malformedToken = 'INVALID_HEADER.payload_xyz.signature_abc';

    return [
      { id: 'authentic', label: 'Authentic Seed Pass', token: authenticToken },
      { id: 'expired', label: 'Expired Pass (-3 days)', token: expiredToken },
      { id: 'tampered', label: 'Tampered Signature', token: tamperedSigToken },
      { id: 'future', label: 'Future Pass (+7 days)', token: futureToken },
      { id: 'malformed', label: 'Malformed Format', token: malformedToken },
    ];
  }, [initialToken]);

  // Read-only diagnostic inspection result
  const inspectionResult: TokenInspectionResult = useMemo(() => {
    return inspectDynamicQRToken(tokenInput.trim());
  }, [tokenInput]);

  // Read-only datastore lookup without mutations
  const datastoreStatus = useMemo(() => {
    if (!inspectionResult.payload?.pid) return null;
    const matchingPass = passes.find((p) => p.id === inspectionResult.payload?.pid);
    const matchingBooking = inspectionResult.payload?.bid
      ? bookings.find((b) => b.id === inspectionResult.payload?.bid)
      : null;
    const matchingGym = inspectionResult.payload?.gid
      ? gyms.find((g) => g.id === inspectionResult.payload?.gid)
      : null;

    return {
      passFound: !!matchingPass,
      isRedeemed: matchingPass ? matchingPass.is_redeemed : false,
      redeemedAt: matchingPass?.redeemed_at,
      bookingFound: !!matchingBooking,
      bookingStatus: matchingBooking?.status,
      gymName: matchingGym?.name || 'Unknown Gym',
    };
  }, [inspectionResult, passes, bookings, gyms]);

  const handleCopyToken = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(tokenInput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-1">
        <div className="flex items-center gap-2 text-xs font-bold text-sky-400">
          <QrCode className="w-4 h-4" />
          <span>Cryptographic Token Inspector (GM1 Protocol)</span>
        </div>
        <h3 className="text-sm font-bold text-white">Read-Only Pass Forensics & Diagnostics</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Inspect dynamic QR tokens, verify constant-time HMAC-SHA256 signatures, and evaluate time validity windows without database modifications.
        </p>
      </div>

      {/* Preset Token Selector */}
      <div className="space-y-1.5">
        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Test Presets
        </label>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setTokenInput(p.token)}
              className="px-2.5 py-1 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-750 text-slate-300 font-medium transition-colors text-[11px]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Token Input Box */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold text-slate-300">GM1 Token String</label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyToken}
              className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-[11px]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={() => setTokenInput('')}
              className="text-slate-400 hover:text-slate-200 text-[11px]"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          rows={3}
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          placeholder="Paste GM1.payload.signature token here..."
          className="w-full bg-white text-slate-900 font-mono text-[11px] border border-slate-300 rounded-xl p-3 focus:outline-none focus:border-emerald-500 placeholder:text-slate-500 leading-relaxed"
        />
      </div>

      {/* DIAGNOSTIC RESULTS BOARD */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-4">
        {/* Main Verification Status Banner */}
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
            inspectionResult.status === 'valid'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : inspectionResult.status === 'signature_mismatch'
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
              : inspectionResult.status === 'expired'
              ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              : inspectionResult.status === 'not_yet_valid'
              ? 'bg-sky-950/40 border-sky-500/40 text-sky-300'
              : 'bg-purple-950/40 border-purple-500/40 text-purple-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {inspectionResult.status === 'valid' ? (
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : inspectionResult.status === 'signature_mismatch' ? (
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 shrink-0" />
            )}
            <div>
              <div className="font-bold text-xs uppercase tracking-wide">
                Status: {inspectionResult.status.replace('_', ' ').toUpperCase()}
              </div>
              <div className="text-[11px] mt-0.5">
                {inspectionResult.error || 'Cryptographically verified with active validity window.'}
              </div>
            </div>
          </div>

          <div className="text-right shrink-0">
            <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900/80 border border-slate-700">
              {inspectionResult.valid ? 'VALID PASS' : 'INVALID PASS'}
            </span>
          </div>
        </div>

        {/* Cryptographic Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* HMAC Signature Check */}
          <div className="bg-slate-850 p-2.5 rounded-xl border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-400 font-semibold flex items-center justify-between">
              <span>HMAC-SHA256 Signature</span>
              <Lock className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div
              className={`font-bold text-xs ${
                inspectionResult.signatureVerified ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {inspectionResult.signatureVerified ? 'Signature Match (Authentic)' : 'Signature Mismatch'}
            </div>
            <div className="font-mono text-[10px] text-slate-400 truncate">
              {inspectionResult.signature ? inspectionResult.signature.substring(0, 24) + '...' : 'None'}
            </div>
          </div>

          {/* Time Window Status */}
          <div className="bg-slate-850 p-2.5 rounded-xl border border-slate-800 space-y-1">
            <div className="text-[10px] text-slate-400 font-semibold flex items-center justify-between">
              <span>Time Window Status</span>
              <Clock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div
              className={`font-bold text-xs ${
                inspectionResult.timeWindowStatus === 'active'
                  ? 'text-emerald-400'
                  : inspectionResult.timeWindowStatus === 'expired'
                  ? 'text-amber-400'
                  : 'text-sky-400'
              }`}
            >
              {inspectionResult.timeWindowStatus.toUpperCase()}
            </div>
            <div className="text-[10px] text-slate-400">
              {inspectionResult.payload?.st
                ? new Date(inspectionResult.payload.st * 1000).toLocaleTimeString('de-AT')
                : 'Unknown'}
            </div>
          </div>
        </div>

        {/* Decoded Parameters Breakdown */}
        {inspectionResult.payload && (
          <div className="space-y-2 pt-1 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-300">Decoded Payload Parameters</div>
            <div className="bg-slate-850 rounded-xl p-3 border border-slate-800 space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Protocol (v):</span>
                <span className="text-white font-bold">{inspectionResult.payload.v} (GM1)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Pass ID (pid):</span>
                <span className="text-sky-400 truncate max-w-[200px]">{inspectionResult.payload.pid}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Booking ID (bid):</span>
                <span className="text-slate-200 truncate max-w-[200px]">{inspectionResult.payload.bid}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Client ID (cid):</span>
                <span className="text-slate-300 truncate max-w-[200px]">{inspectionResult.payload.cid}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Gym Venue ID (gid):</span>
                <span className="text-slate-300 truncate max-w-[200px]">{inspectionResult.payload.gid}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-slate-800/80">
                <span className="text-slate-400">Valid Window:</span>
                <span className="text-emerald-400 text-[10px]">
                  {new Date(inspectionResult.payload.vf * 1000).toLocaleTimeString('de-AT')} -{' '}
                  {new Date(inspectionResult.payload.vu * 1000).toLocaleTimeString('de-AT')}
                </span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-slate-400">Nonce (nce):</span>
                <span className="text-amber-400">{inspectionResult.payload.nce}</span>
              </div>
            </div>
          </div>
        )}

        {/* Read-Only Datastore Status Section */}
        {datastoreStatus && (
          <div className="space-y-2 pt-1 border-t border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-sky-400" />
                Read-Only Datastore Cross-Reference
              </span>
              <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                Zero DB Mutations
              </span>
            </div>

            <div className="bg-slate-850 rounded-xl p-3 border border-slate-800 text-xs space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Pass in Database:</span>
                <span className={datastoreStatus.passFound ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                  {datastoreStatus.passFound ? 'Found' : 'Not Found in Local Seed'}
                </span>
              </div>

              {datastoreStatus.passFound && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Redemption Status:</span>
                  <span
                    className={
                      datastoreStatus.isRedeemed ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'
                    }
                  >
                    {datastoreStatus.isRedeemed ? 'Redeemed (Used)' : 'Unredeemed (Active)'}
                  </span>
                </div>
              )}

              {datastoreStatus.bookingFound && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">Booking Status:</span>
                  <span className="text-sky-400 font-bold">{datastoreStatus.bookingStatus}</span>
                </div>
              )}

              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Target Venue:</span>
                <span className="text-white">{datastoreStatus.gymName}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
