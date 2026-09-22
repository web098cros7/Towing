import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '../types';
import { env } from '@/lib/env';
import { onBookingChatMessage } from '@/lib/realtime/bookingSocket';
import { chatDataSource } from './chatDataSource';
import { chatKeys } from './chat.keys';
import { toChatMessage } from './chatRestSource';

/**
 * One booking's conversation (Figma 22).
 *
 * In live mode the `/customer` socket is the fast path: `chat:message` pushes
 * arrive for both sides and are merged into this cache below. The 5 s poll is
 * the fallback for a dropped socket, and it also marks the driver's messages
 * read server-side. In mock mode there is nothing to poll for — the mock never
 * receives anything it did not send — so polling is off.
 */
export function useChatMessages(bookingId: string) {
  const queryClient = useQueryClient();
  const key = chatKeys.messages(bookingId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => chatDataSource.list(bookingId),
    refetchInterval: env.useMocks ? false : 5_000,
  });

  useEffect(() => {
    if (env.useMocks) return;
    return onBookingChatMessage((message) => {
      if (message.bookingId !== bookingId) return;
      const incoming = toChatMessage(message);
      queryClient.setQueryData<ChatMessage[]>(chatKeys.messages(bookingId), (previous = []) => {
        if (previous.some((m) => m.id === incoming.id)) return previous;
        // Replace the optimistic local copy of the customer's own message.
        const localIndex = previous.findIndex(
          (m) =>
            m.id.startsWith('local-') &&
            m.sender === 'customer' &&
            m.text === incoming.text,
        );
        if (localIndex !== -1) {
          const next = previous.slice();
          next[localIndex] = { ...incoming, localId: previous[localIndex].id };
          return next;
        }
        return [...previous, incoming];
      });
    });
  }, [bookingId, queryClient]);

  return query;
}

let localCount = 0;

/**
 * Sends one customer message, OPTIMISTICALLY: the Outgoing bubble is appended the
 * moment Send (or a quick reply) is tapped, stamped with the current time and
 * identical to a sent one, because 22 draws no sending state (no spinner, clock
 * or tick). When the source answers, the local copy is swapped for the stored one.
 *
 * A FAILED SEND KEEPS ITS BUBBLE and shows nothing: no failed or retry state is
 * designed (22 spec, States and Data gap 9). `retry: false`, like `useShareTrip`:
 * a message is a user intent, not a background read to replay.
 *
 * While the first read is still loading there is no list to append to, and
 * cancelling that read would leave the drawn conversation empty until the
 * screen is re-opened. So the bubble then waits for the send to land (300 ms in
 * mock mode) and is added with the list.
 */
export function useSendChatMessage(bookingId: string) {
  const queryClient = useQueryClient();
  const key = chatKeys.messages(bookingId);

  return useMutation({
    mutationFn: (text: string) => chatDataSource.send(bookingId, text),
    retry: false,
    onMutate: async (text: string) => {
      if (!queryClient.getQueryData<ChatMessage[]>(key)) return undefined;

      // An in-flight refetch would land without this message and wipe it.
      await queryClient.cancelQueries({ queryKey: key });

      localCount += 1;
      // Unique across launches too, so a row key can never repeat one still on screen.
      const localId = `local-${Date.now()}-${localCount}`;
      queryClient.setQueryData<ChatMessage[]>(key, (previous) => [
        ...(previous ?? []),
        { id: localId, bookingId, sender: 'customer', text, sentAt: new Date().toISOString() },
      ]);
      return { localId };
    },
    onSuccess: (sent, _text, context) => {
      const current = queryClient.getQueryData<ChatMessage[]>(key);
      if (!current) {
        void queryClient.invalidateQueries({ queryKey: key });
        return;
      }
      queryClient.setQueryData<ChatMessage[]>(key, (previous = []) => {
        if (context && previous.some((m) => m.id === context.localId)) {
          const stored: ChatMessage = { ...sent, localId: context.localId };
          return previous.map((m) => (m.id === context.localId ? stored : m));
        }
        return previous.some((m) => m.id === sent.id) ? previous : [...previous, sent];
      });
    },
  });
}
