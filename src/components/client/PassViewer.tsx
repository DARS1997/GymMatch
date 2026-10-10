'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { CheckInPass } from '@/types/database';
import {
  QrCode,
  CheckCircle2,
  Clock,
  MapPin,
  User,
  Wifi,
  Copy,
  Check,
  Building2,
  ExternalLink,
} from 'lucide-react';

interface PassViewerProps {
  onScanInReception?: (token: string, gymId: string) => void;
}

/**
 * Deterministic SVG QR Matrix Generator
 * Renders a crisp 29x29 visual QR matrix with standard finder patterns,
 * timing strips, and token-derived modules.
 */
function renderSvgQrMatrix(tokenString: string): boolean[][] {
  const size = 29;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // 1. Draw 7x7 Finder Pattern helper
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

  // Top-left, Top-right, Bottom-left finder patterns
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // 3. Alignment pattern at (20, 20)
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) {
        matrix[20 + r][20 + c] = true;
      }
    }
  }

  // 4. Fill remaining data modules deterministically using token bytes
  let byteIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder and separator zones
      if (
        (r <= 7 && c <= 7) ||
        (r <= 7 && c >= size - 8) ||
        (r >= size - 8 && c <= 7) ||
        (r === 6) ||
        (c === 6) ||
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

export const PassViewer: React.FC<PassViewerProps> = ({ onScanInReception }) => {
  const { passes, bookings, gyms, coaches, setRole, setReceptionGymId } = useRole();
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleCopy = (token: string) => {
    navigator.clipboard?.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleTestInReception = (pass: CheckInPass) => {
    if (onScanInReception) {
      onScanInReception(pass.dynamic_token, pass.gym_id);
    } else {
      setReceptionGymId(pass.gym_id);
      setRole('reception');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <div>
          <h3 className="font-bold text-white text-base">My Check-In Passes</h3>
          <p className="text-[11px] text-slate-400">
            Present dynamic QR code at the gym reception desk
          </p>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20 font-medium">
          <Wifi className="w-3 h-3" />
          <span>Cached Offline</span>
        </div>
      </div>

      {passes.length === 0 ? (
        <div className="bg-slate-900 rounded-2xl p-8 text-center border border-slate-800 space-y-2">
          <QrCode className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-xs text-slate-400 font-medium">No check-in passes yet</p>
          <p className="text-[11px] text-slate-500">
            Book a session with a certified coach to receive your dynamic check-in pass.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {passes.map((pass) => {
            const booking = bookings.find((b) => b.id === pass.booking_id);
            const gym = gyms.find((g) => g.id === pass.gym_id);
            const coach = coaches.find((c) => c.id === booking?.coach_id);
            const matrix = renderSvgQrMatrix(pass.dynamic_token);

            const sessionDate = booking
              ? new Date(booking.session_time).toLocaleDateString('de-AT', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Upcoming Session';

            return (
              <div
                key={pass.id}
                className={`bg-slate-900 rounded-3xl overflow-hidden border transition-all ${
                  pass.is_redeemed
                    ? 'border-slate-800 opacity-85'
                    : 'border-emerald-500/50 shadow-xl shadow-emerald-500/5'
                }`}
              >
                {/* Header Ticket Strip */}
                <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-emerald-500 flex items-center justify-center font-black text-[10px] text-slate-950">
                      GM
                    </div>
                    <span className="font-bold text-xs text-slate-200">GymMatch Pass</span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                      pass.is_redeemed
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 animate-pulse'
                    }`}
                  >
                    {pass.is_redeemed ? (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        CHECKED IN
                      </>
                    ) : (
                      <>
                        <Clock className="w-3 h-3" />
                        READY FOR SCAN
                      </>
                    )}
                  </span>
                </div>

                {/* Main Pass Content */}
                <div className="p-4 space-y-4">
                  {/* Venue and Session Details */}
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-white text-base leading-snug">
                          {gym?.name || 'Partner Gym Linz'}
                        </h4>
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          {gym?.address}, {gym?.postal_code} Linz
                        </p>
                      </div>

                      <div className="text-right text-[11px] text-sky-400 font-semibold bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20">
                        €8.00 Floor Fee
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-slate-800/60">
                      <span className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        Coach: <strong>{coach?.full_name || 'Coach'}</strong>
                      </span>
                      <span className="font-semibold text-emerald-400">{sessionDate}</span>
                    </div>
                  </div>

                  {/* High-Contrast Dynamic QR Code Container */}
                  <div className="bg-white p-4 rounded-2xl flex flex-col items-center justify-center shadow-inner relative">
                    {/* SVG QR Code */}
                    <svg
                      viewBox="0 0 29 29"
                      className="w-48 h-48 shape-rendering-crispEdges"
                      fill="currentColor"
                    >
                      {matrix.map((row, r) =>
                        row.map((filled, c) =>
                          filled ? (
                            <rect
                              key={`${r}-${c}`}
                              x={c}
                              y={r}
                              width="1"
                              height="1"
                              fill="#0f172a"
                            />
                          ) : null
                        )
                      )}
                    </svg>

                    {/* Watermark badge in center of QR */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-1 rounded-md shadow-md border border-slate-200">
                      <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center font-black text-slate-950 text-[10px]">
                        GM
                      </div>
                    </div>

                    {/* Token Status Subtext */}
                    <div className="mt-2 text-center text-[10px] text-slate-600 font-mono tracking-tight font-medium">
                      {pass.is_redeemed ? (
                        <span className="text-purple-700 font-bold">
                          ✓ Redeemed at{' '}
                          {pass.redeemed_at
                            ? new Date(pass.redeemed_at).toLocaleTimeString('de-AT')
                            : 'Front Desk'}
                        </span>
                      ) : (
                        <span className="text-slate-700">Dynamic HMAC-SHA256 Single-Use</span>
                      )}
                    </div>
                  </div>

                  {/* Token String & Copy */}
                  <div className="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Token Hash:</span>
                      <button
                        onClick={() => handleCopy(pass.dynamic_token)}
                        className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium"
                      >
                        {copiedToken === pass.dynamic_token ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy Token
                          </>
                        )}
                      </button>
                    </div>
                    <div className="font-mono text-[10px] text-slate-300 truncate">
                      {pass.dynamic_token}
                    </div>
                  </div>

                  {/* Quick Test in Reception Scanner Button */}
                  {!pass.is_redeemed && (
                    <button
                      onClick={() => handleTestInReception(pass)}
                      className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 transition-colors"
                    >
                      <Building2 className="w-3.5 h-3.5 text-sky-400" />
                      <span>Test Scan in Reception Portal</span>
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
