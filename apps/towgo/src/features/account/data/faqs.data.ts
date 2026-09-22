import type { Faq } from '../types';

export const faqs: Faq[] = [
  {
    id: 'f1',
    question: 'How do I book a tow?',
    answer:
      'Enter your pickup and drop, pick your vehicle and tap Confirm Booking. We match you with the nearest verified driver.',
  },
  {
    id: 'f2',
    question: 'How is the fare calculated?',
    answer:
      'Fares depend on your vehicle class and the trip distance. The estimate is shown before you confirm, and the final fare is locked at confirmation.',
  },
  {
    id: 'f3',
    question: 'Can I cancel a booking?',
    answer:
      "Yes. Cancelling while we're still searching for a driver is always free. After a driver is assigned, our cancellation policy may apply.",
  },
  {
    id: 'f4',
    question: 'What payment methods can I use?',
    answer:
      'You can pay via UPI, cards, or wallets through our secure checkout after the tow is completed.',
  },
  {
    id: 'f5',
    question: 'Is my trip safe?',
    answer:
      'Every driver is KYC-verified. You can share your live trip with family and reach our 24/7 support anytime from the app.',
  },
  {
    id: 'f6',
    question: 'Which areas do you serve?',
    answer: 'We currently operate across Bengaluru and are expanding to more cities zone by zone.',
  },
];
