'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { ManualRedeemModal } from './ManualRedeemModal';
import {
  Camera,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Play,
  RotateCcw,
  Sparkles,
  KeyRound,
  Volume2,
} from 'lucide-react';
import { RedemptionResult } from '@/lib/qr/validator';
import { generateDynamicQRToken, DEFAULT_QR_SECRET } from '@/lib/qr/token';

export const ReceptionScanner: React.FC = () => {
  const { receptionGymId, gyms, passes, bookings, coaches, redeemPass, createBooking } = useRole();
  const currentGym = gyms.find((g) => g.id === receptionGymId) || gyms[0];

  const [lastResult, setLastResult] = useState<RedemptionResult | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<
    'success' | 'already_redeemed' | 'wrong_venue' | 'tampered' | null
  >(null);

  // Synthesize sound via Web Audio API for high-fidelity auditory feedback
  const playSound = (type: 'success' | 'error') => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (type === 'success') {
        // High-pitched pleasant dual chime (523Hz -> 659Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        // Low double buzz (160Hz)
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160, ctx.currentTime);
        gain.gain.setValueAtTime(0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch {
      // AudioContext policy or unsupported
    }
  };

  const handleScanToken = async (token: string) => {
    const result = await redeemPass(token, currentGym.id);
    setLastResult(result);

    if (result.success) {
      setFeedbackType('success');
      playSound('success');
    } else {
      playSound('error');
      if (result.errorCode === 'ALREADY_REDEEMED') {
        setFeedbackType('already_redeemed');
      } else if (result.errorCode === 'GYM_MISMATCH') {
        setFeedbackType('wrong_venue');
      } else {
        setFeedbackType('tampered');
      }
    }
  };

  // 1. Quick simulation: Scan an active valid pass for this gym
  const handleSimulateActiveScan = async () => {
    // Look for unredeemed pass for this gym
    let targetPass = passes.find((p) => p.gym_id === currentGym.id && !p.is_redeemed);

    // If none exists, create a genuine pass into passes state via createBooking
    if (!targetPass) {
      const coach = coaches[0];
      const created = createBooking({
        coachId: coach.id,
        gymId: currentGym.id,
        sessionTimeIso: new Date().toISOString(),
      });
      targetPass = created.pass;
    }

    await handleScanToken(targetPass.dynamic_token);
  };

  // 2. Quick simulation: Replay Attack (attempt to scan already redeemed pass)
  const handleSimulateReplayAttack = async () => {
    // Find an already redeemed pass for this gym or any redeemed pass
    let redeemedPass = passes.find((p) => p.is_redeemed && p.gym_id === currentGym.id);
    if (!redeemedPass) {
      redeemedPass = passes.find((p) => p.is_redeemed);
    }

    if (redeemedPass) {
      await handleScanToken(redeemedPass.dynamic_token);
    } else {
      // Find or create an active pass, redeem it once, then scan it again to naturally trigger ALREADY_REDEEMED
      let activePass = passes.find((p) => p.gym_id === currentGym.id && !p.is_redeemed);
      if (!activePass) {
        const coach = coaches[0];
        const created = createBooking({
          coachId: coach.id,
          gymId: currentGym.id,
          sessionTimeIso: new Date().toISOString(),
        });
        activePass = created.pass;
      }

      // First legitimate redemption
      const firstRes = await redeemPass(activePass.dynamic_token, currentGym.id);
      if (firstRes.success) {
        // Immediate second scan of the same token triggers authentic ALREADY_REDEEMED rejection
        await handleScanToken(activePass.dynamic_token);
      }
    }
  };

  // 3. Quick simulation: Wrong Venue Mismatch
  const handleSimulateWrongVenue = async () => {
    // Find another gym
    const otherGym = gyms.find((g) => g.id !== currentGym.id) || gyms[1];
    let otherPass = passes.find((p) => p.gym_id === otherGym.id && !p.is_redeemed);
    let token = otherPass?.dynamic_token;

    if (!token) {
      const nowEpoch = Math.floor(Date.now() / 1000);
      token = generateDynamicQRToken({
        passId: `pass_wrong_venue_${Date.now()}`,
        bookingId: `bk_wrong_${Date.now()}`,
        clientId: '11111111-1111-1111-1111-000000000001',
        gymId: otherGym.id, // Booked for other gym!
        sessionTimeEpochSeconds: nowEpoch,
        durationMinutes: 60,
        secretKey: DEFAULT_QR_SECRET,
      });
    }

    await handleScanToken(token);
  };

  // 4. Quick simulation: Tampered Token
  const handleSimulateTamperedToken = async () => {
    const validPass = passes[0]?.dynamic_token || 'GM1.eyJ2IjoxfQ.sig';
    // Alter signature characters
    const tamperedToken = validPass.slice(0, -6) + 'xxxxxx';
    await handleScanToken(tamperedToken);
  };

  return (
    <div className="space-y-4">
      {/* Scanner Viewport */}
      <div className="bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 relative shadow-2xl">
        {/* Top Viewport Header */}
        <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Camera className="w-4 h-4 text-emerald-400" />
            <span>Camera Viewfinder Simulator</span>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">
            <Volume2 className="w-3 h-3 text-sky-400" />
            <span>Audio Feedback ON</span>
          </div>
        </div>

        {/* Viewfinder simulation box */}
        <div className="relative h-60 bg-slate-950 flex flex-col items-center justify-center p-6 overflow-hidden">
          {/* Subtle grid pattern background */}
          <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />

          {/* Scanner Targeting Reticle */}
          <div className="relative w-44 h-44 border-2 border-emerald-500/40 rounded-2xl flex items-center justify-center">
            {/* 4 Glowing Corner brackets */}
            <div className="absolute -top-1 -left-1 w-5 h-5 border-t-3 border-l-3 border-emerald-400 rounded-tl-lg" />
            <div className="absolute -top-1 -right-1 w-5 h-5 border-t-3 border-r-3 border-emerald-400 rounded-tr-lg" />
            <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-3 border-l-3 border-emerald-400 rounded-bl-lg" />
            <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-3 border-r-3 border-emerald-400 rounded-br-lg" />

            {/* Animated Laser Sweep */}
            <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-emerald-500 via-sky-400 to-emerald-500 shadow-lg shadow-emerald-500/50 animate-laser" />

            {/* Reticle center icon */}
            <ScanLine className="w-10 h-10 text-emerald-400/50" />
          </div>

          <p className="text-[11px] text-slate-400 mt-3 font-medium text-center z-10">
            Align athlete&apos;s GymMatch dynamic QR code inside the viewfinder
          </p>
        </div>

        {/* Viewfinder Controls Toolbar */}
        <div className="p-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-400 text-[11px]">
            Target: <strong className="text-white">{currentGym.name}</strong>
          </span>

          <button
            onClick={() => setIsManualModalOpen(true)}
            className="text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 text-xs"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Manual Code Entry</span>
          </button>
        </div>
      </div>

      {/* Instant High-Contrast Redemption Feedback Modal / Banner */}
      {feedbackType && lastResult && (
        <div
          className={`rounded-2xl p-4 border shadow-xl animate-in fade-in zoom-in-95 duration-150 ${
            feedbackType === 'success'
              ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-100'
              : feedbackType === 'already_redeemed'
              ? 'bg-amber-950/80 border-amber-500/80 text-amber-100'
              : 'bg-rose-950/80 border-rose-500/80 text-rose-100'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              {feedbackType === 'success' && (
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              )}
              {feedbackType === 'already_redeemed' && (
                <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
              )}
              {feedbackType === 'wrong_venue' && (
                <XCircle className="w-6 h-6 text-rose-400 shrink-0" />
              )}
              {feedbackType === 'tampered' && (
                <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
              )}

              <div>
                <h4 className="font-bold text-sm">
                  {feedbackType === 'success' && '✓ Check-in Approved!'}
                  {feedbackType === 'already_redeemed' && '⚠ REPLAY ATTACK BLOCKED'}
                  {feedbackType === 'wrong_venue' && '✕ WRONG VENUE MISMATCH'}
                  {feedbackType === 'tampered' && '✕ INVALID TOKEN SIGNATURE'}
                </h4>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {feedbackType === 'success' &&
                    `+€8.00 Floor Fee credited directly to ${currentGym.name}`}
                  {feedbackType === 'already_redeemed' &&
                    lastResult.error ||
                    'This pass was already redeemed. Double check-in is strictly blocked.'}
                  {feedbackType === 'wrong_venue' &&
                    lastResult.error ||
                    'Pass was purchased for a different gym facility.'}
                  {feedbackType === 'tampered' &&
                    lastResult.error ||
                    'Cryptographic HMAC signature does not match secret key.'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setFeedbackType(null)}
              className="text-xs opacity-70 hover:opacity-100 p-1 font-bold"
            >
              ✕
            </button>
          </div>

          {feedbackType === 'success' && (
            <div className="mt-3 pt-2 border-t border-emerald-500/30 flex items-center justify-between text-xs font-semibold">
              <span>Athlete: Max Mustermann</span>
              <span className="text-emerald-300 font-mono">
                {new Date().toLocaleTimeString('de-AT')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Test & Simulation Controls Matrix (Crucial for Review & Headless Testing) */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-2.5">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            Scanner Simulation & Verification Harness
          </span>
          <span className="text-[10px] text-slate-500 font-normal">1-Click Probes</span>
        </div>

        <p className="text-[11px] text-slate-400">
          Simulate real-world scanner events without physical webcam hardware:
        </p>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            onClick={handleSimulateActiveScan}
            className="p-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold flex items-center gap-1.5 transition-all text-left"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <div>
              <div className="leading-tight font-bold">Valid Check-In</div>
              <div className="text-[10px] text-slate-400 font-normal">+€8.00 floor fee</div>
            </div>
          </button>

          <button
            onClick={handleSimulateReplayAttack}
            className="p-2.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1.5 transition-all text-left"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <div>
              <div className="leading-tight font-bold">Replay Attack</div>
              <div className="text-[10px] text-slate-400 font-normal">Anti-replay CAS test</div>
            </div>
          </button>

          <button
            onClick={handleSimulateWrongVenue}
            className="p-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold flex items-center gap-1.5 transition-all text-left"
          >
            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <div>
              <div className="leading-tight font-bold">Wrong Venue</div>
              <div className="text-[10px] text-slate-400 font-normal">Cross-gym isolation</div>
            </div>
          </button>

          <button
            onClick={handleSimulateTamperedToken}
            className="p-2.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold flex items-center gap-1.5 transition-all text-left"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <div>
              <div className="leading-tight font-bold">Tampered Token</div>
              <div className="text-[10px] text-slate-400 font-normal">HMAC crypto check</div>
            </div>
          </button>
        </div>
      </div>

      {/* Manual Code Entry Modal */}
      <ManualRedeemModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        onRedeemCompleted={(result) => {
          setLastResult(result);
          setFeedbackType('success');
          playSound('success');
        }}
      />
    </div>
  );
};
