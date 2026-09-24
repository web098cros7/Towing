import React from 'react';
import { Modal, View } from 'react-native';
import { useTheme } from '@towing/theme';
import { Button, Text } from '@towing/ui';
import { MapPin, RadioTower, ShieldCheck } from '@/icons';
import { driverColors } from '@/theme/driverColors';
import { Pressable } from '@/motion';

/**
 * PROMINENT DISCLOSURE — shown BEFORE the OS permission prompt, every time the
 * driver goes online without having accepted it.
 *
 * THIS IS A PLAY STORE REQUIREMENT, NOT A UX FLOURISH. Google's background
 * location policy requires an in-app disclosure that (a) appears before the
 * runtime prompt, (b) names the feature that needs the data, (c) says the
 * collection continues when the app is closed or not in use, and (d) has an
 * affirmative accept action that is not merely "OK" on a dialog the user has to
 * dismiss to continue. Apps are routinely rejected for having the wording but
 * showing it after the prompt, or for burying it in a privacy policy link.
 *
 * The review itself is human, can take weeks, and can reject late — which is why
 * SETUP-CHECKLIST item 3 flags starting it during this phase rather than at
 * submission.
 *
 * ⚠ NEVER SEEN ON A DEVICE, and never submitted to that review.
 */
export function LocationDisclosureSheet({
  visible,
  onAccept,
  onDismiss,
}: {
  visible: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,39,0.45)' }}>
        <View
          style={{
            backgroundColor: theme.colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 24,
            paddingBottom: 28,
            gap: 18,
          }}
        >
          <View style={{ alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: driverColors.noticeBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MapPin size={26} color={driverColors.amber} />
            </View>
            <Text weight="bold" align="center" style={{ fontSize: 20, lineHeight: 26 }}>
              MiTow Driver needs your location
            </Text>
          </View>

          {/*
            The four things the policy requires the disclosure to state, in the
            driver's own terms. Do not soften these into "to improve your
            experience" — the review checks that the purpose is specific and that
            background collection is named explicitly.
          */}
          <View style={{ gap: 14 }}>
            <Row
              icon={RadioTower}
              title="To send you jobs nearby"
              body="We use your location to find tow requests close to you and to show customers where their driver is."
            />
            <Row
              icon={MapPin}
              title="Even when the app is closed"
              body="MiTow Driver collects location in the background while you are online or on a job, so requests still reach you with the app in your pocket."
            />
            <Row
              icon={ShieldCheck}
              title="Only while you're online"
              body="Go offline and collection stops completely. We never track you outside a shift."
            />
          </View>

          <View style={{ gap: 10 }}>
            {/*
              An affirmative accept, not a dismissable "OK". The OS prompt is
              only requested after this is tapped.
            */}
            <Button label="Continue" fullWidth height={50} onPress={onAccept} />
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              style={() => ({ paddingVertical: 12, alignItems: 'center' })}
            >
              <Text color="secondary" weight="medium" style={{ fontSize: 14 }}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof MapPin;
  title: string;
  body: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Icon size={19} color={theme.colors.textSecondary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium" style={{ fontSize: 14, lineHeight: 19 }}>
          {title}
        </Text>
        <Text color="secondary" style={{ fontSize: 13, lineHeight: 18 }}>
          {body}
        </Text>
      </View>
    </View>
  );
}
