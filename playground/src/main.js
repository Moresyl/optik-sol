/**
 * 真机验证台。
 *
 * 这里的每个按钮都对应一个**已知会让同类工具出问题的场景**，
 * 不是随便造的样例数据：
 *  - 循环引用 → 天真的 JSON.stringify 会抛栈溢出
 *  - 十万元素数组 → 一次性序列化会冻结主线程数秒
 *  - Map / Set / Symbol / BigInt / 函数 → JSON 会静默丢掉它们
 *  - 跨 realm 的对象（iframe）→ instanceof 判断会失效
 *  - 图片 404 → error 事件不冒泡，只有捕获阶段能拿到
 *  - 不透明跨域响应 → 浏览器不允许读 body，工具必须如实说明而不是显示空白
 */

import { mount } from 'optik-sol';

const optik = mount({ theme: 'auto' });

// 一个演示插件：证明插件不需要依赖 Solid，返回原生 DOM 即可。
optik.use({
  id: 'demo',
  label: '示例插件',
  render(context) {
    const root = document.createElement('div');
    root.style.cssText = 'padding:12px;font-size:13px;line-height:1.6';
    root.innerHTML = `
      <p>插件拿到的是完整的内核实例，也复用了面板的复制能力
      （在非 HTTPS 环境下同样保证复制成功）。</p>`;

    const button = document.createElement('button');
    button.textContent = '复制当前全部日志';
    button.style.cssText =
      'min-height:44px;padding:0 12px;margin-top:8px;border-radius:8px;' +
      'border:1px solid var(--optik-border);background:var(--optik-bg-elevated);color:inherit';
    button.onclick = () => {
      const text = context.kernel.log
        .entries()
        .map((entry) => entry.text)
        .join('\n');
      context.copy(text, '插件导出');
    };

    root.appendChild(button);
    return root;
  },
});

// ---- 局域网地址 ------------------------------------------------------------
// 地址和二维码都由 vite.config.js 里的插件在服务端注入（见那里的注释：
// 浏览器自己查不到 192.168.x.x，只有 Vite 知道自己绑在哪些网卡上）。

renderLan();

function renderLan() {
  const root = document.getElementById('lan');
  const entries = window.__OPTIK_LAN__ ?? [];
  if (!root) return;

  if (entries.length === 0) {
    root.innerHTML =
      '<p class="hint">没有检测到局域网地址。确认开发服务器是用 <code>--host</code> 启动的，' +
      '并且本机至少连上了一个网络。</p>';
    return;
  }

  const qr = document.createElement('div');
  qr.className = 'qr';

  const urls = document.createElement('div');
  urls.className = 'urls';

  const inputs = [];

  entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'row';

    // 用真正的 input 而不是 readonly 文本：手机上长按能直接选中，
    // 桌面上复制按钮走 select() + execCommand。
    const input = document.createElement('input');
    input.className = 'addr';
    input.value = entry.url;
    input.spellcheck = false;
    input.addEventListener('focus', () => select(index));
    inputs.push(input);

    const copy = document.createElement('button');
    copy.className = 'copy';
    copy.textContent = '复制';
    copy.addEventListener('click', () => {
      input.select();
      input.setSelectionRange(0, input.value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      if (!ok && navigator.clipboard) navigator.clipboard.writeText(entry.url).catch(() => {});
      copy.textContent = ok ? '已复制' : '请长按选择';
      setTimeout(() => (copy.textContent = '复制'), 1400);
    });

    row.append(input, copy);
    urls.appendChild(row);
  });

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    entries.length > 1
      ? '有多个地址时优先试第一个；172.16–172.31 段通常是 WSL / 虚拟机网卡，手机连不上。点其它地址可切换二维码。'
      : '手机和电脑要在同一个局域网内。';

  urls.appendChild(hint);
  root.append(qr, urls);

  function select(index) {
    qr.innerHTML = entries[index].svg;
    inputs.forEach((input, i) => input.classList.toggle('active', i === index));
  }

  select(0);
}

