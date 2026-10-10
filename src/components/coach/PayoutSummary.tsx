'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { calculateSplitPayment, eurToCents } from '@/lib/payments/split';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Building2,
  CheckCircle2,
  ArrowUpRight,
  ShieldCheck,
  Percent,
} from 'lucide-react';

export const PayoutSummary: React.FC = () => {
  const { activeCoachId, coaches, bookings } = useRole();
  const currentCoach = coaches.find((c) => c.id === activeCoachId) || coaches[0];

  const coachBookings = bookings.filter((b) => b.coach_id === currentCoach.id);
  const totalGross = coachBookings.reduce((sum, b) => sum + b.gross_amount, 0);
  const totalNet = coachBookings.reduce((sum, b) => sum + b.coach_payout, 0);
  const totalFloorFees = coachBookings.reduce((sum, b) => sum + b.gym_floor_fee, 0);
  const totalPlatformFees = coachBookings.reduce((sum, b) => sum + b.platform_fee, 0);

  // Rate simulator state
  const [simulationRateEur, setSimulationRateEur] = useState<number>(currentCoach.hourly_rate);
  const simGrossCents = eurToCents(simulationRateEur);
  const simSplit = calculateSplitPayment({ grossAmountCents: simGrossCents });

  return (
    <div className="space-y-4">
      {/* Stripe Connect Account Card */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-black text-xs">
              S
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Stripe Connect Express</h3>
              <p className="text-[11px] text-slate-400">Multi-Party Automated Transfers</p>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Active</span>
          </div>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
          <span className="text-slate-400">Account ID:</span>
          <span className="font-mono text-slate-200">
            {currentCoach.stripe_account_id || 'acct_coach_linz_live'}
          </span>
        </div>
      </div>

      {/* Payout Totals */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            Net Coach Earnings
          </div>
          <div className="text-xl font-black text-emerald-400 mt-1">
            €{totalNet.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            Disbursed to IBAN
          </div>
        </div>

        <div className="bg-slate-900 p-3.5 rounded-2xl border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-sky-400" />
            Gross Booking Value
          </div>
          <div className="text-xl font-black text-white mt-1">
            €{totalGross.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {coachBookings.length} total sessions
          </div>
        </div>
      </div>

      {/* Multi-Party Fee Breakdown */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-2.5">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
          <span>Fee Distribution Breakdown</span>
          <span className="text-[10px] text-slate-500 font-normal">All Time</span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Building2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Partner Gym Floor Fees (€8.00 / session):</span>
            </div>
            <span className="font-bold text-sky-400">€{totalFloorFees.toFixed(2)}</span>
          </div>

          <div className="flex justify-between items-center bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Percent className="w-3.5 h-3.5 text-amber-400" />
              <span>GymMatch Platform Commission (14%):</span>
            </div>
            <span className="font-bold text-amber-400">€{totalPlatformFees.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Interactive Live Split Calculator Simulator */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-emerald-500/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Interactive Split Rate Simulator</span>
          </div>
          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
            75.3% Take-Rate
          </span>
        </div>

        <p className="text-[11px] text-slate-400">
          Adjust session pricing to see your exact take-home payout after partner gym entry fee and platform take-rate:
        </p>

        {/* Stepper / Slider */}
        <div className="flex items-center gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setSimulationRateEur(Math.max(50, simulationRateEur - 5))}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-base flex items-center justify-center"
          >
            -
          </button>
          <div className="flex-1 text-center">
            <span className="text-xl font-black text-white">€{simulationRateEur.toFixed(2)}</span>
            <span className="text-[10px] text-slate-400 block">Session Fee</span>
          </div>
          <button
            onClick={() => setSimulationRateEur(Math.min(150, simulationRateEur + 5))}
            className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-base flex items-center justify-center"
          >
            +
          </button>
        </div>

        {/* Dynamic Calculation Output */}
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs space-y-1.5">
          <div className="flex justify-between text-slate-300">
            <span>Linz Partner Gym Floor Fee:</span>
            <span className="text-sky-400 font-bold">-{simSplit.formatted.gymFloorFee}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Platform Service Fee (14%):</span>
            <span className="text-amber-400 font-bold">-{simSplit.formatted.platformFee}</span>
          </div>
          <div className="pt-2 border-t border-slate-800 flex justify-between font-bold text-sm">
            <span className="text-white">Your Net Payout:</span>
            <span className="text-emerald-400 font-black text-base">
              {simSplit.formatted.coachPayout}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
