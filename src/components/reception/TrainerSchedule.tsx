'use client';

import React, { useState, useMemo } from 'react';
import { useRole } from '@/context/RoleContext';
import { BookingStatus, Booking } from '@/types/database';
import { LINZ_PROFILES } from '@/lib/data/linz-seed';
import {
  Calendar,
  Clock,
  User,
  Dumbbell,
  Building2,
  CheckCircle2,
  AlertCircle,
  Filter,
  TrendingUp,
  Award,
  Euro,
  Users,
} from 'lucide-react';

export const TrainerSchedule: React.FC = () => {
  const { receptionGymId, gyms, coaches, bookings } = useRole();

  // Find currently active facility
  const currentGym = gyms.find((g) => g.id === receptionGymId) || gyms[0];

  // Filters state
  const [dateFilterMode, setDateFilterMode] = useState<'all' | 'today' | 'custom'>('all');
  const [customDate, setCustomDate] = useState<string>('2026-10-15');
  const [selectedCoachId, setSelectedCoachId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // STRICT FACILITY BOUNDARY: filter strictly by current facility
  const facilityBookings = useMemo(() => {
    return bookings.filter((b) => b.gym_id === currentGym.id);
  }, [bookings, currentGym.id]);

  // Today's date string in ISO YYYY-MM-DD
  const todayIso = useMemo(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  // Filtered sessions based on multi-filter toolbar
  const filteredSessions = useMemo(() => {
    return facilityBookings.filter((b) => {
      // Date filter
      if (dateFilterMode === 'today') {
        const sessionDate = b.session_time.split('T')[0];
        if (sessionDate !== todayIso) return false;
      } else if (dateFilterMode === 'custom') {
        const sessionDate = b.session_time.split('T')[0];
        if (sessionDate !== customDate) return false;
      }

      // Coach filter
      if (selectedCoachId !== 'all' && b.coach_id !== selectedCoachId) {
        return false;
      }

      // Status filter
      if (selectedStatus !== 'all' && b.status !== selectedStatus) {
        return false;
      }

      return true;
    });
  }, [facilityBookings, dateFilterMode, todayIso, customDate, selectedCoachId, selectedStatus]);

  // Real-time KPI summaries for this facility
  const totalBookedHours = useMemo(() => {
    return facilityBookings.reduce((sum, b) => sum + (b.duration_minutes || 60), 0) / 60;
  }, [facilityBookings]);

  const attendanceMetrics = useMemo(() => {
    const attendedSessions = facilityBookings.filter(
      (b) => b.status === 'checked_in' || b.status === 'completed'
    ).length;
    const nonCancelledSessions = facilityBookings.filter((b) => b.status !== 'cancelled').length;
    const rate =
      nonCancelledSessions > 0
        ? Math.round((attendedSessions / nonCancelledSessions) * 100)
        : 0;

    const floorFeesEarned = attendedSessions * 8.0;

    return {
      attendedSessions,
      nonCancelledSessions,
      rate,
      floorFeesEarned,
    };
  }, [facilityBookings]);

  // Per-coach performance breakdown at this facility
  const coachesBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        coachId: string;
        coachName: string;
        avatarUrl?: string | null;
        totalSessions: number;
        attendedSessions: number;
        bookedHours: number;
        floorFeesEarned: number;
      }
    >();

    for (const b of facilityBookings) {
      const coach = coaches.find((c) => c.id === b.coach_id);
      const coachName = coach ? coach.full_name : `Coach ${b.coach_id.substring(0, 6)}`;
      const avatarUrl = coach?.avatar_url;

      const existing = map.get(b.coach_id) || {
        coachId: b.coach_id,
        coachName,
        avatarUrl,
        totalSessions: 0,
        attendedSessions: 0,
        bookedHours: 0,
        floorFeesEarned: 0,
      };

      existing.totalSessions += 1;
      existing.bookedHours += (b.duration_minutes || 60) / 60;
      if (b.status === 'checked_in' || b.status === 'completed') {
        existing.attendedSessions += 1;
        existing.floorFeesEarned += 8.0;
      }

      map.set(b.coach_id, existing);
    }

    return Array.from(map.values());
  }, [facilityBookings, coaches]);

  // Helper for status badge styling
  const getStatusBadge = (status: BookingStatus) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Confirmed
          </span>
        );
      case 'checked_in':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            Checked In
          </span>
        );
      case 'completed':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Completed
          </span>
        );
      case 'cancelled':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            Cancelled
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Facility Header Badge */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-sm flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-sky-400 font-semibold mb-1">
            <Building2 className="w-4 h-4" />
            <span>Facility Schedule Scoped</span>
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">{currentGym.name}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {currentGym.address}, {currentGym.postal_code} {currentGym.city}
          </p>
        </div>
        <div className="text-right">
          <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            €8.00 / session fee
          </span>
          <div className="text-[11px] text-slate-400 mt-1 font-medium">
            {facilityBookings.length} total bookings
          </div>
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-3 gap-2">
        {/* Attendance Rate */}
        <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
            <span>Attendance</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1">
            <div className="text-lg font-black text-white">{attendanceMetrics.rate}%</div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {attendanceMetrics.attendedSessions} of {attendanceMetrics.nonCancelledSessions} attended
            </div>
          </div>
        </div>

        {/* Booked Hours */}
        <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
            <span>Booked Hours</span>
            <Clock className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="mt-1">
            <div className="text-lg font-black text-white">{totalBookedHours.toFixed(1)}h</div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {facilityBookings.length} slots booked
            </div>
          </div>
        </div>

        {/* Floor Fee Earnings */}
        <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-[10px] font-semibold">
            <span>Floor Fees</span>
            <Euro className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="mt-1">
            <div className="text-lg font-black text-emerald-400">
              €{attendanceMetrics.floorFeesEarned.toFixed(2)}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Facility total earned
            </div>
          </div>
        </div>
      </div>

      {/* Per-Coach Floor Fee Contribution Summary */}
      {coachesBreakdown.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-3 border border-slate-800">
          <div className="text-xs font-semibold text-slate-300 flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              Coach Floor Fee Contributions ({coachesBreakdown.length} Coaches)
            </span>
            <span className="text-[10px] text-slate-400">Fixed €8.00 / session</span>
          </div>

          <div className="space-y-1.5">
            {coachesBreakdown.map((cb) => {
              const coachAttendanceRate =
                cb.totalSessions > 0
                  ? Math.round((cb.attendedSessions / cb.totalSessions) * 100)
                  : 0;

              return (
                <div
                  key={cb.coachId}
                  className="flex items-center justify-between text-xs bg-slate-850/60 p-2 rounded-lg border border-slate-800/80"
                >
                  <div className="flex items-center gap-2">
                    {cb.avatarUrl ? (
                      <img
                        src={cb.avatarUrl}
                        alt={cb.coachName}
                        className="w-6 h-6 rounded-md object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-400 text-[10px]">
                        <User className="w-3 h-3" />
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-white">{cb.coachName}</div>
                      <div className="text-[10px] text-slate-400">
                        {cb.bookedHours.toFixed(1)}h booked • {coachAttendanceRate}% attendance
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-emerald-400">
                      +€{cb.floorFeesEarned.toFixed(2)}
                    </div>
                    <div className="text-[9px] text-slate-400">
                      {cb.attendedSessions} check-ins
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Multi-Filter Toolbar */}
      <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-300 font-semibold">
          <span className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            Filter Schedule
          </span>
          <span className="text-[10px] text-slate-400 font-normal">
            Showing {filteredSessions.length} of {facilityBookings.length} sessions
          </span>
        </div>

        {/* Date Filter Modes */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setDateFilterMode('all')}
            className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
              dateFilterMode === 'all'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            All Dates
          </button>
          <button
            onClick={() => setDateFilterMode('today')}
            className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
              dateFilterMode === 'today'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateFilterMode('custom')}
            className={`flex-1 py-1 px-2 rounded-lg text-[11px] font-semibold transition-colors ${
              dateFilterMode === 'custom'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-850 text-slate-400 hover:text-slate-200 border border-slate-700/80'
            }`}
          >
            Pick Date
          </button>
        </div>

        {/* Custom Date Input if selected */}
        {dateFilterMode === 'custom' && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-slate-400 font-medium">Session Date:</span>
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="bg-white text-slate-900 border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            />
          </div>
        )}

        {/* Trainer & Status Dropdowns */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {/* Trainer Dropdown */}
          <div>
            <label className="block text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
              Trainer Name
            </label>
            <select
              value={selectedCoachId}
              onChange={(e) => setSelectedCoachId(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            >
              <option value="all" className="bg-white text-slate-900">All Trainers</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id} className="bg-white text-slate-900">
                  {c.full_name}
                </option>
              ))}
            </select>
          </div>

          {/* Booking Status Dropdown */}
          <div>
            <label className="block text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
              Booking Status
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            >
              <option value="all" className="bg-white text-slate-900">All Statuses</option>
              <option value="confirmed" className="bg-white text-slate-900">Confirmed</option>
              <option value="checked_in" className="bg-white text-slate-900">Checked In</option>
              <option value="completed" className="bg-white text-slate-900">Completed</option>
              <option value="cancelled" className="bg-white text-slate-900">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Session Cards List */}
      <div className="space-y-2.5">
        {filteredSessions.length > 0 ? (
          filteredSessions.map((session) => {
            const coach = coaches.find((c) => c.id === session.coach_id);
            const coachName = coach ? coach.full_name : `Coach ${session.coach_id.substring(0, 6)}`;
            const clientName =
              LINZ_PROFILES.find((p) => p.id === session.client_id)?.full_name ||
              `Client ${session.client_id.substring(0, 8)}`;

            const sessionDate = new Date(session.session_time);
            const dateFormatted = sessionDate.toLocaleDateString('de-AT', {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            });
            const timeFormatted = sessionDate.toLocaleTimeString('de-AT', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={session.id}
                className="bg-slate-900 rounded-xl p-3.5 border border-slate-800 hover:border-slate-700 transition-all space-y-2.5 shadow-sm"
              >
                {/* Header: Date, Time & Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    <span>{dateFormatted}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-sky-300 font-bold">{timeFormatted}</span>
                    <span className="text-[10px] text-slate-400">({session.duration_minutes}m)</span>
                  </div>
                  <div>{getStatusBadge(session.status)}</div>
                </div>

                {/* Trainer & Athlete Details */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/60">
                  {/* Trainer Info */}
                  <div className="flex items-center gap-2">
                    {coach?.avatar_url ? (
                      <img
                        src={coach.avatar_url}
                        alt={coachName}
                        className="w-7 h-7 rounded-lg object-cover border border-slate-700"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400">
                        <Dumbbell className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Trainer</div>
                      <div className="text-xs font-bold text-white truncate">{coachName}</div>
                    </div>
                  </div>

                  {/* Athlete Info */}
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Athlete</div>
                      <div className="text-xs font-bold text-white truncate">{clientName}</div>
                    </div>
                  </div>
                </div>

                {/* Notes & Floor Fee Payout Footer */}
                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800/60 text-slate-400">
                  <div className="text-[11px] truncate max-w-[200px] text-slate-300 italic">
                    {session.client_notes ? `"${session.client_notes}"` : 'No special notes'}
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-semibold ${
                        session.status === 'cancelled'
                          ? 'text-slate-500 line-through'
                          : 'text-emerald-400 font-bold'
                      }`}
                    >
                      {session.status === 'cancelled' ? '€0.00 Floor Fee' : '+€8.00 Floor Fee'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-slate-900 rounded-xl p-8 border border-slate-800 text-center space-y-2">
            <Calendar className="w-8 h-8 text-slate-600 mx-auto" />
            <h4 className="text-sm font-bold text-white">No Booked Sessions Found</h4>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              There are no trainer sessions scheduled at {currentGym.name} matching your filter criteria.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