/** 往指定分区里挂一个按钮。 */
function action(section, label, run) {
  const button = document.createElement('button');
  button.textContent = label;
  button.onclick = run;
  document.getElementById(section).appendChild(button);
}

// ---- 日志 ------------------------------------------------------------------

action('logs', 'log / info / warn', () => {
  console.log('普通日志', 42, true, null, undefined);
  console.info('信息级别');
  console.warn('警告级别');
});

action('logs', 'debug / error', () => {
  console.debug('调试级别');
  console.error('错误级别');
});

action('logs', '%c 样式化输出', () => {
  console.log('%c带样式的日志%c 后面是普通文本', 'color:#e91e63;font-weight:bold', '');
});

action('logs', '重复日志（应合并计数）', () => {
  for (let i = 0; i < 12; i++) console.log('这条日志重复了很多次');
});

action('logs', '分组', () => {
  console.group('外层分组');
  console.log('组内第一条');
  console.group('内层分组');
  console.log('嵌套内容');
  console.groupEnd();
  console.groupEnd();
});

action('logs', 'console.table', () => {
  console.table([
    { 名称: '张三', 年龄: 28, 城市: '北京' },
    { 名称: '李四', 年龄: 34, 城市: '上海' },
  ]);
});

action('logs', 'count / time', () => {
  for (let i = 0; i < 3; i++) console.count('点击次数');
  console.time('耗时测量');
  setTimeout(() => console.timeEnd('耗时测量'), 120);
});

action('logs', '超长文本（验证换行与选中）', () => {
  console.log('长 token：' + 'eyJhbGciOiJIUzI1NiJ9.'.repeat(20));
});

// ---- 复杂值 ----------------------------------------------------------------

action('values', '循环引用', () => {
  const node = { name: '根节点', children: [] };
  const child = { name: '子节点', parent: node };
  node.children.push(child);
  node.self = node;
  console.log('循环引用对象：', node);
});

action('values', '十万元素数组', () => {
  console.log('大数组：', Array.from({ length: 100_000 }, (_, i) => i * 3));
});

action('values', '深层嵌套', () => {
  let deep = { 末端: '到底了' };
  for (let i = 20; i > 0; i--) deep = { [`第${i}层`]: deep };
  console.log('深层对象：', deep);
});

action('values', 'Map / Set', () => {
  console.log(
    'Map：',
    new Map([
      ['键一', { 值: 1 }],
      ['键二', [1, 2, 3]],
    ]),
  );
  console.log('Set：', new Set(['甲', '乙', '丙']));
});

action('values', 'JSON 无法表达的值', () => {
  console.log('函数：', function 具名函数(a, b) { return a + b; });
  console.log('箭头函数：', (x) => x * 2);
  console.log('Symbol：', Symbol('标识'));
  console.log('BigInt：', 9007199254740993n);
  console.log('特殊数值：', NaN, Infinity, -0);
  console.log('日期：', new Date());
  console.log('正则：', /^\d{4}-\d{2}-\d{2}$/gi);
});

action('values', 'DOM 节点', () => {
  console.log('元素：', document.body);
  console.log('节点集合：', document.querySelectorAll('button'));
});

action('values', '带 getter 的对象（不应被触发）', () => {
  let 触发次数 = 0;
  const object = {
    普通属性: '安全',
    get 危险属性() {
      触发次数 += 1;
      alert(`getter 被调用了 ${触发次数} 次——这是个 bug`);
      return '不该看到我';
    },
  };
  console.log('展开它，不应弹出任何提示：', object);
});

action('values', '跨 realm 对象（iframe）', () => {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  document.body.appendChild(frame);
  const otherArray = new frame.contentWindow.Array(1, 2, 3);
  // 这个数组来自另一个 realm，`instanceof Array` 为 false，
  // 只有 Object.prototype.toString 能正确识别它。
  console.log('跨 realm 数组（应显示为 Array）：', otherArray);
  frame.remove();
});

