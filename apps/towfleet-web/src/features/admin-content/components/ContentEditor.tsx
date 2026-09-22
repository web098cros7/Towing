'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  RelativeTime,
  Tabs,
  Textarea,
} from '@towing/web-ui';
import type { AdminContentPage, ContentPageKind } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import { ApiError } from '@/lib/apiClient';
import { useAdminContentPages, useUpsertContentPage } from '../api/adminContent.queries';

/**
 * `/admin/content` — W15's FAQ + legal editor (§9.4.12 / §6.6).
 *
 * The body is plain text with `bodyMd`'s line breaks preserved, not rendered
 * markdown: the apps render it the same way, and shipping a markdown renderer
 * to five surfaces so an FAQ answer can have a bold word is the trade this
 * milestone deliberately does not make. The slug is fixed once created —
 * apps link to `/v1/content/faq` and deep-links to a slug, so renaming one
 * would break published help links.
 */
export function ContentEditor() {
  const toast = useToast();
  const [kind, setKind] = useState<ContentPageKind>('faq');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data, isLoading, isError, error, refetch } = useAdminContentPages({ kind });
  const upsert = useUpsertContentPage();

  const items = data?.items ?? [];

  // Select the first page once the list arrives, so the editor is never an
  // empty form beside a non-empty list.
  useEffect(() => {
    if (selectedSlug === null && items.length > 0) {
      setSelectedSlug(items[0]!.slug);
      setDraft(draftOf(items[0]!));
    }
  }, [items, selectedSlug]);

  const select = (page: AdminContentPage) => {
    setSelectedSlug(page.slug);
    setDraft(draftOf(page));
  };

  const startNew = () => {
    setSelectedSlug('');
    setDraft({
      slug: '',
      title: '',
      bodyMd: '',
      sortOrder: nextSortOrder(items),
      isPublished: true,
    });
  };

  const save = () => {
    if (!draft || draft.slug.trim().length === 0 || draft.title.trim().length === 0) return;
    if (draft.bodyMd.trim().length === 0) return;

    upsert.mutate(
      {
        slug: draft.slug.trim(),
        body: {
          kind,
          title: draft.title.trim(),
          bodyMd: draft.bodyMd,
          isPublished: draft.isPublished,
          sortOrder: draft.sortOrder,
        },
      },
      {
        onSuccess: (saved) => {
          setSelectedSlug(saved.slug);
          setDraft(draftOf(saved));
          toast(
            saved.isPublished ? `“${saved.title}” is live` : `“${saved.title}” saved as draft`,
            'success',
          );
        },
        onError: (cause) => toast(messageOf(cause), 'error'),
      },
    );
  };

  const isNew = selectedSlug === '';

  if (error instanceof ApiError && error.status === 403) {
    return <div className="text-sm text-error-soft-fg">You cannot edit content.</div>;
  }

  return (
    <div>
      <Tabs
        items={[
          { value: 'faq', label: 'FAQ' },
          { value: 'legal', label: 'Legal' },
        ]}
        value={kind}
        onChange={(value) => {
          setKind(value as ContentPageKind);
          setSelectedSlug(null);
          setDraft(null);
        }}
        aria-label="Content kind"
      />

      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{kind === 'faq' ? 'FAQ entries' : 'Legal pages'}</CardTitle>
                <Button variant="secondary" size="sm" data-testid="content-new" onClick={startNew}>
                  New page
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                <div className="text-sm text-text-secondary">Loading…</div>
              ) : isError ? (
                <div className="space-y-2">
                  <div className="text-sm text-error-soft-fg">Could not load content.</div>
                  <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                    Try again
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="text-sm text-text-secondary">
                  No {kind === 'faq' ? 'FAQ entries' : 'legal pages'} yet — create one.
                </div>
              ) : (
                items.map((page) => (
                  <button
                    key={page.slug}
                    type="button"
                    data-testid="content-row"
                    onClick={() => select(page)}
                    className={
                      'w-full rounded-card border p-3 text-left ' +
                      (page.slug === selectedSlug
                        ? 'border-brand bg-brand-tint'
                        : 'border-border hover:bg-surface1')
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{page.title}</span>
                      {page.isPublished ? null : <Badge variant="warning">Draft</Badge>}
                    </div>
                    <div className="mt-1 font-mono text-xs text-text-secondary">{page.slug}</div>
                    <div className="mt-1 text-xs text-text-tertiary">
                      {page.updatedByName ? `${page.updatedByName} · ` : ''}
                      <RelativeTime at={page.updatedAt} />
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {draft ? (
            <Card>
              <CardHeader>
                <CardTitle>{isNew ? 'New page' : 'Edit page'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="content-slug">
                    Slug
                  </label>
                  <Input
                    id="content-slug"
                    data-testid="content-slug"
                    value={draft.slug}
                    disabled={!isNew}
                    onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                    placeholder="faq-how-do-i-book"
                  />
                  <p className="text-xs text-text-secondary">
                    {isNew
                      ? 'Lowercase, dashes, stable forever — apps deep-link to it.'
                      : 'Slugs cannot change once a page exists.'}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="content-title">
                    Title
                  </label>
                  <Input
                    id="content-title"
                    data-testid="content-title"
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-semibold" htmlFor="content-body">
                    Body
                  </label>
                  <Textarea
                    id="content-body"
                    data-testid="content-body"
                    rows={14}
                    className="font-mono"
                    value={draft.bodyMd}
                    onChange={(event) => setDraft({ ...draft, bodyMd: event.target.value })}
                  />
                  <p className="text-xs text-text-secondary">
                    Plain text; blank lines separate paragraphs.
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-semibold" htmlFor="content-sort-order">
                      Order
                    </label>
                    <Input
                      id="content-sort-order"
                      data-testid="content-sort-order"
                      type="number"
                      className="w-24"
                      value={String(draft.sortOrder)}
                      onChange={(event) =>
                        setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })
                      }
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      data-testid="content-published"
                      checked={draft.isPublished}
                      onChange={(event) =>
                        setDraft({ ...draft, isPublished: event.target.checked })
                      }
                    />
                    Published (visible in the apps)
                  </label>

                  <Button
                    data-testid="content-save"
                    disabled={
                      upsert.isPending ||
                      draft.slug.trim().length === 0 ||
                      draft.title.trim().length === 0 ||
                      draft.bodyMd.trim().length === 0
                    }
                    onClick={save}
                  >
                    {isNew ? 'Create page' : 'Save'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="text-sm text-text-secondary">Select a page to edit.</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Draft {
  slug: string;
  title: string;
  bodyMd: string;
  sortOrder: number;
  isPublished: boolean;
}

function draftOf(page: AdminContentPage): Draft {
  return {
    slug: page.slug,
    title: page.title,
    bodyMd: page.bodyMd,
    sortOrder: page.sortOrder,
    isPublished: page.isPublished,
  };
}

function nextSortOrder(items: AdminContentPage[]): number {
  const max = items.reduce((acc, row) => Math.max(acc, row.sortOrder), 0);
  return max + 10;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
