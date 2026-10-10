'use client';

import React, { useState } from 'react';
import { PlatformKpiCards } from './PlatformKpiCards';
import { DisputeResolutionTable } from './DisputeResolutionTable';
import { TokenInspector } from './TokenInspector';
import { LayoutDashboard, Scale, Search, ShieldCheck } from 'lucide-react';

export const PlatformManagerDashboard: React.FC = () => {
  const [managerTab, setManagerTab] = useState<'overview' | 'disputes' | 'diagnostics'>('overview');

  const tabs: {
    id: 'overview' | 'disputes' | 'diagnostics';
    label: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'overview', label: 'Overview & KPIs', icon: LayoutDashboard },
    { id: 'disputes', label: 'Disputes & Overrides', icon: Scale },
    { id: 'diagnostics', label: 'Token Diagnostics', icon: Search },
  ];

  return (
    <div className="space-y-4">
      {/* Console Header */}
      <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 shadow-sm flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-semibold mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Platform Supervisor & Tech Support</span>
          </div>
          <h1 className="text-xl font-black text-white tracking-tight">GymMatch Console</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Linz Platform Oversight • Dispute Resolution • Cryptographic Diagnostics
          </p>
        </div>
      </div>

      {/* Sub-Tabs Switcher */}
      <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          const isActive = managerTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setManagerTab(t.id)}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all duration-150 leading-tight text-center ${
                isActive
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {managerTab === 'overview' && <PlatformKpiCards />}
        {managerTab === 'disputes' && <DisputeResolutionTable />}
        {managerTab === 'diagnostics' && <TokenInspector />}
      </div>
    </div>
  );
};
