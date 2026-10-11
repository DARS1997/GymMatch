'use client';

import React from 'react';
import { useRole, UserRole } from '@/context/RoleContext';
import { User, Dumbbell, Building2, Wrench } from 'lucide-react';

export const RoleSwitcher: React.FC = () => {
  const { role, setRole, receptionGymId, setReceptionGymId, gyms } = useRole();

  const roles: { id: UserRole; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'client', label: 'Client', icon: User },
    { id: 'coach', label: 'Coach', icon: Dumbbell },
    { id: 'gym', label: 'Partner Gym', icon: Building2 },
    { id: 'manager', label: 'Platform Manager', icon: Wrench },
  ];

  return (
    <div className="sticky top-[49px] z-30 bg-slate-950/90 backdrop-blur-md px-2 sm:px-4 py-2 border-b border-slate-800/80">
      {/* 4-way Segmented Control Pill */}
      <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
        {roles.map((r) => {
          const Icon = r.icon;
          const isActive = role === r.id || (r.id === 'gym' && role === 'reception');
          return (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 py-1.5 px-1 rounded-lg text-[10px] sm:text-xs font-semibold transition-all duration-150 leading-tight text-center ${
                isActive
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
              <span className="truncate sm:whitespace-nowrap">{r.label}</span>
            </button>
          );
        })}
      </div>

      {/* Gym Selector Bar for Partner Gym Role */}
      {(role === 'gym' || role === 'reception') && (
        <div className="mt-2 flex items-center justify-between text-xs bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
          <span className="text-slate-400 font-medium flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-sky-400" />
            Desk:
          </span>
          <select
            value={receptionGymId}
            onChange={(e) => setReceptionGymId(e.target.value)}
            className="bg-white text-slate-900 border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-emerald-500 font-medium"
          >
            {gyms.map((g) => (
              <option key={g.id} value={g.id} className="bg-white text-slate-900">
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

