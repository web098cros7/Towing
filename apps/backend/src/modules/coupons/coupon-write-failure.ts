/**
 * Backstop for coupon writes that Postgres refuses.
 *
 * The api-contracts zod schemas are the first line of defence; this file exists so that a rule
 * they miss still answers 422-with-the-field instead of an opaque 500. Both the create and the
 * update paths of the admin coupon service share it.
 */

import { ApiException } from '../../common/errors/api-exception';
import {
  constraintName,
  isCheckViolation,
  isNumericOverflow,
  isUniqueViolation,
} from '../../common/errors/pg-errors';
import type { CouponKind } from '@towing/api-contracts';

const WINDOW_MESSAGE = 'The window must end after it starts';

function issues(
  path: string,
  message: string,
): { issues: Array<{ path: string; code: 'custom'; message: string }> } {
  return { issues: [{ path, code: 'custom', message }] };
}

/**
 * Also thrown by the service's own effective-value window check on create and update.
 */
export function couponWindowError(): ApiException {
  return ApiException.validation(WINDOW_MESSAGE, issues('expiresAt', WINDOW_MESSAGE));
}

export interface CouponWriteContext {
  code?: string;
  kind: CouponKind;
}

/**
 * Returns the error to throw: a mapped ApiException, or the ORIGINAL error unchanged when it is
 * none of the known refusals, so genuine faults still surface as 500s and reach the error reporter.
 */
export function couponWriteFailure(error: unknown, ctx: CouponWriteContext): unknown {
  if (isUniqueViolation(error)) {
    return ApiException.conflict('A coupon with that code already exists', { code: ctx.code });
  }

  if (isCheckViolation(error)) {
    switch (constraintName(error)) {
      case 'ck_coupons_window':
        return couponWindowError();
      case 'ck_coupons_value': {
        const message = 'The discount must be greater than zero';
        const path = ctx.kind === 'percent' ? 'percentValue' : 'flatValuePaise';
        return ApiException.validation(message, issues(path, message));
      }
      case 'ck_coupons_percent_ceiling': {
        const message = 'A percentage discount cannot exceed 100%';
        return ApiException.validation(message, issues('percentValue', message));
      }
      default:
        break;
    }
  }

  if (isNumericOverflow(error)) {
    const message = 'A number in this coupon is too large';
    return ApiException.validation(message, issues('', message));
  }

  return error;
}
