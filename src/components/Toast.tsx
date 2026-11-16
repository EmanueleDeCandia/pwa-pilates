import React from 'react';
import { CheckCircle2, AlertCircle, Bell, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-5 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => {
        const styles =
          t.kind === 'success'
            ? 'bg-[#23201D] text-[#F8F6F2] border-[#3A3530]'
            : t.kind === 'error'
              ? 'bg-[#9E352C] text-white border-[#862B23]'
              : 'bg-white text-[#23201D] border-[#D8CFC2]';
        const Icon =
          t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Bell;
        const iconColor =
          t.kind === 'success'
            ? 'text-[#9AC7AE]'
            : t.kind === 'error'
              ? 'text-[#FAD6D2]'
              : 'text-[#4A6759]';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm ${styles}`}
          >
            <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${iconColor}`} />
            <p className="flex-1 leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Chiudi notifica"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
