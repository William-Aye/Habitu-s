import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { CalendarDays, MessageCircle, Search, User } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useUnreadCount } from '../../features/chat/useUnreadCount';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { count, refresh } = useUnreadCount();
  return (
    <Tabs
      screenOptions={{
        tabBarShowLabel: true,
        headerShown: false,
        // The website has no tab bar: the slim header is its only navigation.
        ...(Platform.OS === 'web' ? { tabBarStyle: { display: 'none' as const } } : {}),
      }}
      screenListeners={{ focus: refresh }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.explore'),
          tabBarIcon: ({ color, size }) => <Search color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="my-activities"
        options={{
          title: t('tabs.myActivities'),
          tabBarIcon: ({ color, size }) => <CalendarDays color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.messages'),
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
          tabBarAccessibilityLabel:
            count > 0 ? `${t('tabs.messages')}, ${t('messages.unread', { count })}` : t('tabs.messages'),
          tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
