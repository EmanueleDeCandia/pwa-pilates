import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Phone } from 'lucide-react';
import { Modal } from './Modal';
import { WhatsAppIcon } from './BrandMark';
import { copyTextToClipboard, type WhatsAppLaunchRequest } from '../lib/api';
import { buildWhatsAppUrl } from '../lib/format';

interface WhatsAppActionModalProps {
  request: WhatsAppLaunchRequest | null;
  onClose: () => void;
  notify: (kind: 'success' | 'error' | 'info', msg: string) => void;
}

export function WhatsAppActionModal({
  request,
  onClose,
  notify,
}: WhatsAppActionModalProps) {
  const [draft, setDraft] = useState('');
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (request) {
      setDraft(request.message);
      setCopiedMsg(false);
      setCopiedUrl(false);
    }
  }, [request]);

  if (!request) return null;

  const waUrl = request.phone
    ? buildWhatsAppUrl(request.phone, draft)
    : `https://wa.me/?text=${encodeURIComponent(draft)}`;

  const handleCopyMessage = async () => {
    const ok = await copyTextToClipboard(draft);
    if (ok) {
      setCopiedMsg(true);
      notify('success', 'Messaggio WhatsApp copiato negli appunti.');
      setTimeout(() => setCopiedMsg(false), 2200);
    } else {
      notify('info', 'Seleziona il testo nel riquadro per copiarlo manualmente.');
    }
  };

  const handleCopyUrl = async () => {
    const ok = await copyTextToClipboard(waUrl);
    if (ok) {
      setCopiedUrl(true);
      notify('success', 'Link diretto wa.me copiato negli appunti.');
      setTimeout(() => setCopiedUrl(false), 2200);
    }
  };

  const handleConfirmSent = () => {
    request.onMarkedSent?.();
    notify('success', `Promemoria per ${request.recipientName} contrassegnato come inviato.`);
    onClose();
  };

  return (
    <Modal
      open={Boolean(request)}
      onClose={onClose}
      title="Invio Rapido WhatsApp"
      subtitle={request.contextLabel || 'Messaggio pre-compilato pronto per WhatsApp (zero costi API)'}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Destinatario */}
        <div className="rounded-xl bg-[#F8F6F2] border border-[#E8E2D9] px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[#8E867B]">Destinatario</p>
            <p className="text-sm font-semibold text-[#23201D]">{request.recipientName}</p>
          </div>
          {request.phone && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-[#DED6C8] px-3 py-1 text-xs font-medium text-[#4A6759] tabular-nums">
              <Phone className="h-3 w-3" />
              {request.phone}
            </span>
          )}
        </div>

        {/* Messaggio modificabile */}
        <div>
          <label className="block text-xs font-medium text-[#625B52] mb-1.5">
            Messaggio pre-compilato (puoi personalizzarlo prima dell&apos;invio)
          </label>
          <textarea
            rows={5}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full rounded-xl border border-[#DED6C8] bg-[#FCFBF9] px-3.5 py-2.5 text-sm text-[#23201D] leading-relaxed focus:border-[#4A6759] focus:outline-none"
          />
        </div>

        {/* Azioni principali */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              request.onMarkedSent?.();
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#4A6759] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#3A5347] transition-colors"
          >
            <WhatsAppIcon className="h-4 w-4" />
            Apri WhatsApp
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
          </a>

          <button
            type="button"
            onClick={handleCopyMessage}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#23201D] hover:bg-[#F4F0E8]"
          >
            {copiedMsg ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#2F6649]" />
                Testo Copiato
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-[#4A6759]" />
                Copia Messaggio
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleCopyUrl}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#DED6C8] bg-white px-3.5 py-2.5 text-xs font-medium text-[#625B52] hover:text-[#23201D] hover:bg-[#F4F0E8]"
          >
            {copiedUrl ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#2F6649]" />
                Link Copiato
              </>
            ) : (
              <>
                <Link2 className="h-3.5 w-3.5" />
                Copia Link wa.me
              </>
            )}
          </button>
        </div>

        <div className="rounded-xl bg-[#EDF2EE]/70 border border-[#D4E2D9] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#3B5448]">
          <span>
            Su smartphone e app installata si apre direttamente la chat WhatsApp. In anteprima puoi
            anche copiare il link o segnare subito come inviato.
          </span>
          {request.onMarkedSent && (
            <button
              type="button"
              onClick={handleConfirmSent}
              className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white border border-[#C9DBD0] px-2.5 py-1 font-semibold text-[#2F6649] hover:bg-[#EAF4EE]"
            >
              <Check className="h-3 w-3" />
              Segna come Inviato
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
