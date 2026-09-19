/**
 * One message of the driver chat (Figma 22 · Chat with Driver).
 *
 * APP-LOCAL, because no contract exists: there is no messages table, endpoint,
 * schema or socket event anywhere in the backend or `@towing/api-contracts`, and
 * the driver app has no chat (22 spec, Data gap 1). When a chat API lands, this
 * type moves into the contracts and the sources below keep their shape.
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
