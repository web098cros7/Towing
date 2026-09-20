import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  interpolate,
} from 'react-native-reanimated';
import { useTheme, motion } from '@towing/theme';
import { Text } from '@towing/ui';
import { Search, ChevronDown, Headphones, ClipboardList } from '@/icons';
import { SubScreen } from '@/components/SubScreen';
import { SettingsList } from '@/components/SettingsList';
import { SettingsRow } from '@/components/SettingsRow';
import { TextField } from '@/components/TextField';
import { faqs } from '@/features/account/data/faqs.data';
import { useContentPages } from '@/features/content/api/content.queries';
import type { RootStackParamList } from '@/navigation/types';
import { Pressable } from '@/motion';

interface Faq {
  id: string;
  question: string;
  answer: string;
}

/**
 * One FAQ card.
 *
 * `LinearTransition` on the card is what makes the accordion grow and shrink
 * rather than jump: Reanimated measures the card before and after the answer
 * mounts and tweens the height difference. The chevron rotation is a spring on
 * the same state, so the two read as one gesture.
 */
function FaqRow({
  faq,
  expanded,
  onToggle,
}: {
  faq: Faq;
  expanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();

  const progress = useDerivedValue(() =>
    withSpring(expanded ? 1 : 0, theme.motion.spring.snappy),
  );

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  return (
    <Animated.View layout={LinearTransition.duration(motion.duration.base)}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={faq.question}
        pressScale={theme.motion.pressScale.card}
        style={{
          backgroundColor: theme.colors.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 16,
          gap: expanded ? 10 : 0,
          ...theme.shadows.card,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text weight="medium" style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
            {faq.question}
          </Text>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={18} color={theme.colors.textTertiary} />
          </Animated.View>
        </View>

        {expanded ? (
          <Animated.View
            entering={FadeIn.duration(motion.duration.fast)}
            exiting={FadeOut.duration(motion.duration.fast)}
          >
            <Text color="secondary" style={{ fontSize: 14, lineHeight: 20 }}>
              {faq.answer}
            </Text>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function HelpCenterScreen() {
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  // W15: the answers are content the console can edit; until they arrive (or
  // if they cannot), the bundled copy answers — Help that is unreachable
  // offline is worse than Help that is a release behind.
  const content = useContentPages('faq');
  const items: Faq[] = useMemo(() => {
    const pages = content.data?.items ?? [];
    if (pages.length === 0) return faqs;
    return pages.map((page) => ({ id: page.slug, question: page.title, answer: page.bodyMd }));
  }, [content.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <SubScreen title="Help Center">
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Search help topics"
        autoCapitalize="none"
        rightSlot={<Search size={18} color={theme.colors.textTertiary} />}
      />

      <View style={{ gap: 10 }}>
        {filtered.map((f) => (
          <FaqRow
            key={f.id}
            faq={f}
            expanded={openId === f.id}
            onToggle={() => setOpenId(openId === f.id ? null : f.id)}
          />
        ))}
      </View>

      <SettingsList>
        <SettingsRow
          icon={ClipboardList}
          title="My tickets"
          subtitle="What you have raised and our replies"
          trailing="chevron"
          onPress={() => navigation.navigate('MyTickets')}
        />
        <SettingsRow
          icon={Headphones}
          title="Still need help?"
          subtitle="Reach our support team"
          trailing="chevron"
          onPress={() => navigation.navigate('ContactUs')}
        />
      </SettingsList>
    </SubScreen>
  );
}
