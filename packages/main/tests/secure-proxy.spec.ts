import {describe, expect, test, vi} from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^encrypted:/, ''),
  },
}));

describe('secure proxy credentials', () => {
  test('normalizes legacy proxy strings without keeping plaintext in public fields', async () => {
    const {
      getProxyForConnection,
      maskProxyForPublic,
      normalizeProxyForStorage,
    } = await import('../src/proxy/secure-proxy');

    const stored = normalizeProxyForStorage({
      proxy_type: 'HTTP',
      proxy: '127.0.0.1:8080:user:secret',
    });
    const publicProxy = maskProxyForPublic(stored)!;
    const connectionProxy = getProxyForConnection(stored);

    expect(stored.proxy).toBe('127.0.0.1:8080:user:******');
    expect(stored.password_encrypted).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(stored, 'password')).toBe(false);
    expect(JSON.stringify(publicProxy)).not.toContain('secret');
    expect(JSON.stringify(publicProxy)).not.toContain('password_encrypted');
    expect(connectionProxy.proxy).toBe('127.0.0.1:8080:user:secret');
  });

  test('keeps the existing encrypted password when updating metadata only', async () => {
    const {getProxyForConnection, normalizeProxyForStorage} = await import(
      '../src/proxy/secure-proxy'
    );

    const existing = normalizeProxyForStorage({
      proxy_type: 'SOCKS5',
      host: '10.0.0.1',
      port: '9000',
      username: 'user',
      password: 'old-password',
    });
    const updated = normalizeProxyForStorage(
      {
        proxy_type: 'SOCKS5',
        host: '10.0.0.1',
        port: '9000',
        username: 'user',
        remark: 'new remark',
      },
      existing,
    );

    expect(updated.password_encrypted).toBe(existing.password_encrypted);
    expect(getProxyForConnection(updated).proxy).toBe('10.0.0.1:9000:user:old-password');
  });
});
