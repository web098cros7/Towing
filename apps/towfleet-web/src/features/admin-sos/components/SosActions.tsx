'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Textarea,
} from '@towing/web-ui';
import type { AdminSosDetail } from '@towing/api-contracts';
import { useToast } from '@/components/admin/ToastProvider';
import {
  useAcknowledgeSos,
  useAddSosNote,
  useBroadcastSos,
  useContactSos,
  useResolveSos,
} from '../api/adminSos.mutations';

/**
 * The acknowledge → contact → resolve workflow (§13), plus the note and the
 * G12 broadcast.
 *
 * EVERY BUTTON IS GATED ON STATE, and the backend enforces the same gates:
 * acknowledge only from `triggered`, resolve only while open. The broadcast
 * needs the word typed — it reveals a customer's location to drivers who are
 * not on the job, and that should cost a deliberate action, not a click
 * beside the note field.
 */
export function SosActions({ detail }: { detail: AdminSosDetail }): React.ReactNode {
  const toast = useToast();
  const acknowledge = useAcknowledgeSos(detail.id);
  const contact = useContactSos(detail.id);
  const resolve = useResolveSos(detail.id);
  const addNote = useAddSosNote(detail.id);
  const broadcast = useBroadcastSos(detail.id);

  const [contactId, setContactId] = useState('');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [radiusKm, setRadiusKm] = useState('3');
  const [broadcastConfirm, setBroadcastConfirm] = useState('');

  const closed = detail.status === 'cancelled';
  const callResult = contact.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="sos-acknowledge"
              disabled={detail.status !== 'triggered' || acknowledge.isPending}
              onClick={() =>
                acknowledge.mutate(undefined, {
                  onSuccess: () => toast('Alert acknowledged', 'success'),
                  onError: (error) => toast(messageOf(error), 'error'),
                })
              }
            >
              {detail.status === 'acknowledged' ? 'Acknowledged' : 'Acknowledge'}
            </Button>
            <span className="text-xs text-text-secondary">
              {detail.ackSeconds !== null
                ? `Acknowledged in ${detail.ackSeconds}s`
                : 'Nobody has acknowledged this alert yet'}
            </span>
          </div>

          <div className="space-y-2 rounded-card border border-border p-3">
            <div className="text-sm font-semibold">Contact</div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-64"
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
                data-testid="sos-contact-select"
                aria-label="Contact to call"
                disabled={detail.contacts.length === 0}
              >
                <option value="">
                  {detail.contacts.length === 0
                    ? 'No emergency contacts on file'
                    : 'First contact on file'}
                </option>
                {detail.contacts.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.relation ? ` (${row.relation})` : ''} · {row.phone}
                  </option>
                ))}
              </Select>
              <Button
                data-testid="sos-contact"
                variant="secondary"
                disabled={closed || contact.isPending}
                onClick={() =>
                  contact.mutate(
                    { contactId: contactId || undefined },
                    {
                      onSuccess: () => toast('Call opened', 'info'),
                      onError: (error) => toast(messageOf(error), 'error'),
                    },
                  )
                }
              >
                Open call
              </Button>
            </div>
            {callResult ? (
              <div className="text-sm" data-testid="sos-contact-result">
                {callResult.dialNumber ? (
                  <>
                    Dial <span className="font-mono font-semibold">{callResult.dialNumber}</span>
                    {callResult.masked ? (
                      <span className="ml-2 text-xs text-success">masked</span>
                    ) : (
                      <span
                        className="ml-2 text-xs text-warning"
                        data-testid="sos-contact-unmasked"
                      >
                        NOT masked — Exotel has no account yet, so this is the real number
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-warning">No number available for this contact.</span>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Timeline note</div>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did the caller say? Who was reached?"
              data-testid="sos-note"
              rows={2}
            />
            <Button
              variant="secondary"
              data-testid="sos-note-submit"
              disabled={note.trim().length < 2 || addNote.isPending}
              onClick={() =>
                addNote.mutate(
                  { note: note.trim() },
                  {
                    onSuccess: () => {
                      setNote('');
                      toast('Note added to the timeline', 'success');
                    },
                    onError: (error) => toast(messageOf(error), 'error'),
                  },
                )
              }
            >
              Add note
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Resolve</div>
            <Textarea
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="How did this end? (required — lands on the timeline)"
              data-testid="sos-resolution"
              rows={2}
            />
            <Button
              data-testid="sos-resolve"
              disabled={
                resolution.trim().length < 4 ||
                closed ||
                detail.status === 'resolved' ||
                resolve.isPending
              }
              onClick={() =>
                resolve.mutate(
                  { resolution: resolution.trim() },
                  {
                    onSuccess: () => {
                      setResolution('');
                      toast('Alert resolved', 'success');
                    },
                    onError: (error) => toast(messageOf(error), 'error'),
                  },
                )
              }
            >
              Resolve incident
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcast to nearby drivers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-secondary">
            G12: never automatic. This reveals the location to drivers who are not on the job — type
            BROADCAST to confirm.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-24"
              inputMode="decimal"
              value={radiusKm}
              onChange={(event) => setRadiusKm(event.target.value)}
              aria-label="Radius in km"
              data-testid="sos-broadcast-radius"
            />
            <span className="text-sm text-text-secondary">km radius</span>
            <Input
              className="w-40"
              value={broadcastConfirm}
              onChange={(event) => setBroadcastConfirm(event.target.value)}
              placeholder="BROADCAST"
              aria-label="Type BROADCAST to confirm"
              data-testid="sos-broadcast-confirm"
            />
            <Button
              variant="secondary"
              data-testid="sos-broadcast"
              disabled={closed || broadcastConfirm !== 'BROADCAST' || broadcast.isPending}
              onClick={() =>
                broadcast.mutate(
                  { radiusKm: Number(radiusKm) || undefined },
                  {
                    onSuccess: (result) => {
                      setBroadcastConfirm('');
                      toast(`Broadcast sent to ${result.notified} nearby driver(s)`, 'success');
                    },
                    onError: (error) => toast(messageOf(error), 'error'),
                  },
                )
              }
            >
              Broadcast
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}
