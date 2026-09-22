import { create } from 'zustand';

/**
 * Unread chat markers, keyed by booking id.
 *
 * WHY A STORE AND NOT A QUERY. The unread count is a fact about the driver's
 * attention, not about the server — the backend has no notion of "the driver
 * has seen this message", and inventing one would mean a round trip per
 * message. The socket frame is the only signal, and it arrives while the chat
 * screen may not be mounted, so the marker has to live somewhere that outlives
 * the screen. Zustand is that somewhere.
 *
 * `openBookingId` is the "is the driver looking at this chat right now" flag.
 * A frame for the OPEN chat must not increment the badge — the driver is
 * reading the message as it lands, and a badge that appears and disappears on
 * the same screen is noise. The store ignores the mark in that case rather
 * than the caller checking, so the socket handler stays a one-liner.
 */
type ChatUnreadState = {
  unread: Record<string, number>;
  openBookingId: string | null;
  markUnread: (bookingId: string) => void;
  clear: (bookingId: string) => void;
  setOpen: (bookingId: string | null) => void;
};

export const useChatUnreadStore = create<ChatUnreadState>((set, get) => ({
  unread: {},
  openBookingId: null,

  markUnread: (bookingId) => {
    if (get().openBookingId === bookingId) return;
    set((state) => ({
      unread: { ...state.unread, [bookingId]: (state.unread[bookingId] ?? 0) + 1 },
    }));
  },

  clear: (bookingId) => {
    set((state) => {
      if (!(bookingId in state.unread)) return state;
      const next = { ...state.unread };
      delete next[bookingId];
      return { unread: next };
    });
  },

  setOpen: (bookingId) => {
    set({ openBookingId: bookingId });
  },
}));

/**
 * Non-React entry point for the socket frame handler, which runs outside the
 * component tree. `useChatUnreadStore.getState()` is the same store the hook
 * reads, so a mark from here re-renders every subscriber.
 */
export function markChatUnread(bookingId: string): void {
  useChatUnreadStore.getState().markUnread(bookingId);
}
