'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { CoachAvailability } from '@/types/database';
import { LINZ_AVAILABILITY } from '@/lib/data/linz-seed';
import { Calendar, Plus, Trash2, Clock, MapPin, CheckCircle2 } from 'lucide-react';

const DAYS_OF_WEEK = [
  { index: 1, name: 'Montag', short: 'MO' },
  { index: 2, name: 'Dienstag', short: 'DI' },
  { index: 3, name: 'Mittwoch', short: 'MI' },
  { index: 4, name: 'Donnerstag', short: 'DO' },
  { index: 5, name: 'Freitag', short: 'FR' },
  { index: 6, name: 'Samstag', short: 'SA' },
  { index: 0, name: 'Sonntag', short: 'SO' },
];

export const AvailabilityManager: React.FC = () => {
  const { activeCoachId, coaches, gyms } = useRole();
  const currentCoach = coaches.find((c) => c.id === activeCoachId) || coaches[0];

  const [availabilities, setAvailabilities] = useState<CoachAvailability[]>(LINZ_AVAILABILITY);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(1); // Monday default
  const [newStartTime, setNewStartTime] = useState<string>('10:00');
  const [newEndTime, setNewEndTime] = useState<string>('11:00');
  const [newGymId, setNewGymId] = useState<string>(gyms[0]?.id || '');
  const [isAdding, setIsAdding] = useState<boolean>(false);

  const coachSlots = availabilities.filter((a) => a.coach_id === currentCoach.id);
  const currentDaySlots = coachSlots.filter((a) => a.day_of_week === selectedDayIndex);

  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    const newSlot: CoachAvailability = {
      id: `slot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      coach_id: currentCoach.id,
      gym_id: newGymId,
      day_of_week: selectedDayIndex,
      start_time: `${newStartTime}:00`,
      end_time: `${newEndTime}:00`,
      is_recurring: true,
      is_booked: false,
      created_at: new Date().toISOString(),
    };

    setAvailabilities([...availabilities, newSlot]);
    setIsAdding(false);
  };

  const handleDeleteSlot = (slotId: string) => {
    setAvailabilities(availabilities.filter((a) => a.id !== slotId));
  };

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-base">Weekly Schedule</h3>
            <p className="text-xs text-slate-400">
              Manage booking slots for <strong>{currentCoach.full_name}</strong>
            </p>
          </div>
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Slot</span>
          </button>
        </div>
      </div>

      {/* Add Slot Drawer / Form */}
      {isAdding && (
        <form
          onSubmit={handleAddSlot}
          className="bg-slate-900 rounded-2xl p-4 border border-emerald-500/50 space-y-3 animate-in fade-in"
        >
          <div className="font-bold text-xs text-white">Add New Availability Window</div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={newStartTime}
                onChange={(e) => setNewStartTime(e.target.value)}
                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono font-medium focus:outline-none focus:border-emerald-500"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                End Time
              </label>
              <input
                type="time"
                value={newEndTime}
                onChange={(e) => setNewEndTime(e.target.value)}
                className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-mono font-medium focus:outline-none focus:border-emerald-500"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Linz Partner Gym
            </label>
            <select
              value={newGymId}
              onChange={(e) => setNewGymId(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-medium focus:outline-none focus:border-emerald-500"
            >
              {gyms.map((g) => (
                <option key={g.id} value={g.id} className="bg-white text-slate-900">
                  {g.name} ({g.postal_code} Linz)
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2 rounded-xl text-xs"
            >
              Save Slot
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Weekday Switcher Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar text-xs">
        {DAYS_OF_WEEK.map((day) => {
          const isSelected = selectedDayIndex === day.index;
          const count = coachSlots.filter((s) => s.day_of_week === day.index).length;

          return (
            <button
              key={day.index}
              onClick={() => setSelectedDayIndex(day.index)}
              className={`flex-1 min-w-[50px] py-2 px-1 rounded-xl font-semibold transition-all flex flex-col items-center ${
                isSelected
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>{day.short}</span>
              <span
                className={`text-[9px] px-1 rounded-full mt-0.5 ${
                  isSelected ? 'bg-slate-950 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Slots List for Selected Day */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-300 px-1 flex items-center justify-between">
          <span>
            {DAYS_OF_WEEK.find((d) => d.index === selectedDayIndex)?.name} ({currentDaySlots.length}{' '}
            slots)
          </span>
          <span className="text-[10px] text-slate-400">Recurring Weekly</span>
        </div>

        {currentDaySlots.length === 0 ? (
          <div className="bg-slate-900 rounded-2xl p-6 text-center border border-slate-800 text-xs text-slate-400">
            No availability configured for this day. Tap &ldquo;Add Slot&rdquo; above to link a Linz gym!
          </div>
        ) : (
          <div className="space-y-2">
            {currentDaySlots.map((slot) => {
              const gym = gyms.find((g) => g.id === slot.gym_id);
              const formatTime = (t: string) => t.substring(0, 5);

              return (
                <div
                  key={slot.id}
                  className="bg-slate-900 rounded-xl p-3 border border-slate-800 flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
                      </span>

                      {slot.is_booked ? (
                        <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                          Booked
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                          Available
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-sky-400" />
                      {gym?.name || 'Partner Gym'}
                    </div>
                  </div>

                  {!slot.is_booked && (
                    <button
                      onClick={() => handleDeleteSlot(slot.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-lg transition-colors"
                      title="Remove slot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
