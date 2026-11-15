// Run with: npm test (node --test). Plain Node, no Jest or React Native needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from './apiBase.ts';

const dev = { isDev: true, platform: 'ios', hostUri: '192.168.1.20:8081' };

test('EXPO_PUBLIC_API_URL wins, on every platform and in release builds', () => {
  for (const platform of ['web', 'ios', 'android']) {
    assert.equal(resolveApiBase({ ...dev, platform, envUrl: 'http://10.0.0.5:5001' }), 'http://10.0.0.5:5001');
  }
  assert.equal(resolveApiBase({ isDev: false, platform: 'android', envUrl: 'https://api.example.com' }), 'https://api.example.com');
});

test('trailing slashes and whitespace are tidied', () => {
  assert.equal(resolveApiBase({ ...dev, envUrl: '  https://api.example.com/  ' }), 'https://api.example.com');
});

test('a URL with a path, a bad scheme or garbage is rejected with a clear message', () => {
  assert.throws(() => resolveApiBase({ ...dev, envUrl: 'http://10.0.0.5:5001/api' }), /without a path.*\/api is added automatically/);
  assert.throws(() => resolveApiBase({ ...dev, envUrl: 'ws://10.0.0.5:5001' }), /must start with http/);
  assert.throws(() => resolveApiBase({ ...dev, envUrl: '10.0.0.5:5001' }), /must start with http|not a valid URL/);
  assert.throws(() => resolveApiBase({ ...dev, envUrl: 'not a url' }), /not a valid URL/);
});

test('dev on web without the variable -> localhost', () => {
  assert.equal(resolveApiBase({ isDev: true, platform: 'web' }), 'http://localhost:5001');
});

test('dev on a phone/emulator without the variable -> the dev machine from Metro, backend port', () => {
  assert.equal(resolveApiBase(dev), 'http://192.168.1.20:5001');
  assert.equal(resolveApiBase({ ...dev, platform: 'android', hostUri: '10.0.0.7:19000' }), 'http://10.0.0.7:5001');
  assert.equal(resolveApiBase({ ...dev, devPort: 6000 }), 'http://192.168.1.20:6000');
});

test('dev on a device with no Metro host and no variable -> tells you to set it', () => {
  assert.throws(() => resolveApiBase({ isDev: true, platform: 'ios', hostUri: null }), /Set EXPO_PUBLIC_API_URL in mobile\/\.env/);
});

test('release build without the variable -> error instead of a placeholder URL', () => {
  assert.throws(() => resolveApiBase({ isDev: false, platform: 'web' }), /Release builds need it/);
  assert.throws(() => resolveApiBase({ isDev: false, platform: 'ios', hostUri: '192.168.1.20:8081' }), /Release builds need it/);
});
