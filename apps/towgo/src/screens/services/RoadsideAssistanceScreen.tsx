import React, { useCallback } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mitowColors, mitowLayout, mitowRadii, MiNavBar, MiScreen, MiText } from '@/design';
import { Available247Banner } from '@/components/Available247Banner';
import { useBookingStore } from '@/features/booking/store/bookingStore';
import { track } from '@/lib/analytics/analytics';
import type { RootStackParamList } from '@/navigation/types';
import { RoadsideServiceCard } from './roadside/RoadsideServiceCard';
import { ROADSIDE_SERVICES } from './roadside/roadsideServices.data';

const heroArt = require('@/assets/illustrations/roadside-help.png');

/** Grid gap (row and column) in "Services" `259:1627`. */
const GRID_GAP = 10;

/**
 * Figma 09 · Roadside Assistance (`258:1531`). A pushed screen with no tab bar:
 * Nav Bar Trailing=Help, the cream hero, "Our Services" (3 × 2 Service Cards)
 * and the non-interactive "Available 24/7" banner, stacked 16 apart at a 21
 * side margin from the top safe-area inset (Figma y 49).
 *
 * The nav bar is the column's first block. It is held above the scroll view so
 * that, on a phone too short for the 707pt column, the back chevron and Help
 * chip stay on screen while the rest scrolls; at rest the layout is the frame's.
 * The only space added below the banner is the OS bottom inset, so the banner
 * clears the gesture bar at the end of a scroll.
 *
 * `variant="tab"` is the same screen as the Services tab (owner decision, 24 Sep
 * 2026: Services replaces Support in the tab bar, since Help already opens
 * Support): titled "Services", no back chevron, and the tab bar below it takes
 * the bottom inset.
 */
/** The Services tab: the services screen as a tab scene. */
export function ServicesTabScreen() {
  return <RoadsideAssistanceScreen variant="tab" />;
}

export function RoadsideAssistanceScreen({ variant = 'pushed' }: { variant?: 'pushed' | 'tab' }) {
  const isTab = variant === 'tab';
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const setServiceSlug = useBookingStore((s) => s.setServiceSlug);

  const openService = useCallback(
    (slug: string) => {
      setServiceSlug(slug);
      track('service_selected', { slug });
      navigation.navigate('BookLocation');
    },
    [navigation, setServiceSlug],
  );

  const rows = [0, 2, 4].map((start) => ROADSIDE_SERVICES.slice(start, start + 2));

  return (
    <MiScreen>
      <StatusBar style="dark" />

      {/* 1. Nav bar `259:1606` (Trailing=Help): 351×46 at content y 0. */}
      <View style={{ paddingHorizontal: mitowLayout.sideMargin }}>
        <MiNavBar
          title={isTab ? 'Services' : 'Roadside Assistance'}
          trailing="help"
          onBack={isTab ? undefined : () => navigation.goBack()}
          onHelp={() => navigation.navigate('Support')}
        />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: mitowLayout.blockGap,
          paddingHorizontal: mitowLayout.sideMargin,
          paddingBottom: isTab ? mitowLayout.blockGap : insets.bottom,
          gap: mitowLayout.blockGap,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Hero />

        {/* 3–4. "Our services" `259:1625`: heading, 12, then the 3 × 2 grid. */}
        <View style={{ gap: mitowLayout.headingGap }}>
          <MiText variant="heading18" numberOfLines={1}>
            Our Services
          </MiText>

          <View style={{ gap: GRID_GAP }}>
            {rows.map((row) => (
              <View
                key={row[0]!.slug}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: GRID_GAP }}
              >
                {row.map((service) => (
                  <RoadsideServiceCard
                    key={service.slug}
                    service={service}
                    onPress={() => openService(service.slug)}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* 5. "Available 24/7" banner `259:1738`. */}
        <Available247Banner />
      </ScrollView>
    </MiScreen>
  );
}

/**
 * 2. Hero card `259:1619`: 139 tall, brand/yellow-soft, radius 16, clipped, no
 * border or shadow, absolutely positioned children.
 */
function Hero() {
  return (
    <View
      style={{
        height: 139,
        borderRadius: mitowRadii.card,
        backgroundColor: mitowColors.brandYellowSoft,
        overflow: 'hidden',
      }}
    >
      {/*
        2c. ILL-02 (`403:19242`): 91×94, 14 from the card's right edge and 22.5
        from its top and bottom, radius 12, cover crop. It is anchored to the
        RIGHT edge because the card's width follows the phone (351 only at 393).

        Figma composites it with multiply over the cream card. React Native has
        no blend modes, so the multiply is baked into the asset, and the image is
        drawn BENEATH the copy: on a phone narrower than 393, where the title's
        tail can reach the image's plain left margin, dark text stays on top, as
        it would under a multiply layer.
      */}
      <View
        style={{
          position: 'absolute',
          right: 14,
          top: 22.5,
          width: 91,
          height: 94,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <Image
          source={heroArt}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
          accessibilityIgnoresInvertColors
          accessibilityLabel="A roadside mechanic beside a car"
        />
      </View>

      {/*
        2b. Title: Figma `top: calc(50% - 28px)`, i.e. the two-line block is
        centred on the card's middle (top 41.5 at 393). 2a. The overline sits
        directly on top of it with no gap (top 25.5 at 393).
      */}
      <View style={{ position: 'absolute', left: 16, top: 0, bottom: 0, justifyContent: 'center' }}>
        <View>
          <MiText
            variant="overline12"
            color="secondary"
            numberOfLines={1}
            style={{ position: 'absolute', left: 0, bottom: '100%' }}
          >
            ANYTIME. ANYWHERE.
          </MiText>
          <MiText variant="title23">{"We've got you\ncovered on the road."}</MiText>
        </View>
      </View>
    </View>
  );
}
