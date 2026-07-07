import {describe, expect, test, vi} from 'vitest';

const mockState = vi.hoisted(() => ({
  encryptionAvailable: true,
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

describe('rpa variables', () => {
  test('encrypts, decrypts, and masks sensitive variables', async () => {
    const {
      decryptSensitiveVariables,
      encryptSensitiveVariables,
      maskSensitiveVariables,
    } = await import('../src/rpa/variables');

    const encrypted = encryptSensitiveVariables({password: 'secret'});

    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toContain('secret');
    expect(decryptSensitiveVariables(encrypted)).toEqual({password: 'secret'});
    expect(maskSensitiveVariables({password: 'secret'})).toEqual({password: '******'});
  });

  test('rejects sensitive variables when safeStorage is unavailable', async () => {
    const {encryptSensitiveVariables} = await import('../src/rpa/variables');
    mockState.encryptionAvailable = false;

    expect(() => encryptSensitiveVariables({password: 'secret'})).toThrow('safeStorage encryption is unavailable');
    mockState.encryptionAvailable = true;
  });
});
