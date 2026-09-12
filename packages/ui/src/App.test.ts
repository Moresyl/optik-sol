import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLauncherPosition, readPanelHeight } from './App';

afterEach(() => localStorage.clear());

describe('App persisted layout', () => {
  it('falls back when storage access itself throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(readLauncherPosition()).toEqual({ x: -1, y: -1 });
    expect(readPanelHeight()).toBe(0.6);
    getItem.mockRestore();
  });

  it.each(['null', '"invalid"', '{"x":1}', '{broken']) (
    'rejects an invalid launcher position: %s',
    (raw) => {
      localStorage.setItem('optik:launcher-position', raw);
      expect(readLauncherPosition()).toEqual({ x: -1, y: -1 });
    },
  );

  it('restores finite launcher coordinates', () => {
    localStorage.setItem('optik:launcher-position', JSON.stringify({ x: 120, y: -4 }));
    expect(readLauncherPosition()).toEqual({ x: 120, y: -4 });
  });

  it.each([
    ['null', 0.6],
    ['"tall"', 0.6],
    ['0.1', 0.25],
    ['2', 0.92],
    ['0.7', 0.7],
    ['{broken', 0.6],
  ])('normalizes a persisted panel height of %s', (raw, expected) => {
    localStorage.setItem('optik:panel-height', raw);
    expect(readPanelHeight()).toBe(expected);
  });
});
