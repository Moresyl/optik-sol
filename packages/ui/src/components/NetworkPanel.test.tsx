import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OptikKernel, type CaptureOptions, type NetworkRecord } from 'optik-core';
import { createStore, type Store } from '../store';
import type { CopyController } from './Copy';
import { NetworkPanel } from './NetworkPanel';

const NO_CAPTURE: CaptureOptions = {
  console: false,
  exceptions: false,
  rejections: false,
  resourceErrors: false,
  cspViolations: false,
  xhr: false,
  fetch: false,
  beacon: false,
  websocket: false,
  eventSource: false,
  resourceTiming: false,
  longTasks: false,
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function record(patch: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id: patch.id ?? 'net:1',
    initiator: patch.initiator ?? 'fetch',
    method: patch.method ?? 'GET',
    url: patch.url ?? 'https://example.test/api',
    name: patch.name ?? 'api',
    origin: patch.origin ?? 'https://example.test',
    query: patch.query ?? [],
    requestHeaders: patch.requestHeaders ?? [],
    responseHeaders: patch.responseHeaders ?? [],
    phase: patch.phase ?? 'complete',
    status: patch.status ?? 200,
    timing: patch.timing ?? { startTime: 0, duration: 12 },
    ...patch,
  };
}

function mount(records: NetworkRecord[]): {
  host: HTMLDivElement;
  kernel: OptikKernel;
  store: Store;
  copy: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
} {
  const kernel = new OptikKernel({ capture: NO_CAPTURE });
  for (const item of records) kernel.network.onStart(item);
  const store = createStore(kernel);
  const copy = vi.fn(() => true);
  const reveal = vi.fn();
  const copier: CopyController = {
    copy,
    reveal,
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  cleanups.push(
    render(() => <NetworkPanel store={store} kernel={kernel} copier={copier} />, host),
    () => store.dispose(),
    () => kernel.dispose(),
    () => host.remove(),
  );
  return { host, kernel, store, copy, reveal };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

describe('NetworkPanel', () => {
  it('classifies traffic and combines kind, failure, and address filters', () => {
    const { host } = mount([
      record({ id: 'api', name: 'users', url: 'https://example.test/api/users' }),
      record({
        id: 'script',
        initiator: 'resource',
        name: 'app.js',
        url: 'https://cdn.test/app.js',
        origin: 'https://cdn.test',
        responseType: 'script',
      }),
      record({
        id: 'image',
        initiator: 'resource',
        name: 'hero.webp',
        url: 'https://cdn.test/hero.webp',
        origin: 'https://cdn.test',
        phase: 'failed',
        status: undefined,
        error: 'offline',
      }),
    ]);

    expect(host.textContent).toContain('接口1');
    expect(host.textContent).toContain('JS1');
    expect(host.textContent).toContain('图片1');

    button(host, '仅失败').click();
    expect(host.textContent).toContain('hero.webp');
    expect(host.textContent).not.toContain('app.js https://cdn.test');

    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'missing';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(host.textContent).toContain('没有匹配的请求');

    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    button(host, '图片1').click();
    expect(host.textContent).toContain('hero.webp');
  });

  it('renders a replayable detail, safe zero timings, body actions, and copy output', () => {
    const { host, copy, reveal } = mount([
      record({
        method: 'POST',
        url: "https://example.test/api?name=o'hara",
        name: 'submit',
        query: [['name', "o'hara"]],
        requestHeaders: [['X-Name', "o'hara"]],
        requestBody: { text: '{"hello":"world"}', mimeType: 'application/json', size: 17 },
        responseHeaders: [['Content-Type', 'application/json']],
        responseBody: { text: '{"ok":true}', mimeType: 'application/json', size: 11 },
        status: 201,
        statusText: 'Created',
        timing: { startTime: 0, duration: 1250, dns: 0, tcp: 0, tls: 0, ttfb: 0, download: 0 },
        fromCache: true,
      }),
    ]);

    host.querySelector<HTMLButtonElement>('.optik-row > button')!.click();
    expect(host.textContent).toContain('cURL 命令');
    expect(host.textContent).toContain('1.25 s');
    expect(host.textContent).toContain('来自缓存');
    expect(host.querySelector<HTMLElement>('[title="DNS 解析"]')!.style.width).toBe('0%');

    host.querySelector<HTMLButtonElement>('[title="复制cURL 命令"]')!.click();
    expect(copy).toHaveBeenCalledWith(
      expect.stringContaining("'https://example.test/api?name=o'\\''hara'"),
      'cURL 命令',
    );
    expect(String(copy.mock.calls[copy.mock.calls.length - 1]?.[0])).toContain(
      "-H 'X-Name: o'\\''hara'",
    );

    button(host, '查看原文').click();
    expect(reveal).toHaveBeenCalledWith('{"hello":"world"}', '请求体');
    button(host, '‹ 返回').click();
    expect(host.textContent).toContain('submit');
  });

  it('shows websocket frames without offering an invalid cURL command', () => {
    const { host } = mount([
      record({
        initiator: 'websocket',
        method: 'GET',
        url: 'wss://example.test/socket',
        name: 'socket',
        frames: [
          { direction: 'send', timestamp: 1, opcode: 'text', payload: 'ping', size: 4 },
          { direction: 'receive', timestamp: 2, opcode: 'text', payload: 'pong', size: 4 },
        ],
      }),
    ]);

    host.querySelector<HTMLButtonElement>('.optik-row > button')!.click();
    expect(host.textContent).toContain('帧记录（2）');
    expect(host.textContent).toContain('↑ 发送');
    expect(host.textContent).toContain('↓ 接收');
    expect(host.textContent).not.toContain('cURL 命令');
  });

  it('exports privacy-safe HAR and clears the live list', async () => {
    const { host, copy } = mount([
      record({ requestHeaders: [['Authorization', 'Bearer secret']] }),
    ]);

    host.querySelector<HTMLButtonElement>('[title^="复制全部请求 HAR"]')!.click();
    const har = String(copy.mock.calls[copy.mock.calls.length - 1]?.[0]);
    expect(har).toContain('Optik');
    expect(har).not.toContain('Bearer secret');

    button(host, '清空').click();
    await vi.waitFor(() => expect(host.textContent).toContain('暂无请求'));
  });
});
