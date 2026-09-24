'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Input,
  Select,
  Switch,
  Textarea,
} from '@towing/web-ui';
import type { AdminBanner, BannerAudience } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useCreateBanner,
  useUpdateBanner,
  useUploadBannerImage,
} from '../api/adminPromotions.mutations';
import { fromLocalInput, toLocalInput } from '../lib/promotionsMath';

interface BannerDraft {
  title: string;
  imageKey: string;
  ctaLink: string;
  ctaLabel: string;
  audience: BannerAudience;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  reason: string;
}

function draftFrom(banner: AdminBanner | null): BannerDraft {
  if (!banner) {
    return {
      title: '',
      imageKey: '',
      ctaLink: '',
      ctaLabel: '',
      audience: 'customer',
      startsAt: '',
      endsAt: '',
      isActive: true,
      reason: '',
    };
  }
  return {
    title: banner.title,
    imageKey: banner.imageKey,
    ctaLink: banner.ctaLink ?? '',
    ctaLabel: banner.ctaLabel ?? '',
    audience: banner.audience,
    startsAt: toLocalInput(banner.startsAt),
    endsAt: toLocalInput(banner.endsAt),
    isActive: banner.isActive,
    reason: '',
  };
}

/**
 * The banner editor (§9.4.11): image, CTA, audience and the schedule window.
 *
 * The image rides the same presign → PUT → save-the-key shape as every other
 * console upload. In mocks mode the upload is simulated (see the mock's
 * header) and the preview is the LOCAL blob the operator picked — which is
 * what makes the mocks-on e2e able to walk the whole flow honestly.
 */
export function BannerEditorDrawer({
  target,
  onClose,
}: {
  target: AdminBanner | 'new' | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const banner = target === 'new' ? null : target;
  const [draft, setDraft] = useState<BannerDraft>(() => draftFrom(banner));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const create = useCreateBanner();
  const update = useUpdateBanner();
  const upload = useUploadBannerImage();

  useEffect(() => {
    setDraft(draftFrom(banner));
    setPreviewUrl(banner?.imageUrl ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const open = target !== null;
  const isNew = target === 'new';

  const pickFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const { key } = await upload.mutateAsync(file);
      setDraft((current) => ({ ...current, imageKey: key }));
      setPreviewUrl(URL.createObjectURL(file));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Upload failed', 'error');
    }
  };

  const save = (): void => {
    const title = draft.title.trim();
    if (title.length === 0) {
      toast('A banner needs a title', 'error');
      return;
    }
    if (draft.imageKey.trim().length === 0) {
      toast('Upload the banner image first', 'error');
      return;
    }

    const body = {
      title,
      imageKey: draft.imageKey.trim(),
      ctaLink: draft.ctaLink.trim().length > 0 ? draft.ctaLink.trim() : null,
      ctaLabel: draft.ctaLabel.trim().length > 0 ? draft.ctaLabel.trim() : null,
      audience: draft.audience,
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: fromLocalInput(draft.endsAt),
      isActive: draft.isActive,
      ...(draft.reason.trim().length > 0 ? { reason: draft.reason.trim() } : {}),
    };

    const onSuccess = (saved: AdminBanner): void => {
      toast(`Banner “${saved.title}” saved`, 'success');
      onClose();
    };
    const onError = (cause: unknown): void => {
      toast(cause instanceof Error ? cause.message : 'Could not save the banner', 'error');
    };

    if (banner) update.mutate({ bannerId: banner.id, body }, { onSuccess, onError });
    else create.mutate(body, { onSuccess, onError });
  };

  const saving = create.isPending || update.isPending;

  return (
    <Drawer open={open} onClose={onClose} labelledBy="banner-editor-title">
      <DrawerHeader>
        <DrawerTitle id="banner-editor-title">
          {isNew ? 'New banner' : banner ? `Edit ${banner.title}` : 'Banner'}
        </DrawerTitle>
      </DrawerHeader>

      <DrawerBody>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="banner-title">
              Title
            </label>
            <Input
              id="banner-title"
              data-testid="banner-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Monsoon drive — 15% off"
            />
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Image</div>
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Banner preview"
                data-testid="banner-image-preview"
                className="h-24 w-full rounded-card border border-border object-cover"
              />
            ) : (
              <div className="flex h-24 w-full items-center justify-center rounded-card border border-dashed border-border-strong text-xs text-text-tertiary">
                No image yet
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              data-testid="banner-image-input"
              className="text-sm"
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
            <p className="text-xs text-text-secondary">
              JPEG, PNG or WebP. {upload.isPending ? 'Uploading…' : 'Uploaded straight to storage.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="banner-cta-label">
                CTA label
              </label>
              <Input
                id="banner-cta-label"
                data-testid="banner-cta-label"
                value={draft.ctaLabel}
                onChange={(event) => setDraft({ ...draft, ctaLabel: event.target.value })}
                placeholder="Book now"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="banner-cta-link">
                CTA link
              </label>
              <Input
                id="banner-cta-link"
                data-testid="banner-cta-link"
                value={draft.ctaLink}
                onChange={(event) => setDraft({ ...draft, ctaLink: event.target.value })}
                placeholder="towgo://offers"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="banner-audience">
              Audience
            </label>
            <Select
              id="banner-audience"
              data-testid="banner-audience"
              value={draft.audience}
              onChange={(event) =>
                setDraft({ ...draft, audience: event.target.value as BannerAudience })
              }
            >
              <option value="customer">Customers (MiTow app)</option>
              <option value="driver">Drivers (MiTow Driver)</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="banner-starts">
                Starts
              </label>
              <Input
                id="banner-starts"
                data-testid="banner-starts"
                type="datetime-local"
                value={draft.startsAt}
                onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold" htmlFor="banner-ends">
                Ends
              </label>
              <Input
                id="banner-ends"
                data-testid="banner-ends"
                type="datetime-local"
                value={draft.endsAt}
                onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-text-secondary">
            Empty window = always live. Outside it the app never sees the banner, whatever the
            switch says.
          </p>

          <div className="flex items-center justify-between rounded-card border border-border p-3">
            <div>
              <div className="text-sm font-semibold">Active</div>
              <div className="text-xs text-text-secondary">
                The off switch, independent of schedule.
              </div>
            </div>
            <Switch
              checked={draft.isActive}
              onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
              labelledBy="banner-active-label"
            />
          </div>
          <span id="banner-active-label" className="sr-only">
            Banner active
          </span>

          <div className="space-y-1">
            <label className="text-sm font-semibold" htmlFor="banner-reason">
              Reason (audited)
            </label>
            <Textarea
              id="banner-reason"
              data-testid="banner-reason"
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              rows={2}
            />
          </div>
        </div>
      </DrawerBody>

      <DrawerFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button data-testid="banner-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save banner'}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}
