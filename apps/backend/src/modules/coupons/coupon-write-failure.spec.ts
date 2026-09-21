import { describe, expect, it } from 'vitest';
import { ApiException } from '../../common/errors/api-exception';
import { couponWindowError, couponWriteFailure } from './coupon-write-failure';

/**
 * Backstop that turns a Postgres refusal on a coupon write into a 422/409 naming the field,
 * while letting genuine faults through untouched.
 */

describe('couponWriteFailure', () => {
  const pgError = (code: string, constraint?: string) => ({ code, constraint_name: constraint });

  const issuePaths = (exception: ApiException): string[] =>
    (exception.details as { issues: Array<{ path: string }> }).issues.map((issue) => issue.path);

  it('maps a duplicate code to a 409 carrying the code', () => {
    const result = couponWriteFailure(pgError('23505'), { code: 'SUMMER', kind: 'percent' });

    expect(result).toBeInstanceOf(ApiException);
    const exception = result as ApiException;
    expect(exception.getStatus()).toBe(409);
    expect(exception.code).toBe('conflict');
    expect(exception.details).toEqual({ code: 'SUMMER' });
  });

  it('maps a reversed window to the 422 the service throws itself', () => {
    const result = couponWriteFailure(pgError('23514', 'ck_coupons_window'), {
      code: 'SUMMER',
      kind: 'percent',
    });

    expect(result).toBeInstanceOf(ApiException);
    const exception = result as ApiException;
    expect(exception.getStatus()).toBe(422);
    expect(exception.code).toBe('validation_failed');
    expect(exception.message).toBe('The window must end after it starts');
    expect(exception.details).toEqual(couponWindowError().details);
    expect(issuePaths(exception)).toEqual(['expiresAt']);
  });

  it('names the percent field for a zero percent discount and the flat field for a zero flat discount', () => {
    const percentResult = couponWriteFailure(pgError('23514', 'ck_coupons_value'), {
      code: 'SUMMER',
      kind: 'percent',
    });

    expect(percentResult).toBeInstanceOf(ApiException);
    const percentException = percentResult as ApiException;
    expect(percentException.getStatus()).toBe(422);
    expect(percentException.message).toBe('The discount must be greater than zero');
    expect(issuePaths(percentException)).toEqual(['percentValue']);

    const flatResult = couponWriteFailure(pgError('23514', 'ck_coupons_value'), {
      code: 'SUMMER',
      kind: 'flat',
    });

    expect(flatResult).toBeInstanceOf(ApiException);
    const flatException = flatResult as ApiException;
    expect(flatException.getStatus()).toBe(422);
    expect(flatException.message).toBe('The discount must be greater than zero');
    expect(issuePaths(flatException)).toEqual(['flatValuePaise']);
  });

  it('names percentValue when the 100% ceiling is broken', () => {
    const result = couponWriteFailure(pgError('23514', 'ck_coupons_percent_ceiling'), {
      code: 'SUMMER',
      kind: 'percent',
    });

    expect(result).toBeInstanceOf(ApiException);
    const exception = result as ApiException;
    expect(exception.getStatus()).toBe(422);
    expect(exception.message).toBe('A percentage discount cannot exceed 100%');
    expect(issuePaths(exception)).toEqual(['percentValue']);
  });

  it('maps a numeric overflow to a 422 with no single field', () => {
    const result = couponWriteFailure(pgError('22003'), { code: 'SUMMER', kind: 'flat' });

    expect(result).toBeInstanceOf(ApiException);
    const exception = result as ApiException;
    expect(exception.getStatus()).toBe(422);
    expect(exception.message).toBe('A number in this coupon is too large');
    expect(issuePaths(exception)).toEqual(['']);
  });

  it('finds the driver error on cause, the way Drizzle wraps it', () => {
    const result = couponWriteFailure(
      { cause: pgError('23514', 'ck_coupons_window') },
      { code: 'SUMMER', kind: 'percent' },
    );

    expect(result).toBeInstanceOf(ApiException);
    const exception = result as ApiException;
    expect(exception.getStatus()).toBe(422);
    expect(exception.code).toBe('validation_failed');
    expect(exception.message).toBe('The window must end after it starts');
    expect(exception.details).toEqual(couponWindowError().details);
    expect(issuePaths(exception)).toEqual(['expiresAt']);
  });

  it('lets everything else through untouched', () => {
    const unknownConstraint = pgError('23514', 'ck_something_else');
    const plainError = new Error('boom');
    const notAnObject = 'nope';

    expect(couponWriteFailure(unknownConstraint, { code: 'SUMMER', kind: 'percent' })).toBe(
      unknownConstraint,
    );
    expect(couponWriteFailure(plainError, { code: 'SUMMER', kind: 'percent' })).toBe(plainError);
    expect(couponWriteFailure(notAnObject, { code: 'SUMMER', kind: 'percent' })).toBe(notAnObject);
  });
});
