import {beforeEach, describe, expect, test, vi} from 'vitest';

const state = vi.hoisted(() => ({
  window: {
    id: 7,
    profile_id: 'profile-alpha',
    status: 1,
  } as Record<string, unknown> | undefined,
  updates: [] as Record<string, unknown>[],
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

vi.mock('../src/db', () => {
  const createQuery = () => {
    const query = {
      select: vi.fn(() => query),
      where: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      first: vi.fn(() => Promise.resolve(state.window ? {...state.window} : undefined)),
      update: vi.fn((value: Record<string, unknown>) => {
        state.updates.push(value);
        return Promise.resolve(1);
      }),
    };
    return query;
  };
  const db = Object.assign(
    vi.fn(() => createQuery()),
    {
      fn: {now: () => 'now'},
    },
  );
  return {db};
});

describe('window fingerprint regeneration', () => {
  beforeEach(() => {
    state.window = {id: 7, profile_id: 'profile-alpha', status: 1};
    state.updates = [];
  });

  test('regenerates a closed profile with a new Auto snapshot', async () => {
    const {WindowDB} = await import('../src/db/window');
    const result = await WindowDB.regenerateFingerprintSnapshot(7);

    expect(result.success).toBe(true);
    expect(result.data?.profileId).toBe('profile-alpha');
    expect(result.data?.requestedTemplateId).toBe('auto');
    expect(result.data?.generationId).toBeTruthy();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].fingerprint).toContain(result.data?.generationId);
  });

  test('rejects regeneration while the profile is running', async () => {
    state.window = {id: 7, profile_id: 'profile-alpha', status: 2};
    const {WindowDB} = await import('../src/db/window');
    const result = await WindowDB.regenerateFingerprintSnapshot(7);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Close the profile');
    expect(state.updates).toHaveLength(0);
  });
});
