import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { BookingsStackParamList } from './types';
import { BookingsScreen } from '@/screens/bookings/BookingsScreen';

const Stack = createNativeStackNavigator<BookingsStackParamList>();

/**
 * The Bookings tab's stack. Booking Details is a ROOT route (Figma 20 / 35 draw
 * it with no tab bar); `navigate('BookingDetails')` from the list bubbles up to
 * the root stack.
 */
export function BookingsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BookingsList" component={BookingsScreen} />
    </Stack.Navigator>
  );
}
