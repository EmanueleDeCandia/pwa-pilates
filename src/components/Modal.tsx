import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: 'md' | 'lg' | 'xl' | '2xl';
  children: React.ReactNode;
}

const WIDTH_MAP = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  maxWidth = 'lg',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#23201D]/45 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${WIDTH_MAP[maxWidth]} max-h-[92dvh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white border border-[#E8E2D9] shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#EFEAE1] px-5 sm:px-6 py-4 bg-[#FCFBF9]">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold text-[#23201D] leading-tight">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs sm:text-sm text-[#625B52]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#625B52] hover:bg-[#F1ECE3] hover:text-[#23201D] transition-colors"
            aria-label="Chiudi finestra"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 sm:px-6 py-5 safe-bottom">{children}</div>
      </div>
    </div>
  );
}
