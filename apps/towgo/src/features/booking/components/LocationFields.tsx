import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useTheme } from '@towing/theme';
import { usePressablePrimitive } from '@towing/ui';
import { mitowColors, mitowRadii, mitowShadows, mitowType, MiMapButton, MiText } from '@/design';
import { PinHead } from './book-a-tow/RoutePin';

export type LocationField = 'pickup' | 'drop';

/** Figma stroke of the Locations card (289:2209): 1.2 border/subtle. */
const CARD_BORDER = 1.2;
/**
 * Figma padding 14 is measured from the OUTER edge (the stroke takes no layout
 * space there). RN borders do, so the padding is 14 - 1.2.
 */
const CARD_PADDING = 14 - CARD_BORDER;
/** Row height (289:2210 / 289:2220). */
const ROW_HEIGHT = 42;
/** Marker box, text column offset = 26 + gap 14. */
const MARKER = 26;
const ROW_GAP = 14;

const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** MiTow/Body M 15 for the editable value, scaled like MiText. */
function useValueStyle(): TextStyle {
  const theme = useTheme();
  const t = mitowType.bodyM15;
  const r = theme.scaleRatio;
  const lineHeight = r === 1 ? t.lineHeight : roundHalf(t.lineHeight * r);
  return {
    height: lineHeight,
    fontFamily: theme.fonts[t.weight],
    fontSize: r === 1 ? t.fontSize : roundHalf(t.fontSize * r),
    lineHeight,
    letterSpacing: t.letterSpacing,
    color: mitowColors.textPrimary,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  };
}

/**
 * Row marker in the 26 box: the green pickup / red drop pin head the maps use
 * (Book a Tow, Pick on Map), so a field and its pin on the map read as one thing
 * (owner, 25 Sep 2026; Figma 289:2211 draws a grey disc and a black pin).
 */
function FieldMarker({ kind }: { kind: LocationField }) {
  return (
    <View style={{ width: MARKER, height: MARKER, alignItems: 'center', justifyContent: 'center' }}>
      <PinHead kind={kind} size={20} />
    </View>
  );
}

type RowProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  inputRef: React.RefObject<TextInput | null>;
  returnKeyType: 'next' | 'done';
  onSubmitEditing?: () => void;
  marker: React.ReactNode;
  trailing: React.ReactNode;
};

/**
 * One location row: marker 26, gap 14, text column (label Body S 14 / value
 * Body M 15, gap 3), 40 round button.
 *
 * At rest the value is plain single-line text, exactly as drawn, ending in an
 * ellipsis if an address is wider than the 229 column (the design does not
 * settle overflow). The TextInput under it only shows its own text while the
 * customer is typing.
 */
function LocationRow({
  label,
  value,
  placeholder,
  onChangeText,
  onFocus,
  onBlur,
  inputRef,
  returnKeyType,
  onSubmitEditing,
  marker,
  trailing,
}: RowProps) {
  const Pressable = usePressablePrimitive();
  const valueStyle = useValueStyle();
  const [focused, setFocused] = useState(false);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ROW_GAP, height: ROW_HEIGHT }}>
      {marker}
      {/*
        Tapping the label focuses the value. A text field does not shrink when
        tapped, so there is no press scale; the caret, the keyboard and a
        selection haptic are the feedback.
      */}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        pressScale={1}
        haptic="selection"
        accessible={false}
        // `minWidth: 0` + clipping: a long address never pushes into the button
        // or spills over the row below (owner, 24 Sep 2026).
        style={{ flex: 1, minWidth: 0, gap: 3, overflow: 'hidden' }}
      >
        <MiText variant="bodyS14" color="secondary" numberOfLines={1}>
          {label}
        </MiText>
        <View style={{ height: valueStyle.height, overflow: 'hidden' }}>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            onFocus={() => {
              setFocused(true);
              onFocus();
            }}
            onBlur={() => {
              setFocused(false);
              onBlur();
            }}
            placeholder={focused ? placeholder : undefined}
            placeholderTextColor={mitowColors.textPlaceholder}
            // Hidden at rest with opacity, not a transparent colour: Android keeps
            // drawing the text under the overlay when only its colour changes
            // (the two addresses overlapped on device, 25 Sep 2026).
            style={[valueStyle, focused ? null : { opacity: 0 }]}
            selectionColor={mitowColors.brandYellow}
            cursorColor={mitowColors.textPrimary}
            maxFontSizeMultiplier={1.2}
            autoCorrect={false}
            // One line that scrolls sideways while typing, never a wrap.
            multiline={false}
            numberOfLines={1}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            accessibilityLabel={label}
          />
          {focused ? null : (
            <View
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
            >
              <MiText
                variant="bodyM15"
                color={value ? 'primary' : 'placeholder'}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {value || placeholder || ''}
              </MiText>
            </View>
          )}
        </View>
      </Pressable>
      {trailing}
    </View>
  );
}

