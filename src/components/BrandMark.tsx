import React from 'react';
import type { TrafficLightStatus } from '../../shared/types';

export function BrandMark({
  size = 38,
  variant = 'sage',
}: {
  size?: number;
  variant?: 'sage' | 'linen';
}) {
  const isSage = variant === 'sage';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        width="512"
        height="512"
        rx="124"
        fill={isSage ? '#4A6759' : 'rgba(248, 246, 242, 0.14)'}
        stroke={isSage ? 'none' : 'rgba(248, 246, 242, 0.28)'}
        strokeWidth={isSage ? 0 : 12}
      />
      <circle
        cx="256"
        cy="256"
        r="168"
        stroke="#F8F6F2"
        strokeOpacity="0.22"
        strokeWidth="8"
      />
      <path
        d="M148 324C178 214 236 156 320 156C352 156 374 176 374 204C374 248 314 282 232 296C190 303 162 326 154 356"
        stroke="#F8F6F2"
        strokeWidth="24"
        strokeLinecap="round"
      />
      <path
        d="M196 356C236 334 292 326 356 340"
        stroke="#E5C9B8"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <circle cx="244" cy="146" r="24" fill="#E5C9B8" />
    </svg>
  );
}

export function WhatsAppIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}

export function TrafficLightBadge({ status }: { status: TrafficLightStatus }) {
  const map: Record<
    TrafficLightStatus,
    { label: string; dot: string; wrapper: string }
  > = {
    GREEN: {
      label: 'Validato',
      dot: 'bg-[#3D7A5A]',
      wrapper: 'bg-[#EAF4EE] text-[#2F6649] border-[#BDDAC8]',
    },
    YELLOW: {
      label: 'In corso · Entro 15m',
      dot: 'bg-[#C4862D] animate-pulse',
      wrapper: 'bg-[#FCF4E6] text-[#94611A] border-[#ECD4AA]',
    },
    RED: {
      label: 'Non validato',
      dot: 'bg-[#B5443A]',
      wrapper: 'bg-[#FBECEB] text-[#A63A31] border-[#EBC3C0]',
    },
    UPCOMING: {
      label: 'In programma',
      dot: 'bg-[#8E867B]',
      wrapper: 'bg-[#F4F0E8] text-[#625B52] border-[#E2DACD]',
    },
  };
  const cfg = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.wrapper}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
