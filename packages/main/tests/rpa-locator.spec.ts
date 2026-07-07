import {describe, expect, test} from 'vitest';
import {getRpaLocatorCandidates, getRpaLocatorQuality} from '../src/rpa/locator';

describe('rpa locator candidates', () => {
  test('orders semantic locators before legacy css fallback', () => {
    const candidates = getRpaLocatorCandidates({
      id: 'click-result',
      type: 'click',
      selector: 'div > div:nth-of-type(1) > div > span > a',
      text: 'Reddit',
      element: {
        tag: 'a',
        role: 'link',
        text: 'Reddit',
        href: 'https://www.reddit.com/',
        recordedUrl: 'https://www.google.com/search?q=reddit',
        quality: 'medium',
      },
      locators: [
        {type: 'href', value: 'https://www.reddit.com/', text: 'Reddit', score: 68},
        {type: 'text', value: 'Reddit', score: 48},
      ],
    });

    expect(candidates.map(candidate => candidate.type).slice(0, 3)).toEqual(['href', 'text', 'css']);
    expect(candidates[candidates.length - 1].value).toContain('nth-of-type');
  });

  test('detects low quality legacy css-only steps', () => {
    expect(
      getRpaLocatorQuality({
        id: 'brittle',
        type: 'click',
        selector: 'div > div:nth-of-type(1) > span',
      }),
    ).toBe('low');
  });
});
