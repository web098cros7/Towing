/**
 * One message of the driver chat (Figma 22 · Chat with Driver).
 *
 * The screen's own shape. The wire shape is `BookingMessage` in
 * `@towing/api-contracts` (`GET/POST bookings/:id/messages`, `chat:message`), and
 * the driver answers from MiTow Driver's job chat; the REST source maps one to the
 * other.
 */
export type ChatMessage = {
  id: string;
  bookingId: string;
  /** `'driver'` draws an Incoming bubble (left, muted); `'customer'` an Outgoing one (right, dark). */
  sender: 'customer' | 'driver';
  /** Verbatim user text. */
  text: string;
  /** ISO instant. The bubble shows it as "10:08 AM"; the Day pill groups by its local date. */
  sentAt: string;
  /**
   * App-only, never sent: the id of the optimistic copy this message replaced, so its
   * row keeps the same list key and the bubble is not re-mounted when the send lands.
   */
  localId?: string;
};
