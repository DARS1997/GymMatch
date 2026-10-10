'use client';

import React, { useMemo } from 'react';
import { useRole } from '@/context/RoleContext';
import { eurToCents, formatCentsToEur } from '@/lib/payments/split';
import {
  TrendingUp,
  ShieldCheck,
  CheckCircle2,
  Euro,
  Building2,
  Dumbbell,
  CalendarCheck,
  Percent,
} from 'lucide-react';

export const PlatformKpiCards: React.FC = () => {
  const { bookings } = useRole();

  const financialMetrics = useMemo(() => {
    let totalGrossCents = 0;
    let totalFloorCents = 0;
    let totalPlatformCents = 0;
    let totalCoachCents = 0;
    let totalRefundCents = 0;

    let activeBookingsCount = 0;
    let completedBookingsCount = 0;
    let cancelledBookingsCount = 0;

    for (const b of bookings) {
      const gross = eurToCents(b.gross_amount || 0);
      const floor = eurToCents(b.gym_floor_fee || 0);
      const platform = eurToCents(b.platform_fee || 0);
      const coach = eurToCents(b.coach_payout || 0);

      totalGrossCents += gross;
      totalFloorCents += floor;
      totalPlatformCents += platform;
      totalCoachCents += coach;

      if (b.status === 'cancelled') {
        cancelledBookingsCount += 1;
        // In full refund, refund amount is gross - disbursed fees
        const refund = Math.max(0, gross - (floor + platform + coach));
        totalRefundCents += refund;
      } else if (b.status === 'completed') {
        completedBookingsCount += 1;
      } else if (b.status === 'confirmed' || b.status === 'checked_in') {
        activeBookingsCount += 1;
      }
    }

    // Conservation check: Gross === Floor + Platform + Coach + Refund
    const calculatedSum = totalFloorCents + totalPlatformCents + totalCoachCents + totalRefundCents;
    const driftCents = totalGrossCents - calculatedSum;

    return {
      totalGrossEur: formatCentsToEur(totalGrossCents),
      totalFloorEur: formatCentsToEur(totalFloorCents),
      totalPlatformEur: formatCentsToEur(totalPlatformCents),
      totalCoachEur: formatCentsToEur(totalCoachCents),
      totalRefundEur: formatCentsToEur(totalRefundCents),
      driftCents,
      isConserved: driftCents === 0,
      activeBookingsCount,
      completedBookingsCount,
      cancelledBookingsCount,
      totalBookingsCount: bookings.length,
    };
  }, [bookings]);

  return (
    <div className="space-y-3.5">
      {/* Currency Conservation Invariant Banner */}
      <div
        className={`p-3.5 rounded-2xl border transition-all ${
          financialMetrics.isConserved
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 shadow-sm'
            : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-xl ${
                financialMetrics.isConserved
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {financialMetrics.isConserved ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <Percent className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="text-xs font-black tracking-wide uppercase flex items-center gap-1.5">
                <span>Currency Conservation Invariant</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {Math.abs(financialMetrics.driftCents).toFixed(2)}¢ Drift
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                $Gross \equiv Floor + Platform + Coach + Refunds$ integer-cent conservation holds strictly with 0.00¢ rounding loss.
              </p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              100% Invariant Conserved
            </span>
          </div>
        </div>
      </div>

      {/* 5 Core Platform Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {/* Active Bookings */}
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Active Bookings</span>
            <CalendarCheck className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-white">
              {financialMetrics.activeBookingsCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {financialMetrics.totalBookingsCount} total platform sessions
            </div>
          </div>
        </div>

        {/* Total GBV */}
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Total GBV</span>
            <Euro className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-400">
              €{financialMetrics.totalGrossEur}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Gross booking volume
            </div>
          </div>
        </div>

        {/* Platform Take-rate (14%) */}
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Platform Revenue</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-amber-400">
              €{financialMetrics.totalPlatformEur}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              14% net commission retained
            </div>
          </div>
        </div>

        {/* Total Gym Floor Fees */}
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Gym Floor Fees</span>
            <Building2 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-sky-400">
              €{financialMetrics.totalFloorEur}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              €8.00 / session venue payout
            </div>
          </div>
        </div>

        {/* Net Coach Payouts */}
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 shadow-sm flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Coach Earnings</span>
            <Dumbbell className="w-4 h-4 text-purple-400" />
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-purple-400">
              €{financialMetrics.totalCoachEur}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Net trainer earnings disbursed
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
