'use client';

import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton, StatusChip, Switch } from '@towing/web-ui';
import type { AdminBanner } from '@towing/api-contracts';
import { AdminForbidden } from '@/components/admin/AdminForbidden';
import { ApiError } from '@/lib/apiClient';
import { useAdminBanners } from '../api/adminPromotions.queries';
import { useUpdateBanner } from '../api/adminPromotions.mutations';
import { bannerWindowLabel } from '../lib/promotionsMath';
import { BannerEditorDrawer } from './BannerEditorDrawer';

/**
 * `/admin/promotions` — the banner half (§9.4.11).
 *
 * ROWS ARE THE CAROUSEL, IN ORDER. Reordering is explicit (drag on desktop
 * would be nice; the arrows are what the e2e and a keyboard can drive), and it
 * writes normalised `sort_order` positions so two operators moving different
 * rows cannot create ties. The switch is the off switch; the window is the
 * schedule; both are shown, because "why is my banner not showing" is the
 * support question this screen exists to answer.
 */
export function BannersPanel() {
  const [target, setTarget] = useState<AdminBanner | 'new' | null>(null);
  const { data, isLoading, isError, error, refetch } = useAdminBanners();
  const update = useUpdateBanner();

  if (error instanceof ApiError && error.status === 403) {
    return <AdminForbidden resource="the promotions console" />;
  }

  const banners = data?.items ?? [];

  const ordered = (audience: AdminBanner['audience']): AdminBanner[] =>
    banners
      .filter((banner) => banner.audience === audience)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

  /**
   * Moves one row past its neighbour and re-normalises the audience's
   * positions to 1..n. Only rows whose stored position actually changed are
   * written — a swap writes two rows, not the whole carousel.
   */
  const move = async (row: AdminBanner, direction: 'up' | 'down'): Promise<void> => {
    const siblings = ordered(row.audience);
    const index = siblings.findIndex((banner) => banner.id === row.id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= siblings.length) return;

    const next = [...siblings];
    [next[index], next[swapWith]] = [next[swapWith]!, next[index]!];

    for (const [position, banner] of next.entries()) {
      if (banner.sortOrder !== position + 1) {
        await update.mutateAsync({
          bannerId: banner.id,
          body: { sortOrder: position + 1, reason: 'Reordered the carousel' },
        });
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          The apps read <code className="font-mono text-xs">GET /v1/banners</code> — active rows
          inside their window, in the order below.
        </p>
        <Button data-testid="banner-new" onClick={() => setTarget('new')}>
          New banner
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : isError ? (
        <div className="space-y-2">
          <p className="text-sm text-error-soft-fg">Could not load banners.</p>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : banners.length === 0 ? (
        <EmptyState title="No banners yet" description="Create the first carousel entry." />
      ) : (
        (['customer', 'driver'] as const).map((audience) => {
          const rows = ordered(audience);
          return (
            <div key={audience} className="space-y-2">
              <h3 className="text-sm font-semibold">
                {audience === 'customer'
                  ? 'Customer carousel (MiTow app)'
                  : 'Driver carousel (TowPartner)'}
              </h3>
              {rows.length === 0 ? (
                <p className="text-xs text-text-secondary">Nothing for this audience.</p>
              ) : (
                rows.map((banner, index) => (
                  <Card key={banner.id} data-testid="banner-row">
                    <div className="flex items-center gap-4 p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.imageUrl ?? ''}
                        alt=""
                        className="h-14 w-24 shrink-0 rounded-card border border-border object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{banner.title}</span>
                          <Badge variant={banner.audience === 'customer' ? 'info' : 'warning'}>
                            {banner.audience}
                          </Badge>
                          <StatusChip
                            status={banner.isActive ? 'active' : 'inactive'}
                            tone={banner.isActive ? 'success' : 'neutral'}
                          />
                        </div>
                        <div className="mt-0.5 text-xs text-text-secondary">
                          {bannerWindowLabel(banner.startsAt, banner.endsAt)}
                          {banner.ctaLabel ? ` · CTA “${banner.ctaLabel}”` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${banner.title} up`}
                          disabled={index === 0}
                          onClick={() => void move(banner, 'up')}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Move ${banner.title} down`}
                          disabled={index === rows.length - 1}
                          onClick={() => void move(banner, 'down')}
                        >
                          ↓
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setTarget(banner)}>
                          Edit
                        </Button>
                        <Switch
                          checked={banner.isActive}
                          disabled={update.isPending}
                          labelledBy={`banner-switch-${banner.id}`}
                          onCheckedChange={(checked) =>
                            update.mutate({
                              bannerId: banner.id,
                              body: { isActive: checked, reason: 'Toggled from the console' },
                            })
                          }
                        />
                        <span id={`banner-switch-${banner.id}`} className="sr-only">
                          {banner.title} active
                        </span>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          );
        })
      )}

      <BannerEditorDrawer target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
