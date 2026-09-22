'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@towing/web-ui';

/**
 * W7's zoomable viewer — CSS transform plus wheel, no library.
 *
 * A KYC reviewer's whole job is deciding whether a number on a blurry licence
 * is legible, so the image has to go bigger without the page going anywhere.
 * `transform: scale()` on a contained, scrollable box does that without
 * re-requesting the signed URL (which is short-lived — a re-render must not
 * fetch a fresh one).
 */
export interface DocumentViewerProps {
  open: boolean;
  onClose: () => void;
  src: string;
  title: string;
  /** Shown under the image — a rejection reason, or the version's date. */
  caption?: string | null;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 0.5;

export function DocumentViewer({ open, onClose, src, title, caption }: DocumentViewerProps) {
  const [zoom, setZoom] = useState(1);

  // A reopened viewer must start at 1× — the previous document's zoom is
  // exactly the kind of state that makes an operator think the file is cropped.
  useEffect(() => {
    if (open) setZoom(1);
  }, [open, src]);

  const clamped = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="document-viewer-title"
      className="w-[min(64rem,calc(100vw-2rem))]"
    >
      <DialogHeader>
        <DialogTitle id="document-viewer-title">{title}</DialogTitle>
      </DialogHeader>

      <DialogBody className="p-0">
        {/* Wheel zoom is the fastest path for a mouse; the buttons are what a
            touch or keyboard user has, so both exist. */}
        <div
          className="max-h-[70vh] overflow-auto rounded-md border border-border bg-surface1"
          onWheel={(event) => {
            event.preventDefault();
            setZoom((current) => clamped(current - event.deltaY * 0.002));
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-TTL URL; not a static asset Next can optimize */}
          <img
            src={src}
            alt={title}
            data-testid="document-viewer-image"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            className="block max-w-none transition-transform duration-75"
          />
        </div>
        {caption ? <p className="px-1 pt-2 text-xs text-text-secondary">{caption}</p> : null}
      </DialogBody>

      <DialogFooter>
        <span className="mr-auto text-xs tabular-nums text-text-secondary" data-testid="document-viewer-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom((current) => clamped(current - STEP))}
          disabled={zoom <= MIN_ZOOM}
          data-testid="document-viewer-zoom-out"
        >
          Zoom out
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom((current) => clamped(current + STEP))}
          disabled={zoom >= MAX_ZOOM}
          data-testid="document-viewer-zoom-in"
        >
          Zoom in
        </Button>
        <Button size="sm" onClick={onClose} data-testid="document-viewer-close">
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
