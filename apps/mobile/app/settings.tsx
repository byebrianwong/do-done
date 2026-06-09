import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth-context';

interface SettingsRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  onPress?: () => void;
}

function SettingsRow({ icon, label, value, onPress }: SettingsRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color="#6b7280" style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { session } = useAuth();
  const router = useRouter();

  const version = Constants.expoConfig?.version ?? '1.0.0';
  const sha =
    (Constants.expoConfig?.extra?.git as { sha?: string } | undefined)?.sha ??
    'dev';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {session?.user && (
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(session.user.email?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userEmail}>{session.user.email}</Text>
            <Text style={styles.userId} numberOfLines={1}>
              Signed in
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.sectionHeader}>Tasks</Text>
      <View style={styles.section}>
        <SettingsRow
          icon="checkmark-done-circle-outline"
          label="Completed tasks"
          onPress={() => router.push('/completed' as never)}
        />
      </View>

      <Text style={styles.sectionHeader}>Calendar Integration</Text>
      <View style={styles.section}>
        <SettingsRow
          icon="calendar-outline"
          label="Google Calendar"
          value="Web only"
          onPress={() =>
            Alert.alert(
              'Google Calendar',
              'Calendar sync is configured from the do-done web app for now. Once connected there, scheduled tasks stay in sync on mobile.'
            )
          }
        />
      </View>

      <Text style={styles.sectionHeader}>About</Text>
      <View style={styles.section}>
        <SettingsRow
          icon="information-circle-outline"
          label="Version"
          value={`${version} (${sha})`}
          onPress={() =>
            Alert.alert('do-done', `Version ${version}\nBuild ${sha}`)
          }
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.signoutButton,
          pressed && styles.signoutButtonPressed,
        ]}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.signoutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  content: {
    paddingBottom: 40,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  rowPressed: {
    backgroundColor: '#f9fafb',
  },
  rowIcon: {
    marginRight: 12,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  rowValue: {
    fontSize: 14,
    color: '#9ca3af',
    marginRight: 8,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  userId: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  signoutButton: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#fecaca',
  },
  signoutButtonPressed: {
    backgroundColor: '#fef2f2',
  },
  signoutText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '600',
  },
});
