'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { RoleSwitcher } from '@/components/layout/RoleSwitcher';
import { GymDiscovery } from '@/components/client/GymDiscovery';
import { CoachStorefront } from '@/components/client/CoachStorefront';
import { AvailabilityPicker } from '@/components/client/AvailabilityPicker';
import { CheckoutModal } from '@/components/client/CheckoutModal';
import { PassViewer } from '@/components/client/PassViewer';
import { CoachDashboard } from '@/components/coach/CoachDashboard';
import { AvailabilityManager } from '@/components/coach/AvailabilityManager';
import { PayoutSummary } from '@/components/coach/PayoutSummary';
import { ReceptionScanner } from '@/components/reception/ReceptionScanner';
import { LiveFeeTally } from '@/components/reception/LiveFeeTally';
import { TrainerSchedule } from '@/components/reception/TrainerSchedule';
import { PlatformManagerDashboard } from '@/components/manager/PlatformManagerDashboard';
import { CoachProfile, Gym, Booking, CheckInPass } from '@/types/database';
import {
  Building2,
  Dumbbell,
  QrCode,
  LayoutDashboard,
  Calendar,
  Wallet,
  ScanLine,
  TrendingUp,
  Briefcase,
  ShoppingCart,
  AlertCircle,
  X,
  ShieldCheck,
} from 'lucide-react';

