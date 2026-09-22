import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorState } from '@towing/ui';
import {
  MiBookingCard,
  MiButton,
  MiScreen,
  MiSegmented,
  MiText,
  mitowLayout,
  noBookingsIllustration,
  type MiBookingCardMedia,
  type MiBookingCardProps,
  type MiSegmentedOption,
  type MiStatusBadgeStatus,
} from '@/design';
import { useBookings } from '@/features/bookings/api/bookings.queries';
import type { Booking } from '@/features/bookings/types';
import { serviceTitle } from '@/features/services/data/serviceTitles';
import { useTabBarSpace } from '@/navigation/TabBar';
import type { RootStackParamList } from '@/navigation/types';
import { areaOf } from '@/screens/booking/tracking/trackingDisplay';
import { formatPaise } from '@/utils/format';

/**
 * Figma 33 · My Bookings (`243:961`) and 34 · My Bookings · Empty (`301:4628`), the Bookings
 * tab root (route `BookingsList`). 34 is this screen's EMPTY STATE, not a second screen.
 *
 * Content `245:1098` is a 393-wide column below the 50 status bar: `Top` (`250:1125`, 21 in,
 * 351 wide, 104 tall — a 46-tall "My Bookings" heading over the 58-below filter) and then the
 * list. Neither frame draws an `AppHeader`, so the screen renders none and scrolls under the
 * status bar; the tab bar is the navigator's own pinned bar (white, 1 px border/subtle top
 * stroke), so nothing here draws one.
 *
 * WHERE THE THREE STATES COME FROM (`useBookings`, whose paging is kept):
 * - LOADING shows the title and filter only, with NO skeleton — neither frame draws one, and
 *   a bar where the design has nothing is a shape it never asked for.
 * - AN ERROR WITH NO CACHED DATA keeps a retry (`ErrorState`, `@towing/ui`).
 * - ZERO BOOKINGS after a successful load is 34, in full.
 * A filter that matches nothing while bookings exist shows nothing under the filter — the same
 * blank as loading, which is what the design draws when it has no cards to show.
 *
 * FINITE SCOPE: only the pages `useBookings` has already fetched are rendered, and nothing
 * asks for the next one, so a customer with more bookings than one page sees the first page.
 * 33's frame gives no pager and draws its six cards as a plain stack, so a "Load more" button
 * would be a control the design never drew. Reported.
 *
 * DATA: every value is a real booking field or a `SlotBar`. Nothing is invented and nothing the
 * design draws is dropped — an unknown service slug (`serviceTitle` returns null) keeps the
 * title's placeholder, as do an unreadable timestamp and a missing route.
 */

/** §10.9's retry copy, unchanged from the screen this replaces. */
const ERROR_TITLE = "Couldn't load your bookings";
const ERROR_BODY = 'Check your connection and try again.';

/**
 * The cards' gap. 33's `Bookings` frame stacks five 106-tall cards at y 0 / 120 / 240 / 360 /
 * 480 — a 120 pitch — but its own instance `245:1109` measures 351 × 106 while the component's
 * contents (12 + header 28 + gap 12 + body 42 + 12) total 106 exactly. The drawn 14 between
 * cards is therefore the one number the file's own geometry cannot corroborate; it is taken as
 * the design's intent and used as-is, since the screenshot reads with a clear gap.
 */
const LIST_GAP = 14;

/** `Top` `250:1125`: the heading box, the filter's offset inside it, and the filter's height. */
const HEADING_HEIGHT = 46;
const FILTER_TOP = 58;
const FILTER_HEIGHT = 46;
/**
 * The content below `Top`. `Bookings` (`245:1108`) and `Empty state` (`301:4931`) both start at
 * y 120 within `Content`, and `Top` ends at 104 — so this is 16, the same gap `blockGap` names,
 * and the empty state's own 103 pt padding sits inside it.
 */
const LIST_TOP = 16;

/** Empty state `301:4931`: 103 top, 16 sides, gap 16. */
const EMPTY_PAD_TOP = 103;
const EMPTY_PAD_SIDE = 16;
const EMPTY_GAP = 16;
/** Illustration `387:18517` as drawn (300.08 × 207) — the widest thing in the 351 column. */
const ILLUSTRATION_WIDTH = 300.08;
const ILLUSTRATION_HEIGHT = 207;
/** Text `301:4934`: 319 wide (351 − 16 each side), gap 6. */
const EMPTY_TEXT_GAP = 6;
/** "Book a Tow Now" `390:18373`: 207 × 54, brand/yellow, radius 14, gap 12. */
const CTA_WIDTH = 207;
const CTA_HEIGHT = 54;

/** The filter's three Segment instances (`245:1102` / `245:1104` / `245:1106`), "All" first. */
type FilterKey = 'all' | 'upcoming' | 'past';

