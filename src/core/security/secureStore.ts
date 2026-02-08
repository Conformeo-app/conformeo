import * as SecureStore from 'expo-secure-store';

const DEFAULT_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

export async function setSecureValue(key: string, value: string) {
  await SecureStore.setItemAsync(key, value, DEFAULT_OPTIONS);
}

export async function getSecureValue(key: string) {
  return SecureStore.getItemAsync(key, DEFAULT_OPTIONS);
}

export async function removeSecureValue(key: string) {
  await SecureStore.deleteItemAsync(key, DEFAULT_OPTIONS);
}