/**
 * Figma 10 Locations card (289:2209): pickup row, inset divider, drop row, and
 * the dashed connector between the two markers.
 *
 * Presentational: the screen owns what each value shows (the booking's place,
 * or the customer's text while they type) and what a finished edit does. The
 * pickup has no placeholder (none is drawn); the drop's empty state is the
 * drawn "Where should we tow it?".
 */
export function LocationFields({
  pickupInputRef,
  dropInputRef,
  pickupText,
  dropText,
  onChangeText,
  onFocusField,
  onBlurField,
  onLocate,
  onSwap,
  locating = false,
}: {
  pickupInputRef: React.RefObject<TextInput | null>;
  dropInputRef: React.RefObject<TextInput | null>;
  pickupText: string;
  dropText: string;
  onChangeText: (field: LocationField, text: string) => void;
  onFocusField: (field: LocationField) => void;
  /** Editing ended (keyboard Done / Next, or focus moved away). */
  onBlurField: (field: LocationField) => void;
  onLocate: () => void;
  onSwap: () => void;
  locating?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: mitowColors.surfacePage,
        borderWidth: CARD_BORDER,
        borderColor: mitowColors.borderSubtle,
        borderRadius: mitowRadii.card,
        padding: CARD_PADDING,
        gap: 12,
        ...mitowShadows.card,
      }}
    >
      <LocationRow
        label="Pickup Location"
        value={pickupText}
        // Not drawn in Figma (the pickup is always filled there): while the
        // location is found, say so; with none, ask.
        placeholder={locating ? 'Finding your location…' : 'Where should we pick you up?'}
        onChangeText={(text) => onChangeText('pickup', text)}
        onFocus={() => onFocusField('pickup')}
        onBlur={() => onBlurField('pickup')}
        inputRef={pickupInputRef}
        returnKeyType="next"
        onSubmitEditing={() => dropInputRef.current?.focus()}
        marker={<FieldMarker kind="pickup" />}
        trailing={
          <MiMapButton
            icon="locate"
            size={40}
            iconSize={24}
            disabled={locating}
            onPress={onLocate}
            accessibilityLabel="Use my current location as pickup"
          />
        }
      />

      {/* Divider 289:2218: 1px border/subtle, left padding 40 */}
      <View
        style={{
          height: 1,
          marginLeft: MARKER + ROW_GAP,
          backgroundColor: mitowColors.borderSubtle,
        }}
      />

      <LocationRow
        label="Drop Location"
        value={dropText}
        placeholder="Where should we tow it?"
        onChangeText={(text) => onChangeText('drop', text)}
        onFocus={() => onFocusField('drop')}
        onBlur={() => onBlurField('drop')}
        inputRef={dropInputRef}
        returnKeyType="done"
        marker={<FieldMarker kind="drop" />}
        trailing={
          <MiMapButton
            colorIcon="swap"
            size={40}
            iconSize={24}
            onPress={onSwap}
            accessibilityLabel="Swap pickup and drop"
          />
        }
      />

      {/*
        Connector 289:2226: a 2×48 box at card (26, 43) from the OUTER edge;
        absolute children are placed inside the border, hence the -1.2. A dashed
        1.5 #CCD2DA line from y 1 to 47, dash 3 / gap 3, round caps. Last child,
        so it draws above the markers as in Figma.
      */}
      <Svg
        pointerEvents="none"
        width={2}
        height={48}
        style={{ position: 'absolute', left: 26 - CARD_BORDER, top: 43 - CARD_BORDER }}
      >
        <Line
          x1={1}
          y1={1}
          x2={1}
          y2={47}
          stroke={mitowColors.borderHandle}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
