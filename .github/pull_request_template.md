## What changed / 改了什么

<!-- One sentence. Link issues with "Closes #123". -->
<!-- 一句话说清楚。关联 Issue 请写 Closes #123 -->

## How it breaks without this / 改之前会怎么坏

<!-- More useful than the section above. Not "added a copy button", but
     "once logs exceed one screen, the copy entry is pushed out of view
     and users only notice after scrolling down". -->
<!-- 这一栏比上一栏有用：不写「加了一个复制按钮」，写「日志行超过一屏后，
     底部的复制入口被挤出可视区，用户滚下去才发现按钮跑了」。 -->

## Verification / 验证

- [ ] `pnpm typecheck` passes / 通过
- [ ] `pnpm build` passes / 通过
- [ ] UI changes confirmed on **a real device or touch emulation** (screenshot / recording attached) / UI 改动已在**真机或触摸仿真**下确认（附截图或录屏）
- [ ] New class names: `packages/ui/src/generated/uno.css` regenerated / 新增 class 名已重新生成
- [ ] Instrumentation changes: the host page is fully restored after `destroy()` / 插桩改动后 `destroy()` 能完全还原宿主页面
- [ ] New UI copy is in Chinese, including `aria-label` / `title` / 界面新增文案是中文

<!-- Delete rows that do not apply; do not tick boxes to fill the list. -->
<!-- 不适用的项直接删掉，不用打勾凑数 -->

## Screenshots / 截图

<!-- Required for UI changes. Phone screenshots are best — they also show
     whether touch targets are large enough. -->
<!-- UI 改动请附上。手机上截的最好，能同时看出触控目标够不够大。 -->
