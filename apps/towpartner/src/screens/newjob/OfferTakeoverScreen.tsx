import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { Star, X } from '@/icons';
import { track } from '@/lib/analytics/analytics';
import {
  useAcceptOffer,
  useCurrentOffer,
  useRejectOffer,
} from '@/features/offers/api/offers.queries';
import { CountdownRing } from '@/features/offers/components/CountdownRing';
import { OfferCard } from '@/features/offers/components/OfferCard';
import { useOfferCountdown } from '@/features/offers/hooks/useOfferCountdown';
import { driverColors } from '@/theme/driverColors';
import { formatPaise } from '@/utils/format';
import type { RootStackParamList } from '@/navigation/types';
import { Pressable, haptics } from '@/motion';

/**
 * §6.3's offer, as a full-screen takeover.
 *
 * A BOTTOM-TAB SCREEN CANNOT DO THIS, which is the whole reason it exists. A
 * driver has twenty seconds, is very likely holding a steering wheel, and the
 * offer arrived while they were looking at something else — or at nothing. The
 * screen has to arrive over whatever is showing, be unmissable, and be decidable
 * at a glance, which is why the net figure and the ring are above everything the
 * Figma card already carries.
 *
 * SOUND IS DELIBERATELY ABSENT. A distinct alert tone needs an audio asset that
 * has to be licensed, and — because Android ignores every change to a
 * notification channel once it exists — a `job-offer-v2` channel to carry it.
 * What ships is haptics plus the ring; the backgrounded case already alerts
 * through Phase 13's high-priority `job-offer-v1` channel at `importance: MAX`
 * with `bypassDnd`, which is the part that actually wakes a phone in Doze.
 * Recorded in `ToBeDoneEhsan.md` rather than faked with a placeholder sound.
 *
 * ⚠ NEVER RUN ON A DEVICE. No dev-client build exists for this app, so the
 * takeover, the haptics and the ring have never been seen move.
 */
