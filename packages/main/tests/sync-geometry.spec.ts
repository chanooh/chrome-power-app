import {describe, expect, test} from 'vitest';
import {containsPoint, mapRelativePoint} from '../src/sync/geometry';

describe('macOS sync geometry', () => {
  test('maps relative coordinates across differently positioned windows', () => {
    const mapped = mapRelativePoint(
      {x: -1440, y: 30, width: 1200, height: 800},
      {x: 80, y: 60, width: 600, height: 400},
      -840,
      430,
    );
    expect(mapped).toEqual({x: 380, y: 260});
  });

  test('clamps coordinates and supports negative monitor origins', () => {
    const mapped = mapRelativePoint(
      {x: -1000, y: -100, width: 500, height: 500},
      {x: 0, y: 0, width: 1000, height: 800},
      -1200,
      700,
    );
    expect(mapped).toEqual({x: 0, y: 800});
    expect(containsPoint({x: -1000, y: -100, width: 500, height: 500}, -750, 0)).toBe(true);
  });

  test('rejects invalid source bounds', () => {
    expect(() =>
      mapRelativePoint(
        {x: 0, y: 0, width: 0, height: 100},
        {x: 0, y: 0, width: 100, height: 100},
        0,
        0,
      ),
    ).toThrow('Source window bounds are invalid');
  });
});
