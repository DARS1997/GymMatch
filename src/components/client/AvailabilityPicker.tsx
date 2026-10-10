'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { CoachProfile, Gym } from '@/types/database';
import { Calendar, Clock, Sun, Sunset, Moon, Check, ChevronRight } from 'lucide-react';

interface AvailabilityPickerProps {
  coach: CoachProfile;
  gym?: Gym;
  onProceedToCheckout: (slotData: {
    coach: CoachProfile;
    gym: Gym;
    sessionTimeIso: string;
    formattedDate: string;
    timeString: string;
  }) => void;
  onBackToCoaches?: () => void;
}

export const AvailabilityPicker: React.FC<AvailabilityPickerProps> = ({
  coach,
  gym: propGym,
  onProceedToCheckout,
  onBackToCoaches,
}) => {
  const { gyms } = useRole();

  // Selected Gym (default to prop or first gym)
  const [selectedGymId, setSelectedGymId] = useState<string>(
    propGym?.id || gyms[0]?.id || '00000000-0000-0000-0000-000000000001'
  );

  const activeGym = gyms.find((g) => g.id === selectedGymId) || gyms[0];

  // 7-day calendar window starting today
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(0);
  const selectedDate = weekDays[selectedDayIndex];

  // Mock slot schedule with morning, afternoon, evening slots
  const allSlotTimes = [
    { time: '08:00', label: '08:00 – 09:00', period: 'morning', booked: false },
    { time: '09:30', label: '09:30 – 10:30', period: 'morning', booked: selectedDayIndex === 0 },
    { time: '11:00', label: '11:00 – 12:00', period: 'morning', booked: false },
    { time: '14:00', label: '14:00 – 15:00', period: 'afternoon', booked: false },
    { time: '15:30', label: '15:30 – 16:30', period: 'afternoon', booked: false },
    { time: '17:00', label: '17:00 – 18:00', period: 'evening', booked: selectedDayIndex === 1 },
    { time: '18:30', label: '18:30 – 19:30', period: 'evening', booked: false },
  ];

  const [selectedSlotTime, setSelectedSlotTime] = useState<string>('14:00');

  // Format date helper (German / Linz locale)
  const formatDayName = (d: Date) => {
    return d.toLocaleDateString('de-AT', { weekday: 'short' }).toUpperCase();
  };

  const handleConfirm = () => {
    if (!selectedSlotTime) return;

    const [hours, minutes] = selectedSlotTime.split(':').map(Number);
    const sessionDate = new Date(selectedDate);
    sessionDate.setHours(hours, minutes, 0, 0);

    const formattedDate = sessionDate.toLocaleDateString('de-AT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    onProceedToCheckout({
      coach,
      gym: activeGym,
      sessionTimeIso: sessionDate.toISOString(),
      formattedDate,
      timeString: selectedSlotTime,
    });
  };

  return (
    <div className="space-y-4">
      {/* Top Coach Banner */}
      <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={coach.avatar_url || ''}
            alt={coach.full_name}
            className="w-10 h-10 rounded-xl object-cover border border-slate-700"
          />
          <div>
            <h4 className="font-bold text-white text-sm">{coach.full_name}</h4>
            <p className="text-[11px] text-emerald-400 font-medium">
              €{coach.hourly_rate.toFixed(2)} / session
            </p>
          </div>
        </div>

        {onBackToCoaches && (
          <button
            onClick={onBackToCoaches}
            className="text-xs text-slate-400 hover:text-slate-200 underline"
          >
            Change
          </button>
        )}
      </div>

      {/* Linz Venue Selector */}
      <div className="bg-slate-900 rounded-2xl p-3 border border-slate-800 space-y-1.5">
        <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
          Select Partner Gym in Linz
        </label>
        <select
          value={selectedGymId}
          onChange={(e) => setSelectedGymId(e.target.value)}
          className="w-full bg-slate-950 text-slate-100 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:border-emerald-500"
        >
          {gyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.postal_code} Linz) — €8.00 Floor Fee
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-400">
          📍 {activeGym.address}, {activeGym.postal_code} Linz
        </p>
      </div>

      {/* Horizontal 7-Day Calendar Strip */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs px-1">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            Select Date
          </span>
          <span className="text-[11px] text-slate-400">
            {selectedDate.toLocaleDateString('de-AT', { month: 'short', year: 'numeric' })}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {weekDays.map((d, index) => {
            const isSelected = selectedDayIndex === index;
            const isToday = index === 0;

            return (
              <button
                key={index}
                onClick={() => setSelectedDayIndex(index)}
                className={`flex-1 min-w-[50px] py-2.5 px-1 rounded-xl flex flex-col items-center justify-center transition-all ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-md scale-105'
                    : 'bg-slate-900 text-slate-300 hover:bg-slate-850 border border-slate-800'
                }`}
              >
                <span className={`text-[10px] font-medium ${isSelected ? 'text-slate-950' : 'text-slate-400'}`}>
                  {isToday ? 'HEUTE' : formatDayName(d)}
                </span>
                <span className="text-base font-black my-0.5">{d.getDate()}</span>
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    isSelected ? 'bg-slate-950' : 'bg-emerald-400'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Time Slot Groups */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 px-1">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          Available Slots
        </div>

        {/* Morning */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-1">
            <Sun className="w-3 h-3 text-amber-400" />
            Morning (08:00 – 12:00)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {allSlotTimes
              .filter((s) => s.period === 'morning')
              .map((slot) => {
                const isSelected = selectedSlotTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    disabled={slot.booked}
                    onClick={() => setSelectedSlotTime(slot.time)}
                    className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all border ${
                      slot.booked
                        ? 'bg-slate-900/40 text-slate-600 border-slate-800/40 line-through cursor-not-allowed'
                        : isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm font-bold'
                        : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {slot.time}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Afternoon */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-1">
            <Sunset className="w-3 h-3 text-orange-400" />
            Afternoon (12:00 – 17:00)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {allSlotTimes
              .filter((s) => s.period === 'afternoon')
              .map((slot) => {
                const isSelected = selectedSlotTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    disabled={slot.booked}
                    onClick={() => setSelectedSlotTime(slot.time)}
                    className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all border ${
                      slot.booked
                        ? 'bg-slate-900/40 text-slate-600 border-slate-800/40 line-through cursor-not-allowed'
                        : isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm font-bold'
                        : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {slot.time}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Evening */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 px-1">
            <Moon className="w-3 h-3 text-indigo-400" />
            Evening (17:00 – 21:00)
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {allSlotTimes
              .filter((s) => s.period === 'evening')
              .map((slot) => {
                const isSelected = selectedSlotTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    disabled={slot.booked}
                    onClick={() => setSelectedSlotTime(slot.time)}
                    className={`py-2 px-1 rounded-xl text-xs font-semibold transition-all border ${
                      slot.booked
                        ? 'bg-slate-900/40 text-slate-600 border-slate-800/40 line-through cursor-not-allowed'
                        : isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm font-bold'
                        : 'bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {slot.time}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Bar */}
      <div className="pt-3 border-t border-slate-800/80">
        <button
          onClick={handleConfirm}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 px-4 rounded-xl text-sm shadow-lg shadow-emerald-500/20 flex items-center justify-between transition-all"
        >
          <div className="text-left">
            <div className="text-[11px] text-slate-900 font-semibold">
              {formatDayName(selectedDate)}, {selectedDate.getDate()}. {selectedSlotTime}
            </div>
            <div className="text-sm font-black">€{coach.hourly_rate.toFixed(2)} Total</div>
          </div>
          <div className="flex items-center gap-1 text-xs font-black uppercase tracking-wide">
            <span>Continue</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </button>
      </div>
    </div>
  );
};
