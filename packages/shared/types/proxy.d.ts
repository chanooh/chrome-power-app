import type {DB} from './db';

export interface ProxyEndpoint {
  host: string;
  port: string;
  username?: string;
  password?: string;
}

export interface MaskedProxy extends Omit<DB.Proxy, 'password_encrypted' | 'password'> {
  proxy?: string;
  host?: string;
  port?: string | number;
  username?: string;
  hasPassword?: boolean;
  credential_status?: 'encrypted' | 'none' | 'legacy' | 'unavailable';
}
