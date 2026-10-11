'use client';

import React, { useState } from 'react';
import { useRole } from '@/context/RoleContext';
import { X, KeyRound, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { RedemptionResult } from '@/lib/qr/validator';

interface ManualRedeemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRedeemCompleted: (result: RedemptionResult) => void;
}

export const ManualRedeemModal: React.FC<ManualRedeemModalProps> = ({
  isOpen,
  onClose,
  onRedeemCompleted,
}) => {
  const { redeemPass, receptionGymId, gyms } = useRole();
  const currentGym = gyms.find((g) => g.id === receptionGymId) || gyms[0];

  const [inputToken, setInputToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await redeemPass(inputToken.trim(), currentGym.id);
      setIsSubmitting(false);

      if (result.success) {
        onRedeemCompleted(result);
        onClose();
      } else {
        setErrorMsg(result.error || 'Failed to redeem pass token.');
      }
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'Error occurred while verifying token.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl relative animate-in fade-in">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-white text-sm">Manual Code Entry</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Check-In Pass Token or GM1 String
            </label>
            <textarea
              rows={3}
              placeholder="Paste GM1.<payload>.<sig> token..."
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="w-full bg-white text-slate-900 border border-slate-300 rounded-xl p-2.5 text-xs font-mono font-medium focus:outline-none focus:border-sky-500 placeholder:text-slate-500"
              required
            />
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
            Scanning for venue: <strong className="text-slate-200">{currentGym.name}</strong>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !inputToken.trim()}
              className="flex-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Validate & Check In</span>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
