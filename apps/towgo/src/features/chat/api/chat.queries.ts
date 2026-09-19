import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage } from '../types';
import { chatDataSource } from './chatDataSource';
import { chatKeys } from './chat.keys';

/**
 * One booking's conversation (Figma 22).
 *
 * NO POLLING. The mock never receives anything it did not send, so there is
 * nothing to poll for; real-time delivery of driver messages needs the chat API
 * and a socket event that do not exist yet (22 spec, Data gap 1).
 */
export function useChatMessages(bookingId: string) {
  return useQuery({
    queryKey: chatKeys.messages(bookingId),
    queryFn: () => chatDataSource.list(bookingId),
  });
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
