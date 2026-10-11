'use client';

import React from 'react';
import { useRole } from '@/context/RoleContext';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  CheckCircle2,
  DollarSign,
  TrendingUp,
  FileText,
} from 'lucide-react';

export const CoachDashboard: React.FC = () => {
  const { coaches, activeCoachId, setActiveCoachId, bookings, gyms } = useRole();

  const currentCoach = coaches.find((c) => c.id === activeCoachId) || coaches[0];
  const coachBookings = bookings.filter((b) => b.coach_id === currentCoach.id);

  // Compute metrics
  const totalGross = coachBookings.reduce((sum, b) => sum + b.gross_amount, 0);
  const totalNet = coachBookings.reduce((sum, b) => sum + b.coach_payout, 0);
  const totalFloorFees = coachBookings.reduce((sum, b) => sum + b.gym_floor_fee, 0);
  const checkedInCount = coachBookings.filter(
    (b) => b.status === 'checked_in' || b.status === 'completed'
  ).length;

  return (
    <div className="space-y-4">
      {/* Coach Profile Selector Card */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={currentCoach.avatar_url || ''}
              alt={currentCoach.full_name}
              className="w-12 h-12 rounded-xl object-cover border border-slate-700"
            />
            <div>
              <h3 className="font-bold text-white text-base leading-tight">
                {currentCoach.full_name}
              </h3>
              <p className="text-xs text-emerald-400 font-medium mt-0.5">
                Certified Trainer • €{currentCoach.hourly_rate.toFixed(2)}/h
              </p>
            </div>
          </div>

          {/* Quick Coach Profile Switcher */}
          <select
            value={activeCoachId}
            onChange={(e) => setActiveCoachId(e.target.value)}
            className="bg-white text-slate-900 border border-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500 font-medium"
          >
            {coaches.map((c) => (
              <option key={c.id} value={c.id} className="bg-white text-slate-900">
                {c.full_name}
              </option>
            ))}
          </select>
        </div>

        {/* Live Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
          <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/60">
            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-400" />
              Net Earnings
            </div>
            <div className="text-base font-black text-emerald-400 mt-0.5">
              €{totalNet.toFixed(2)}
            </div>
            <div className="text-[9px] text-slate-500">From €{totalGross.toFixed(2)} Gross</div>
          </div>

          <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/60">
            <div className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-sky-400" />
              Sessions
            </div>
            <div className="text-base font-black text-white mt-0.5">
              {coachBookings.length}{' '}
              <span className="text-xs text-slate-400 font-normal">
                ({checkedInCount} checked in)
              </span>
            </div>
            <div className="text-[9px] text-sky-400">€{totalFloorFees.toFixed(2)} Floor Fees</div>
          </div>
        </div>
      </div>

      {/* Booked Sessions Timeline */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs px-1">
          <span className="font-bold text-slate-300 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            Assigned Sessions & Clients ({coachBookings.length})
          </span>
          <span className="text-[11px] text-slate-500">Chronological</span>
        </div>

        {coachBookings.length === 0 ? (
          <div className="bg-slate-900 rounded-2xl p-6 text-center border border-slate-800 text-xs text-slate-400">
            No sessions booked yet for this coach. Switch to Client role to book a session!
          </div>
        ) : (
          <div className="space-y-3">
            {coachBookings.map((b) => {
              const gym = gyms.find((g) => g.id === b.gym_id);
              const sessionDate = new Date(b.session_time);
              const formattedTime = sessionDate.toLocaleDateString('de-AT', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={b.id}
                  className="bg-slate-900 rounded-2xl p-3.5 border border-slate-800 space-y-2.5"
                >
                  {/* Top Bar: Venue & Status */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                      {gym?.name || 'Partner Gym'}
                    </span>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        b.status === 'checked_in'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : b.status === 'confirmed'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {b.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Client & Date */}
                  <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-500" />
                        Athlete: <strong className="text-slate-200">Max Mustermann</strong>
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {formattedTime} ({b.duration_minutes} min)
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xs font-bold text-emerald-400">
                        +€{b.coach_payout.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">Net payout</div>
                    </div>
                  </div>

                  {/* Training Notes */}
                  {b.client_notes && (
                    <div className="text-[11px] text-slate-300 bg-slate-800/50 p-2 rounded-lg border border-slate-700/40 flex items-start gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{b.client_notes}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
