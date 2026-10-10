'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { CoachProfile, Gym, Booking, CheckInPass } from '@/types/database';
import { calculateSplitPayment, eurToCents } from '@/lib/payments/split';
import {
  X,
  CreditCard,
  Building2,
  User,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Lock,
} from 'lucide-react';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  coach: CoachProfile;
  gym: Gym;
  sessionTimeIso: string;
  formattedDate: string;
  timeString: string;
  onSuccess: (booking: Booking, pass: CheckInPass) => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  coach,
  gym,
  sessionTimeIso,
  formattedDate,
  timeString,
  onSuccess,
}) => {
  const { createBooking } = useRole();
  const [clientNotes, setClientNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  // Multi-party split calculation via integer cent engine
  const grossCents = eurToCents(coach.hourly_rate);
  const split = calculateSplitPayment({ grossAmountCents: grossCents });

  const handlePay = async () => {
    setIsProcessing(true);

    // Simulate 600ms realistic mock processing
    await new Promise((resolve) => setTimeout(resolve, 600));

    const { booking, pass } = createBooking({
      coachId: coach.id,
      gymId: gym.id,
      sessionTimeIso,
      durationMinutes: 60,
      hourlyRateEur: coach.hourly_rate,
      clientNotes,
    });

    setIsProcessing(false);
    setIsSuccess(true);

    setTimeout(() => {
      onSuccess(booking, pass);
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm p-0 sm:p-4">
      {/* Slide up sheet */}
      <div className="w-full max-w-[430px] bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl relative animate-in fade-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-white text-base">Confirm & Pay</h3>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center animate-bounce">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-bold text-white">Payment Confirmed!</h4>
            <p className="text-xs text-slate-300">
              Generating your dynamic cryptographic check-in pass...
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Session Summary Card */}
            <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  Coach:
                </span>
                <span className="font-bold text-white">{coach.full_name}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5 font-medium">
                  <Building2 className="w-3.5 h-3.5 text-sky-400" />
                  Partner Gym:
                </span>
                <span className="font-bold text-white text-right truncate max-w-[200px]">
                  {gym.name}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-slate-400 font-medium">Scheduled Time:</span>
                <span className="font-bold text-emerald-400">
                  {formattedDate} • {timeString}
                </span>
              </div>
            </div>

            {/* Transparent Multi-Party Split Breakdown */}
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 space-y-2">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Multi-Party Split Breakdown</span>
                <span className="text-[10px] text-emerald-400 font-semibold">100% Transparent</span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center text-slate-300">
                  <span>Coach Training Service:</span>
                  <span className="font-semibold text-white">{split.formatted.coachPayout}</span>
                </div>

                <div className="flex justify-between items-center text-slate-300">
                  <span className="flex items-center gap-1">
                    Partner Gym Floor Fee:
                    <span className="text-[10px] text-sky-400 font-medium">({gym.name})</span>
                  </span>
                  <span className="font-semibold text-white">{split.formatted.gymFloorFee}</span>
                </div>

                <div className="flex justify-between items-center text-slate-300">
                  <span>Platform & Processing Fee (14%):</span>
                  <span className="font-semibold text-white">{split.formatted.platformFee}</span>
                </div>

                <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-sm">
                  <span className="font-bold text-white">Total Gross Billed:</span>
                  <span className="font-black text-emerald-400 text-base">
                    {split.formatted.gross}
                  </span>
                </div>
              </div>
            </div>

            {/* Client Training Notes */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Session Goals & Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Focus on deadlift technique and mobility..."
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                className="w-full bg-slate-950 text-slate-200 border border-slate-700/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 placeholder:text-slate-500"
              />
            </div>

            {/* Security Guarantee */}
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Stripe Connect Escrow • 24h Free Cancellation Policy</span>
            </div>

            {/* 1-Click Pay Button */}
            <button
              onClick={handlePay}
              disabled={isProcessing}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black py-3.5 px-4 rounded-xl text-sm shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing Payment...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Pay {split.formatted.gross} (1-Click Instant Booking)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
