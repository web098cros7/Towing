'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Input,
  Money,
  Select,
  Switch,
  Textarea,
} from '@towing/web-ui';
import { paiseToRupeeString, type AdminCoupon, type CouponKind } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { apiIssues } from '@/lib/apiIssues';
import { useCreateCoupon, useUpdateCoupon } from '../api/adminPromotions.mutations';
import { useCouponRedemptions } from '../api/adminPromotions.queries';
import { fromLocalInput, previewDiscountPaise, toLocalInput } from '../lib/promotionsMath';
import {
  fieldErrorsFromIssues,
  validateCouponDraft,
  type CouponField,
  type CouponFieldErrors,
} from '../lib/couponValidation';

interface CouponDraft {
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
  isActive: boolean;
  reason: string;
}

function draftFrom(coupon: AdminCoupon | null): CouponDraft {
  if (!coupon) {
    return {
      code: '',
      kind: 'percent',
      percentValue: '20',
      flatRupees: '',
      maxDiscountRupees: '',
      minOrderRupees: '',
      maxUses: '',
      maxUsesPerUser: '1',
      startsAt: '',
      expiresAt: '',
      isActive: true,
      reason: '',
    };
  }
  return {
    code: coupon.code,
    kind: coupon.kind,
    percentValue: coupon.percentValue === null ? '' : String(coupon.percentValue),
    flatRupees:
      coupon.flatValuePaise === null ? '' : String(Math.round(coupon.flatValuePaise / 100)),
    maxDiscountRupees:
      coupon.maxDiscountPaise === null ? '' : String(Math.round(coupon.maxDiscountPaise / 100)),
    minOrderRupees:
      coupon.minOrderPaise === 0 ? '' : String(Math.round(coupon.minOrderPaise / 100)),
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    maxUsesPerUser: String(coupon.maxUsesPerUser),
    startsAt: toLocalInput(coupon.startsAt),
    expiresAt: toLocalInput(coupon.expiresAt),
    isActive: coupon.isActive,
    reason: '',
  };
}

/**
 * The coupon editor (§9.4.11) with the "what the customer sees" preview.
 *
 * THE PREVIEW IS THE POINT OF THE SCREEN. `percent` and `flat` share one
 * stored column but mean very different things — "20" is 20% or ₹20 — and the
 * editor keeps them in two inputs for exactly that reason. The preview then
 * runs the shared maths (`lib/promotionsMath.ts`, a mirror of the backend's
 * `discountFor`) against a sample fare so an operator sees the discount a
 * customer would get, caps included, before saving.
 *
 * `used_count` has no field here, not even a disabled one: the counter is
 * moved only by the confirm transaction, and a disabled input still reads as
 * "a number you are not allowed to change" rather than "not a number".
 */
