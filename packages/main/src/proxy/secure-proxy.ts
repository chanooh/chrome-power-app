import {safeStorage} from 'electron';
import type {DB} from '../../../shared/types/db';
import type {MaskedProxy, ProxyEndpoint} from '../../../shared/types/proxy';

const PASSWORD_MASK = '******';

const isMaskedPassword = (value?: string) =>
  !value || value === PASSWORD_MASK || /^\*+$/.test(value);

export const isProxyEncryptionAvailable = () => {
  try {
    return !!safeStorage?.isEncryptionAvailable?.();
  } catch {
    return false;
  }
};

export const encryptProxyPassword = (password?: string) => {
  if (!password || isMaskedPassword(password)) return null;
  if (!isProxyEncryptionAvailable()) {
    throw new Error('macOS secure storage is unavailable; cannot save proxy password.');
  }
  return safeStorage.encryptString(password).toString('base64');
};

export const decryptProxyPassword = (encrypted?: string | null) => {
  if (!encrypted) return undefined;
  if (!isProxyEncryptionAvailable()) {
    throw new Error('macOS secure storage is unavailable; cannot read proxy password.');
  }
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
};

export const parseProxyString = (proxy?: string): ProxyEndpoint | undefined => {
  if (!proxy) return undefined;
  let value = proxy.trim();
  if (!value) return undefined;
  value = value.replace(/^https?:\/\//i, '').replace(/^socks5:\/\//i, '');
  const [host, port, username, password] = value.split(':');
  if (!host || !port) return undefined;
  return {
    host,
    port,
    username: username || undefined,
    password: password && !isMaskedPassword(password) ? password : undefined,
  };
};

export const maskProxyEndpoint = (endpoint?: ProxyEndpoint) => {
  if (!endpoint?.host || !endpoint?.port) return '';
  if (!endpoint.username) return `${endpoint.host}:${endpoint.port}`;
  return `${endpoint.host}:${endpoint.port}:${endpoint.username}:${PASSWORD_MASK}`;
};

export const buildProxyString = (endpoint?: ProxyEndpoint) => {
  if (!endpoint?.host || !endpoint?.port) return '';
  if (!endpoint.username) return `${endpoint.host}:${endpoint.port}`;
  return `${endpoint.host}:${endpoint.port}:${endpoint.username}:${endpoint.password || ''}`;
};

export const getStoredProxyEndpoint = (proxy: DB.Proxy): ProxyEndpoint | undefined => {
  const structured =
    proxy.host && proxy.port
      ? {
          host: proxy.host,
          port: String(proxy.port),
          username: proxy.username || undefined,
          password: decryptProxyPassword(proxy.password_encrypted),
        }
      : undefined;

  if (structured) return structured;
  return parseProxyString(proxy.proxy);
};

export const getProxyForConnection = (proxy: DB.Proxy): DB.Proxy => {
  const endpoint = getStoredProxyEndpoint(proxy);
  return {
    ...proxy,
    proxy: buildProxyString(endpoint),
    host: endpoint?.host,
    port: endpoint?.port,
    username: endpoint?.username,
    password: endpoint?.password,
  };
};

export const normalizeProxyForStorage = (
  proxy: DB.Proxy,
  existing?: DB.Proxy,
): DB.Proxy => {
  const fromFields =
    proxy.host && proxy.port
      ? {
          host: proxy.host,
          port: String(proxy.port),
          username: proxy.username || undefined,
          password: proxy.password && !isMaskedPassword(proxy.password) ? proxy.password : undefined,
        }
      : undefined;
  const fromProxyString = parseProxyString(proxy.proxy);
  const endpoint = fromFields || fromProxyString;

  if (!endpoint) {
    return proxy;
  }

  const existingEndpoint = existing ? getStoredProxyEndpoint(existing) : undefined;
  const shouldKeepExistingPassword =
    !endpoint.password &&
    !!existing?.password_encrypted &&
    existingEndpoint?.host === endpoint.host &&
    existingEndpoint?.port === endpoint.port &&
    existingEndpoint?.username === endpoint.username;
  const passwordEncrypted = shouldKeepExistingPassword
    ? existing.password_encrypted!
    : encryptProxyPassword(endpoint.password);

  return {
    ...proxy,
    host: endpoint.host,
    port: endpoint.port,
    username: endpoint.username || undefined,
    password: undefined,
    password_encrypted: passwordEncrypted,
    proxy: maskProxyEndpoint({
      ...endpoint,
      password: passwordEncrypted ? PASSWORD_MASK : undefined,
    }),
  };
};

export const maskProxyForPublic = (proxy?: DB.Proxy | null): MaskedProxy | undefined => {
  if (!proxy) return undefined;
  const endpoint =
    proxy.host && proxy.port
      ? {
          host: proxy.host,
          port: String(proxy.port),
          username: proxy.username || undefined,
        }
      : parseProxyString(proxy.proxy);
  const hasPassword = !!proxy.password_encrypted || !!parseProxyString(proxy.proxy)?.password;
  const {password_encrypted: _passwordEncrypted, password: _password, ...publicProxy} = proxy;
  const masked: MaskedProxy = {
    ...publicProxy,
    host: endpoint?.host || proxy.host,
    port: endpoint?.port || proxy.port,
    username: endpoint?.username || proxy.username,
    proxy: maskProxyEndpoint(endpoint),
    hasPassword,
    credential_status: proxy.password_encrypted
      ? 'encrypted'
      : hasPassword
        ? 'legacy'
        : 'none',
  };
  return masked;
};

export const maskProxyValue = (proxy?: string) => maskProxyEndpoint(parseProxyString(proxy));
