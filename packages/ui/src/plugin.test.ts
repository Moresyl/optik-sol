import { describe, expect, it, vi } from 'vitest';
import type { OptikKernel } from 'optik-core';
import { PluginRegistry, safely, type OptikPlugin, type PluginContext } from './plugin';

const context = {
  kernel: {} as OptikKernel,
  copy: () => undefined,
  reveal: () => undefined,
  log: () => undefined,
  theme: () => 'light' as const,
} satisfies PluginContext;

function plugin(id: string, onDispose = vi.fn()): OptikPlugin {
  return { id, label: id, render: () => document.createElement('div'), onDispose };
}

describe('PluginRegistry', () => {
  it('validates identity and reports only real registry changes', () => {
    const registry = new PluginRegistry();
    const changed = vi.fn();
    const unsubscribe = registry.subscribe(changed);
    expect(() => registry.register(plugin(''))).toThrow('id 和 label');

    const value = plugin('one');
    registry.register(value);
    registry.register(value);
    expect(registry.list()).toEqual([value]);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(registry.unregister('missing')).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('retires replaced and removed plugins for contextual cleanup', () => {
    const registry = new PluginRegistry();
    const first = plugin('same');
    const second = plugin('same');
    registry.register(first);
    registry.register(second);
    expect(registry.takeRetired()).toEqual([first]);
    expect(registry.takeRetired()).toEqual([]);

    expect(registry.unregister('same')).toBe(true);
    expect(registry.takeRetired()).toEqual([second]);
  });

  it('disposes live and not-yet-drained retired plugins exactly once', () => {
    const registry = new PluginRegistry();
    const firstDispose = vi.fn(() => {
      throw new Error('plugin cleanup failed');
    });
    const secondDispose = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registry.register(plugin('same', firstDispose));
    registry.register(plugin('same', secondDispose));

    registry.disposeAll(context);

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('[optik] 插件销毁失败：', expect.any(Error));
    expect(registry.list()).toEqual([]);
    expect(registry.takeRetired()).toEqual([]);
    warn.mockRestore();
  });

  it('isolates broken subscribers and tolerates self-unsubscription', () => {
    const registry = new PluginRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = vi.fn(() => {
      throw new Error('listener failed');
    });
    const selfRemoving = vi.fn();
    let offSelf: () => void = () => undefined;
    offSelf = registry.subscribe(() => {
      selfRemoving();
      offSelf();
    });
    registry.subscribe(broken);
    const healthy = vi.fn();
    registry.subscribe(healthy);

    expect(() => registry.register(plugin('one'))).not.toThrow();
    registry.register(plugin('two'));

    expect(selfRemoving).toHaveBeenCalledOnce();
    expect(broken).toHaveBeenCalledTimes(2);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('safely', () => {
  it('returns values and contains plugin exceptions', () => {
    expect(safely('测试', () => 42)).toBe(42);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(
      safely('测试', () => {
        throw new Error('broken');
      }),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[optik] 插件测试时出错：', expect.any(Error));
    warn.mockRestore();
  });
});