// ---- 错误 ------------------------------------------------------------------

action('errors', '未捕获异常', () => {
  setTimeout(() => {
    throw new Error('这是一个未捕获的异常');
  }, 0);
});

action('errors', '未处理的 Promise 拒绝', () => {
  Promise.reject(new Error('这个 Promise 没有 catch'));
});

action('errors', '嵌套错误（含 cause）', () => {
  try {
    try {
      JSON.parse('{ 这不是合法 JSON }');
    } catch (inner) {
      throw new Error('解析配置失败', { cause: inner });
    }
  } catch (error) {
    console.error(error);
  }
});

action('errors', '图片 404（不冒泡）', () => {
  const image = new Image();
  image.src = `/不存在的图片-${Date.now()}.png`;
  document.body.appendChild(image);
});

action('errors', '脚本 404', () => {
  const script = document.createElement('script');
  script.src = `/不存在的脚本-${Date.now()}.js`;
  document.head.appendChild(script);
});

// ---- 网络 ------------------------------------------------------------------

action('network', 'fetch JSON', () => {
  fetch('https://httpbin.org/json').then((response) => response.json());
});

action('network', 'fetch 404', () => {
  fetch('https://httpbin.org/status/404');
});

action('network', 'fetch POST（带请求体）', () => {
  fetch('https://httpbin.org/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Header': '演示' },
    body: JSON.stringify({ 消息: '你好', 时间戳: Date.now() }),
  });
});

action('network', 'XHR', () => {
  const request = new XMLHttpRequest();
  request.open('GET', 'https://httpbin.org/uuid');
  request.send();
});

action('network', 'sendBeacon', () => {
  const accepted = navigator.sendBeacon(
    'https://httpbin.org/post',
    JSON.stringify({ 事件: '页面离开' }),
  );
  console.log('浏览器是否接受了这次 beacon：', accepted);
});

action('network', 'WebSocket', () => {
  const socket = new WebSocket('wss://echo.websocket.org');
  socket.onopen = () => {
    socket.send('第一帧');
    socket.send(JSON.stringify({ 第二帧: true }));
    setTimeout(() => socket.close(), 1500);
  };
});

action('network', '不透明跨域响应', () => {
  // no-cors 下浏览器不允许读取 body，工具应当明确说明原因而不是显示空内容。
  fetch('https://example.com/', { mode: 'no-cors' });
});

action('network', '图片 / CSS（无 JS API）', () => {
  const image = new Image();
  image.src = `https://httpbin.org/image/png?t=${Date.now()}`;
});

action('network', '请求超时/中断', () => {
  const controller = new AbortController();
  fetch('https://httpbin.org/delay/5', { signal: controller.signal }).catch(() => {});
  setTimeout(() => controller.abort(), 600);
});

// ---- 存储 ------------------------------------------------------------------

action('storage', '写入测试数据', () => {
  localStorage.setItem('用户令牌', 'eyJhbGciOiJIUzI1NiJ9.' + 'x'.repeat(120));
  localStorage.setItem('用户配置', JSON.stringify({ 主题: '深色', 语言: 'zh-CN', 通知: true }));
  sessionStorage.setItem('会话标识', crypto.randomUUID());
  document.cookie = `演示Cookie=${Date.now()};path=/;max-age=3600`;
  console.log('已写入测试数据，切到「存储」标签查看');
});

action('storage', '写入大量条目', () => {
  for (let i = 0; i < 60; i++) localStorage.setItem(`批量键_${i}`, `值 ${i} · ${'内容'.repeat(10)}`);
  console.log('已写入 60 条');
});

action('storage', '清空 localStorage', () => {
  localStorage.clear();
  console.log('已清空');
});

console.log('调试台就绪。点击右下角悬浮按钮打开面板。');
