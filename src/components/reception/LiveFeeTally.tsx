'use client';

import React from 'react';
import { useRole } from '@/context/RoleContext';
import { Building2, DollarSign, Users, Clock, CheckCircle2, TrendingUp } from 'lucide-react';

export const LiveFeeTally: React.FC = () => {
  const { receptionGymId, gyms, passes, bookings, coaches } = useRole();

  const currentGym = gyms.find((g) => g.id === receptionGymId) || gyms[0];

  // Passes belonging to this gym
  const gymPasses = passes.filter((p) => p.gym_id === currentGym.id);
  const redeemedPasses = gymPasses.filter((p) => p.is_redeemed);

  // Today's floor fee earnings (€8.00 per check-in)
  const floorFeePerSession = currentGym.floor_fee || 8.0;
  const todayCheckInsCount = redeemedPasses.length;
  const todayEarnedFloorFees = todayCheckInsCount * floorFeePerSession;

  // Month-to-date baseline simulation (baseline 85 historical + today)
  const mtdCheckIns = 85 + todayCheckInsCount;
  const mtdEarned = mtdCheckIns * floorFeePerSession;

  return (
    <div className="space-y-4">
      {/* Hero Live Floor Fee Accumulator Widget */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 rounded-2xl p-4 border border-sky-500/30 shadow-xl shadow-sky-500/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm leading-tight">{currentGym.name}</h3>
              <p className="text-[11px] text-slate-400">Linz Floor Fee Revenue Desk</p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              Guaranteed €{floorFeePerSession.toFixed(2)}/Scan
            </span>
          </div>
        </div>

        {/* Big glowing revenue display */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
          <div className="bg-slate-950/80 p-3 rounded-xl border border-sky-500/20">
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-sky-400" />
              Today&apos;s Floor Fees
            </div>
            <div className="text-2xl font-black text-sky-400 mt-1">
              €{todayEarnedFloorFees.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {todayCheckInsCount} checked-in session{todayCheckInsCount === 1 ? '' : 's'}
            </div>
          </div>

          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
            <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              Month-to-Date Accrual
            </div>
            <div className="text-2xl font-black text-emerald-400 mt-1">
              €{mtdEarned.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {mtdCheckIns} total check-ins
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Front Desk Check-in Log */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs px-1">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-sky-400" />
            Desk Check-in Activity ({redeemedPasses.length})
          </span>
          <span className="text-[11px] text-slate-400">Live Sync</span>
        </div>

        {redeemedPasses.length === 0 ? (
          <div className="bg-slate-900 rounded-xl p-5 text-center border border-slate-800 text-xs text-slate-400">
            No check-ins scanned for {currentGym.name} yet today. Use the QR Scanner below to validate incoming passes!
          </div>
        ) : (
          <div className="space-y-2">
            {redeemedPasses.map((pass) => {
              const booking = bookings.find((b) => b.id === pass.booking_id);
              const coach = coaches.find((c) => c.id === booking?.coach_id);
              const redemptionTime = pass.redeemed_at
                ? new Date(pass.redeemed_at).toLocaleTimeString('de-AT', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : 'Earlier Today';

              return (
                <div
                  key={pass.id}
                  className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Max Mustermann</span>
                      <span className="text-slate-500 font-normal">•</span>
                      <span className="text-slate-400 font-normal">
                        Coach: {coach?.full_name || 'Coach'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-500" />
                      Redeemed at: {redemptionTime}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md border border-sky-500/20 text-xs">
                      +€{floorFeePerSession.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-500 block mt-0.5 font-mono">
                      Pass: {pass.id.substring(0, 8)}...
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
