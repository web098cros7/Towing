import type { AdminContentPage } from '@towing/api-contracts';

/**
 * W15's content fixtures (M5) — the six FAQ answers and two legal pages the
 * seed ships, verbatim enough to develop against.
 *
 * The mutations are LIVE: saving a page updates module state, so a spec can
 * prove "unpublishing a page takes it out of the FAQ list on the public side"
 * without a backend.
 */

const MINUTE = 60_000;
const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE).toISOString();

const MOCK_ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const MOCK_ADMIN_NAME = 'Mock Admin';

let pages: AdminContentPage[] = [
  page(
    'faq-how-do-i-book',
    'faq',
    'How do I book a tow truck?',
    '1. Open the app and enter your pickup location.\n2. Pick the vehicle size.\n3. Confirm the fare and tap Book.\n\nYou will see the truck live on the map as soon as a driver accepts.',
    10,
    at(4_320),
  ),
  page(
    'faq-how-is-the-fare-calculated',
    'faq',
    'How is the fare calculated?',
    'The fare is distance plus a base charge, with the exact rate card shown before you confirm. Waiting time beyond the free window is billed per minute.',
    20,
    at(4_310),
  ),
  page(
    'faq-what-if-the-driver-is-late',
    'faq',
    'What if the driver is late?',
    'The app shows the live ETA. If the driver is more than 15 minutes late you can cancel without a fee from the booking screen.',
    30,
    at(4_300),
  ),
  page(
    'faq-payment-methods',
    'faq',
    'Which payment methods can I use?',
    'UPI, cards and cash. Cash jobs require the driver to confirm the amount in the app before you pay.',
    40,
    at(4_290),
  ),
  page(
    'faq-where-is-my-invoice',
    'faq',
    'Where is my invoice?',
    'Every completed trip has an invoice under Trips → the trip → View invoice. You can share it as a PDF.',
    50,
    at(4_280),
  ),
  page(
    'faq-how-do-i-contact-support',
    'faq',
    'How do I contact support?',
    'Use Help → Contact us from the app. Tickets reach a human console with your trip already attached, so you rarely have to repeat yourself.',
    60,
    at(4_270),
  ),
  page(
    'legal-terms-of-service',
    'legal',
    'Terms of Service',
    'These terms govern your use of the Towing platform.\n\n1. The platform connects you with independent tow operators.\n2. Fares shown at booking are binding for the trip as described.\n3. Abuse of the SOS feature is grounds for account suspension.',
    10,
    at(8_640),
  ),
  page(
    'legal-privacy-policy',
    'legal',
    'Privacy Policy',
    'We collect the location you provide to dispatch a truck and keep it for the periods the DPDP Act requires.\n\nEmergency contacts are only used to reach someone when you raise an SOS.',
    20,
    at(8_630),
  ),
];

function page(
  slug: string,
  kind: AdminContentPage['kind'],
  title: string,
  bodyMd: string,
  sortOrder: number,
  updatedAt: string,
): AdminContentPage {
  return {
    slug,
    kind,
    title,
    bodyMd,
    locale: 'en',
    isPublished: true,
    sortOrder,
    updatedBy: MOCK_ADMIN_ID,
    updatedByName: MOCK_ADMIN_NAME,
    createdAt: updatedAt,
    updatedAt,
  };
}

export function mockContentPages(kind?: AdminContentPage['kind']): {
  items: AdminContentPage[];
} {
  const items = pages
    .filter((row) => (kind ? row.kind === kind : true))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  return { items };
}

export function mockUpsertContent(
  slug: string,
  body: Pick<AdminContentPage, 'kind' | 'title' | 'bodyMd' | 'isPublished' | 'sortOrder'> & {
    locale?: string;
  },
): AdminContentPage {
  const now = new Date().toISOString();
  const existing = pages.find((row) => row.slug === slug);
  const next: AdminContentPage = {
    slug,
    kind: body.kind,
    title: body.title,
    bodyMd: body.bodyMd,
    locale: body.locale ?? existing?.locale ?? 'en',
    isPublished: body.isPublished,
    sortOrder: body.sortOrder,
    updatedBy: MOCK_ADMIN_ID,
    updatedByName: MOCK_ADMIN_NAME,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  pages = existing ? pages.map((row) => (row.slug === slug ? next : row)) : [...pages, next];
  return next;
}
