import React from 'react';
import { View } from 'react-native';
import { Skeleton } from '@towing/ui';

/**
 * What a list-shaped screen shows while its first read is in flight.
 *
 * BIG BLOCKS, ONE PER ROW — not a placeholder per value inside a row (Ehsan,
 * 23 Sep). A row's worth of small bars reads as a broken row rather than a
 * loading one, and it tells the reader nothing they can use: nobody is waiting
 * to learn how wide the second line of an unloaded ticket will be. A single
 * shimmering block per group says "something is coming, about this big", which
 * is the only honest thing a loading state knows.
 *
 * It replaces two worse states this app used to show. A spinner, which says
 * "wait" without saying what for, and hides how much is coming; and nothing at
 * all, which on a slow connection is indistinguishable from an empty list — so
 * a customer with three saved vehicles briefly saw the same blank screen as a
 * customer with none.
 *
 * The count is deliberately small. These stand in for content that has not
 * arrived, and a screenful of them overstates what is likely there.
 */
export function MiListSkeleton({
  rows = 3,
  height = 84,
  radius = 16,
  gap = 12,
}: {
  rows?: number;
  /** Roughly the height of one real row, so the list does not jump when it lands. */
  height?: number;
  radius?: number;
  gap?: number;
}) {
  return (
    <View style={{ gap }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} width="100%" height={height} radius={radius} />
      ))}
    </View>
  );
}
