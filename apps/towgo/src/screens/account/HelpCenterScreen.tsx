import React, { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MiScreen,
  MiText,
  MiNavBar,
  MiTextField,
  MiColorIcon,
  MiMenuCard,
  MiMenuRow,
  MiChip,
} from '@/design';
import { MiFaqRow, MiFaqCard } from '@/design/components/MiFaqRow';
import { faqs } from '@/features/account/data/faqs.data';
import { useContentPages } from '@/features/content/api/content.queries';
import type { RootStackParamList } from '@/navigation/types';

type Category = 'all' | 'booking' | 'payments' | 'safety' | 'account';

/**
 * Category per FAQ. The FAQ data does not carry a category yet, so we map it
 * here. Reported as a decision.
 */
const CATEGORY: Record<string, 'booking' | 'payments' | 'safety' | 'account'> = {
  f1: 'booking',
  f2: 'payments',
  f3: 'booking',
  f4: 'payments',
  f5: 'safety',
  f6: 'account',
};

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'booking', label: 'Booking' },
  { key: 'payments', label: 'Payments' },
  { key: 'safety', label: 'Safety' },
  { key: 'account', label: 'Account' },
];

/**
 * Category for a server FAQ, derived from its slug. First match wins; no match
 * means the FAQ is only shown under 'All'.
 */
function categoryFromSlug(slug: string): 'booking' | 'payments' | 'safety' | 'account' | null {
  const s = slug.toLowerCase();
  if (/pay|fare|refund|wallet|coupon|price/.test(s)) return 'payments';
  if (/safe|emergency|sos|police|insurance/.test(s)) return 'safety';
  if (/account|profile|login|otp|delete|privacy|data/.test(s)) return 'account';
  if (/book|cancel|track|driver|tow|trip/.test(s)) return 'booking';
  return null;
}

/**
 * Help Center — Figma 59 · Help Center (296:3244).
 */
export function HelpCenterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('all');
  // `undefined` = the drawn default (the first visible FAQ open); `null` = all closed.
  const [open, setOpen] = useState<string | null | undefined>(undefined);

  const content = useContentPages('faq');
  // Memoised, not `?? []` inline: the fallback would be a NEW array on every
  // render, so the `useMemo` below re-ran every time and memoised nothing.
  const serverItems = useMemo(() => content.data?.items ?? [], [content.data?.items]);

  const list = useMemo(() => {
    if (serverItems.length > 0) {
      return serverItems.map((page) => ({
        id: page.slug,
        question: page.title,
        answer: page.bodyMd,
        category: categoryFromSlug(page.slug),
      }));
    }
    return faqs.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      category: CATEGORY[f.id] ?? null,
    }));
  }, [serverItems]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((f) => {
      if (category !== 'all' && f.category !== category) return false;
      if (!q) return true;
      return f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q);
    });
  }, [list, query, category]);

  const firstVisibleId = visible.length > 0 ? visible[0].id : null;
  const openId = open === undefined ? firstVisibleId : open;

  return (
    <MiScreen edges={['top']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 21,
          gap: 16,
          paddingBottom: Math.max(insets.bottom, 34),
        }}
      >
        {/* 296:3244 — Nav bar */}
        <MiNavBar title="Help Center" trailing="none" onBack={() => navigation.goBack()} />

        {/* 296:3477 — Search */}
        <MiTextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search help topics"
          leftSlot={<MiColorIcon name="search" size={22} />}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search help topics"
        />

        {/* 296:3489 — Categories */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -21 }}
          contentContainerStyle={{ paddingHorizontal: 21, gap: 8 }}
        >
          {CATEGORIES.map((c) => (
            <MiChip
              key={c.key}
              label={c.label}
              selected={category === c.key}
              onPress={() => setCategory(c.key)}
            />
          ))}
        </ScrollView>

        {/* 296:3500 — FAQs */}
        {visible.length > 0 ? (
          <MiFaqCard>
            {visible.map((f) => (
              <MiFaqRow
                key={f.id}
                question={f.question}
                answer={f.answer}
                expanded={openId === f.id}
                onToggle={() => setOpen(openId === f.id ? null : f.id)}
              />
            ))}
          </MiFaqCard>
        ) : (
          <MiText variant="bodyM15" color="secondary">
            No help topics match your search.
          </MiText>
        )}

        {/* 296:3547 — Still need help */}
        <MiMenuCard radius={16} paddingVertical={4}>
          <MiMenuRow
            icon={{ color: 'help' }}
            title="Still need help?"
            subtitle="Reach our support team, 24/7"
            showChevron
            onPress={() => navigation.navigate('SupportChat', {})}
          />
        </MiMenuCard>
      </ScrollView>
    </MiScreen>
  );
}
