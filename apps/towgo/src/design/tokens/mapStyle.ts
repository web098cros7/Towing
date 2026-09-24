import type { MapStyleElement } from 'react-native-maps';

/**
 * Every map in the customer app (owner decision, 24 Sep 2026): Figma 07's light
 * street palette, WITH road and area names (Figma draws the map without labels;
 * the owner wants a clean map a customer can read, as Rapido's). Shops,
 * transit and highway shields stay hidden, so the pins and the route are what
 * stands out. Always light: the app is light-only, and without a style Google
 * follows the phone's dark mode.
 */
export const MITOW_MAP_STYLE: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#F1F4F7' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F1F4F7' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#DAF2E2' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5EBFC' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E3E7ED' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }, { weight: 3 }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#374151' }],
  },
];