export function CouponEditorDrawer({
  target,
  onClose,
}: {
  target: AdminCoupon | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const coupon = target === 'new' ? null : target;
  const [draft, setDraft] = useState<CouponDraft>(() => draftFrom(coupon));
  const [sampleRupees, setSampleRupees] = useState('2000');
  const [redemptionPage, setRedemptionPage] = useState(1);
  const [errors, setErrors] = useState<CouponFieldErrors>({});

  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const redemptions = useCouponRedemptions(coupon?.id ?? null, redemptionPage);

  // Re-seed the form whenever the drawer opens on a different target.
  useEffect(() => {
    setDraft(draftFrom(coupon));
    setRedemptionPage(1);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Every input goes through here so an edit clears the message under the field it fixes.
  const edit = (patch: Partial<CouponDraft>): void => {
    setDraft({ ...draft, ...patch });
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as CouponField[]) delete next[key];
      // Moving the start can settle the "expires after it starts" message.
      if ('startsAt' in patch) delete next.expiresAt;
      return next;
    });
  };

  const open = target !== null;
  const isNew = target === 'new';

  const percentValue = draft.kind === 'percent' ? Number(draft.percentValue || '0') : null;
  const flatValuePaise =
    draft.kind === 'flat' ? Math.round(Number(draft.flatRupees || '0') * 100) : null;
  const maxDiscountPaise =
    draft.kind === 'percent' && draft.maxDiscountRupees.trim().length > 0
      ? Math.round(Number(draft.maxDiscountRupees) * 100)
      : null;

  const subtotalPaise = Math.max(0, Math.round(Number(sampleRupees || '0') * 100));
  const discountPaise = previewDiscountPaise(
    { kind: draft.kind, percentValue, flatValuePaise, maxDiscountPaise },
    subtotalPaise,
  );

  const save = (): void => {
    const found = validateCouponDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const code = draft.code.trim();

    const body = {
      code,
      kind: draft.kind,
      ...(draft.kind === 'percent'
        ? { percentValue: Number(draft.percentValue || '0') }
        : { flatValuePaise: Math.round(Number(draft.flatRupees || '0') * 100) }),
      maxDiscountPaise,
      minOrderPaise: Math.round(Number(draft.minOrderRupees || '0') * 100),
      maxUses: draft.maxUses.trim().length > 0 ? Number(draft.maxUses) : null,
      maxUsesPerUser: Number(draft.maxUsesPerUser || '1'),
      startsAt: fromLocalInput(draft.startsAt),
      expiresAt: fromLocalInput(draft.expiresAt),
      isActive: draft.isActive,
      ...(draft.reason.trim().length > 0 ? { reason: draft.reason.trim() } : {}),
    };

    const onSuccess = (saved: AdminCoupon): void => {
      toast(`Coupon ${saved.code} saved`, 'success');
      onClose();
    };
    const onError = (cause: unknown): void => {
      // The server names the field in the same words as the checks above, so a rule the client
      // missed still lands under the right input instead of a vague toast.
      const fromServer = fieldErrorsFromIssues(apiIssues(cause));
      if (Object.keys(fromServer).length > 0) {
        setErrors(fromServer);
        return;
      }
      toast(cause instanceof Error ? cause.message : 'Could not save the coupon', 'error');
    };

    if (coupon) update.mutate({ couponId: coupon.id, body }, { onSuccess, onError });
    else create.mutate(body, { onSuccess, onError });
  };

  const saving = create.isPending || update.isPending;

  return (
    <Drawer open={open} onClose={onClose} labelledBy="coupon-editor-title">
      <DrawerHeader>
        <DrawerTitle id="coupon-editor-title">
          {isNew ? 'New coupon' : coupon ? `Edit ${coupon.code}` : 'Coupon'}
        </DrawerTitle>
      </DrawerHeader>

      <DrawerBody>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="coupon-code">
              Code
            </label>
            <Input
              id="coupon-code"
              data-testid="coupon-code"
              aria-invalid={errors.code ? true : undefined}
              value={draft.code}
              onChange={(event) => edit({ code: event.target.value.toUpperCase() })}
              placeholder="SAVE20"
            />
            {errors.code ? (
              <p className="text-xs text-error" role="alert" data-testid="coupon-error-code">
                {errors.code}
              </p>
            ) : null}
            <p className="text-xs text-text-secondary">
              Matched case-insensitively; customers may type it any way.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-kind">
                Kind
              </label>
              <Select
                id="coupon-kind"
                data-testid="coupon-kind"
                value={draft.kind}
                onChange={(event) => edit({ kind: event.target.value as CouponKind })}
              >
                <option value="percent">Percentage</option>
                <option value="flat">Flat ₹</option>
              </Select>
            </div>

            {draft.kind === 'percent' ? (
              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="coupon-percent">
                  Percent off
                </label>
                <Input
                  id="coupon-percent"
                  data-testid="coupon-percent"
                  aria-invalid={errors.percentValue ? true : undefined}
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={draft.percentValue}
                  onChange={(event) => edit({ percentValue: event.target.value })}
                />
                {errors.percentValue ? (
                  <p className="text-xs text-error" role="alert" data-testid="coupon-error-percent">
                    {errors.percentValue}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="coupon-flat">
                  Rupees off
                </label>
                <Input
                  id="coupon-flat"
                  data-testid="coupon-flat"
                  aria-invalid={errors.flatRupees ? true : undefined}
                  type="number"
                  min="1"
                  step="1"
                  value={draft.flatRupees}
                  onChange={(event) => edit({ flatRupees: event.target.value })}
                />
                {errors.flatRupees ? (
                  <p className="text-xs text-error" role="alert" data-testid="coupon-error-flat">
                    {errors.flatRupees}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {draft.kind === 'percent' ? (
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-cap">
                Max discount (₹)
              </label>
              <Input
                id="coupon-cap"
                data-testid="coupon-cap"
                aria-invalid={errors.maxDiscountRupees ? true : undefined}
                type="number"
                min="0"
                step="1"
                value={draft.maxDiscountRupees}
                onChange={(event) => edit({ maxDiscountRupees: event.target.value })}
                placeholder="No cap"
              />
              {errors.maxDiscountRupees ? (
                <p className="text-xs text-error" role="alert" data-testid="coupon-error-cap">
                  {errors.maxDiscountRupees}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-min-order">
                Min order (₹)
              </label>
              <Input
                id="coupon-min-order"
                data-testid="coupon-min-order"
                aria-invalid={errors.minOrderRupees ? true : undefined}
                type="number"
                min="0"
                step="1"
                value={draft.minOrderRupees}
                onChange={(event) => edit({ minOrderRupees: event.target.value })}
                placeholder="0"
              />
              {errors.minOrderRupees ? (
                <p className="text-xs text-error" role="alert" data-testid="coupon-error-min-order">
                  {errors.minOrderRupees}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-max-uses">
                Total uses
              </label>
              <Input
                id="coupon-max-uses"
                data-testid="coupon-max-uses"
                aria-invalid={errors.maxUses ? true : undefined}
                type="number"
                min="1"
                step="1"
                value={draft.maxUses}
                onChange={(event) => edit({ maxUses: event.target.value })}
                placeholder="Unlimited"
              />
              {errors.maxUses ? (
                <p className="text-xs text-error" role="alert" data-testid="coupon-error-max-uses">
                  {errors.maxUses}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-per-user">
                Per customer
              </label>
              <Input
                id="coupon-per-user"
                data-testid="coupon-per-user"
                aria-invalid={errors.maxUsesPerUser ? true : undefined}
                type="number"
                min="1"
                step="1"
                value={draft.maxUsesPerUser}
                onChange={(event) => edit({ maxUsesPerUser: event.target.value })}
              />
              {errors.maxUsesPerUser ? (
                <p className="text-xs text-error" role="alert" data-testid="coupon-error-per-user">
                  {errors.maxUsesPerUser}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-starts">
                Starts
              </label>
              <Input
                id="coupon-starts"
                data-testid="coupon-starts"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => edit({ startsAt: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-expires">
                Expires
              </label>
              <Input
                id="coupon-expires"
                data-testid="coupon-expires"
                aria-invalid={errors.expiresAt ? true : undefined}
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(event) => edit({ expiresAt: event.target.value })}
              />
              {errors.expiresAt ? (
                <p className="text-xs text-error" role="alert" data-testid="coupon-error-expires">
                  {errors.expiresAt}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-card border border-border p-3">
            <div>
              <div className="text-sm font-semibold">Active</div>
              <div className="text-xs text-text-secondary">
                An inactive code answers exactly like an unknown one.
              </div>
            </div>
            <Switch
              checked={draft.isActive}
              onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
              labelledBy="coupon-active-label"
            />
          </div>
          <span id="coupon-active-label" className="sr-only">
            Coupon active
          </span>

          <div className="space-y-2 rounded-card border border-border p-3">
            <div className="text-sm font-semibold">What the customer sees</div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-secondary" htmlFor="coupon-sample">
                Sample fare ₹
              </label>
              <Input
                id="coupon-sample"
                data-testid="coupon-sample"
                type="number"
                min="0"
                step="1"
                className="h-8 w-28"
                value={sampleRupees}
                onChange={(event) => setSampleRupees(event.target.value)}
              />
            </div>
            <div className="text-sm">
              Discount{' '}
              <span data-testid="coupon-preview-discount" className="font-semibold">
                <Money value={paiseToRupeeString(discountPaise)} />
              </span>{' '}
              → customer pays{' '}
              <span data-testid="coupon-preview-total" className="font-semibold">
                <Money value={paiseToRupeeString(subtotalPaise - discountPaise)} />
              </span>
            </div>
            <p className="text-xs text-text-secondary">
              Capped at the subtotal; the confirm transaction recomputes this server-side.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="coupon-reason">
              Reason (audited)
            </label>
            <Textarea
              id="coupon-reason"
              data-testid="coupon-reason"
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              rows={2}
              placeholder="Why this change — recorded on the audit row."
            />
          </div>

          {coupon ? (
            <div className="space-y-2 rounded-card border border-border p-3">
              <div className="text-sm font-semibold">
                Redemptions used ({coupon.usedCount} of {coupon.maxUses ?? '∞'})
              </div>
              {redemptions.data && redemptions.data.items.length > 0 ? (
                <ul className="space-y-1 text-xs">
                  {redemptions.data.items.map((redemption) => (
                    <li key={redemption.id} className="flex items-center justify-between gap-2">
                      <span>
                        {redemption.userName ?? 'Unknown'} ·{' '}
                        <span className="font-mono">{redemption.bookingCode}</span>
                      </span>
                      <Money value={paiseToRupeeString(redemption.discountPaise)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-secondary">No live redemptions.</p>
              )}
            </div>
          ) : null}
        </div>
      </DrawerBody>

      <DrawerFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button data-testid="coupon-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save coupon'}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
