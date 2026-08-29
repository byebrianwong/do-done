/**
 * The signed-out screen. Deliberately **not** a route.
 *
 * It used to live at `app/(auth)/login.tsx`, reached by a `router.replace`
 * from the root layout once `getSession()` came back empty. That navigation is
 * what broke Android autofill: 1Password and Google's keyboard offered nothing
 * on either field, and the OS reported "Content can't be autofilled".
 *
 * Android builds its autofill view structure per activity, and a native-stack
 * navigation swaps the activity's content without telling `AutofillManager`
 * about it — the documented remedy is `AutofillManager.cancel()`, which
 * neither React Navigation nor react-native-screens calls and which no JS API
 * exposes. So the session stays pinned to the screen we navigated *away* from,
 * and the fields we navigated *to* are invisible to it. The tell is that
 * backgrounding the app and returning fixes it for that launch, because
 * resuming the activity is the other thing that rebuilds the structure. It is
 * open upstream on both sides (react-native-screens#349 / #3130,
 * react-navigation#12210 / #12717) with no fix and no JS-level workaround.
 *
 * Hence: being signed out is a *state* of the app, not a destination inside
 * it. `app/_layout.tsx` renders this in place of the navigator, so the fields
 * are children of the activity's root view from the first frame and nothing
 * navigates to reach them. It also drops the flash of the tab bar that the
 * redirect used to show on a signed-out launch.
 *
 * **Keep it out of `app/`.** A file under there is a route whether or not
 * anything links to it, and a route is arrived at by navigating.
 */
import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { supabase } from '@/lib/supabase';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setLoading(true);
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })
        : await supabase.auth.signUp({
            email: email.trim(),
            password,
          });
    setLoading(false);

    if (error) {
      Alert.alert('Auth error', error.message);
      return;
    }

    if (mode === 'signup') {
      Alert.alert(
        'Check your email',
        'We sent you a link to confirm your address. Open it to finish signing up.'
      );
    }
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
        <Text style={styles.logo}>DoDone</Text>
        <Text style={styles.subtitle}>
          {mode === 'signin' ? 'Welcome back' : 'Create your account'}
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          testID="login-email"
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          // Autofill hints: `autoComplete` drives Android's autofillHints,
          // `textContentType` drives iOS AutoFill. Password managers only
          // offer to fill fields they can identify.
          autoComplete="email"
          textContentType="username"
          importantForAutofill="yes"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          ref={passwordRef}
          testID="login-password"
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#9ca3af"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          // Signup asks for a *new* password so managers offer to generate
          // and save one instead of filling the existing credential.
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          textContentType={mode === 'signin' ? 'password' : 'newPassword'}
          importantForAutofill="yes"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          testID="login-submit"
          style={({ pressed }) => [
            styles.button,
            (loading || pressed) && styles.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? '...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          <Text style={styles.switchText}>
            {mode === 'signin' ? 'New here? Sign up' : 'Have an account? Sign in'}
          </Text>
        </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  logo: {
    fontSize: 32,
    fontWeight: '800',
    color: '#6366f1',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 28,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fff',
  },
  button: {
    backgroundColor: '#6366f1',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  switchText: {
    textAlign: 'center',
    color: '#6366f1',
    fontSize: 13,
    marginTop: 16,
  },
});
