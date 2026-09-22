import type { ContentPage, ContentPagesResponse } from '@towing/api-contracts';
import { env } from '@/lib/env';
import { faqs } from '@/features/account/data/faqs.data';
import type { ContentDataSource } from './contentDataSource';

/**
 * The mock content source — built from the app's own bundled copy, so mocks-on
 * shows the same answers the fallback shows and the two cannot drift apart in
 * review.
 */

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const updatedAt = '2025-11-01T00:00:00.000Z';

const FAQ_PAGES: ContentPage[] = faqs.map((faq, index) => ({
  slug: `faq-${faq.id}`,
  kind: 'faq',
  title: faq.question,
  bodyMd: faq.answer,
  locale: 'en',
  sortOrder: (index + 1) * 10,
  updatedAt,
}));

const LEGAL_PAGES: ContentPage[] = [
  {
    slug: 'legal-terms-of-service',
    kind: 'legal',
    title: 'Terms of Service',
    bodyMd:
      'These terms govern your use of the Towing platform.\n\n1. The platform connects you with independent tow operators.\n2. Fares shown at booking are binding for the trip as described.\n3. Abuse of the SOS feature is grounds for account suspension.',
    locale: 'en',
    sortOrder: 10,
    updatedAt,
  },
  {
    slug: 'legal-privacy-policy',
    kind: 'legal',
    title: 'Privacy Policy',
    bodyMd:
      'We collect the location you provide to dispatch a truck and keep it for the periods the DPDP Act requires.\n\nEmergency contacts are only used to reach someone when you raise an SOS.',
    locale: 'en',
    sortOrder: 20,
    updatedAt,
  },
];

export const contentMockSource: ContentDataSource = {
  async pages(kind) {
    await delay(300);
    if (env.mockContentState === 'error') throw new Error('Failed to load content');
    if (env.mockContentState === 'empty') return { items: [] };
    return { items: kind === 'faq' ? FAQ_PAGES : LEGAL_PAGES };
  },
};

export const contentFallback = (kind: 'faq' | 'legal'): ContentPagesResponse => ({
  items: kind === 'faq' ? FAQ_PAGES : LEGAL_PAGES,
});