export function OfferTakeoverScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const { data: offer } = useCurrentOffer();
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const { secondsLeft, fraction, expired } = useOfferCountdown(offer?.expiresAt);

  /** Set the moment the driver commits, so the auto-dismiss below stands down. */
  const [deciding, setDeciding] = useState(false);
  /** The accept lost a race. Held as its own state — see the effect below. */
  const [lost, setLost] = useState(false);

  /**
   * One tap on arrival, one at five seconds. NOT a repeating buzz: a driver
   * mid-manoeuvre cannot act on it, and a phone that vibrates continuously gets
   * silenced — which would cost them every future offer, not just this one.
   */
  const greeted = useRef(false);
  const warned = useRef(false);

  useEffect(() => {
    if (!offer || greeted.current) return;
    greeted.current = true;
    haptics.success();
  }, [offer]);

  useEffect(() => {
    if (!offer || warned.current || secondsLeft > 5 || secondsLeft <= 0) return;
    warned.current = true;
    haptics.warning();
  }, [offer, secondsLeft]);

  /**
   * Leaves the moment the offer is gone — the countdown reached zero, or a
   * `job:revoked` frame cleared the cache because somebody else accepted.
   *
   * A takeover that lingered on a dead offer would let a driver tap Accept on a
   * booking that has been gone for fifteen seconds and collect a 409 for it.
   */
  useEffect(() => {
    if (deciding) return;
    // `undefined` is "the query has not answered yet" and must not dismiss —
    // only `null`, which is the server saying there is no offer.
    if (offer === undefined) return;
    if (expired || offer === null) navigation.goBack();
  }, [expired, offer, deciding, navigation]);

  /**
   * Losing the race gets a beat on screen before the dismissal.
   *
   * IT NEEDS ITS OWN STATE because the failed accept invalidates the offer
   * query, which resolves to `null` almost immediately — so a message rendered
   * off the offer would flash for a frame and vanish, and the driver would see
   * their tap do nothing at all. Roughly two seconds is long enough to read four
   * words and short enough not to cost them the next offer.
   */
  useEffect(() => {
    if (!lost) return;
    const timer = setTimeout(() => navigation.goBack(), 1_800);
    return () => clearTimeout(timer);
  }, [lost, navigation]);

  const onAccept = useCallback(() => {
    if (!offer || accept.isPending) return;
    setDeciding(true);
    track('offer_accepted', { wave: offer.wave, secondsLeft });
    accept.mutate(offer.bookingId, {
      onSuccess: () => {
        haptics.medium();
        /**
         * `reset`, not `navigate`. Going "back" from a job they now hold would
         * land on a countdown for an offer that no longer exists, and the
         * takeover is not something a driver should be able to swipe back into.
         */
        navigation.reset({ index: 1, routes: [{ name: 'Tabs' }, { name: 'AssignedJob' }] });
      },
      onError: () => {
        // Almost always a 409: another driver got there first. `deciding` stays
        // true so the auto-dismiss does not race the message off the screen.
        haptics.error();
        setLost(true);
      },
    });
  }, [offer, accept, navigation, secondsLeft]);

  const onDecline = useCallback(() => {
    if (!offer) return;
    setDeciding(true);
    track('offer_declined', { wave: offer.wave, secondsLeft });
    reject.mutate({ bookingId: offer.bookingId });
    navigation.goBack();
  }, [offer, reject, navigation, secondsLeft]);

  if (lost) return <RaceLostState />;

  // The auto-dismiss above is already on its way out; rendering nothing for one
  // frame beats rendering a card with no data in it.
  if (!offer) return null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* The three facts a twenty-second decision is made on: how long is
            left, what it pays, and who it is for. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            paddingHorizontal: 20,
            paddingTop: 6,
            paddingBottom: 14,
          }}
        >
          <CountdownRing secondsLeft={secondsLeft} fraction={fraction} />

          <View style={{ flex: 1, gap: 1 }}>
            <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
              New job
            </Text>
            {/*
              THE NET, LARGE. §9.2.2's acceptance criterion, and it is a
              correction rather than an addition: the card used to show one
              unqualified number, which was the GROSS, so a driver was
              over-estimating their earnings by the commission every single time.
            */}
            <Text
              weight="bold"
              tabular
              style={{ fontSize: 30, lineHeight: 36, color: driverColors.online }}
            >
              {formatPaise(offer.earnings.netPaise)}
            </Text>
            <EarningsBreakdown earnings={offer.earnings} />
            {offer.customerRating !== null || offer.customerName !== null ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 3 }}
              >
                {offer.customerRating !== null ? (
                  <>
                    <Star size={13} color={driverColors.amber} strokeWidth={2.4} />
                    <Text tabular style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>
                      {offer.customerRating.toFixed(1)}
                    </Text>
                  </>
                ) : null}
                {offer.customerName ? (
                  <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: INK_SOFT }}>
                    {offer.customerRating !== null ? '· ' : ''}
                    {offer.customerName}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={onDecline}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel="Decline job"
            hitSlop={12}
            style={() => ({ padding: 4, alignSelf: 'flex-start' })}
          >
            <X size={22} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* The designed card, unchanged in shape — it reads real fields now.
              Its own buttons stay live for a driver who scrolled to the note
              before deciding. */}
          <OfferCard
            offer={offer}
            expiresLabel={`${secondsLeft}s`}
            onAccept={onAccept}
            onDecline={onDecline}
          />
        </ScrollView>

        {/*
          A SECOND, PINNED PAIR OF ACTIONS. The card's own buttons sit below a
          note, a vehicle block and a route — far enough down that a driver who
          has not scrolled cannot reach them, and twenty seconds is not enough
          time to go looking.
        */}
        <SafeAreaView edges={['bottom']}>
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 10,
              paddingBottom: 10,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              gap: 8,
            }}
          >
            <Button
              label={
                accept.isPending
                  ? 'Accepting…'
                  : `Accept · ${formatPaise(offer.earnings.netPaise)}`
              }
              fullWidth
              loading={accept.isPending}
              disabled={expired}
              onPress={onAccept}
            />
            <Button label="Decline" variant="ghost" fullWidth height={44} onPress={onDecline} />
          </View>
        </SafeAreaView>
      </SafeAreaView>
    </View>
  );
}

const INK_SOFT = '#4B5563';

/**
 * What a losing accept looks like.
 *
 * NAMED HONESTLY — "another driver got there first", not "something went wrong".
 * A progressive-radius search offers the same booking to three drivers at once
 * on purpose, so losing is an ordinary outcome of the design rather than a
 * malfunction, and a driver who is told it was an error will start distrusting
 * the app for working correctly.
 */
function RaceLostState() {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 40,
        backgroundColor: theme.colors.surface0,
      }}
    >
      <Text weight="medium" align="center" style={{ fontSize: 18, lineHeight: 25 }}>
        Another driver got there first
      </Text>
      <Text color="secondary" align="center" style={{ fontSize: 14, lineHeight: 20 }}>
        We'll send you the next one.
      </Text>
    </View>
  );
}

/**
 * gross → commission → net, spelled out.
 *
 * §9.2.2 asks for it, and the reason is that a deduction a driver cannot explain
 * is a deduction they assume is wrong. The percentage shown is the one LOCKED on
 * the booking at confirm (§3.4), so it is also the rate they will actually be
 * paid at — an admin editing the rate card mid-search cannot move it.
 */
function EarningsBreakdown({
  earnings,
}: {
  earnings: { grossPaise: number; commissionPaise: number; commissionPct: number | null };
}) {
  return (
    <Text tabular style={{ fontSize: 12, lineHeight: 17, color: '#6B7280' }}>
      {formatPaise(earnings.grossPaise)} fare − {formatPaise(earnings.commissionPaise)}
      {earnings.commissionPct === null ? '' : ` (${earnings.commissionPct}%)`} platform fee
    </Text>
  );
}
