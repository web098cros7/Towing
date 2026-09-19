import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList, RootTabParamList } from './types';
import { TabBar } from './TabBar';
import { BookingsStack } from './BookingsStack';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { SupportScreen } from '@/screens/support/SupportScreen';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Tabs as Figma draws them: Home, Bookings, Support, Profile.
 *
 * Tab scenes swap instantly (`animation` unset = v7's `'none'`): bottom-tabs
 * keeps visited scenes mounted, so a cross-dissolve stacks semi-transparent
 * screens for its whole duration.
 *
 * SUPPORT HAS NO TAB SCENE. Figma 58 is drawn as a pushed screen (back chevron,
 * no tab bar) and no screen ever draws the Support tab active, so pressing it is
 * intercepted and the ROOT route `Support` is pushed instead. The `component`
 * below only exists because a tab must have one; it is never focused through
 * the tab bar.
 *
 * The tab route is named `SupportTab`, NOT `Support`: a `navigate('Support')`
 * from inside a tab scene (Home's Help chip) is offered to this navigator
 * first, and TabRouter handles NAVIGATE for any route name it owns, so a tab
 * called `Support` would swallow it and focus this placeholder scene with the
 * tab bar still up instead of pushing root 58.
 */
export function BottomTabs() {
  return (
    <Tab.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bookings" component={BookingsStack} />
      <Tab.Screen
        name="SupportTab"
        component={SupportScreen}
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            event.preventDefault();
            navigation
              .getParent<NativeStackNavigationProp<RootStackParamList>>()
              ?.navigate('Support');
          },
        })}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
