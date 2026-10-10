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
} from 'lucide-react';

export default function Home() {
  const { role, setRole, setReceptionGymId, passes } = useRole();

  // Client Tab Navigation: 'gyms' | 'coaches' | 'passes'
  const [clientTab, setClientTab] = useState<'gyms' | 'coaches' | 'passes'>('gyms');
  // Coach Tab Navigation: 'dashboard' | 'availability' | 'payouts'
  const [coachTab, setCoachTab] = useState<'dashboard' | 'availability' | 'payouts'>('dashboard');
  // Reception Tab Navigation: 'scanner' | 'tally'
  const [receptionTab, setReceptionTab] = useState<'scanner' | 'tally'>('scanner');

  // Booking Flow active states
  const [selectedCoach, setSelectedCoach] = useState<CoachProfile | null>(null);
  const [selectedGym, setSelectedGym] = useState<Gym | null>(null);
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
    setRole('reception');
    setReceptionTab('scanner');
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Pinned 3-Role Switcher */}
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

        {/* ROLE: COACH */}
        {role === 'coach' && (
          <div className="space-y-4">
            {coachTab === 'dashboard' && <CoachDashboard />}
            {coachTab === 'availability' && <AvailabilityManager />}
            {coachTab === 'payouts' && <PayoutSummary />}
          </div>
        )}

        {/* ROLE: RECEPTION */}
        {role === 'reception' && (
          <div className="space-y-4">
            {receptionTab === 'scanner' && <ReceptionScanner />}
            {receptionTab === 'tally' && <LiveFeeTally />}
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

        {/* Coach Bottom Tabs */}
        {role === 'coach' && (
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

        {/* Reception Bottom Tabs */}
        {role === 'reception' && (
          <div className="grid grid-cols-2 py-2 px-3">
            <button
              onClick={() => setReceptionTab('scanner')}
              className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                receptionTab === 'scanner' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ScanLine className="w-4 h-4" />
              <span>QR Scanner</span>
            </button>

            <button
              onClick={() => setReceptionTab('tally')}
              className={`flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-semibold transition-colors ${
                receptionTab === 'tally' ? 'text-sky-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Floor Fee Tally</span>
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}
