import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { MiPill } from '@/design';
import { useBookingStore } from '../store/bookingStore';
import { SchedulePickerSheet } from './SchedulePickerSheet';
import { ContactSheet } from './BookingExtrasSheets';
import { formatClock, formatShortDay } from './enter-location/format';

/**
 * Figma 10 Pills row (289:2196): "Pickup now" and "For me", gap 8. They open
 * sheet 11 (Schedule a Tow) and sheet 12 (Who's the Tow For).
 *
 * The labels are the drawn copy and do not change after a choice: the design
 * draws no label for a scheduled time or another contact. The current choice is
 * still announced to screen readers through the hint, and each sheet shows it
 * as its selected row.
 */
export function BookingPills() {
  const scheduledAt = useBookingStore((s) => s.scheduledAt);
  const setScheduledAt = useBookingStore((s) => s.setScheduledAt);
  const contact = useBookingStore((s) => s.contact);
  const setContact = useBookingStore((s) => s.setContact);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const openSchedule = useCallback(() => setScheduleOpen(true), []);
  const closeSchedule = useCallback(() => setScheduleOpen(false), []);
  const openContact = useCallback(() => setContactOpen(true), []);
  const closeContact = useCallback(() => setContactOpen(false), []);

  const scheduledHint = scheduledAt
    ? `Scheduled for ${formatShortDay(new Date(scheduledAt))}, ${formatClock(new Date(scheduledAt))}`
    : undefined;
  const contactHint = contact ? `Booked for ${contact.name}` : undefined;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <MiPill
        icon="clock"
        label="Pickup now"
        onPress={openSchedule}
        accessibilityHint={scheduledHint}
      />
      <MiPill icon="user" label="For me" onPress={openContact} accessibilityHint={contactHint} />

      <SchedulePickerSheet
        visible={scheduleOpen}
        scheduledAt={scheduledAt}
        onSelect={setScheduledAt}
        onClose={closeSchedule}
      />
      <ContactSheet
        visible={contactOpen}
        contact={contact}
        onSave={setContact}
        onClose={closeContact}
      />
    </View>
  );
}
