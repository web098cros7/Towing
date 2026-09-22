/**
 * Client-side coupon draft validation.
 * Mirrors the zod contract in packages/api-contracts/src/admin/promotions.ts.
 * A rule changed there must change here too — the server stays the authority.
 */

import type { ApiIssue } from '@/lib/apiIssues';
import type { CouponKind } from '@towing/api-contracts';

export interface CouponDraftFields {
  code: string;
  kind: CouponKind;
  percentValue: string;
  flatRupees: string;
  maxDiscountRupees: string;
  minOrderRupees: string;
  maxUses: string;
  maxUsesPerUser: string;
  startsAt: string;
  expiresAt: string;
}

export type CouponField =
  | 'code'
  | 'percentValue'
  | 'flatRupees'
  | 'maxDiscountRupees'
  | 'minOrderRupees'
  | 'maxUses'
  | 'maxUsesPerUser'
  | 'startsAt'
  | 'expiresAt';

export type CouponFieldErrors = Partial<Record<CouponField, string>>;

export const MAX_PAISE = 999_999_999_999;
export const MAX_INT4 = 2_147_483_647;

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function hasMoreThanTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) > 1e-6;
}

export function validateCouponDraft(draft: CouponDraftFields): CouponFieldErrors {
  const errors: CouponFieldErrors = {};

  const code = draft.code.trim();
  if (code.length < 3) {
    errors.code = 'A coupon code needs at least 3 characters';
  } else if (code.length > 32) {
    errors.code = 'A coupon code is at most 32 characters';
  }

  if (draft.kind === 'percent') {
    const percent = parseNumber(draft.percentValue);
    if (percent === null) {
      errors.percentValue = 'Enter a percentage';
    } else if (percent <= 0) {
      errors.percentValue = 'The percentage must be greater than 0';
    } else if (percent > 100) {
      errors.percentValue = 'A percentage cannot exceed 100';
    } else if (hasMoreThanTwoDecimals(percent)) {
      errors.percentValue = 'Use at most two decimal places';
    }
  }

  if (draft.kind === 'flat') {
    const flat = parseNumber(draft.flatRupees);
    if (flat === null) {
      errors.flatRupees = 'Enter a rupee amount';
    } else {
      const paise = rupeesToPaise(flat);
      if (paise < 1) {
        errors.flatRupees = 'The discount must be greater than ₹0';
      } else if (paise > MAX_PAISE) {
        errors.flatRupees = 'That amount is too large';
      }
    }
  }

  if (draft.kind === 'percent' && draft.maxDiscountRupees.trim() !== '') {
    const cap = parseNumber(draft.maxDiscountRupees);
    if (cap === null) {
      errors.maxDiscountRupees = 'Enter a rupee amount';
    } else {
      const paise = rupeesToPaise(cap);
      if (paise < 0) {
        errors.maxDiscountRupees = 'The cap cannot be negative';
      } else if (paise > MAX_PAISE) {
        errors.maxDiscountRupees = 'That amount is too large';
      }
    }
  }

  if (draft.minOrderRupees.trim() !== '') {
    const minOrder = parseNumber(draft.minOrderRupees);
    if (minOrder === null) {
      errors.minOrderRupees = 'Enter a rupee amount';
    } else {
      const paise = rupeesToPaise(minOrder);
      if (paise < 0) {
        errors.minOrderRupees = 'The minimum cannot be negative';
      } else if (paise > MAX_PAISE) {
        errors.minOrderRupees = 'That amount is too large';
      }
    }
  }

  if (draft.maxUses.trim() !== '') {
    const maxUses = parseNumber(draft.maxUses);
    if (maxUses === null || !Number.isInteger(maxUses)) {
      errors.maxUses = 'Enter a whole number';
    } else if (maxUses < 1) {
      errors.maxUses = 'Total uses must be at least 1';
    } else if (maxUses > MAX_INT4) {
      errors.maxUses = 'That number is too large';
    }
  }

  if (draft.maxUsesPerUser.trim() !== '') {
    const perUser = parseNumber(draft.maxUsesPerUser);
    if (perUser === null || !Number.isInteger(perUser)) {
      errors.maxUsesPerUser = 'Enter a whole number';
    } else if (perUser < 1 || perUser > 100) {
      errors.maxUsesPerUser = 'Per customer must be between 1 and 100';
    }
  }

  if (draft.startsAt.trim() !== '' && draft.expiresAt.trim() !== '') {
    const start = new Date(draft.startsAt).getTime();
    const end = new Date(draft.expiresAt).getTime();
    if (start >= end) {
      errors.expiresAt = 'Expires must be after it starts';
    }
  }

  return errors;
}

export const COUPON_FIELD_BY_PATH: Record<string, CouponField> = {
  code: 'code',
  percentValue: 'percentValue',
  flatValuePaise: 'flatRupees',
  maxDiscountPaise: 'maxDiscountRupees',
  minOrderPaise: 'minOrderRupees',
  maxUses: 'maxUses',
  maxUsesPerUser: 'maxUsesPerUser',
  startsAt: 'startsAt',
  expiresAt: 'expiresAt',
};

/**
 * Maps server issues onto editor fields. The server backstop names the field in
 * the same words, so a rule the client missed still lands under the right input.
 */
export function fieldErrorsFromIssues(issues: ApiIssue[]): CouponFieldErrors {
  const errors: CouponFieldErrors = {};
  for (const issue of issues) {
    const field = COUPON_FIELD_BY_PATH[issue.path];
    if (field && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