const FILTERS: MiSegmentedOption[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

/**
 * Badge and filter, from §5.1's ten statuses (`jobStatusSchema`).
 *
 * `MiStatusBadge` has three drawn variants, so the mapping is:
 * - `completed` — `completed`, `paid` and `disputed`. A `disputed` trip IS a finished one; the
 *   dispute is its own record and no fourth badge is drawn for it.
 * - `cancelled` — `cancelled` and `no_drivers_found`. Both are trips that did not happen, and
 *   33 draws the red badge for the one with no second failure badge for the other.
 * - `upcoming` — every other status (`searching`, `assigned`, `en_route`, `arrived`,
 *   `in_progress`): a live trip, plus a scheduled one still searching.
 *
 * The filter follows the BADGE rather than the raw status, so the two controls can never
 * disagree on screen: **Upcoming** shows the cards wearing the Upcoming badge, **Past** shows
 * Completed and Cancelled.
 */
function badgeFor(status: Booking['status']): MiStatusBadgeStatus {
  if (status === 'completed' || status === 'paid' || status === 'disputed') return 'completed';
  if (status === 'cancelled' || status === 'no_drivers_found') return 'cancelled';
  return 'upcoming';
}

/** The colour-icon box for a service that has no drawn card of its own. */
const MEDIA_ICON_SIZE = 50;

/**
 * The card's media, per the booked service.
 *
 * - Any TOW draws the 226-vector tow art (`towTruckArtSource`, re-exported by `MiServiceRow`)
 *   in the drawn 64 × 33.832 box, as instances `245:1109`, `245:1160`, `245:1175` and the
 *   `476:18351` leftover all do. That covers `car_tow` and the other tow slugs, which have no
 *   drawn card of their own.
 * - `flat_tyre` and `fuel` draw their own cards' colour icons, as `327:12100` (tyre, 52 wide)
 *   and `245:1175` show.
 * - `battery`, `lockout` and `breakdown` take the colour icon their Home tile draws
 *   (`SERVICE_TILES`, `screens/home/HomeScreen.tsx`), so a service looks like itself on both
 *   screens. Home's fourth tile pairs the 56 px `tow-truck` colour icon with "Tow a Car", but
 *   every drawing of a towed trip in the file uses the ART, so the art wins here.
 *
 * ⚠ 33 HAS A LEFTOVER: its second card `476:18351` is named "Battery Jump Start" but still
 * holds a "Tow Truck" frame and the copy "Tow a Car". That is a stale override in the file
 * rather than a rule, so `battery` takes the battery icon — following the booked service, as
 * asked. Reported.
 *
 * A slug with no mapping (a catalogue row added later) falls back to the generic tow truck, the
 * same instinct `serviceArtwork.ts` has.
 */
function mediaFor(slug: string | null | undefined): MiBookingCardMedia {
  switch (slug) {
    case 'flat_tyre':
      return { kind: 'tyre' };
    case 'fuel':
      return { kind: 'icon', name: 'jerry-can', size: MEDIA_ICON_SIZE };
    case 'battery':
      return { kind: 'icon', name: 'battery', size: MEDIA_ICON_SIZE };
    case 'lockout':
      return { kind: 'icon', name: 'lock', size: MEDIA_ICON_SIZE };
    case 'breakdown':
      return { kind: 'icon', name: 'wrench', size: MEDIA_ICON_SIZE };
    default:
      return { kind: 'tow' };
  }
}

/** A booking as the card's props, keeping its id for the key. */
type CardModel = MiBookingCardProps & { id: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A card's date as 33 draws it: "02 Mar 2025, 04:30 PM" (day and hour zero-padded); null for an unreadable instant. */
function cardDateLabel(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = pad2(d.getDate());
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hour12 = pad2(d.getHours() % 12 || 12);
  const minutes = pad2(d.getMinutes());
  const meridiem = d.getHours() < 12 ? ' AM' : ' PM';
  return `${day} ${month} ${year}, ${hour12}:${minutes}${meridiem}`;
}

/**
 * A booking, as the card's props.
 *
 * The date is `scheduledAt ?? createdAt` through `cardDateLabel` — 33's own "02 Mar 2025, 04:30
 * PM" form, which zero-pads the day and the hour — and `null` for an unreadable instant, so the
 * card keeps its placeholder rather than "NaN". The route joins the two AREAS, the first
 * comma-separated part of each stored label (`areaOf`), as 25 names its drop area, with the
 * design's arrow, " → " (U+2192).
 *
 * The price is the real fare, except on a Cancelled card: 33's "Out of Fuel · Cancelled" draws
 * an em dash there, because the customer was not charged. A future-dated booking shows its
 * locked fare like any other, which is what `245:1160` ("Upcoming", "₹1,200") draws.
 */
function cardFor(booking: Booking): CardModel {
  const status = badgeFor(booking.status);
  const from = areaOf(booking.originLabel);
  const to = areaOf(booking.destinationLabel);
  return {
    id: booking.id,
    status,
    date: cardDateLabel(booking.scheduledAt ?? booking.createdAt),
    title: serviceTitle(booking.serviceSlug),
    route: from && to ? `${from} \u2192 ${to}` : null,
    price: status === 'cancelled' ? '\u2014' : formatPaise(booking.farePaise),
    media: mediaFor(booking.serviceSlug),
  };
}

export function BookingsScreen() {
  const tabBarSpace = useTabBarSpace();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { items, isPending, isError, refetch } = useBookings();

  const [filter, setFilter] = useState<FilterKey>('all');

  const openBooking = useCallback(
    (bookingId: string) => navigation.navigate('BookingDetails', { bookingId }),
    [navigation],
  );

  /** "Book a Tow Now": 10 Enter Location, Home's own book-a-tow destination. */
  const bookTow = useCallback(() => navigation.navigate('BookLocation'), [navigation]);

  const cards = useMemo(() => {
    const shown =
      filter === 'all'
        ? items
        : items.filter((booking) => {
            const upcoming = badgeFor(booking.status) === 'upcoming';
            return filter === 'upcoming' ? upcoming : !upcoming;
          });
    return shown.map(cardFor);
  }, [filter, items]);

  /*
   * The content column. `isError` with cached rows still shows the rows: a list the customer
   * already has beats an apology for a refresh that failed.
   */
  let body: React.ReactNode = null;
  if (isError && items.length === 0) {
    body = (
      <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
        <ErrorState title={ERROR_TITLE} body={ERROR_BODY} onRetry={() => void refetch()} />
      </View>
    );
  } else if (!isPending && items.length === 0) {
    body = <EmptyBookings onBook={bookTow} />;
  } else if (cards.length > 0) {
    body = (
      <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
        <View style={{ gap: LIST_GAP }}>
          {cards.map((card) => (
            <MiBookingCard
              key={card.id}
              status={card.status}
              date={card.date}
              title={card.title}
              route={card.route}
              price={card.price}
              media={card.media}
              onPress={() => openBooking(card.id)}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <MiScreen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          // Figma's 49 is measured from the top of the 852 frame, status bar included, so the
          // top offset is the larger of the layout constant and the device's status-bar inset —
          // the same rule `screens/booking/BookTowScreen.tsx` uses.
          paddingTop: Math.max(mitowLayout.contentTop, insets.top),
          paddingBottom: tabBarSpace,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
          <View style={{ height: HEADING_HEIGHT, justifyContent: 'center' }}>
            <MiText variant="display27" numberOfLines={1} accessibilityRole="header">
              My Bookings
            </MiText>
          </View>
          <View style={{ marginTop: FILTER_TOP - HEADING_HEIGHT }}>
            <MiSegmented
              options={FILTERS}
              value={filter}
              onChange={(key) => setFilter(key as FilterKey)}
              height={FILTER_HEIGHT}
            />
          </View>
        </View>

        {/* The design's 16 between `Top` and whatever it introduces (see `LIST_TOP`). */}
        <View style={{ paddingTop: LIST_TOP }}>{body}</View>
      </ScrollView>
    </MiScreen>
  );
}

/**
 * 34 · My Bookings · Empty as instanced on this screen: the `Empty state` `301:4931` writes
 * `pt` 103, `px` 16, gap 16, items centred, in the same 351 content column the cards use.
 *
 * The illustration (`387:18517`) is the SVG export (`noBookingsIllustration`) in its drawn
 * 300.08 × 207 box, rendered through `SvgXml` exactly as `MiLineIcon` renders the icon set.
 *
 * ⚠ THE PALE DISC BEHIND THE CLIPBOARD IS IN THE ILLUSTRATION, not a layer of this screen. The
 * `Illustration · No bookings yet` group carries its own pale circle (fill #F8FAFB) alongside
 * the clouds, the city and the yellow sparks, all inside the one 300.08 × 207 box — which is why
 * this screen draws no second shape behind the art. Verified by rendering the module's own SVG
 * string: the disc is there, centred on the clipboard, and clipped away below y ≈ 160.
 */
function EmptyBookings({ onBook }: { onBook: () => void }) {
  return (
    <View
      style={{
        paddingTop: EMPTY_PAD_TOP,
        paddingHorizontal: EMPTY_PAD_SIDE,
        gap: EMPTY_GAP,
        alignItems: 'center',
      }}
    >
      <SvgXml
        xml={noBookingsIllustration}
        width={ILLUSTRATION_WIDTH}
        height={ILLUSTRATION_HEIGHT}
      />

      {/* Text `301:4934`: gap 6, centred; the body wraps to its drawn two lines in 319. */}
      <View style={{ gap: EMPTY_TEXT_GAP, alignItems: 'center' }}>
        <MiText variant="title23" align="center">
          No Bookings Yet
        </MiText>
        <MiText variant="bodyL155" color="secondary" align="center">
          {"You haven't booked any towing services yet. When you do, they'll appear here."}
        </MiText>
      </View>

      {/*
        "Book a Tow Now" `390:18373`: a 207 × 54 brand/yellow button, radius 14, gap 12 — the
        drawn label then icon/arrow-right at 24. `MiButton` tone="yellow" is exactly that fill,
        radius and gap, and its label is Strong 16.
      */}
      <View style={{ width: CTA_WIDTH }}>
        <MiButton
          tone="yellow"
          label="Book a Tow Now"
          trailingIcon="arrow-right"
          height={CTA_HEIGHT}
          onPress={onBook}
        />
      </View>
    </View>
  );
}
