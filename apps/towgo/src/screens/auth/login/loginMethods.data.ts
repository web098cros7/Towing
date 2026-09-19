import type { TextInputProps } from 'react-native';

export type LoginMethodKey = 'mobile' | 'email';

export type LoginMethod = {
  key: LoginMethodKey;
  /** Segment label (Segment 243:837, `Label#243:10`). */
  segmentLabel: string;
  /** Field label above the Input (MiTow/Medium 16). */
  fieldLabel: string;
  placeholder: string;
  inputAccessibilityLabel: string;
  keyboardType: TextInputProps['keyboardType'];
  textContentType: TextInputProps['textContentType'];
  autoComplete: TextInputProps['autoComplete'];
  autoCapitalize: TextInputProps['autoCapitalize'];
};

/**
 * The two log-in methods of 03 Login's segmented control `259:1754`.
 *
 * "Mobile Number" is fully drawn: segment 6.1a, field label 6.2a and
 * placeholder 6.2b-iii, all verbatim.
 *
 * "Email" is drawn as a tappable Default segment (6.1b), but no Email-selected
 * panel exists in any of the 61 screens (spec data gap 1). Its field follows the
 * drawn pieces: the label is the design's own Email field label (39 · Personal
 * Information, Text Field `293:3024`, "Email" in MiTow/Medium 16) and the Input
 * is the same frame as the mobile one without the country-code group. The
 * placeholder is NOT in Figma; it mirrors the mobile placeholder's wording until
 * the designer draws this state.
 */
export const LOGIN_METHODS: readonly LoginMethod[] = [
  {
    key: 'mobile',
    segmentLabel: 'Mobile Number',
    fieldLabel: 'Mobile Number',
    placeholder: 'Enter your mobile number',
    inputAccessibilityLabel: 'Mobile number',
    keyboardType: 'number-pad',
    textContentType: 'telephoneNumber',
    autoComplete: 'tel',
    autoCapitalize: 'none',
  },
  {
    key: 'email',
    segmentLabel: 'Email',
    fieldLabel: 'Email',
    placeholder: 'Enter your email',
    inputAccessibilityLabel: 'Email',
    keyboardType: 'email-address',
    textContentType: 'emailAddress',
    autoComplete: 'email',
    autoCapitalize: 'none',
  },
];
