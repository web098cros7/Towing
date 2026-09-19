import React from 'react';
import { View } from 'react-native';
import { mitowColors, mitowRadii, mitowShadows, MiColorIcon, type MiColorIconName } from '@/design';
import { ExactText } from './ExactText';

/** Menu card 287:1950 geometry (no tokens). */
const CARD_BORDER = 1.2; // border/subtle, inside, counts toward layout
const CARD_PAD_VERTICAL = 4;
/** Menu Row 238:520 as instanced here (Show chevron / value / toggle all off). */
const ROW_PAD_VERTICAL = 8;
const ROW_PAD_LEFT = 14;
const ROW_PAD_RIGHT = 10;
const ROW_GAP = 14;
const ICON_SIZE = 34;
const TEXT_GAP = 1;
/** Divider frames 287:1967 / 287:1985: padding-left 62, line runs to the inner right edge. */
const DIVIDER_INSET = 62;

export type UsageRow = {
  icon: MiColorIconName;
  title: string;
  subtitle: string;
};

/**
 * E4b "What we use" menu card (287:1950): white, 1.2 border/subtle, radius 16,
 * Elevation/Card, padding 4 top/bottom, three non-interactive Menu Rows with
 * 1px dividers between them. Built locally so the row copy uses the exact Figma
 * type metrics (see `ExactText`); `MiMenuRow` scales its text.
 */
export function UsageCard({ rows }: { rows: readonly UsageRow[] }) {
  return (
    <View
      style={{
        backgroundColor: mitowColors.surfacePage,
        borderWidth: CARD_BORDER,
        borderColor: mitowColors.borderSubtle,
        borderRadius: mitowRadii.card,
        paddingVertical: CARD_PAD_VERTICAL,
        ...mitowShadows.card,
      }}
    >
      {rows.map((row, i) => (
        <React.Fragment key={row.title}>
          {i > 0 ? (
            <View
              style={{
                height: 1,
                marginLeft: DIVIDER_INSET,
                backgroundColor: mitowColors.borderSubtle,
              }}
            />
          ) : null}
          <View
            accessible
            accessibilityLabel={`${row.title}. ${row.subtitle}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: ROW_GAP,
              paddingTop: ROW_PAD_VERTICAL,
              paddingBottom: ROW_PAD_VERTICAL,
              paddingLeft: ROW_PAD_LEFT,
              paddingRight: ROW_PAD_RIGHT,
            }}
          >
            <MiColorIcon name={row.icon} size={ICON_SIZE} />
            <View style={{ flex: 1, gap: TEXT_GAP, overflow: 'hidden' }}>
              <ExactText variant="bodyM15">{row.title}</ExactText>
              <ExactText variant="bodyS14" color="secondary">
                {row.subtitle}
              </ExactText>
            </View>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
