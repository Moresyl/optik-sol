/**
 * IIFE 构建的入口：`<script src>` 直接引时用这一个文件。
 *
 * 这里没有手写 `window.Optik = ...`。IIFE 产物的外层是
 * `var Optik = (function(){ ... return api })()`，而经典脚本里顶层 `var`
 * 本身就会在 window 上建属性——手动再赋一次反而会和 rollup 的赋值打架。
 *
 * ESM 使用者走 `src/index.ts`，不会执行这里的任何副作用。
 */

import * as api from './index';
import { autoMount } from './index';

declare global {
  interface Window {
    Optik: typeof api;
  }
}

autoMount();

export default api;
