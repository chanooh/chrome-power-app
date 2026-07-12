import {afterEach, describe, expect, test} from 'vitest';
import {profileLeaseRegistry} from '../src/automation/profile-lease';

afterEach(() => profileLeaseRegistry.clear());

describe('profile automation leases', () => {
  test('atomically rejects sync and RPA conflicts', () => {
    profileLeaseRegistry.acquire([1, 2], 'sync', 'sync-1');
    expect(() => profileLeaseRegistry.acquire([2, 3], 'rpa', 'rpa-1')).toThrow('2 (sync)');
    expect(profileLeaseRegistry.get(3)).toBeUndefined();
  });

  test('releases a disconnected profile without releasing the session', () => {
    profileLeaseRegistry.acquire([4, 5], 'sync', 'sync-2');
    profileLeaseRegistry.releaseWindow(5, 'sync-2');
    expect(profileLeaseRegistry.get(4)?.owner).toBe('sync');
    expect(profileLeaseRegistry.get(5)).toBeUndefined();
  });
});
