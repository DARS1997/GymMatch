'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { CoachProfile } from '@/types/database';
import { Star, Award, Dumbbell, ChevronRight, CheckCircle2 } from 'lucide-react';
import { LINZ_AFFILIATIONS } from '@/lib/data/linz-seed';

interface CoachStorefrontProps {
  onSelectCoach?: (coach: CoachProfile) => void;
  selectedCoachId?: string;
  filterGymId?: string;
}

export const CoachStorefront: React.FC<CoachStorefrontProps> = ({
  onSelectCoach,
  selectedCoachId,
  filterGymId,
}) => {
  const { coaches, gyms } = useRole();
  const [selectedSpecialty, setSelectedSpecialty] = useState<string>('all');

  // Extract all unique specialties
  const allSpecialties = Array.from(new Set(coaches.flatMap((c) => c.specialties)));

  const filteredCoaches = coaches.filter((coach) => {
    // If filterGymId is provided, check if coach is affiliated with that gym
    if (filterGymId) {
      const isAffiliated = LINZ_AFFILIATIONS.some(
        (aff) => aff.coach_id === coach.id && aff.gym_id === filterGymId && aff.is_verified
      );
      if (!isAffiliated) return false;
    }

    if (selectedSpecialty !== 'all' && !coach.specialties.includes(selectedSpecialty)) {
      return false;
    }

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Specialty Filter Chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
        <button
          onClick={() => setSelectedSpecialty('all')}
          className={`px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
            selectedSpecialty === 'all'
              ? 'bg-emerald-500 text-slate-950 font-semibold'
              : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          All Specialties ({coaches.length})
        </button>
        {allSpecialties.map((spec) => (
          <button
            key={spec}
            onClick={() => setSelectedSpecialty(spec)}
            className={`px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
              selectedSpecialty === spec
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {spec}
          </button>
        ))}
      </div>

      {/* Coach Cards */}
      <div className="space-y-3.5">
        {filteredCoaches.map((coach) => {
          const isSelected = selectedCoachId === coach.id;

          // Find affiliated gyms
          const coachAffiliations = LINZ_AFFILIATIONS.filter(
            (aff) => aff.coach_id === coach.id && aff.is_verified
          );
          const affiliatedGyms = gyms.filter((g) =>
            coachAffiliations.some((aff) => aff.gym_id === g.id)
          );

          return (
            <div
              key={coach.id}
              className={`bg-slate-900 rounded-2xl p-4 border transition-all duration-200 ${
                isSelected
                  ? 'border-emerald-500 ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-500/10'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Header: Avatar, Name, Rating & Hourly Rate */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={coach.avatar_url || ''}
                      alt={coach.full_name}
                      className="w-13 h-13 rounded-xl object-cover border border-slate-700/80"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-slate-950 p-0.5 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-white text-base leading-tight">
                      {coach.full_name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1 text-xs">
                      <div className="flex items-center text-amber-400 font-semibold">
                        <Star className="w-3 h-3 fill-amber-400 mr-0.5" />
                        <span>{coach.rating.toFixed(2)}</span>
                      </div>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400 text-[11px]">
                        ({coach.review_count} reviews)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Transparent Rate Box */}
                <div className="text-right">
                  <div className="text-base font-black text-emerald-400 leading-tight">
                    €{coach.hourly_rate.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium">per 60m session</div>
                  <div className="text-[9px] text-sky-400/90 font-medium">incl. gym entry</div>
                </div>
              </div>

              {/* Bio summary */}
              <p className="text-xs text-slate-300 mt-3 line-clamp-2 leading-relaxed">
                {coach.bio}
              </p>

              {/* Certifications & Specialties */}
              <div className="mt-3 space-y-1.5">
                <div className="flex flex-wrap gap-1">
                  {coach.specialties.map((spec, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-md font-medium"
                    >
                      {spec}
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Award className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="truncate">{coach.certifications.join(' • ')}</span>
                </div>
              </div>

              {/* Affiliated Linz Gyms */}
              <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Dumbbell className="w-3 h-3 text-sky-400" />
                  Affiliated Linz Gyms
                </div>
                <div className="flex flex-wrap gap-1">
                  {affiliatedGyms.map((gym) => (
                    <span
                      key={gym.id}
                      className="text-[10px] bg-slate-800/90 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700/60 font-medium"
                    >
                      📍 {gym.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-3.5 pt-2 border-t border-slate-800/60 flex justify-end">
                <button
                  onClick={() => onSelectCoach && onSelectCoach(coach)}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 shadow-md'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-sm'
                  }`}
                >
                  <span>Select & View Schedule</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {filteredCoaches.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No certified coaches found for selected filters.
          </div>
        )}
      </div>
    </div>
  );
};
