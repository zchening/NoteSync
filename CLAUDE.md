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
9. **组字态纪律（v7.3.2 定）**：compositionend 前的组字窗口内禁止 linkify/poll 等任何 DOM 手术——手术 detach 组字目标节点后 compositionend 不再冒泡，isComposing 永真卡死，光标消失且一切编辑被拦（bug c 事故）。linkifyEditor 入口必须 `if (isComposing) return;`（且先于 isLinkifying=true，防死锁形态）；editor blur 必须复位 isComposing=false（最后防线）；compositionend 必须补调 scheduleRemMarkRefresh 兜底重跑被拦下的手术。
10. **焦点归还纪律（v7.3.2 定）**：PC 端（CHIP_HOVER_OK）任何「关闭后回到编辑器」的模态/浮层路径必须归还焦点 `if (CHIP_HOVER_OK) { try { editor.focus(); ensureCaret(); } catch (e) {} }`（面板/提醒卡×2/菜单遮罩/关于/诊断/改口令取消与成功/扫码/历史版本恢复，共 11 处）；漏补 → 编辑器失焦、光标不绘制（bug c 事故）。跳转/接力路径（开新模态/跳页）不得误补。工具栏按钮须 pointerdown/mousedown preventDefault 防焦点抢夺。
11. **拆包纪律（v7.3.2 定）**：行首/行尾回车格式克隆占位标记拆包必须保 `<br>`——Blink insertParagraph 把新空块的 `<br>` 包进格式克隆标记（`<u class="rem-mark"><br></u>` 等），按 textContent 整体替换会把 `<br>` 一起销毁、空行塌缩、内容回跳（bug b 事故）。一律走 unwrapMark：空占位拆子节点、块级空占位补 br、行内空标记直接移除、非空标记遍历子节点保 BR。
12. **收敛采纳纪律（v7.3.3 定）**：干净设备（本机正文与 lastHtml 装饰等价）可自动采纳他端真实变更不弹条，但采纳前必须过 `cleanBody` 全守卫（`!pendingRemoteNote && isDraftBarHidden() && !isComposing && 恢复保护窗外 && isDecorativelyEqual(editor, lastHtml)`）——任一不满足、或解密失败/无法确认等价，一律挂起弹条，绝不静默吞；真实文本编辑必属「未保存脏」故永不误采纳（对抗审事故）。恢复内容必须经 `saveLocal(true)` force 落库且 force 意图 busy 时随补挂保留（pendingForceResave），恢复后 `lastRestoreAt` 3s 保护窗贯彻到 poll 级2 主路径（本机净也挂起不静默撤恢复）；系统通道 409 挂起与重试预算耗尽必须 `stashReminderDraft()` 落提醒草稿（防关页丢本轮提醒）。
13. **等价集同步纪律（v7.5.0 定）**：装饰/占位等价规则（isDecorativelyEqual / isPlaceholderEqual / blocksEqual+normPlaceholderHtml）消费点多处独立（poll 409×2、handleReminderConflict、autoMergeSave 合并器、restoreDraftIfNeeded、bodyChanged）——新增豁免形态必须 grep 全部消费点同步改，漏一处=冲突误报复发（v7.5.0 事故）。且 unwrapMark 延迟手术会把格式克隆壳 `<u class="rem-mark"><br></u>` 拆成真实空行 `<div><br></div>`——等价判定必须对手术前后两种形态都成立：壳可剥、真实空行保留块结构。键盘守卫禁止用 matchMedia('any-pointer:fine') 判鼠标（触屏笔/蓝牙鼠标恒命中，v7.4.0~v7.5.0 事故）。
14. **版本写回同步纪律（v7.6.0 定）**：任何会推进服务器版本的前置写（新建笔记落盐 `const rr = await apiPut({ ct: note.ct || '' ...})`、盐自愈 `const rr2 = await apiPut(...)`）成功后，除 `localVer = rr.v` 外**必须同步 `note.v = rr.v`**——因为紧随的 `applyUnlocked(key, note)` 里 `localVer = note.v || 0` 会用写前的旧快照把 localVer 覆盖回去（漏同步 → 首端 baseV 恒 0 撞服务器 v1 → server.js 永久 409、正文永不落库、加入端只读空版本，v7.6.0 事故）。回归纪律：测试必须覆盖**"空笔记名从零建笔记"**真实路径——`seedNote` 预建（带 salt）会跳过 `!note.salt` 落盐分支，是该 bug 的测试盲区（补 `tests/e2e/new_note_version.test.js` 真起 server 测）。
15. **toast 必配自动隐藏 + e2e 桩库 MIME（v7.6.0 定）**：每次 `showUploadStatus(text)` 之后**必须**配套 `setTimeout(hideUploadStatus, ms)` 且带"仅当 `uploadStatus.textContent` 仍是它才清"守卫（否则常驻、只能整页刷新才没，diagCopy「已复制诊断信息」漏排事故）。e2e 桩 `tests/e2e/server.js` 对懒加载库（`/html2canvas.min.js`、`/jsQR.js`）**必须返回合法 `application/javascript`**，不得让它们被 SPA 回退成 HTML——经典 `<script>` 把 HTML 当 JS 执行会抛 SyntaxError 污染 `pageerror`，令 `V529` 等"优雅降级"用例非确定红。