export default function Home() {
  const {
    role,
    setRole,
    coachSubMode,
    setCoachSubMode,
    activeCoachId,
    setReceptionGymId,
    passes,
  } = useRole();

  // Client Tab Navigation: 'gyms' | 'coaches' | 'passes'
  const [clientTab, setClientTab] = useState<'gyms' | 'coaches' | 'passes'>('gyms');
  // Coach Tab Navigation: 'dashboard' | 'availability' | 'payouts'
  const [coachTab, setCoachTab] = useState<'dashboard' | 'availability' | 'payouts'>('dashboard');
  // Gym Tab Navigation: 'scanner' | 'schedule'
  const [gymTab, setGymTab] = useState<'scanner' | 'schedule'>('scanner');
  // Reception Tab Navigation: 'scanner' | 'tally' (backward compat)
  const [receptionTab, setReceptionTab] = useState<'scanner' | 'tally'>('scanner');

  // Booking Flow active states
  const [selectedCoach, setSelectedCoach] = useState<CoachProfile | null>(null);
  const [selectedGym, setSelectedGym] = useState<Gym | null>(null);
  const [selfBookingWarning, setSelfBookingWarning] = useState<string | null>(null);
  const [checkoutData, setCheckoutData] = useState<{
    coach: CoachProfile;
    gym: Gym;
    sessionTimeIso: string;
    formattedDate: string;
    timeString: string;
  } | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Unredeemed passes count for client badge
  const unredeemedPassesCount = passes.filter((p) => !p.is_redeemed).length;

  // Handlers
  const handleSelectGymFromDiscovery = (gym: Gym) => {
    setSelectedGym(gym);
    setClientTab('coaches');
  };

  const handleSelectCoachFromStorefront = (coach: CoachProfile) => {
    // Coach-as-Client self-booking protection
    if (role === 'coach' && coachSubMode === 'client' && coach.id === activeCoachId) {
      setSelfBookingWarning(
        'Self-booking protected: You cannot book a session with yourself. Please select another coach.'
      );
      return;
    }
    setSelfBookingWarning(null);
    setSelectedCoach(coach);
  };

  const handleProceedToCheckout = (data: {
    coach: CoachProfile;
    gym: Gym;
    sessionTimeIso: string;
    formattedDate: string;
    timeString: string;
  }) => {
    setCheckoutData(data);
    setIsCheckoutOpen(true);
  };

  const handleCheckoutSuccess = (booking: Booking, pass: CheckInPass) => {
    setIsCheckoutOpen(false);
    setSelectedCoach(null);
    setCheckoutData(null);
    setClientTab('passes');
  };

  const handleScanPassInReception = (token: string, gymId: string) => {
    setReceptionGymId(gymId);
    setRole('gym');
    setGymTab('scanner');
    setReceptionTab('scanner');
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Pinned 4-Role Switcher */}
      <RoleSwitcher />

      {/* Main Role Content Container */}
      <div className="flex-1 p-4 pb-20">
        {/* ROLE: CLIENT */}
        {role === 'client' && (
          <div className="space-y-4">
            {/* If selecting a slot for a coach */}
            {selectedCoach ? (
              <AvailabilityPicker
                coach={selectedCoach}
                gym={selectedGym || undefined}
                onProceedToCheckout={handleProceedToCheckout}
                onBackToCoaches={() => setSelectedCoach(null)}
              />
            ) : (
              <>
                {clientTab === 'gyms' && (
                  <GymDiscovery
                    onSelectGym={handleSelectGymFromDiscovery}
                    selectedGymId={selectedGym?.id}
                  />
                )}

                {clientTab === 'coaches' && (
                  <CoachStorefront
                    onSelectCoach={handleSelectCoachFromStorefront}
                    selectedCoachId={undefined}
                    filterGymId={selectedGym?.id}
                  />
                )}

                {clientTab === 'passes' && (
                  <PassViewer onScanInReception={handleScanPassInReception} />
                )}
              </>
            )}
          </div>
        )}

        {/* ROLE: COACH (Featuring dual-mode: Business vs Book as Client) */}
        {role === 'coach' && (
          <div className="space-y-4">
            {/* Coach Dual Sub-Tab Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => {
                  setCoachSubMode('business');
                  setSelfBookingWarning(null);
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  coachSubMode === 'business'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>My Coaching Business</span>
              </button>
              <button
                onClick={() => {
                  setCoachSubMode('client');
                  setSelfBookingWarning(null);
                }}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  coachSubMode === 'client'
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                <span>Book as Client</span>
              </button>
            </div>

            {/* Sub-Mode 1: Coaching Business */}
            {coachSubMode === 'business' && (
              <div className="space-y-4">
                {coachTab === 'dashboard' && <CoachDashboard />}
                {coachTab === 'availability' && <AvailabilityManager />}
                {coachTab === 'payouts' && <PayoutSummary />}
              </div>
            )}

            {/* Sub-Mode 2: Book as Client (Embedded Client Discovery) */}
            {coachSubMode === 'client' && (
              <div className="space-y-4">
                {/* Coach Shopping Banner */}
                <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 text-xs text-sky-200 flex items-start gap-2.5 shadow-sm">
                  <ShoppingCart className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-white">Coach-as-Client Shopping Mode</div>
                    <div className="text-[11px] text-sky-300 mt-0.5">
                      Browse and book sessions with fellow Linz trainers for peer conditioning or professional development. Your trainer profile and business payouts are preserved.
                    </div>
                  </div>
                </div>

                {/* Self-booking protection alert */}
                {selfBookingWarning && (
                  <div className="bg-rose-950/40 border border-rose-500/40 rounded-xl p-3 text-xs text-rose-300 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{selfBookingWarning}</span>
                    </div>
                    <button
                      onClick={() => setSelfBookingWarning(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Embedded Client Flow */}
                {selectedCoach ? (
                  <AvailabilityPicker
                    coach={selectedCoach}
                    gym={selectedGym || undefined}
                    onProceedToCheckout={handleProceedToCheckout}
                    onBackToCoaches={() => setSelectedCoach(null)}
                  />
                ) : (
                  <>
                    {clientTab === 'gyms' && (
                      <GymDiscovery
                        onSelectGym={handleSelectGymFromDiscovery}
                        selectedGymId={selectedGym?.id}
                      />
                    )}

                    {clientTab === 'coaches' && (
                      <CoachStorefront
                        onSelectCoach={handleSelectCoachFromStorefront}
                        selectedCoachId={undefined}
                        filterGymId={selectedGym?.id}
                      />
                    )}

                    {clientTab === 'passes' && (
                      <PassViewer onScanInReception={handleScanPassInReception} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ROLE: PARTNER GYM (Scanner & Trainer Schedule) */}
        {(role === 'gym' || role === 'reception') && (
          <div className="space-y-4">
            {/* Gym Sub-Tab Switcher */}
            <div className="grid grid-cols-2 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setGymTab('scanner')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  gymTab === 'scanner'
                    ? 'bg-sky-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>QR Scanner</span>
              </button>
              <button
                onClick={() => setGymTab('schedule')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                  gymTab === 'schedule'
                    ? 'bg-sky-500 text-slate-950 font-bold shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Trainer Schedule</span>
              </button>
            </div>

            {/* Gym Tab 1: Dynamic QR Scanner & Live Fee Tally */}
            {gymTab === 'scanner' && (
              <div className="space-y-4">
                <ReceptionScanner />
                <LiveFeeTally />
              </div>
            )}

            {/* Gym Tab 2: Facility Trainer Schedule Board */}
            {gymTab === 'schedule' && <TrainerSchedule />}
          </div>
        )}

        {/* ROLE: PLATFORM MANAGER */}
        {role === 'manager' && (
          <div className="space-y-4">
            <PlatformManagerDashboard />
          </div>
        )}
      </div>

      {/* 1-Click Checkout Modal */}
      {checkoutData && (
        <CheckoutModal
          isOpen={isCheckoutOpen}
          onClose={() => setIsCheckoutOpen(false)}
          coach={checkoutData.coach}
          gym={checkoutData.gym}
          sessionTimeIso={checkoutData.sessionTimeIso}
          formattedDate={checkoutData.formattedDate}
          timeString={checkoutData.timeString}
          onSuccess={handleCheckoutSuccess}
        />
      )}

      {/* Bottom Thumb Navigation Bar */}
      {role !== 'manager' && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 max-w-[430px] mx-auto">
          {/* Client Bottom Tabs */}
          {role === 'client' && (
            <div className="grid grid-cols-3 py-2 px-3">
              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('gyms');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  clientTab === 'gyms' && !selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Partner Gyms</span>
              </button>

              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('coaches');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  clientTab === 'coaches' || selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Dumbbell className="w-4 h-4" />
                <span>Coaches</span>
              </button>

              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('passes');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors relative ${
                  clientTab === 'passes' && !selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <QrCode className="w-4 h-4" />
                  {unredeemedPassesCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-emerald-500 text-slate-950 text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center">
                      {unredeemedPassesCount}
                    </span>
                  )}
                </div>
                <span>My Passes</span>
              </button>
            </div>
          )}

          {/* Coach Business Bottom Tabs */}
          {role === 'coach' && coachSubMode === 'business' && (
            <div className="grid grid-cols-3 py-2 px-3">
              <button
                onClick={() => setCoachTab('dashboard')}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  coachTab === 'dashboard' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Sessions</span>
              </button>

              <button
                onClick={() => setCoachTab('availability')}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  coachTab === 'availability' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>Availability</span>
              </button>

              <button
                onClick={() => setCoachTab('payouts')}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  coachTab === 'payouts' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wallet className="w-4 h-4" />
                <span>Payouts</span>
              </button>
            </div>
          )}

          {/* Coach-as-Client Bottom Tabs */}
          {role === 'coach' && coachSubMode === 'client' && (
            <div className="grid grid-cols-3 py-2 px-3">
              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('gyms');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  clientTab === 'gyms' && !selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Building2 className="w-4 h-4" />
                <span>Partner Gyms</span>
              </button>

              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('coaches');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  clientTab === 'coaches' || selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Dumbbell className="w-4 h-4" />
                <span>Coaches</span>
              </button>

              <button
                onClick={() => {
                  setSelectedCoach(null);
                  setClientTab('passes');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors relative ${
                  clientTab === 'passes' && !selectedCoach
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <QrCode className="w-4 h-4" />
                  {unredeemedPassesCount > 0 && (
                    <span className="absolute -top-1 -right-2 bg-emerald-500 text-slate-950 text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center">
                      {unredeemedPassesCount}
                    </span>
                  )}
                </div>
                <span>My Passes</span>
              </button>
            </div>
          )}

          {/* Partner Gym / Reception Bottom Tabs */}
          {(role === 'gym' || role === 'reception') && (
            <div className="grid grid-cols-2 py-2 px-3">
              <button
                onClick={() => {
                  setGymTab('scanner');
                  setReceptionTab('scanner');
                }}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  gymTab === 'scanner' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ScanLine className="w-4 h-4" />
                <span>QR Scanner</span>
              </button>

              <button
                onClick={() => setGymTab('schedule')}
                className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                  gymTab === 'schedule' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>Trainer Schedule</span>
              </button>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}
