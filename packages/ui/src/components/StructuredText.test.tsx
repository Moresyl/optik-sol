import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { CopyController } from './Copy';
import { HighlightedCode, StructuredTextView } from './StructuredText';
import {
  detectCodeLanguage,
  formattedStructuredText,
  isJsonContainerText,
  parseJsonDocument,
  tokenizeCodeLine,
} from '../structured-text';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function copier(): CopyController & { copy: ReturnType<typeof vi.fn>; reveal: ReturnType<typeof vi.fn> } {
  const copy = vi.fn((_text: string, _label?: string) => true);
  const reveal = vi.fn((_text: string, _title?: string) => undefined);
  return {
    copy,
    reveal,
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
}

function click(host: HTMLElement, text: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  button.click();
}

describe('structured text helpers', () => {
  it('recognises declared JSON scalars and shape-safe JSON containers', () => {
    expect(parseJsonDocument('true', 'application/problem+json')?.value).toBe(true);
    expect(parseJsonDocument('{"ok":true}')?.formatted).toContain('\n  "ok": true\n');
    expect(parseJsonDocument('{broken}', 'application/json')).toBeNull();
    expect(parseJsonDocument('{"ok":true}', undefined, 4)).toBeNull();
    expect(isJsonContainerText('[1,2]')).toBe(true);
    expect(isJsonContainerText('"text"')).toBe(false);
  });

  it('detects common response/code formats and tokenises JSON semantics', () => {
    expect(detectCodeLanguage('<html></html>', 'text/html')).toBe('html');
    expect(detectCodeLanguage('{broken}', 'application/json')).toBe('json');
    expect(detectCodeLanguage('curl https://example.test')).toBe('shell');
    expect(detectCodeLanguage('a=1&b=2', 'application/x-www-form-urlencoded')).toBe('form');
    const tokens = tokenizeCodeLine('  "answer": 42, "ok": true', 'json');
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: '"answer"', kind: 'key' }),
        expect.objectContaining({ text: '42', kind: 'number' }),
        expect.objectContaining({ text: 'true', kind: 'boolean' }),
      ]),
    );
    expect(formattedStructuredText('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(tokenizeCodeLine('<main data-id="42">', 'html')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'main', kind: 'tag' }),
        expect.objectContaining({ text: 'data-id', kind: 'attr' }),
        expect.objectContaining({ text: '"42"', kind: 'string' }),
      ]),
    );
    expect(tokenizeCodeLine('color: #ff0000;', 'css')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'color', kind: 'key' }),
        expect.objectContaining({ text: '#ff0000', kind: 'string' }),
      ]),
    );
  });
});

describe('StructuredTextView', () => {
  it('renders expandable JSON, highlighted code, formatted copy, and raw reveal', () => {
    const controller = copier();
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(
      render(
        () => (
          <StructuredTextView
            text='{"user":{"name":"Ada"},"active":true}'
            mimeType="application/json"
            label="响应体"
            copier={controller}
          />
        ),
        host,
      ),
      () => host.remove(),
    );

    expect(host.textContent).toContain('树形结构');
    expect(host.textContent).toContain('"user"');
    click(host, '全部展开');
    expect(host.textContent).toContain('"name"');
    expect(host.querySelector('[data-code-token="boolean"]')?.textContent).toBe('true');

    click(host, '代码');
    expect(host.querySelector('[data-code-token="key"]')?.textContent).toContain('"user"');
    host.querySelector<HTMLButtonElement>('[title="复制响应体"]')!.click();
    expect(controller.copy).toHaveBeenCalledWith(expect.stringContaining('\n  "user"'), '响应体');
    click(host, '查看原文');
    expect(controller.reveal).toHaveBeenCalledWith(
      '{"user":{"name":"Ada"},"active":true}',
      '响应体',
    );
  });

  it('renders declared JSON scalars as highlighted code without meaningless tree controls', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    cleanups.push(
      render(
        () => (
          <StructuredTextView
            text="true"
            mimeType="application/problem+json"
            label="标量响应"
            copier={copier()}
          />
        ),
        host,
      ),
      () => host.remove(),
    );
    expect(host.textContent).toContain('JSON');
    expect(host.textContent).not.toContain('树形结构');
    expect(host.querySelector('[data-code-token="boolean"]')?.textContent).toBe('true');
  });

  it('collapses long code and keeps syntax rendering free of HTML injection', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const text = Array.from({ length: 15 }, (_, index) => `<tag data-i="${index}">`).join('\n');
    cleanups.push(
      render(
        () => <HighlightedCode text={text} language="html" expanded={false} />,
        host,
      ),
      () => host.remove(),
    );
    expect(host.textContent).toContain('还有 3 行…');
    expect(host.querySelector('tag')).toBeNull();
    expect(host.querySelectorAll('[data-code-token="tag"]')).toHaveLength(12);
  });

  it('pages large JSON branches instead of rendering the whole payload at once', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const value = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`entry-${index}`, index]),
    );
    cleanups.push(
      render(
        () => (
          <StructuredTextView
            text={JSON.stringify(value)}
            label="大响应体"
            copier={copier()}
          />
        ),
        host,
      ),
      () => host.remove(),
    );

    expect(host.textContent).toContain('Object(205)');
    expect(host.textContent).toContain('"entry-99"');
    expect(host.textContent).not.toContain('"entry-100"');
    click(host, '再显示 100 项（剩余 105 项）');
    expect(host.textContent).toContain('"entry-199"');
    expect(host.textContent).not.toContain('"entry-200"');
  });

  it('bounds expand-all traversal and pages long code by 500 lines', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const nested = Object.fromEntries(
      Array.from({ length: 10 }, (_, branch) => [
        `branch-${branch}`,
        Object.fromEntries(Array.from({ length: 100 }, (_, leaf) => [`leaf-${leaf}`, leaf])),
      ]),
    );
    const disposeTree = render(
      () => <StructuredTextView text={JSON.stringify(nested)} label="巨型树" copier={copier()} />,
      host,
    );
    click(host, '全部展开');
    expect(host.textContent).toContain('最多展开 500 个节点');
    expect(host.querySelectorAll('[data-code-token="key"]').length).toBeLessThanOrEqual(520);
    disposeTree();
    host.replaceChildren();

    const longCode = Array.from({ length: 620 }, (_, index) => `line ${index + 1}`).join('\n');
    cleanups.push(
      render(
        () => <StructuredTextView text={longCode} label="长文本" copier={copier()} />,
        host,
      ),
      () => host.remove(),
    );
    click(host, '展开代码（620 行）');
    expect(host.querySelectorAll('code')).toHaveLength(500);
    click(host, '再显示 120 行');
    expect(host.querySelectorAll('code')).toHaveLength(620);
  });
});
