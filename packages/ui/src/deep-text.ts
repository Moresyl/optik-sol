/**
 * 把一个已镜像的对象**完整**展开成文本，供复制使用。
 *
 * 日志行上显示的那一行（`entry.text`）是 core 在写入时算好的浅层预览：
 * 只取前几个键、超出的用 `…` 收尾。它的任务是让人一眼扫过去，不是让人把数据拿走。
 * 复制走的如果也是这一行，那么把 localStorage 整个导出来、复制、粘贴到别处，
 * 得到的是 `Object {token: "eyJ…", user: "…", …}`——省略号本身被复制走了，等于没复制。
 *
 * 这里换一条路：顺着 `objectId` 用 `getProperties` 一层层真的走下去，
 * 输出 JSON 形状的多行文本。之所以不是严格合法的 JSON——函数、Symbol 键、
 * 循环引用、已经被释放的句柄，这几样在 JSON 里没有对应写法，
 * 硬塞进去只能丢掉信息。保留它们的描述（`ƒ foo()`、`「循环引用 → Object」`）
 * 比伪装成一份能被 `JSON.parse` 吃下去的文本有用：人是读得懂的，
 * 而如果真的需要机器可读，用户自己会写 `JSON.stringify`。
 */

import type { OptikKernel, PropertyDescriptor, RemoteObject } from 'optik-core';

/**
 * 两条硬上限，都不是为了排版好看。
 *
 * 深度挡的是原型链和自引用结构——`path` 已经能拦住严格意义上的环，
 * 但 `a.b.a2.b2…` 这种每层都是新对象的结构不成环，照样能一路走到栈溢出。
 * 节点数挡的是 `document`、`window` 这类一展开就是几万个节点的东西：
 * 用户点的是「复制」，不该换来几秒钟的卡死。
 */
const MAX_DEPTH = 6;
const MAX_NODES = 800;

/** 用方括号列出来的：数组、定型数组，以及 Map/Set（它们的条目也是按下标编号的）。 */
function isListLike(node: RemoteObject): boolean {
  return (
    node.subtype === 'array' ||
    node.subtype === 'typedarray' ||
    node.subtype === 'map' ||
    node.subtype === 'set'
  );
}

/** 走不下去的那一层：原始值，或者我们决定不再展开的东西。 */
function leafToText(node: RemoteObject): string {
  if (node.type === 'string') return JSON.stringify(node.value ?? '');
  // NaN / Infinity / -0 / 123n —— JSON 表达不了，core 已经把字面量算好放这儿了。
  if (node.unserializableValue !== undefined) return node.unserializableValue;
  if (node.subtype === 'null') return 'null';
  if (node.type === 'undefined') return 'undefined';
  if (node.type === 'number' || node.type === 'boolean') return String(node.value);
  return node.description;
}

export function remoteObjectToDeepText(remote: RemoteObject, kernel: OptikKernel): string {
  /**
   * `getProperties` 每返回一个子值，都会把它重新 retain 进注册表一次。
   * 不还回去的话，「复制一次」就等于把整棵树永久钉在内存里——
   * 这个面板敢在页面里挂几个小时，靠的正是「句柄的生命周期跟着日志走」这条不变量，
   * 复制不该是那条不变量的例外。所以把这一趟新拿到的句柄全记下来，
   * 走完一次性 release，净持有量为零。
   *
   * 注意释放的是「这趟借的那一份」：同一个对象如果本来就被某条日志持有，
   * 引用计数从 2 减到 1，值仍然活着，那条日志照样能展开。
   */
  const borrowed: string[] = [];
  /** 当前这条路径上的 objectId，用来发现环。 */
  const path: string[] = [];
  let budget = MAX_NODES;

  const walk = (node: RemoteObject, depth: number, pad: string): string => {
    if (node.objectId === undefined || node.subtype === 'null') return leafToText(node);
    // 函数展开出来是一堆内部属性，没有人想要；`ƒ name()` 这个描述才是有用的部分。
    if (node.type === 'function') return node.description;
    if (path.includes(node.objectId)) return `「循环引用 → ${node.description}」`;
    if (depth >= MAX_DEPTH) return `「${node.description} 层级过深，未展开」`;

    const properties = kernel.log.getProperties(node.objectId, { ownProperties: true });
    // 句柄没了：这条日志已经老到被环形缓冲挤出去，值不再被持有。
    // 这时候安静地打印个 `{}` 是在撒谎，得把「拿不到了」说出来。
    if (properties === null) return `「${node.description}（已不再持有）」`;

    // 借据要在这里一次记全：下面的循环可能因为预算耗尽提前 break，
    // 但 getProperties 已经把**所有**属性都 retain 过了，漏记就是漏还。
    for (const property of properties) {
      for (const child of [property.value, property.get, property.set]) {
        if (child?.objectId !== undefined) borrowed.push(child.objectId);
      }
    }

    const listLike = isListLike(node);
    const inner = `${pad}  `;
    const rows: string[] = [];
    let truncated = false;

    path.push(node.objectId);
    for (const property of properties) {
      // `[[Prototype]]` 这类内部槽位：调试对象结构时有用，复制数据时是噪音。
      if (property.name.startsWith('[[')) continue;
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget--;
      rows.push(inner + renderProperty(property, listLike, depth, inner));
    }
    path.pop();

    if (truncated) rows.push(`${inner}…`);

    const [open, close] = listLike ? ['[', ']'] : ['{', '}'];
    // 数组的方括号自己就说明了类型；Map(3) / Set(2) / Uint8Array(8) 不写就看不出来。
    const label = listLike && node.subtype !== 'array' ? `${node.description} ` : '';
    if (rows.length === 0) return `${label}${open}${close}`;
    return `${label}${open}\n${rows.join(',\n')}\n${pad}${close}`;
  };

  const renderProperty = (
    property: PropertyDescriptor,
    listLike: boolean,
    depth: number,
    inner: string,
  ): string => {
    let value: string;
    if (property.value) value = walk(property.value, depth + 1, inner);
    // 取值器不主动调用：读一个 getter 可能有副作用，而复制是个只读动作。
    else if (property.get) value = '「取值器，未求值」';
    else value = 'undefined';
    return listLike ? value : `${JSON.stringify(property.name)}: ${value}`;
  };

  try {
    return walk(remote, 0, '');
  } catch {
    // A custom protocol bridge or hostile host object may still throw while a deeper
    // level is being materialised. Copying is a read-only convenience: degrade to an
    // explicit marker instead of breaking the whole panel.
    return `「${remote.description}（展开失败）」`;
  } finally {
    // `walk` can fail after one or more ancestor levels have already retained their
    // children. Always return those borrowed references, including exceptional paths.
    for (const objectId of borrowed) kernel.log.registry.release(objectId);
  }
}
