import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from './types';
import { TabBar } from './TabBar';
import { BookingsStack } from './BookingsStack';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { ServicesTabScreen } from '@/screens/services/RoadsideAssistanceScreen';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';

const Tab = createBottomTabNavigator<RootTabParamList>();

/**
 * Tabs: Home, Bookings, Services, Profile. Figma draws Support third; Services
 * replaced it (owner decision, 24 Sep 2026) because every screen's Help chip
 * already opens Support (root 58), and the services list earns a tab of its own.
 *
 * Tab scenes swap instantly (`animation` unset = v7's `'none'`): bottom-tabs
 * keeps visited scenes mounted, so a cross-dissolve stacks semi-transparent
 * screens for its whole duration.
 */
export function BottomTabs() {
  return (
    <Tab.Navigator tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bookings" component={BookingsStack} />
      <Tab.Screen name="Services" component={ServicesTabScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
