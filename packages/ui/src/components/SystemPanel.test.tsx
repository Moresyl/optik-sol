import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OptikKernel, type SystemInfo } from 'optik-core';
import type { CopyController } from './Copy';
import { SystemPanel } from './SystemPanel';

const kernels: OptikKernel[] = [];
const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const kernel of kernels.splice(0)) kernel.dispose();
});

function systemInfo(longTaskTiming: boolean): SystemInfo {
  return {
    userAgent: 'TestBrowser/1',
    platform: 'test',
    language: 'zh-CN',
    client: 'Test Browser',
    viewport: { width: 390, height: 844, dpr: 3 },
    screen: { width: 390, height: 844 },
    safeArea: { top: 0, right: 0, bottom: 34, left: 0 },
    timing: { ttfb: 12 },
    capabilities: { longTaskTiming },
  };
}

function renderPanel(longTaskTiming = true): {
  host: HTMLDivElement;
  kernel: OptikKernel;
  copy: ReturnType<typeof vi.fn>;
} {
  const kernel = new OptikKernel({ capture: { console: false } });
  kernels.push(kernel);
  vi.spyOn(kernel.system, 'info').mockReturnValue(systemInfo(longTaskTiming));
  const copy = vi.fn(() => true);
  const copier: CopyController = {
    copy,
    reveal: vi.fn(),
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  disposers.push(
    render(
      () => (
        <SystemPanel
          kernel={kernel}
          copier={copier}
          theme="light"
          onThemeChange={vi.fn()}
        />
      ),
      host,
    ),
    () => host.remove(),
  );
  return { host, kernel, copy };
}

describe('SystemPanel long-task diagnostics', () => {
  it('reacts to records, presents a bounded recent list, and clears it', () => {
    const { host, kernel } = renderPanel();
    kernel.performance.onLongTask({
      id: kernel.performance.nextId(),
      startTime: 120,
      duration: 76,
      name: 'self',
      attribution: [],
    });

    expect(host.textContent).toContain('1 次 · 累计 76 ms · 最长 76 ms');
    expect(host.textContent).toContain('+120 ms');

    const clear = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '清空记录',
    );
    expect(clear).toBeDefined();
    clear!.click();
    expect(host.textContent).toContain('0 次 · 累计 0 ms · 最长 0 ms');
  });

  it('copies long-task evidence without URL credentials, query, or fragment', () => {
    const { host, kernel, copy } = renderPanel();
    kernel.performance.onLongTask({
      id: kernel.performance.nextId(),
      startTime: 1,
      duration: 51,
      name: 'cross-origin-descendant',
      attribution: [
        {
          containerType: 'iframe',
          containerSrc: 'https://user:pass@example.test/embed?token=secret#fragment',
          containerId: '',
          containerName: '',
        },
      ],
    });

    const copyButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '复制',
    );
    copyButton!.click();
    const exported = String(copy.mock.calls[0]?.[0]);
    expect(exported).toContain('https://example.test/embed');
    expect(exported).not.toContain('user:pass');
    expect(exported).not.toContain('token=secret');
    expect(exported).not.toContain('#fragment');
  });

  it('explains unsupported browsers instead of rendering empty diagnostics', () => {
    const { host } = renderPanel(false);
    expect(host.textContent).toContain('当前浏览器不支持');
    expect(host.textContent).not.toContain('清空记录');
  });
});
