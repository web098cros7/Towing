import { describe, expect, it } from 'vitest';
import {
  formatPaise,
  formatRupees,
  paiseToRupeeString,
  rupeeStringToPaise,
} from '@towing/api-contracts';

/**
 * The shared money formatter, tested HERE.
 *
 * WHY IN THE BACKEND. Neither Expo app has a test runner and neither does
 * `@towing/api-contracts`; the backend is the only package in the repo with
 * vitest, and it already imports the contracts package everywhere. Adding a
 * second runner to two React Native apps to test one pure function would be a
 * tooling change larger than the function.
 *
 * WHY IT NEEDED TESTING AT ALL. TowGo and TowPartner each hand-rolled this, and
 * TowGo's was wrong for negative amounts in a way nothing could catch: no
 * screen rendered negative money until Phase 19's wallet. `paiseSchema` has
 * been explicitly signed since Phase 7 — "ledger amounts carry their sign" —
 * and payout debits, §3.5 compensation and §14.5 reversals are all negative
 * rows a driver and a customer now both see.
 */
describe('formatPaise / formatRupees', () => {
  it('groups the Indian way, not in thousands', () => {
    // 1,00,000 — not 100,000. The lakh grouping is the whole reason this is
    // hand-rolled rather than `toFixed` plus a comma regex.
    expect(formatPaise(10_000_000)).toBe('₹1,00,000');
    expect(formatPaise(100_000_000)).toBe('₹10,00,000');
    expect(formatPaise(125_000)).toBe('₹1,250');
    expect(formatPaise(50_000)).toBe('₹500');
    expect(formatPaise(0)).toBe('₹0');
  });

  it('renders NEGATIVE amounts correctly — the bug this replaced', () => {
    // ⚠ THE REGRESSION. The old TowGo implementation grouped the signed string
    // directly: for −500 the digits were "-500", `last3` was "500" and `rest`
    // was "-" — truthy — so the grouping branch ran and produced "₹-,500".
    expect(formatPaise(-50_000)).toBe('-₹500');
    expect(formatPaise(-10_000_000)).toBe('-₹1,00,000');
    expect(formatRupees(-500)).toBe('-₹500');
    expect(formatRupees(-100_000)).toBe('-₹1,00,000');
  });

  it('shows paise only when there are any', () => {
    expect(formatPaise(125_050)).toBe('₹1,250.50');
    expect(formatPaise(50)).toBe('₹0.50');
    expect(formatPaise(1)).toBe('₹0.01');
    // Whole rupees stay clean — a fare list of "₹1,250.00" reads worse.
    expect(formatPaise(125_000)).toBe('₹1,250');
  });

  it('renders a negative fractional amount', () => {
    // The one case the OLD code got right, kept so the fix cannot regress it.
    expect(formatPaise(-125_050)).toBe('-₹1,250.50');
    expect(formatPaise(-50)).toBe('-₹0.50');
  });

  it('round-trips against the wire helpers', () => {
    // The three money functions have to agree: what the database stores, what
    // crosses the wire, and what a person reads.
    for (const rupees of ['0.00', '1250.50', '100000.00', '-499.50', '0.01']) {
      const paise = rupeeStringToPaise(rupees);
      expect(paiseToRupeeString(paise)).toBe(rupees);
      // And the display never loses the sign.
      expect(formatPaise(paise).startsWith('-')).toBe(paise < 0);
    }
  });
});
