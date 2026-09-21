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
import { useCreateCoupon, useUpdateCoupon } from '../api/adminPromotions.mutations';
import { useCouponRedemptions } from '../api/adminPromotions.queries';
import { fromLocalInput, previewDiscountPaise, toLocalInput } from '../lib/promotionsMath';

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

  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const redemptions = useCouponRedemptions(coupon?.id ?? null, redemptionPage);

  // Re-seed the form whenever the drawer opens on a different target.
  useEffect(() => {
    setDraft(draftFrom(coupon));
    setRedemptionPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

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
    const code = draft.code.trim();
    if (code.length < 3) {
      toast('A coupon code needs at least 3 characters', 'error');
      return;
    }

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
              value={draft.code}
              onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })}
              placeholder="SAVE20"
            />
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
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as CouponKind })}
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
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={draft.percentValue}
                  onChange={(event) => setDraft({ ...draft, percentValue: event.target.value })}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-sm font-semibold" htmlFor="coupon-flat">
                  Rupees off
                </label>
                <Input
                  id="coupon-flat"
                  data-testid="coupon-flat"
                  type="number"
                  min="1"
                  step="1"
                  value={draft.flatRupees}
                  onChange={(event) => setDraft({ ...draft, flatRupees: event.target.value })}
                />
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
                type="number"
                min="0"
                step="1"
                value={draft.maxDiscountRupees}
                onChange={(event) => setDraft({ ...draft, maxDiscountRupees: event.target.value })}
                placeholder="No cap"
              />
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
                type="number"
                min="0"
                step="1"
                value={draft.minOrderRupees}
                onChange={(event) => setDraft({ ...draft, minOrderRupees: event.target.value })}
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-max-uses">
                Total uses
              </label>
              <Input
                id="coupon-max-uses"
                data-testid="coupon-max-uses"
                type="number"
                min="1"
                step="1"
                value={draft.maxUses}
                onChange={(event) => setDraft({ ...draft, maxUses: event.target.value })}
                placeholder="Unlimited"
              />
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
                type="number"
                min="1"
                step="1"
                value={draft.maxUsesPerUser}
                onChange={(event) => setDraft({ ...draft, maxUsesPerUser: event.target.value })}
              />
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
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="coupon-expires">
                Expires
              </label>
              <Input
                id="coupon-expires"
                data-testid="coupon-expires"
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
              />
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
