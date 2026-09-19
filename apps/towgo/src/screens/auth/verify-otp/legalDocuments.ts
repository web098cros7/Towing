/**
 * The two documents 04's Terms line links to.
 *
 * The copy is the app's current legal copy, word for word from
 * `screens/account/LegalScreen.tsx` (route `Legal`, 56 · Privacy & Legal). That
 * screen keeps it in module-private constants, so it is mirrored here for the
 * signed-out reader; when 56 is rebuilt, both should read from one module.
 */
export type LegalDocumentKey = 'terms' | 'privacy';

export type LegalDocument = {
  /** Same words as the link that opens it. */
  title: string;
  sections: readonly { title: string; body: string }[];
};

export const legalDocuments: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    title: 'Terms of Service',
    sections: [
      {
        title: 'Using MiTow',
        body: 'The app connects you with independent towing partners. Fares, ETAs and vehicle availability are estimates and may vary at the time of service.',
      },
      {
        title: 'Your responsibilities',
        body: 'Provide accurate pickup/drop details and vehicle information, and keep your account credentials confidential.',
      },
      {
        title: 'Liability',
        body: 'MiTow facilitates the booking; the towing partner is responsible for the service performed on your vehicle.',
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        title: 'What we collect',
        body: 'Your mobile number, name, saved vehicles, saved addresses and emergency contacts, plus booking and location data needed to arrange a tow.',
      },
      {
        title: 'How we use it',
        body: 'To match you with a nearby driver, keep you updated on a booking, and improve the safety and reliability of the service.',
      },
      {
        title: 'Your rights',
        body: 'You can review, correct, export or delete your data at any time from this screen, in line with the Digital Personal Data Protection Act.',
      },
    ],
  },
};
