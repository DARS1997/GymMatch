'use client';

import React from 'react';
import { useRole } from '@/context/RoleContext';
import { WifiOff, MapPin } from 'lucide-react';

export interface MobileContainerProps {
  children: React.ReactNode;
}

export const MobileContainer: React.FC<MobileContainerProps> = ({ children }) => {
  const { isOffline } = useRole();

  return (
    <div className="min-h-screen bg-slate-950 flex justify-center items-start selection:bg-emerald-500 selection:text-slate-950">
      {/* 390px - 430px smartphone form-factor container */}
      <div className="w-full max-w-[430px] min-h-screen bg-slate-900/95 text-slate-100 flex flex-col shadow-2xl relative border-x border-slate-800/80 overflow-x-hidden">
        {/* Offline indicator banner */}
        {isOffline && (
          <div className="bg-amber-600 text-white text-xs px-3 py-1.5 flex items-center justify-center gap-1.5 font-medium sticky top-0 z-50">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline Mode: Local check-in passes remain accessible</span>
          </div>
        )}

        {/* Linz Brand Header Bar */}
        <header className="px-4 py-2.5 bg-slate-950/80 backdrop-blur border-b border-slate-800/60 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-slate-950 text-sm shadow-md">
              GM
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-base">GymMatch</span>
              <span className="text-emerald-400 font-semibold text-xs ml-1.5">Linz</span>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/50">
            <MapPin className="w-3 h-3 text-emerald-400" />
            <span>Linz, OÖ</span>
          </div>
        </header>

        {/* Main role & application content */}
        <main className="flex-1 flex flex-col relative pb-16">{children}</main>
      </div>
    </div>
  );
};
