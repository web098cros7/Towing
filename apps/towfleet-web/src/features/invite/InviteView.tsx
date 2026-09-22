'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Refer & Earn's public invite card (Figma 45's share target).
 *
 * A SINGLE CENTRED CARD, mobile-first, no chrome. The visitor arrived from a
 * WhatsApp forward; the only two things they can do are copy the code or open
 * the app, and both are one tap away. Anything else — nav, footer, links back
 * into the console — would be noise on a page a stranger sees once.
 *
 * THE DEEP LINK IS `moveyo://r/{code}`. The app stores the code on cold start
 * (`useCaptureReferralLinks`) and applies it after sign-up, so a visitor who
 * taps through does not have to remember or paste anything. The code is also
 * shown in full so it can be typed by hand if the app is not installed yet.
 */

const BRAND_YELLOW = '#FCC30B';
const INK = '#0B0C0E';
const MUTED = '#4A5568';
const PAGE_BG = '#F3F6F8';

export function InviteView({ code, rewardPaise }: { code: string; rewardPaise: number }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const rewardRupees = (rewardPaise / 100).toLocaleString('en-IN');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). The code is
      // visible and selectable in the box, so the visitor is not stuck.
    }
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-6"
      style={{ backgroundColor: PAGE_BG, color: INK, fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm"
        style={{ borderRadius: 16 }}
      >
        <img
          src="/brand/logo.svg"
          alt="MiTow"
          width={120}
          height={32}
          className="mx-auto mb-6"
        />

        <h1 className="text-xl font-semibold" style={{ color: INK }}>
          You&apos;ve been invited to MiTow
        </h1>

        <p className="mt-3 text-sm leading-relaxed" style={{ color: MUTED }}>
          Use this code on your first booking and get ₹{rewardRupees} off your first tow.
        </p>

        <div
          className="mt-6 flex items-center justify-between gap-3 border-2 border-dashed px-4 py-3"
          style={{ borderColor: BRAND_YELLOW, borderRadius: 16 }}
        >
          <span
            className="select-all text-lg font-semibold tracking-[0.2em]"
            style={{ color: INK, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          >
            {code}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: copied ? BRAND_YELLOW : '#F3F6F8',
              color: INK,
              borderRadius: 8,
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <a
          href={`moveyo://r/${code}`}
          className="mt-6 block w-full py-3 text-center text-sm font-semibold text-white"
          style={{ backgroundColor: INK, borderRadius: 16 }}
        >
          Open the MiTow app
        </a>

        <p className="mt-4 text-xs leading-relaxed" style={{ color: MUTED }}>
          Don&apos;t have the app yet? It&apos;s coming soon to Google Play and the App Store.
        </p>
      </div>
    </main>
  );
}
