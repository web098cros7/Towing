import React from 'react';
import { View } from 'react-native';

import { usePressablePrimitive } from '@towing/ui';
import { useTheme } from '@towing/theme';

import { MiText } from './MiText';
import { mitowColors } from '../tokens/colors';
import { MiLineIcon } from '../icons/MiLineIcon';

/**
 * MiFaqRow — Figma FAQ Row component.
 *
 * Collapsed: node 281:1773
 * Expanded:  node 281:1779
 *
 * Used on screens 56 Privacy & Legal and 59 Help Center.
 */
export type MiFaqRowProps = {
  question: string;
  answer: string;
  expanded: boolean;
  onToggle: () => void;
};

export function MiFaqRow({ question, answer, expanded, onToggle }: MiFaqRowProps) {
  const Pressable = usePressablePrimitive();
  const theme = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      pressScale={theme.motion.pressScale.row}
      haptic="light"
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={question}
      style={{
        paddingTop: 15,
        paddingBottom: 15,
        paddingLeft: 16,
        paddingRight: 14,
        gap: 8,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <MiText variant="strong15" style={{ flex: 1 }}>
          {question}
        </MiText>
        <View
          style={{
            width: 20,
            height: 20,
            transform: [{ rotate: expanded ? '-90deg' : '90deg' }],
          }}
        >
          <MiLineIcon name="chevron-right" size={20} />
        </View>
      </View>
      {expanded ? (
        <MiText variant="bodyS14" color="secondary">
          {answer}
        </MiText>
      ) : null}
    </Pressable>
  );
}

/**
 * MiFaqCard — Figma white list card that holds FAQ rows.
 *
 * Node 296:3500
 */
export type MiFaqCardProps = {
  children: React.ReactNode;
};

export function MiFaqCard({ children }: MiFaqCardProps) {
  const items = React.Children.toArray(children);

  return (
    <View
      style={{
        backgroundColor: mitowColors.surfacePage,
        borderWidth: 1.2,
        borderColor: mitowColors.borderSubtle,
        borderRadius: 16,
        paddingVertical: 0.8,
        boxShadow: '0px 1px 2px 0px rgba(16, 24, 40, 0.04)',
        overflow: 'hidden',
      }}
    >
      {items.map((child, index) => (
        <React.Fragment key={index}>
          {index > 0 ? (
            <View
              style={{
                height: 1,
                marginLeft: 14.8,
                backgroundColor: mitowColors.borderSubtle,
              }}
            />
          ) : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}
