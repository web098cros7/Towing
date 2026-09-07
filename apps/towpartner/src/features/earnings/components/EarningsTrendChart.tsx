import React, { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@towing/theme';
import { Card } from '@towing/ui';
import { driverColors } from '@/theme/driverColors';
import { formatRupees } from '@/utils/format';
import type { EarningsPoint } from '../types';

/**
 * Indian-grouped RUPEES from paise, without the symbol — e.g. 268000 → "2,680".
 *
 * Strips the ₹ from the shared formatter rather than reimplementing the lakh
 * grouping, which is the one piece of this that is easy to get subtly wrong.
 * An axis is the one place a currency symbol on every tick is noise.
 */
const groupInt = (paise: number) => formatRupees(paise / 100).replace('₹', '');

/** "12 May" — the axis label, formatted HERE rather than sent pre-formatted. */
function axisLabel(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

// Figma 78:784 plots into a 203-tall SVG area inside a 235-tall card.
const HEIGHT = 203;
const PAD = { left: 8, right: 12, top: 24, bottom: 24 };
const GRID_FRACTIONS = [0, 1 / 3, 2 / 3, 1];

/** Rounds up to a clean ₹ boundary. In PAISE since Phase 19, hence the ×100. */
function niceMax(maxPaise: number): number {
  return Math.max(100_000, Math.ceil(maxPaise / 100_000) * 100_000);
}

function gridLabel(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : '0';
}

/** Line + area earnings trend (react-native-svg), sized to its container. */
export function EarningsTrendChart({ points }: { points: EarningsPoint[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const yMax = niceMax(Math.max(...points.map((p) => p.valuePaise)));
  const lastIndex = points.length - 1;

  const xAt = (i: number) => PAD.left + (points.length > 1 ? (innerW * i) / lastIndex : innerW / 2);
  const yAt = (value: number) => PAD.top + innerH * (1 - value / yMax);

  const linePoints = points.map((p, i) => `${xAt(i)},${yAt(p.valuePaise)}`).join(' ');
  const areaPoints = `${PAD.left},${PAD.top + innerH} ${linePoints} ${xAt(lastIndex)},${PAD.top + innerH}`;

  return (
    <Card radius="card" padding={16}>
      <View onLayout={onLayout} style={{ width: '100%', height: HEIGHT }}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT}>
            {/* Gridlines + y labels */}
            {GRID_FRACTIONS.map((frac) => {
              const value = yMax * (1 - frac);
              const y = PAD.top + innerH * frac;
              return (
                <React.Fragment key={frac}>
                  <Line
                    x1={PAD.left}
                    y1={y}
                    x2={width - PAD.right}
                    y2={y}
                    stroke={theme.colors.border}
                    strokeWidth={1}
                  />
                  <SvgText x={PAD.left} y={y - 4} fontSize={10} fill={theme.colors.textTertiary}>
                    {gridLabel(value)}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Area + line */}
            <Polygon points={areaPoints} fill={driverColors.accent} fillOpacity={0.12} />
            <Polyline
              points={linePoints}
              fill="none"
              stroke={driverColors.accent}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Points; value label on the last point only, axis labels thinned. */}
            {points.map((p, i) => {
              const isLast = i === lastIndex;
              const showAxisLabel = points.length <= 5 || i % 2 === 0 || isLast;
              return (
                <React.Fragment key={p.day}>
                  {isLast ? (
                    <SvgText
                      x={xAt(i)}
                      y={yAt(p.valuePaise) - 11}
                      fontSize={10}
                      fontWeight="600"
                      fill={driverColors.accent}
                      textAnchor="end"
                    >
                      {groupInt(p.valuePaise)}
                    </SvgText>
                  ) : null}
                  <Circle
                    cx={xAt(i)}
                    cy={yAt(p.valuePaise)}
                    r={isLast ? 5 : 3.5}
                    fill={driverColors.accent}
                    stroke={theme.colors.card}
                    strokeWidth={isLast ? 2 : 1}
                  />
                  {showAxisLabel ? (
                    <SvgText
                      x={xAt(i)}
                      y={HEIGHT - 8}
                      fontSize={10}
                      fill={isLast ? driverColors.accent : theme.colors.textTertiary}
                      textAnchor="middle"
                    >
                      {axisLabel(p.day)}
                    </SvgText>
                  ) : null}
                </React.Fragment>
              );
            })}
          </Svg>
        ) : null}
      </View>
    </Card>
  );
}
