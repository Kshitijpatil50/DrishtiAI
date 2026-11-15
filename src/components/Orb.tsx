/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppState } from '../state/machine';

interface OrbProps {
  state: AppState;
  rms?: number; // Optional fallback RMS volume level
  orbRef?: React.RefObject<HTMLDivElement | null>; // Direct DOM ref setting --orb-rms (0..1)
}

export const Orb: React.FC<OrbProps> = ({ state, rms = 0, orbRef }) => {
  // Determine state display label
  let label = 'OBSERVING';
  if (state === 'LISTENING') label = 'LISTENING';
  else if (state === 'THINKING' || state === 'TRANSCRIBING') label = 'THINKING';
  else if (state === 'SPEAKING') label = 'SPEAKING';
  else if (state === 'QUIET') label = 'QUIET';

  return (
    <div
      ref={orbRef}
      className="flex flex-col items-center justify-center select-none py-1"
      style={{ '--orb-rms': String(rms) } as React.CSSProperties}
      aria-hidden="true"
    >
      {/* 92px Orb Container */}
      <div
        className="relative flex items-center justify-center w-[92px] h-[92px]"
        style={{
          transform:
            state === 'LISTENING'
              ? 'scale(min(1.28, calc(1 + var(--orb-rms, 0) * 3.5)))'
              : 'scale(1)',
          transition: 'transform 0.1s ease-out',
        }}
      >
        {/* Outer Ring / Aura */}
        <div
          className={`absolute inset-0 rounded-full transition-all duration-300 ${
            state === 'LISTENING'
              ? 'ring-4 ring-[#2F3BE0] ring-offset-2 scale-105 opacity-90'
              : state === 'THINKING' || state === 'TRANSCRIBING'
              ? 'bg-gradient-to-tr from-[#3898EC]/40 to-[#0082F3]/30 animate-orb-shimmer'
              : state === 'SPEAKING'
              ? 'bg-[#FFB98A]/30 animate-orb-pulse scale-110'
              : state === 'OBSERVING'
              ? 'bg-[#FFE3CF]/50 animate-orb-breathe'
              : 'bg-[#E6E6E6]/40 opacity-40'
          }`}
        />

        {/* Middle Concentric Circle */}
        <div
          className={`absolute w-[72px] h-[72px] rounded-full transition-all duration-300 shadow-sm ${
            state === 'QUIET'
              ? 'bg-[#E6E6E6]'
              : state === 'THINKING' || state === 'TRANSCRIBING'
              ? 'bg-gradient-to-br from-[#3898EC] to-[#0082F3] opacity-80'
              : 'bg-gradient-to-br from-[#FFE3CF] to-[#FFB98A]'
          } ${
            state === 'SPEAKING'
              ? 'animate-orb-pulse'
              : state === 'OBSERVING'
              ? 'animate-orb-breathe'
              : ''
          }`}
        />

        {/* Inner Core */}
        <div
          className={`relative w-[52px] h-[52px] rounded-full flex items-center justify-center transition-all duration-300 ${
            state === 'QUIET'
              ? 'bg-[#D1D5DB]'
              : state === 'THINKING' || state === 'TRANSCRIBING'
              ? 'bg-white/90'
              : 'bg-white/80'
          }`}
        >
          {/* Animated Waveform Representation */}
          {state === 'LISTENING' ? (
            <div className="flex items-center gap-[3px] h-5">
              {[0.4, 0.9, 0.6, 1.0, 0.5].map((h, i) => (
                <span
                  key={i}
                  className="w-[3px] bg-[#2F3BE0] rounded-full transition-[height] duration-75"
                  style={{
                    height: `clamp(5px, calc((var(--orb-rms, 0) * 100px + 5px) * ${h}), 20px)`,
                  }}
                />
              ))}
            </div>
          ) : state === 'SPEAKING' ? (
            <div className="flex items-center gap-[3px] h-5">
              <span className="w-[3px] h-3.5 bg-[#FF8000] rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-[3px] h-5 bg-[#FF6A00] rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-[3px] h-2.5 bg-[#FF8000] rounded-full animate-bounce" />
            </div>
          ) : state === 'THINKING' || state === 'TRANSCRIBING' ? (
            <div className="w-4 h-4 border-2 border-[#0082F3] border-t-transparent rounded-full animate-spin" />
          ) : state === 'OBSERVING' ? (
            <div className="w-2.5 h-2.5 rounded-full bg-[#FFB98A] animate-ping opacity-60" />
          ) : (
            <div className="w-2.5 h-2.5 rounded-full bg-[#9CA3AF]" />
          )}
        </div>
      </div>

      {/* One-word uppercase 12px label beneath */}
      <span
        className={`mt-2 text-[11px] font-semibold tracking-wider uppercase transition-colors duration-300 ${
          state === 'LISTENING'
            ? 'text-[#2F3BE0]'
            : state === 'THINKING' || state === 'TRANSCRIBING'
            ? 'text-[#0082F3]'
            : state === 'SPEAKING'
            ? 'text-[#E06000]'
            : state === 'QUIET'
            ? 'text-[#6B7280]'
            : 'text-[#4B5563]'
        }`}
      >
        {label}
      </span>
    </div>
  );
};
