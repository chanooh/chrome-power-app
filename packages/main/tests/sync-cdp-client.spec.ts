import {afterEach, describe, expect, test} from 'vitest';
import {WebSocketServer} from 'ws';
import {CdpClient} from '../src/sync/cdp-client';

const servers: WebSocketServer[] = [];
afterEach(() => servers.splice(0).forEach(server => server.close()));

describe('raw CDP client', () => {
  test('preserves command ids, session ids and events', async () => {
    const server = new WebSocketServer({port: 0});
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('Missing WebSocket address');

    server.on('connection', socket => {
      socket.on('message', raw => {
        const request = JSON.parse(raw.toString());
        socket.send(JSON.stringify({id: request.id, sessionId: request.sessionId, result: {echo: request.params.value}}));
        socket.send(JSON.stringify({method: 'Target.targetCreated', params: {targetInfo: {targetId: 'page-1'}}}));
      });
    });

    const client = new CdpClient(`ws://127.0.0.1:${address.port}`);
    await client.connect();
    const event = new Promise(resolve => client.on('Target.targetCreated', resolve));
    await expect(client.send<{echo: number}>('Runtime.evaluate', {value: 42}, 'session-1')).resolves.toEqual({echo: 42});
    await expect(event).resolves.toMatchObject({method: 'Target.targetCreated'});
    client.close();
  });

  test('times out commands without leaking pending requests', async () => {
    const server = new WebSocketServer({port: 0});
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('Missing WebSocket address');
    const client = new CdpClient(`ws://127.0.0.1:${address.port}`, 20);
    await client.connect();
    await expect(client.send('Never.responds')).rejects.toThrow('timed out');
    client.close();
  });
});
