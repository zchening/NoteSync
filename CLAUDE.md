# CLAUDE.md — NoteSync 工作规则

E2E 加密便签（浏览器端 AES-256-GCM + PBKDF2，服务器只见密文）。单文件前端 `index.html` + 零依赖后端 `server.js`。线上 124.221.92.225（Windows 服务 NoteSync，:8080）。

## 命令速查

```bash
cd tests && node --test unit/*.test.js      # jsdom 单元测试
cd tests && node --test e2e/*.test.js       # Playwright E2E（flow/sync/userbugs）
node tests/e2e/_probe_<name>.js             # 各专项回归探针（退出码 0 为全绿）
```

- Node 用 `C:/Users/zchen/.workbuddy/binaries/node/versions/22.22.2-2/node.exe`（**带 -2**）；playwright 装在 `tests/node_modules`，**探针脚本必须放在 `tests/` 子树内**否则 MODULE_NOT_FOUND
- 涉保存/解锁的探针必须 spawn 真实 `server.js`（localhost 安全上下文）；about:blank setContent 页无 crypto.subtle/localStorage。纯 DOM 探针可 setContent 加载 index.html（替换 html2canvas src）
- jsdom 坑（v5.51 实锤）：顶层 `const` 不挂 window，测试要注入 mock 就让函数内**每次读 `window.X`**（不缓存 const）；每个 jsdom 测试末尾必须 `dom.window.close()`，否则 node --test 进程 SIGTERM 不退出

## 红线（违反即回归，全部有历史事故背书）

1. **linkify 只走 DOM API**（`buildLinkSafe`：createTextNode + createElement('a') 属性赋值）。禁止 innerHTML 字符串拼接链接——v5.19 前存储型 XSS（I1）。
2. **URL 正则字符类必须排除 CJK 区段**；`trimUrlTrailing` 只修尾部中文标点，ASCII 尾部不动（保护 `...(B)` 类合法 URL）。
3. **选区操作只用 `setSel`/`setCaret`**。禁止 `removeAllRanges()+addRange()`——会打断 Chromium 原生撤销事务分组（F11 教训）。
4. **任何移动/替换"含选区锚点节点"的 DOM 手术**，前后必须 `saveSelectionBlocked`/`restoreSelectionInBlock` 保存恢复选区（linkifyEditor、pasteTextNative 同款）。`ensureBlockWrapped` 包裸文本节点会把选区折叠成元素偏移、光标跳行尾（v5.19 实测）。
5. **编辑器根下必须全为块级子节点**（`ensureBlockWrapped` 收口）；裸文本挂根 Chromium 不绘制光标（F7）。
6. **撤销栈纪律**：用户 input 压栈（recordIfChanged）；程序化改动（linkify/poll/粘贴收尾整理）只 `syncCurrentState()` 不压栈；`historyUndo/historyRedo` 不触发 linkify、不参与首尾空行清理；回车类输入（insertParagraph/insertLineBreak）绝不清理空块（bug 4）。
7. **fetchRetry 对 4xx 不重试**（锁定/非法名等客户端错误，重试只浪费时间）。
8. **保存/冲突纪律（v7.3.0 定）**：baseV 一律 localVer（SSE 只触发 poll，绝不抬 baseV）；409 后必须**解密远端正文与本机比较再决策**（AES-GCM 随机 IV，绝不比 ct/iv），真实差异挂起弹条绝不静默覆盖；提醒系统 409 走系统通道只合并列表、不弹用户条。

## 测试与发布纪律

- 改完必须全量回归：单元 + E2E + 相关探针全绿才算完成；**发版前四层测试闸（2026-09-07 用户硬规）**：A 单元全套 / B 模块定向 / C 全链路 e2e+新增场景 / D 逐条功能核对，多个子代理独立跑、各自出报告，全绿才准 commit/tag；任一红则修复后该层与下游重跑（撞 429 可降级为主线程直跑全套，不阻塞发版）
- 发布四件套：三 bump（`index.html` 的 `APP_VERSION` 三段式 + `android/app/build.gradle` 的 versionCode=去点/versionName + `tools/notesync-mcp-server.js` 的 serverInfo）→ README 更新历史（顶部插一行 `| vX.Y.Z | 日期 | 摘要 |`，摘要 ≤40 汉字）+ BUG_CHECKLIST 版本速查表 + MCP 工具表/边界表 → annotated tag `vX.Y.Z`（**必须三段式**，CI 从 tag 注入 versionName；独立建 tag + `git tag -l` 核实，绝不与 push 链式）
- **必须推送 GitHub**：提交后 push main + push tag（三通道不稳交替重试，以 `git ls-remote` 为准；漏推会让 GitHub 滞后——v5.19/v5.20 曾犯）。push tag 触发 GitHub Actions 云构建 release APK（`.github/workflows/build-apk.yml`，4 个 ANDROID_KEYSTORE* Secrets 必须在位）
- 部署只走 `D:/Users/zchen/Documents/WorkBuddyProject/NoteSync/deploy_gen.py` + `deploy_target_*.json`（**spec 必须带 src_dir**；清单不含凭据，密码读 `C:/Temp/new_server_pwd.txt`；常传 index.html + tools/notesync-mcp-server.js）。验证走公网域名 `note.xuyinji.com.cn` / `biji.xuyinji.com.cn`（均 Caddy 反代同后端；直连裸 IP 无 Host 匹配会被 302 拦截，故不走裸 IP）或 localhost；大文件传后必须二次实抓复验

## 深入文档

| 要了解 | 去哪 |
|---|---|
| 用法 / 部署架构 / 版本更新历史 | `README.md` |
| 历史 bug 根因与核对要点（A-M 类） | `BUG_CHECKLIST.md` |
| 回归探针清单与断言 | `tests/e2e/_probe_*.js` 头部注释 |
