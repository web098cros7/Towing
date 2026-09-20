/**
 * The SOS chime — two short tones from a Web Audio oscillator.
 *
 * NO AUDIO ASSET, deliberately: a bundled mp3 is a binary in the diff, a
 * fetch on every console load and a licensing question, for a sound the
 * oscillator makes in ten lines. Browsers may refuse to start audio before a
 * user gesture; an operator who has logged in has gestured, and if the context
 * still refuses the chime is SILENTLY skipped — the toast, the banner and the
 * badge are the load-bearing alerts, and none of them may fail because a
 * speaker did not.
 */
export function playSosChime(): void {
  if (typeof window === 'undefined') return;

  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const start = ctx.currentTime;

    for (const [offset, frequency] of [
      [0, 880],
      [0.25, 620],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.25);
    }

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 800);
  } catch {
    // Audio is a nicety; the console must never break over it.
  }
}
