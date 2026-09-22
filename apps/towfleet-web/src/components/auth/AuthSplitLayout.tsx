'use client';

import { cn } from '@towing/web-ui';

/**
 * MiTow wordmark shared with the mobile app (`towgo/src/assets/brand/logo.svg`,
 * copied to `public/brand/`). The SVG's dark ink vanishes on dark surfaces, so
 * `logo-on-dark` renders it all-white via filter — the same inverse treatment
 * the mobile `Logo` component applies by theme.
 */
const LOGO_SRC = '/brand/logo.svg';

export type AuthRealm = 'fleet' | 'admin';

const REALM_COPY: Record<
  AuthRealm,
  { artTitle: string; artSubtitle: string; footer: string }
> = {
  fleet: {
    artTitle: 'Run your fleet with total clarity',
    artSubtitle: 'Trucks, drivers, jobs and payouts — live in one console.',
    footer: 'Managed by your platform admin · session expires after 30 min idle',
  },
  admin: {
    artTitle: 'Command the marketplace',
    artSubtitle: 'Verification, dispatch, money and safety — audited end to end.',
    footer: 'Restricted console · every sign-in is audited',
  },
};

/**
 * Split-card auth frame (reference-grade login): gradient art panel left,
 * form panel right, stacked with a slim art banner on mobile.
 *
 * The art is CSS-only (layered gradients + blurred glow blobs, fixed colors
 * so it reads identically in light and dark mode). Realms differ deliberately:
 * fleet glows violet-blue, admin runs deep charcoal-navy — the same visual
 * distinction the two consoles carry inside.
 */
export function AuthSplitLayout({
  realm,
  title,
  description,
  children,
}: {
  realm: AuthRealm;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.ReactNode {
  const copy = REALM_COPY[realm];
  return (
    <main className="animate-admin-fade-in flex min-h-screen items-center justify-center bg-surface0 p-4 md:p-[4vh]">
      <div className="grid w-full gap-2 overflow-hidden rounded-sheet border border-border bg-card p-2 shadow-2xl md:min-h-[84vh] md:w-[70vw] md:max-w-[1100px] md:grid-cols-2 md:gap-3 md:p-3">
        <ArtPanel realm={realm} title={copy.artTitle} subtitle={copy.artSubtitle} />
        <div className="flex flex-col justify-center p-6 sm:p-8 md:p-10">
          <img
            src={LOGO_SRC}
            alt="MiTow"
            className="h-7 w-auto dark:brightness-0 dark:invert"
          />
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
          <div className="mt-6 flex flex-col">{children}</div>
          <p className="mt-6 text-center text-xs text-text-tertiary">{copy.footer}</p>
        </div>
      </div>
    </main>
  );
}

function ArtPanel({
  realm,
  title,
  subtitle,
}: {
  realm: AuthRealm;
  title: string;
  subtitle: string;
}): React.ReactNode {
  return (
    <div
      aria-hidden
      className={cn(
        'relative flex-col justify-between overflow-hidden rounded-[20px] p-8 text-white',
        'hidden md:flex',
        realm === 'fleet'
          ? 'bg-[#e7e8fb]'
          : 'bg-[linear-gradient(150deg,#020617_0%,#1e1b4b_45%,#1e3a8a_75%,#1d4ed8_100%)]',
      )}
    >
      {realm === 'fleet' ? (
        <>
          {/* Aurora mesh — pale lavender base with flowing pastel washes, like
              the reference: saturated blue top-left for the mark, violet
              center, pink right edge, and a deeper indigo pocket bottom-left
              so the white headline always sits on colour. */}
          <div className="absolute -left-24 -top-24 size-96 rounded-full bg-blue-500/55 blur-3xl" />
          <div className="absolute left-1/4 top-[12%] size-80 rounded-full bg-violet-500/45 blur-3xl" />
          <div className="absolute -right-24 top-1/3 size-80 rounded-full bg-fuchsia-400/40 blur-3xl" />
          <div className="absolute -bottom-16 right-8 size-72 rounded-full bg-sky-300/60 blur-3xl" />
          <div className="absolute -bottom-32 -left-20 size-[26rem] rounded-full bg-indigo-600/55 blur-3xl" />
        </>
      ) : (
        <>
          <div className="absolute -right-20 -top-20 size-72 rounded-full bg-fuchsia-300/40 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 size-80 rounded-full bg-sky-300/30 blur-3xl" />
          <div className="absolute left-1/3 top-1/3 size-56 rounded-full bg-white/15 blur-3xl" />
        </>
      )}
      <img
        src={LOGO_SRC}
        alt="MiTow"
        className="relative h-9 w-auto brightness-0 invert"
      />
      <div className="relative">
        <p className="text-xs font-medium uppercase tracking-widest text-white/80">You can easily</p>
        <p className="mt-2 font-display text-[26px] font-bold leading-snug [text-shadow:0_1px_14px_rgba(49,46,129,0.5)]">
          {title}
        </p>
        <p className="mt-2 text-sm text-white/85 [text-shadow:0_1px_10px_rgba(49,46,129,0.4)]">
          {subtitle}
        </p>
      </div>
    </div>
  );
}
