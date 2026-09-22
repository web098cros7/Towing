import type { FontWeightKey } from '@towing/theme';

/**
 * MiTow type scale — the Figma text styles `MiTow/*`, Inter throughout.
 *
 * LETTER SPACING IS IN px, NOT PERCENT. Figma reports a percent of the font
 * size ("Display 34" is -2.5% → -0.85px). Every value below is converted.
 *
 * Key → Figma style:
 *   amount44   MiTow/Amount 44   Bold     44 / 52    -2.5%  -1.1
 *   display34  MiTow/Display 34   Bold     34 / 40    -2.5%  -0.85
 *   display31  MiTow/Display 31   Bold     31 / 36    -2.5%  -0.775
 *   display27  MiTow/Display 27   Bold     27 / 32    -2.5%  -0.675
 *   title23    MiTow/Title 23     Bold     23 / 28    -2.5%  -0.575
 *   amount22   MiTow/Amount 22    Bold     22 / 28    -2.5%  -0.55
 *   title20    MiTow/Title 20     Bold     20 / 26    -1.5%  -0.3
 *   heading18  MiTow/Heading 18   SemiBold 18 / 24    -2%    -0.36
 *   medium16   MiTow/Medium 16    Medium   16 / 21    -2%    -0.32
 *   strong16   MiTow/Strong 16    SemiBold 16 / 21    -2%    -0.32
 *   overline12 MiTow/Overline 12  SemiBold 12 / 16    +8%    +0.96
 *   bodyL155   MiTow/Body L 15.5  Regular  15.5 / 21  -2%    -0.31
 *   strong155  MiTow/Strong 15.5  SemiBold 15.5 / 20  -2%    -0.31
 *   strong15   MiTow/Strong 15    SemiBold 15 / 20    -2%    -0.3
 *   bodyM15    MiTow/Body M 15    Regular  15 / 20    -1.5%  -0.225
 *   chip135    MiTow/Chip 13.5    Medium   13.5 / 18  -2%    -0.27
 *   bodyXS135  MiTow/Body XS 13.5 Regular  13.5 / 18.5 -2%   -0.27
 *   strong14   MiTow/Strong 14    SemiBold 14 / 19    -2%    -0.28
 *   bodyS14    MiTow/Body S 14    Regular  14 / 19    -1.5%  -0.21
 *   label13    MiTow/Label 13     Regular  13 / 16.5  -2%    -0.26
 *
 * `amount44` is 27 Payment's Total (E2 `239:707`, "₹1,200") and 28's backdrop copy of it.
 *
 * `weight` is the shared `FontWeightKey`, so `MiText` resolves the Inter family
 * through `theme.fonts[weight]` (registered in `providers/FontGate.tsx`).
 */
export type MitowTypeToken = {
  fontSize: number;
  lineHeight: number;
  /** In px. Negative = tighter. */
  letterSpacing: number;
  weight: FontWeightKey;
};

export const mitowType = {
  amount44: { fontSize: 44, lineHeight: 52, letterSpacing: -1.1, weight: 'bold' },
  display34: { fontSize: 34, lineHeight: 40, letterSpacing: -0.85, weight: 'bold' },
  display31: { fontSize: 31, lineHeight: 36, letterSpacing: -0.775, weight: 'bold' },
  display27: { fontSize: 27, lineHeight: 32, letterSpacing: -0.675, weight: 'bold' },
  title23: { fontSize: 23, lineHeight: 28, letterSpacing: -0.575, weight: 'bold' },
  amount22: { fontSize: 22, lineHeight: 28, letterSpacing: -0.55, weight: 'bold' },
  title20: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3, weight: 'bold' },
  heading18: { fontSize: 18, lineHeight: 24, letterSpacing: -0.36, weight: 'semibold' },
  medium16: { fontSize: 16, lineHeight: 21, letterSpacing: -0.32, weight: 'medium' },
  strong16: { fontSize: 16, lineHeight: 21, letterSpacing: -0.32, weight: 'semibold' },
  overline12: { fontSize: 12, lineHeight: 16, letterSpacing: 0.96, weight: 'semibold' },
  bodyL155: { fontSize: 15.5, lineHeight: 21, letterSpacing: -0.31, weight: 'regular' },
  strong155: { fontSize: 15.5, lineHeight: 20, letterSpacing: -0.31, weight: 'semibold' },
  strong15: { fontSize: 15, lineHeight: 20, letterSpacing: -0.3, weight: 'semibold' },
  bodyM15: { fontSize: 15, lineHeight: 20, letterSpacing: -0.225, weight: 'regular' },
  chip135: { fontSize: 13.5, lineHeight: 18, letterSpacing: -0.27, weight: 'medium' },
  bodyXS135: { fontSize: 13.5, lineHeight: 18.5, letterSpacing: -0.27, weight: 'regular' },
  strong14: { fontSize: 14, lineHeight: 19, letterSpacing: -0.28, weight: 'semibold' },
  bodyS14: { fontSize: 14, lineHeight: 19, letterSpacing: -0.21, weight: 'regular' },
  label13: { fontSize: 13, lineHeight: 16.5, letterSpacing: -0.26, weight: 'regular' },
} as const satisfies Record<string, MitowTypeToken>;

export type MitowTypeVariant = keyof typeof mitowType;
