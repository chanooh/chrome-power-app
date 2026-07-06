import {db} from '.';
import type {DB, SafeAny} from '../../../shared/types/db';
import {
  getProxyForConnection,
  maskProxyForPublic,
  normalizeProxyForStorage,
  parseProxyString,
} from '../proxy/secure-proxy';

const all = async () => {
  const proxies = await db('proxy')
    .leftJoin('window', function () {
      this.on('window.proxy_id', '=', 'proxy.id').andOn('window.status', '>', 0 as SafeAny); // 增加的筛选条件
    })
    .select('proxy.*')
    .count('window.id as usageCount')
    .groupBy('proxy.id')
    .orderBy('proxy.created_at', 'desc');
  return proxies.map(proxy => maskProxyForPublic(proxy));
};

const getById = async (id: number) => {
  const proxy = await db('proxy').where({id}).first();
  return maskProxyForPublic(proxy);
};

const getByIdForConnection = async (id?: number | null) => {
  if (!id) return {};
  const proxy = await db('proxy').where({id}).first();
  return proxy ? getProxyForConnection(proxy) : {};
};

const getByProxy = async (proxy_type?: string, proxy?: string) => {
  const parsed = parseProxyString(proxy);
  const query = parsed
    ? parsed.username
      ? {proxy_type, host: parsed.host, port: parsed.port, username: parsed.username}
      : {proxy_type, host: parsed.host, port: parsed.port}
    : {proxy_type, proxy};
  const result = await db('proxy').where(query).first();
  return maskProxyForPublic(result);
};

const update = async (id: number, updatedData: DB.Proxy) => {
  const existing = await db('proxy').where({id}).first();
  const normalized = normalizeProxyForStorage(updatedData, existing);
  return await db('proxy').where({id}).update(normalized);
};

const create = async (proxyData: DB.Proxy) => {
  return await db('proxy').insert(normalizeProxyForStorage(proxyData));
};

const importProxies = async (proxies: DB.Proxy[]) => {
  return await db('proxy').insert(proxies.map(proxy => normalizeProxyForStorage(proxy)));
};

const remove = async (id: number) => {
  return await db('proxy').where({id}).delete();
};

const deleteAll = async () => {
  return await db('proxy').delete();
};

const migrateLegacyCredentials = async () => {
  const proxies = await db('proxy').select('*');
  for (const proxy of proxies) {
    if (proxy.host && proxy.port) continue;
    const parsed = parseProxyString(proxy.proxy);
    if (!parsed) continue;
    const normalized = normalizeProxyForStorage(proxy);
    await db('proxy').where({id: proxy.id}).update({
      host: normalized.host,
      port: normalized.port,
      username: normalized.username,
      password_encrypted: normalized.password_encrypted,
      proxy: normalized.proxy,
      credentials_migrated_at: db.fn.now(),
    });
  }
};

const batchDelete = async (ids: number[]) => {
  // 首先，检查这些 IDs 是否被 window 表所引用
  const referencedIds = await db('window')
    .select('proxy_id')
    .where('status', '>', 0)
    .whereIn('proxy_id', ids)
    .then(rows => rows.map(row => row.proxy_id));

  // 如果有被引用的 ID，可以选择抛出错误或者返回相关信息
  if (referencedIds.length > 0) {
    // 或者返回相关信息
    return {success: false, message: 'Some IDs are referenced in the window table.', referencedIds};
  } else {
    try {
      await db('proxy').delete().whereIn('id', ids);
      return {success: true};
    } catch (error) {
      return {success: false, message: 'Failed to delete.'};
    }
  }
};

export const ProxyDB = {
  all,
  getById,
  getByIdForConnection,
  getByProxy,
  batchDelete,
  importProxies,
  migrateLegacyCredentials,
  update,
  create,
  remove,
  deleteAll,
};
