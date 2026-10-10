'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { Gym } from '@/types/database';
import { Search, MapPin, Phone, Mail, CheckCircle2, Dumbbell } from 'lucide-react';

interface GymDiscoveryProps {
  onSelectGym?: (gym: Gym) => void;
  selectedGymId?: string;
}

export const GymDiscovery: React.FC<GymDiscoveryProps> = ({ onSelectGym, selectedGymId }) => {
  const { gyms } = useRole();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPostal, setSelectedPostal] = useState<string>('all');

  const filteredGyms = gyms.filter((gym) => {
    const matchesSearch =
      gym.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      gym.address.toLowerCase().includes(searchTerm.toLowerCase()) ||
      gym.amenities.some((a) => a.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesPostal = selectedPostal === 'all' || gym.postal_code === selectedPostal;

    return matchesSearch && matchesPostal;
  });

  return (
    <div className="space-y-4">
      {/* Search and District Filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search gym, equipment or district..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar text-[11px]">
          <button
            onClick={() => setSelectedPostal('all')}
            className={`px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
              selectedPostal === 'all'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            All Linz ({gyms.length})
          </button>
          <button
            onClick={() => setSelectedPostal('4020')}
            className={`px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
              selectedPostal === '4020'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Linz Zentrum (4020)
          </button>
          <button
            onClick={() => setSelectedPostal('4040')}
            className={`px-3 py-1 rounded-full font-medium transition-colors whitespace-nowrap ${
              selectedPostal === '4040'
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Linz Urfahr (4040)
          </button>
        </div>
      </div>

      {/* Gym Cards List */}
      <div className="space-y-3.5">
        {filteredGyms.map((gym) => {
          const isSelected = selectedGymId === gym.id;

          return (
            <div
              key={gym.id}
              className={`bg-slate-900 rounded-2xl overflow-hidden border transition-all duration-200 ${
                isSelected
                  ? 'border-emerald-500 ring-1 ring-emerald-500/50 shadow-lg shadow-emerald-500/10'
                  : 'border-slate-800/80 hover:border-slate-700'
              }`}
            >
              {/* Gym Image Banner */}
              <div className="relative h-32 w-full bg-slate-950 overflow-hidden">
                <img
                  src={gym.hero_image_url || gym.image_url || ''}
                  alt={gym.name}
                  className="w-full h-full object-cover opacity-80 hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />

                {/* Guaranteed Floor Fee Badge */}
                <div className="absolute top-2.5 right-2.5 bg-slate-950/90 backdrop-blur-md text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1 shadow-sm">
                  <span>€{gym.floor_fee.toFixed(2)} Floor Fee</span>
                </div>

                {/* District Tag */}
                <div className="absolute bottom-2 left-3 flex items-center gap-1 text-[11px] font-medium text-slate-300 bg-slate-950/70 backdrop-blur-sm px-2 py-0.5 rounded-md">
                  <MapPin className="w-3 h-3 text-emerald-400" />
                  <span>
                    {gym.postal_code} {gym.city}
                  </span>
                </div>
              </div>

              {/* Gym Details */}
              <div className="p-3.5 space-y-3">
                <div>
                  <h3 className="font-bold text-white text-base leading-snug">{gym.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{gym.address}</p>
                </div>

                {/* Amenities pills */}
                <div className="flex flex-wrap gap-1">
                  {gym.amenities.map((amenity, i) => (
                    <span
                      key={i}
                      className="text-[10px] bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700/50 font-medium"
                    >
                      {amenity}
                    </span>
                  ))}
                </div>

                {/* Contacts & Action */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3 text-slate-500" />
                      {gym.contact_phone}
                    </span>
                  </div>

                  <button
                    onClick={() => onSelectGym && onSelectGym(gym)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
                    }`}
                  >
                    {isSelected ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Selected
                      </>
                    ) : (
                      <>
                        <Dumbbell className="w-3.5 h-3.5" />
                        Choose Venue
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredGyms.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-xs">
            No partner fitness centers found matching &ldquo;{searchTerm}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
};