## 测试与发布纪律

- 改完必须全量回归：单元 + E2E + 相关探针全绿才算完成；**发版前四层测试闸（2026-09-07 用户硬规）**：A 单元全套 / B 模块定向 / C 全链路 e2e+新增场景 / D 逐条功能核对，多个子代理独立跑、各自出报告，全绿才准 commit/tag；任一红则修复后该层与下游重跑（撞 429 可降级为主线程直跑全套，不阻塞发版）
- 发布五件套：① 三 bump（`index.html` 的 `APP_VERSION` 三段式 + `android/app/build.gradle` 的 versionCode=去点/versionName + `tools/notesync-mcp-server.js` 的 serverInfo）→ ② README 更新历史（顶部插一行 `| vX.Y.Z | 日期 | 摘要 |`，摘要 ≤40 汉字）+ BUG_CHECKLIST 版本速查表 + MCP 工具表/边界表 → ③ annotated tag `vX.Y.Z`（**必须三段式**，CI 从 tag 注入 versionName；独立建 tag + `git tag -l` 核实，绝不与 push 链式）→ ④ 推送 main + tag → ⑤ **立即部署服务器**：新建 `deploy_target_vX.Y.Z.json`（含 version/src_dir/files/markers/forbidden）并跑 `python D:/Users/zchen/Documents/WorkBuddyProject/NoteSync/deploy_gen.py`，公网域名验证 APP_VERSION 变新。**⑤不可省**：app 联网热更新永远先抓线上 index.html（MainActivity shouldInterceptRequest），网页版也直读服务器——漏部署则网页版与 app 全部停留在旧版（v7.3.0~v7.3.2 曾三连漏，服务器停在 7.2.1 用户实测 bug 依旧）
- **必须推送 GitHub**：提交后 push main + push tag（三通道不稳交替重试，以 `git ls-remote` 为准；漏推会让 GitHub 滞后——v5.19/v5.20 曾犯）。push tag 触发 GitHub Actions 云构建 release APK（`.github/workflows/build-apk.yml`，4 个 ANDROID_KEYSTORE* Secrets 必须在位）
- 部署只走 `D:/Users/zchen/Documents/WorkBuddyProject/NoteSync/deploy_gen.py` + `deploy_target_*.json`（**spec 必须带 src_dir**；清单不含凭据，密码读 `C:/Temp/new_server_pwd.txt`；常传 index.html + tools/notesync-mcp-server.js）。验证走公网域名 `note.xuyinji.com.cn` / `biji.xuyinji.com.cn`（均 Caddy 反代同后端；直连裸 IP 无 Host 匹配会被 302 拦截，故不走裸 IP）或 localhost；大文件传后必须二次实抓复验

## 深入文档

| 要了解 | 去哪 |
|---|---|
| 用法 / 部署架构 / 版本更新历史 | `README.md` |
| 历史 bug 根因与核对要点（A-S 类） | `BUG_CHECKLIST.md` |
| 回归探针清单与断言 | `tests/e2e/_probe_*.js` 头部注释 |
