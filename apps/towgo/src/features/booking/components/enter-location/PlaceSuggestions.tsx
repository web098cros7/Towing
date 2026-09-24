import React from 'react';
import type { PlacePrediction } from '@towing/api-contracts';
import { MiMenuCard, MiMenuRow } from '@/design';

/**
 * The places matching what the customer is typing into Pickup or Drop, shown
 * in place of Saved & Recent while they type (owner decision, 24 Sep 2026;
 * Figma 10 draws no list). Built from the screen's own Menu Card and Menu Row,
 * with the map-pin glyph the Locations card already uses, so nothing new is
 * drawn. Tapping a row fills the field the text was typed in.
 */
export function PlaceSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: PlacePrediction[];
  onSelect: (prediction: PlacePrediction) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <MiMenuCard radius={16} paddingVertical={4}>
      {suggestions.slice(0, 6).map((prediction) => (
        <MiMenuRow
          key={prediction.placeId}
          icon={{ line: 'map-pin' }}
          title={prediction.primary}
          subtitle={prediction.secondary || null}
          accessibilityLabel={[prediction.primary, prediction.secondary].filter(Boolean).join(', ')}
          onPress={() => onSelect(prediction)}
        />
      ))}
    </MiMenuCard>
  );
}
