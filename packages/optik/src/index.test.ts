import { afterEach, describe, expect, it } from 'vitest';
import { autoMount, instance } from './index';

afterEach(() => {
  instance()?.destroy();
  document.querySelectorAll('script[data-optik]').forEach((script) => script.remove());
});

function addScript(attributes: Record<string, string> = {}): HTMLScriptElement {
  const script = document.createElement('script');
  script.setAttribute('data-optik', '');
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  document.head.appendChild(script);
  return script;
}

describe('autoMount script configuration', () => {
  it('applies the declarative long-task capacity', () => {
    addScript({ 'data-max-long-tasks': '1' });
    autoMount();
    const kernel = instance()!.kernel;
    kernel.performance.onLongTask({
      id: 'task:1',
      startTime: 0,
      duration: 50,
      name: 'self',
      attribution: [],
    });
    kernel.performance.onLongTask({
      id: 'task:2',
      startTime: 60,
      duration: 51,
      name: 'self',
      attribution: [],
    });
    expect(kernel.performance.longTasks().map((task) => task.id)).toEqual(['task:2']);
  });

  it('ignores invalid capacities and honors manual mode', () => {
    addScript({ 'data-max-long-tasks': 'NaN', 'data-optik-manual': '' });
    autoMount();
    expect(instance()).toBeNull();
  });
});
