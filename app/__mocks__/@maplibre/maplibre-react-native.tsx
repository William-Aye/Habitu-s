import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

// Plain-View stand-ins that expose the native props so tests can assert them.
export const Map = ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
  <View testID="map" {...props}>
    {children}
  </View>
);
export const Camera = (props: Record<string, unknown>) => <View testID="camera" {...props} />;
export const Marker = ({
  children,
  onPress,
  lngLat,
  ...props
}: { children?: ReactNode; onPress?: () => void; lngLat?: unknown } & Record<string, unknown>) => (
  <Pressable testID="marker" accessibilityRole="button" onPress={onPress} {...props}>
    {children}
  </Pressable>
);
export const GeoJSONSource = ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
  <View testID="geojson-source" {...props}>
    {children}
  </View>
);
export const Layer = ({ type, ...props }: { type: string } & Record<string, unknown>) => (
  <View testID={`layer-${type}`} {...props} />
);
