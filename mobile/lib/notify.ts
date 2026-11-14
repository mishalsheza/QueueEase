// lib/notify.ts
import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * Drop-in replacement for Alert.alert that also works on web.
 *
 * React Native Web's Alert.alert is a no-op, so on web every error and
 * success message was silently dropped. On web this uses window.alert for
 * one button (or none) and window.confirm when there is a cancel option.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  // Two or more buttons: treat it as a confirm dialog.
  // OK runs the first non-cancel button; Cancel runs the cancel button.
  const cancel = buttons.find((b) => b.style === 'cancel');
  const action = buttons.find((b) => b !== cancel) ?? buttons[buttons.length - 1];
  if (window.confirm(text)) {
    action.onPress?.();
  } else {
    cancel?.onPress?.();
  }
}
