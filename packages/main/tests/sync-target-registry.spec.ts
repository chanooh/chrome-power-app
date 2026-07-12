import {Window} from 'happy-dom';
import {describe, expect, test} from 'vitest';
import type {CdpClient} from '../src/sync/cdp-client';
import {CdpTargetRegistry, type SyncCdpTarget} from '../src/sync/target-registry';

describe('sync semantic target resolution', () => {
  test('finds a link after dynamic wrapper and sibling changes', async () => {
    const browserWindow = new Window({url: 'https://search.example/'});
    browserWindow.document.body.innerHTML = `
      <section class="random-wrapper-812">
        <aside>Advertisement</aside>
        <div><a href="https://www.reddit.com/"><span>Reddit - The heart of the internet</span></a></div>
      </section>
    `;
    const link = browserWindow.document.querySelector('a')!;
    link.getBoundingClientRect = () =>
      ({left: 20, top: 30, width: 240, height: 40, right: 260, bottom: 70, x: 20, y: 30, toJSON: () => ({})}) as DOMRect;
    const client = {
      send: async (method: string, params: {expression?: string}) => {
        if (method !== 'Runtime.evaluate') return {};
        const value = browserWindow.eval(params.expression || 'undefined');
        return {result: {value}};
      },
    } as unknown as CdpClient;
    const registry = new CdpTargetRegistry(client);
    const target: SyncCdpTarget = {
      targetId: 'page-1',
      sessionId: 'session-1',
      type: 'page',
      title: 'Search',
      url: 'https://search.example/',
      kind: 'ordinary',
      createdAt: Date.now(),
    };
    registry.targets.set(target.targetId, target);

    await expect(
      registry.resolveElement(target, {
        tag: 'a',
        href: 'https://www.reddit.com/',
        text: 'Reddit - The heart of the internet',
      }),
    ).resolves.toMatchObject({confidence: 'high'});
  });
});
