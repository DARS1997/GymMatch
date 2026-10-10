'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  Gym,
  CoachProfile,
  Booking,
  BookingStatus,
  CheckInPass,
} from '@/types/database';
import {
  LINZ_GYMS,
  LINZ_COACHES,
  LINZ_BOOKINGS,
  DEFAULT_PORTAL_BOOKINGS,
  LINZ_PASSES,
} from '@/lib/data/linz-seed';
import { calculateSplitPayment, eurToCents } from '@/lib/payments/split';
import { generateDynamicQRToken, DEFAULT_QR_SECRET } from '@/lib/qr/token';
import { redeemCheckInPass, RedemptionResult } from '@/lib/qr/validator';

export type UserRole = 'client' | 'coach' | 'gym' | 'manager' | 'reception';

export interface BookingCreationParams {
  coachId: string;
  gymId: string;
  sessionTimeIso: string;
  durationMinutes?: number;
  hourlyRateEur?: number;
  clientNotes?: string;
}

export interface RoleContextValue {
  role: UserRole;
  setRole: (role: UserRole) => void;
  coachSubMode: 'business' | 'client';
  setCoachSubMode: (mode: 'business' | 'client') => void;
  gyms: Gym[];
  coaches: CoachProfile[];
  bookings: Booking[];
  passes: CheckInPass[];
  activeClientId: string;
  activeCoachId: string;
  setActiveCoachId: (id: string) => void;
  receptionGymId: string;
  setReceptionGymId: (id: string) => void;
  createBooking: (params: BookingCreationParams) => { booking: Booking; pass: CheckInPass };
  redeemPass: (token: string, targetGymId?: string) => Promise<RedemptionResult>;
  updateBookingStatus: (bookingId: string, status: BookingStatus, reason?: string) => Promise<void>;
  refundBooking: (bookingId: string, reason?: string) => Promise<void>;
  isOffline: boolean;
  offlinePassesCount: number;
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

const STORAGE_KEY_BOOKINGS = 'gymmatch_linz_bookings';
const STORAGE_KEY_PASSES = 'gymmatch_linz_passes';

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRoleState] = useState<UserRole>('client');
  const [coachSubMode, setCoachSubMode] = useState<'business' | 'client'>('business');
  const [gyms] = useState<Gym[]>(LINZ_GYMS);
  const [coaches] = useState<CoachProfile[]>(LINZ_COACHES);
  const [activeClientId] = useState<string>('11111111-1111-1111-1111-000000000001'); // Max Mustermann
  const [activeCoachId, setActiveCoachId] = useState<string>('44444444-4444-4444-4444-000000000001'); // Lukas Bauer
  const [receptionGymId, setReceptionGymId] = useState<string>('00000000-0000-0000-0000-000000000001'); // John Harris Atrium
  const [bookings, setBookings] = useState<Booking[]>(DEFAULT_PORTAL_BOOKINGS);
  const [passes, setPasses] = useState<CheckInPass[]>(LINZ_PASSES);
  const [isOffline, setIsOffline] = useState<boolean>(false);

  const setRole = (newRole: UserRole) => {
    const normalizedRole: UserRole = newRole === 'reception' ? 'gym' : newRole;
    setRoleState(normalizedRole);
  };


  // Restore state from localStorage if available (Basement mode caching)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const savedBookings = localStorage.getItem(STORAGE_KEY_BOOKINGS);
        if (savedBookings) {
          const parsed = JSON.parse(savedBookings);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const savedIds = new Set(parsed.map((b: Booking) => b.id));
            const merged = [
              ...parsed,
              ...DEFAULT_PORTAL_BOOKINGS.filter((b) => !savedIds.has(b.id)),
            ];
            setBookings(merged);
          }
        }
        const savedPasses = localStorage.getItem(STORAGE_KEY_PASSES);
        if (savedPasses) {
          const parsed = JSON.parse(savedPasses);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPasses(parsed);
          }
        }
      } catch (err) {
        console.warn('Failed to load cached passes from localStorage:', err);
      }

      const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
      window.addEventListener('online', updateOnlineStatus);
      window.addEventListener('offline', updateOnlineStatus);
      setIsOffline(!navigator.onLine);

      return () => {
        window.removeEventListener('online', updateOnlineStatus);
        window.removeEventListener('offline', updateOnlineStatus);
      };
    }
  }, []);

  // Save changes to localStorage for offline retention
  const persistState = (newBookings: Booking[], newPasses: CheckInPass[]) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(newBookings));
        localStorage.setItem(STORAGE_KEY_PASSES, JSON.stringify(newPasses));
      } catch (err) {
        console.warn('Failed to persist passes to localStorage:', err);
      }
    }
  };

  const createBooking = (params: BookingCreationParams): { booking: Booking; pass: CheckInPass } => {
    const {
      coachId,
      gymId,
      sessionTimeIso,
      durationMinutes = 60,
      hourlyRateEur = 75.0,
      clientNotes = '',
    } = params;

    const grossCents = eurToCents(hourlyRateEur);
    const split = calculateSplitPayment({ grossAmountCents: grossCents });

    const newBookingId = `bk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newPassId = `pass_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const sessionEpoch = Math.floor(new Date(sessionTimeIso).getTime() / 1000);

    const dynamicToken = generateDynamicQRToken({
      passId: newPassId,
      bookingId: newBookingId,
      clientId: activeClientId,
      gymId: gymId,
      sessionTimeEpochSeconds: sessionEpoch,
      durationMinutes,
      secretKey: DEFAULT_QR_SECRET,
    });

    const signature = dynamicToken.split('.')[2] || 'sig_dynamic';
    const nonce = `nonce_${Math.random().toString(36).substring(2, 10)}`;

    const newBooking: Booking = {
      id: newBookingId,
      client_id: activeClientId,
      coach_id: coachId,
      gym_id: gymId,
      session_time: sessionTimeIso,
      duration_minutes: durationMinutes,
      gross_amount: hourlyRateEur,
      gym_floor_fee: split.gymFloorFeeCents / 100,
      platform_fee: split.platformFeeCents / 100,
      coach_payout: split.coachPayoutCents / 100,
      status: 'confirmed',
      client_notes: clientNotes,
      created_at: nowIso,
      updated_at: nowIso,
      stripe_payment_intent_id: `pi_sim_${Date.now()}`,
    };

    const newPass: CheckInPass = {
      id: newPassId,
      booking_id: newBookingId,
      gym_id: gymId,
      client_id: activeClientId,
      dynamic_token: dynamicToken,
      qr_signature: signature,
      nonce: nonce,
      expires_at: new Date((sessionEpoch + (durationMinutes * 60) + 1800) * 1000).toISOString(),
      is_redeemed: false,
      created_at: nowIso,
    };

    const nextBookings = [newBooking, ...bookings];
    const nextPasses = [newPass, ...passes];

    setBookings(nextBookings);
    setPasses(nextPasses);
    persistState(nextBookings, nextPasses);

    return { booking: newBooking, pass: newPass };
  };

  const redeemPass = async (token: string, targetGymId?: string): Promise<RedemptionResult> => {
    const gymIdToUse = targetGymId || receptionGymId;
    const staffUserId = `staff_${gymIdToUse.substring(0, 8)}`;
    let currentPassesState = [...passes];
    let currentBookingsState = [...bookings];

    const result = await redeemCheckInPass({
      token,
      staffGymId: gymIdToUse,
      staffUserId,
      secretKey: DEFAULT_QR_SECRET,
      dbAdapter: {
        findPassById: (passId: string) => {
          return currentPassesState.find((p) => p.id === passId) || null;
        },
        atomicRedeemPass: ({ passId, staffUserId: staffId, nowIso }) => {
          const passIndex = currentPassesState.findIndex((p) => p.id === passId);
          if (passIndex === -1) return false;
          if (currentPassesState[passIndex].is_redeemed) return false;

          const updatedPasses = [...currentPassesState];
          updatedPasses[passIndex] = {
            ...updatedPasses[passIndex],
            is_redeemed: true,
            redeemed_at: nowIso,
            redeemed_by_user_id: staffId,
          };
          currentPassesState = updatedPasses;
          setPasses(updatedPasses);
          persistState(currentBookingsState, updatedPasses);
          return true;
        },
        updateBookingStatus: (bookingId: string, status: 'checked_in') => {
          const bookingIndex = currentBookingsState.findIndex((b) => b.id === bookingId);
          if (bookingIndex === -1) return null;

          const updatedBookings = [...currentBookingsState];
          updatedBookings[bookingIndex] = {
            ...updatedBookings[bookingIndex],
            status,
            updated_at: new Date().toISOString(),
          };
          currentBookingsState = updatedBookings;
          setBookings(updatedBookings);
          persistState(updatedBookings, currentPassesState);
          return updatedBookings[bookingIndex];
        },
      },
    });

    return result;
  };

  const updateBookingStatus = async (
    bookingId: string,
    status: BookingStatus,
    reason?: string
  ): Promise<void> => {
    setBookings((prevBookings) => {
      const bookingIndex = prevBookings.findIndex((b) => b.id === bookingId);
      if (bookingIndex === -1) return prevBookings;

      const existing = prevBookings[bookingIndex];
      let gym_floor_fee = existing.gym_floor_fee;
      let platform_fee = existing.platform_fee;
      let coach_payout = existing.coach_payout;

      if (status === 'cancelled') {
        gym_floor_fee = 0;
        platform_fee = 0;
        coach_payout = 0;
      } else if (existing.status === 'cancelled') {
        // Re-allocating splits when reactivating a cancelled session
        const split = calculateSplitPayment({
          grossAmountCents: eurToCents(existing.gross_amount),
        });
        gym_floor_fee = split.gymFloorFeeCents / 100;
        platform_fee = split.platformFeeCents / 100;
        coach_payout = split.coachPayoutCents / 100;
      }

      const updatedBooking: Booking = {
        ...existing,
        status,
        gym_floor_fee,
        platform_fee,
        coach_payout,
        cancellation_reason: reason !== undefined ? reason : existing.cancellation_reason,
        updated_at: new Date().toISOString(),
      };

      const nextBookings = [...prevBookings];
      nextBookings[bookingIndex] = updatedBooking;
      persistState(nextBookings, passes);
      return nextBookings;
    });
  };

  const refundBooking = async (
    bookingId: string,
    reason?: string
  ): Promise<void> => {
    setBookings((prevBookings) => {
      const bookingIndex = prevBookings.findIndex((b) => b.id === bookingId);
      if (bookingIndex === -1) return prevBookings;

      const existing = prevBookings[bookingIndex];
      const updatedBooking: Booking = {
        ...existing,
        status: 'cancelled',
        gym_floor_fee: 0,
        platform_fee: 0,
        coach_payout: 0,
        cancellation_reason: reason || 'Administrative full refund issued by platform manager',
        updated_at: new Date().toISOString(),
      };

      const nextBookings = [...prevBookings];
      nextBookings[bookingIndex] = updatedBooking;
      persistState(nextBookings, passes);
      return nextBookings;
    });
  };

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole,
        coachSubMode,
        setCoachSubMode,
        gyms,
        coaches,
        bookings,
        passes,
        activeClientId,
        activeCoachId,
        setActiveCoachId,
        receptionGymId,
        setReceptionGymId,
        createBooking,
        redeemPass,
        updateBookingStatus,
        refundBooking,
        isOffline,
        offlinePassesCount: passes.length,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
};

export function useRole(): RoleContextValue {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error('useRole must be used within a RoleProvider');
  }
  return context;
}
