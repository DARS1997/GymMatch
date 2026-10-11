'use client';

import React, { useState, useMemo } from 'react';
import { useRole } from '@/context/RoleContext';
import { Booking, BookingStatus } from '@/types/database';
import { LINZ_PROFILES } from '@/lib/data/linz-seed';
import { calculateSplitPayment, eurToCents } from '@/lib/payments/split';
import {
  Search,
  Filter,
  SlidersHorizontal,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  X,
  CreditCard,
  Building2,
  User,
  Dumbbell,
  ShieldAlert,
  ArrowRight,
  Receipt,
} from 'lucide-react';

export const DisputeResolutionTable: React.FC = () => {
  const { bookings, gyms, coaches, updateBookingStatus, refundBooking } = useRole();

  // Search & Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [gymFilter, setGymFilter] = useState<string>('all');

  // Timeline / Details Drawer state
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  // Status Override Modal state
  const [overrideModalBooking, setOverrideModalBooking] = useState<Booking | null>(null);
  const [newStatus, setNewStatus] = useState<BookingStatus>('confirmed');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [isOverrideSubmitting, setIsOverrideSubmitting] = useState(false);

  // Refund Confirmation Modal state
  const [refundModalBooking, setRefundModalBooking] = useState<Booking | null>(null);
  const [refundReason, setRefundReason] = useState<string>('');
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // Filtered Bookings
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      // Status filter
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;

      // Venue filter
      if (gymFilter !== 'all' && b.gym_id !== gymFilter) return false;

      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const gymName = gyms.find((g) => g.id === b.gym_id)?.name.toLowerCase() || '';
        const coachName = coaches.find((c) => c.id === b.coach_id)?.full_name.toLowerCase() || '';
        const clientName =
          LINZ_PROFILES.find((p) => p.id === b.client_id)?.full_name.toLowerCase() || '';
        const notes = (b.client_notes || '').toLowerCase();
        const bookingId = b.id.toLowerCase();

        const matches =
          bookingId.includes(query) ||
          gymName.includes(query) ||
          coachName.includes(query) ||
          clientName.includes(query) ||
          notes.includes(query);

        if (!matches) return false;
      }

      return true;
    });
  }, [bookings, gyms, coaches, statusFilter, gymFilter, searchQuery]);

  // Handle status override submission
  const handleConfirmOverride = async () => {
    if (!overrideModalBooking) return;
    setIsOverrideSubmitting(true);
    try {
      await updateBookingStatus(
        overrideModalBooking.id,
        newStatus,
        overrideReason || `Admin manual override to ${newStatus}`
      );
      // Update selected booking if currently open in drawer
      if (selectedBooking && selectedBooking.id === overrideModalBooking.id) {
        let updatedFloor = selectedBooking.gym_floor_fee;
        let updatedPlatform = selectedBooking.platform_fee;
        let updatedCoach = selectedBooking.coach_payout;

        if (newStatus === 'cancelled') {
          updatedFloor = 0;
          updatedPlatform = 0;
          updatedCoach = 0;
        } else if (selectedBooking.status === 'cancelled') {
          const split = calculateSplitPayment({
            grossAmountCents: eurToCents(selectedBooking.gross_amount),
          });
          updatedFloor = split.gymFloorFeeCents / 100;
          updatedPlatform = split.platformFeeCents / 100;
          updatedCoach = split.coachPayoutCents / 100;
        }

        setSelectedBooking({
          ...selectedBooking,
          status: newStatus,
          gym_floor_fee: updatedFloor,
          platform_fee: updatedPlatform,
          coach_payout: updatedCoach,
          cancellation_reason:
            newStatus === 'cancelled'
              ? overrideReason || 'Admin manual cancellation'
              : overrideReason || selectedBooking.cancellation_reason,
        });
      }
      setOverrideModalBooking(null);
      setOverrideReason('');
    } finally {
      setIsOverrideSubmitting(false);
    }
  };

  // Handle refund submission
  const handleConfirmRefund = async () => {
    if (!refundModalBooking) return;
    setIsRefundSubmitting(true);
    try {
      await refundBooking(
        refundModalBooking.id,
        refundReason || 'Administrative dispute refund issued by Platform Manager'
      );
      if (selectedBooking && selectedBooking.id === refundModalBooking.id) {
        setSelectedBooking({
          ...selectedBooking,
          status: 'cancelled',
          gym_floor_fee: 0,
          platform_fee: 0,
          coach_payout: 0,
          cancellation_reason:
            refundReason || 'Administrative dispute refund issued by Platform Manager',
        });
      }
      setRefundModalBooking(null);
      setRefundReason('');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  // Helper status badge
  const renderStatusBadge = (status: BookingStatus) => {
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
      {/* Search & Filter Bar */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-3">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search booking ID, athlete, coach, or Linz venue..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white text-slate-900 pl-9 pr-3 py-2 rounded-xl text-xs border border-slate-300 focus:outline-none focus:border-emerald-500 font-medium placeholder:text-slate-500"
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="block text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
              Status Filter
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            >
              <option value="all" className="bg-white text-slate-900">All Statuses ({bookings.length})</option>
              <option value="confirmed" className="bg-white text-slate-900">Confirmed</option>
              <option value="checked_in" className="bg-white text-slate-900">Checked In</option>
              <option value="completed" className="bg-white text-slate-900">Completed</option>
              <option value="cancelled" className="bg-white text-slate-900">Cancelled</option>
              <option value="pending" className="bg-white text-slate-900">Pending</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] text-slate-400 font-semibold mb-1 uppercase tracking-wider">
              Venue Filter
            </label>
            <select
              value={gymFilter}
              onChange={(e) => setGymFilter(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 font-medium"
            >
              <option value="all" className="bg-white text-slate-900">All Linz Gyms ({gyms.length})</option>
              {gyms.map((g) => (
                <option key={g.id} value={g.id} className="bg-white text-slate-900">
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Bookings List / Table */}
      <div className="space-y-2.5">
        <div className="text-xs text-slate-400 font-semibold flex items-center justify-between px-1">
          <span>Platform Sessions ({filteredBookings.length})</span>
          <span>Click session for audit lifecycle</span>
        </div>

        {filteredBookings.length > 0 ? (
          filteredBookings.map((b) => {
            const gym = gyms.find((g) => g.id === b.gym_id);
            const coach = coaches.find((c) => c.id === b.coach_id);
            const clientName =
              LINZ_PROFILES.find((p) => p.id === b.client_id)?.full_name ||
              `Client ${b.client_id.substring(0, 8)}`;

            const sessionDate = new Date(b.session_time);
            const dateStr = sessionDate.toLocaleDateString('de-AT', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            });
            const timeStr = sessionDate.toLocaleTimeString('de-AT', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={b.id}
                className="bg-slate-900 rounded-xl p-3.5 border border-slate-800 hover:border-slate-700 transition-all space-y-2 shadow-sm"
              >
                {/* Header: ID, Date & Status */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                    <span className="text-slate-500">ID:</span>
                    <span className="font-bold text-sky-400 truncate max-w-[120px] sm:max-w-[180px]">
                      {b.id}
                    </span>
                  </div>
                  <div>{renderStatusBadge(b.status)}</div>
                </div>

                {/* Session Parties */}
                <div className="grid grid-cols-2 gap-2 text-xs py-1 border-t border-slate-800/80">
                  <div>
                    <div className="text-[10px] text-slate-400 font-semibold">Athlete & Coach</div>
                    <div className="font-bold text-white truncate">{clientName}</div>
                    <div className="text-[11px] text-slate-300 truncate">
                      w/ {coach?.full_name || 'Coach'}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] text-slate-400 font-semibold">Venue & Time</div>
                    <div className="font-bold text-white truncate">{gym?.name || 'Linz Gym'}</div>
                    <div className="text-[11px] text-sky-300">
                      {dateStr} {timeStr}
                    </div>
                  </div>
                </div>

                {/* Split Financials Summary */}
                <div className="flex items-center justify-between text-[11px] bg-slate-850/80 px-2.5 py-1.5 rounded-lg border border-slate-800/80">
                  <span className="font-bold text-emerald-400">
                    Gross: €{b.gross_amount.toFixed(2)}
                  </span>
                  <span className="text-slate-400">
                    Floor: €{b.gym_floor_fee.toFixed(2)} • Plat: €{b.platform_fee.toFixed(2)} • Coach: €
                    {b.coach_payout.toFixed(2)}
                  </span>
                </div>

                {/* Admin Actions Toolbar */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 gap-1.5">
                  <button
                    onClick={() => setSelectedBooking(b)}
                    className="flex-1 py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-sky-400" />
                    <span>Timeline</span>
                  </button>

                  <button
                    onClick={() => {
                      setOverrideModalBooking(b);
                      setNewStatus(b.status);
                    }}
                    className="flex-1 py-1 px-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                    <span>Override</span>
                  </button>

                  {b.status !== 'cancelled' && (
                    <button
                      onClick={() => setRefundModalBooking(b)}
                      className="py-1 px-2.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Refund</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-slate-900 rounded-xl p-8 border border-slate-800 text-center space-y-2">
            <Filter className="w-8 h-8 text-slate-600 mx-auto" />
            <h4 className="text-sm font-bold text-white">No Matching Bookings</h4>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              No sessions matched the search query and filters. Clear filters to view all bookings.
            </p>
          </div>
        )}
      </div>

      {/* TIMELINE / DETAILS MODAL DRAWER */}
      {selectedBooking && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-md w-full border border-slate-800 shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black uppercase text-sky-400 tracking-wider">
                  Audit Lifecycle Drawer
                </span>
                <h3 className="text-base font-bold text-white">Booking Details & Timeline</h3>
                <div className="font-mono text-xs text-slate-400 mt-0.5 truncate max-w-[280px]">
                  {selectedBooking.id}
                </div>
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Split Financial Breakdown */}
            <div className="bg-slate-850 rounded-xl p-3 border border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Integer-Cent Balance Conservation</span>
                {renderStatusBadge(selectedBooking.status)}
              </div>
              <div className="grid grid-cols-4 gap-1 text-center text-xs">
                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <div className="text-[9px] text-slate-400 font-semibold">Gross</div>
                  <div className="font-bold text-white">€{selectedBooking.gross_amount.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <div className="text-[9px] text-slate-400 font-semibold">Floor</div>
                  <div className="font-bold text-sky-400">€{selectedBooking.gym_floor_fee.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <div className="text-[9px] text-slate-400 font-semibold">Platform</div>
                  <div className="font-bold text-amber-400">€{selectedBooking.platform_fee.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                  <div className="text-[9px] text-slate-400 font-semibold">Coach</div>
                  <div className="font-bold text-purple-400">€{selectedBooking.coach_payout.toFixed(2)}</div>
                </div>
              </div>
              {selectedBooking.cancellation_reason && (
                <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-500/20 p-2 rounded-lg mt-1">
                  <span className="font-semibold">Reason:</span> {selectedBooking.cancellation_reason}
                </div>
              )}
            </div>

            {/* Timeline Steps */}
            <div className="space-y-3 pt-1">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Lifecycle Events Trail
              </div>

              {/* Event 1: Creation */}
              <div className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="w-0.5 flex-1 bg-slate-800 my-1" />
                </div>
                <div className="pb-3">
                  <div className="font-bold text-white">Booking Initiated & Captured</div>
                  <div className="text-[11px] text-slate-400">
                    PaymentIntent {selectedBooking.stripe_payment_intent_id || 'pi_simulated'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Created at {new Date(selectedBooking.created_at).toLocaleString('de-AT')}
                  </div>
                </div>
              </div>

              {/* Event 2: GM1 Pass Issue */}
              <div className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center">
                    <Receipt className="w-3.5 h-3.5" />
                  </div>
                  <div className="w-0.5 flex-1 bg-slate-800 my-1" />
                </div>
                <div className="pb-3">
                  <div className="font-bold text-white">Dynamic HMAC-SHA256 Pass Issued</div>
                  <div className="text-[11px] text-slate-400">
                    Valid ±30m around session start ({new Date(selectedBooking.session_time).toLocaleString('de-AT')})
                  </div>
                </div>
              </div>

              {/* Event 3: Check-in / Current State */}
              <div className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      selectedBooking.status === 'completed' || selectedBooking.status === 'checked_in'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : selectedBooking.status === 'cancelled'
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {selectedBooking.status === 'cancelled' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-white">
                    Current Status: {selectedBooking.status.toUpperCase()}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {selectedBooking.status === 'completed'
                      ? 'Session successfully finished; Stripe transfers disbursed.'
                      : selectedBooking.status === 'checked_in'
                      ? 'Dynamic QR redeemed at reception desk.'
                      : selectedBooking.status === 'cancelled'
                      ? 'Booking cancelled; balances reconciled.'
                      : 'Awaiting session time and check-in scan.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Close Button */}
            <div className="pt-2">
              <button
                onClick={() => setSelectedBooking(null)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATUS OVERRIDE MODAL */}
      {overrideModalBooking && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-sm w-full border border-slate-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                  Override Booking Status
                </h3>
                <div className="font-mono text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">
                  {overrideModalBooking.id}
                </div>
              </div>
              <button
                onClick={() => setOverrideModalBooking(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-semibold mb-1">Target Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as BookingStatus)}
                  className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:border-emerald-500"
                >
                  <option value="pending" className="bg-white text-slate-900">pending</option>
                  <option value="confirmed" className="bg-white text-slate-900">confirmed</option>
                  <option value="checked_in" className="bg-white text-slate-900">checked_in</option>
                  <option value="completed" className="bg-white text-slate-900">completed</option>
                  <option value="cancelled" className="bg-white text-slate-900">cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">
                  Administrative Reason (Audit Log)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Reception hardware failure manual check-in verification"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setOverrideModalBooking(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isOverrideSubmitting}
                onClick={handleConfirmOverride}
                className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
              >
                {isOverrideSubmitting ? 'Updating...' : 'Save Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REFUND CONFIRMATION MODAL */}
      {refundModalBooking && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl max-w-sm w-full border border-slate-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-rose-400 flex items-center gap-1.5">
                  <RotateCcw className="w-4 h-4" />
                  Issue Full Dispute Refund
                </h3>
                <div className="font-mono text-xs text-slate-400 mt-0.5 truncate max-w-[240px]">
                  {refundModalBooking.id}
                </div>
              </div>
              <button
                onClick={() => setRefundModalBooking(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 text-xs space-y-1.5 text-slate-300">
              <div className="font-bold text-white flex items-center gap-1 text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                Integer-Cent Balance Reconciliation
              </div>
              <p className="text-[11px] leading-relaxed">
                Issuing a full refund will refund €{refundModalBooking.gross_amount.toFixed(2)} (100%) to the client, cancel the booking, and zero out gym floor fees and coach disbursements with 0.00¢ rounding drift.
              </p>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="block text-slate-400 font-semibold">Refund Audit Reason</label>
              <input
                type="text"
                placeholder="e.g. Trainer illness, facility power outage"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg p-2 placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRefundModalBooking(null)}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isRefundSubmitting}
                onClick={handleConfirmRefund}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
              >
                {isRefundSubmitting ? 'Processing...' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
