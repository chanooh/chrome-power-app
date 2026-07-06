// types/models.d.ts
import type {MacDeviceTemplateId} from './fingerprint';
import type {ExtensionSourceType} from './extension';

export namespace DB {
  export interface Window {
    id?: number;
    profile_id?: string;
    name?: string;
    group_id?: number | null;
    group_name?: string;
    tags?: number[] | string[] | null | string;
    remark?: string;
    opened_at?: string;
    created_at?: string;
    updated_at?: string;
    ua?: string;
    fingerprint?: string;
    fingerprint_template_id?: MacDeviceTemplateId;
    cookie?: string;
    /** 0: removed; 1: closed; 2: running; 3: Preparing  */
    status?: number;

    ip?: string;
    port?: number | null;
    pid?: number | null;
    local_proxy_port?: number;

    proxy_id?: number | null;
    proxy?: string;
    proxy_type?: string;
    ip_country?: string;
    ip_checker?: string;
    tags_name?: string[];
  }

  export interface Proxy {
    id?: number;
    ip?: string;
    proxy?: string;
    host?: string;
    port?: string | number;
    username?: string;
    password?: string;
    password_encrypted?: string | null;
    proxy_type?: string;
    ip_checker?: 'ip2location' | 'geoip';
    ip_country?: string;
    check_result?: string;
    checking?: boolean;
    remark?: string;
    checked_at?: string;
    usageCount?: number;
    hasPassword?: boolean;
    credential_status?: 'encrypted' | 'none' | 'legacy' | 'unavailable';
    // ... other properties
  }

  export interface Group {
    id?: number;
    name?: string;
  }

  export interface Tag {
    id?: number;
    name?: string;
    color?: string;
  }

  export interface Extension {
    id?: number;
    name: string;
    version: string;
    path: string;
    extension_uid?: string;
    source_type?: ExtensionSourceType;
    manifest_version?: number;
    sha256?: string;
    permissions?: string[] | string | null;
    host_permissions?: string[] | string | null;
    repository_path?: string;
    current_path?: string;
    update_url_removed?: boolean | number;
    last_verified_at?: string;
    imported_at?: string;
    usageCount?: number;
    windows?: number[] | string;
    icon?: string;
    description?: string;
    created_at?: string;
    updated_at?: string;
  }

  export interface WindowExtension {
    id?: number;
    extension_id?: number;
    window_id?: number;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SafeAny = any;
