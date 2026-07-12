import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import WebSocket, {WebSocketServer} from 'ws';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const addonPath = path.join(root, 'packages/main/src/native-addon/build/Release/window-addon.node');
const addon = require(addonPath);
const manager = new addon.WindowManager();
const permissions = manager.getPermissionStatus();
const requiredMethods = [
  'startEventCapture',
  'stopEventCapture',
  'getPermissionStatus',
  'requestListenAccess',
  'requestPostAccess',
  'sendMouseEvent',
  'sendKeyboardEvent',
  'sendWheelEvent',
];
for (const method of requiredMethods) {
  if (typeof manager[method] !== 'function') throw new Error(`Native addon is missing ${method}`);
}
if (process.env.SYNC_REQUIRE_PERMISSIONS === '1') {
  const ready = permissions.accessibility && permissions.listenEvents && permissions.postEvents;
  if (!ready) throw new Error('macOS synchronization permissions are not fully granted');
}

const server = new WebSocketServer({port: 0, perMessageDeflate: false});
await new Promise(resolve => server.once('listening', resolve));
const address = server.address();
if (typeof address === 'string' || !address) throw new Error('Unable to start mock CDP server');
server.on('connection', socket => {
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    socket.send(JSON.stringify({id: message.id, result: {ok: true}}));
  });
});

const peerCount = 30;
const clients = await Promise.all(
  Array.from(
    {length: peerCount},
    () =>
      new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://127.0.0.1:${address.port}`, {perMessageDeflate: false});
        client.once('open', () => resolve(client));
        client.once('error', reject);
      }),
  ),
);
const latencies = [];
await Promise.all(
  clients.map(
    (client, index) =>
      new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const timer = setTimeout(
          () => reject(new Error(`Mock CDP peer ${index} timed out`)),
          1_000,
        );
        client.once('message', () => {
          clearTimeout(timer);
          latencies.push(performance.now() - startedAt);
          resolve();
        });
        client.send(
          JSON.stringify({
            id: index + 1,
            method: 'Input.dispatchKeyEvent',
            params: {type: 'keyDown'},
          }),
        );
      }),
  ),
);
clients.forEach(client => client.close());
await new Promise(resolve => server.close(resolve));

latencies.sort((left, right) => left - right);
const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
if (p95 >= 250) throw new Error(`30-peer CDP smoke exceeded latency target: ${p95.toFixed(1)}ms`);

console.log(
  JSON.stringify(
    {
      nativeAddon: 'ok',
      permissions,
      peers: peerCount,
      p95LatencyMs: Number(p95.toFixed(1)),
    },
    null,
    2,
  ),
);
