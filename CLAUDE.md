# CLAUDE.md — NoteSync 工作规则

E2E 加密便签（浏览器端 AES-256-GCM + PBKDF2，服务器只见密文）。单文件前端 `index.html` + 零依赖后端 `server.js`。线上 124.221.92.225（Windows 服务 NoteSync，:8080）。

## 命令速查

```bash
cd tests && node --test unit/*.test.js      # jsdom 单元测试
cd tests && node --test e2e/*.test.js       # Playwright E2E（flow/sync/userbugs）
node tests/e2e/_probe_<name>.js             # 各专项回归探针（退出码 0 为全绿）
```

- Node 用 `C:/Users/zchen/.workbuddy/binaries/node/versions/22.22.2/node.exe`；playwright 装在 `tests/node_modules`，**探针脚本必须放在 `tests/` 子树内**否则 MODULE_NOT_FOUND
- 涉保存/解锁的探针必须 spawn 真实 `server.js`（localhost 安全上下文）；about:blank setContent 页无 crypto.subtle/localStorage。纯 DOM 探针可 setContent 加载 index.html（替换 html2canvas src）

## 红线（违反即回归，全部有历史事故背书）

1. **linkify 只走 DOM API**（`buildLinkSafe`：createTextNode + createElement('a') 属性赋值）。禁止 innerHTML 字符串拼接链接——v5.19 前存储型 XSS（I1）。
2. **URL 正则字符类必须排除 CJK 区段**；`trimUrlTrailing` 只修尾部中文标点，ASCII 尾部不动（保护 `...(B)` 类合法 URL）。
3. **选区操作只用 `setSel`/`setCaret`**。禁止 `removeAllRanges()+addRange()`——会打断 Chromium 原生撤销事务分组（F11 教训）。
4. **任何移动/替换"含选区锚点节点"的 DOM 手术**，前后必须 `saveSelectionBlocked`/`restoreSelectionInBlock` 保存恢复选区（linkifyEditor、pasteTextNative 同款）。`ensureBlockWrapped` 包裸文本节点会把选区折叠成元素偏移、光标跳行尾（v5.19 实测）。
5. **编辑器根下必须全为块级子节点**（`ensureBlockWrapped` 收口）；裸文本挂根 Chromium 不绘制光标（F7）。
6. **撤销栈纪律**：用户 input 压栈（recordIfChanged）；程序化改动（linkify/poll/粘贴收尾整理）只 `syncCurrentState()` 不压栈；`historyUndo/historyRedo` 不触发 linkify、不参与首尾空行清理；回车类输入（insertParagraph/insertLineBreak）绝不清理空块（bug 4）。
7. **fetchRetry 对 4xx 不重试**（锁定/非法名等客户端错误，重试只浪费时间）。

## 测试与发布纪律

- 改完必须全量回归：单元 + E2E + 相关探针全绿才算完成；大版本上线前派独立子代理做盲测验证（v5.19 起惯例）
- 发布四件套：`index.html` 的 `APP_VERSION`/`BUILD_DATE` → README 更新历史条目 → BUG_CHECKLIST 对应条目/版本表 → git tag（纯版本号 `vN`）
- 部署只走 `D:/Users/zchen/Documents/WorkBuddyProject/NoteSync/deploy_gen.py` + `deploy_target_*.json`（清单不含凭据，密码读 `C:\Temp\new_server_pwd.txt`）。验证走服务器 localhost（域名 note.xuyinji.com.cn 因 ICP 备案暂停解析；直连 IP 会被拦截 302）

## 深入文档

| 要了解 | 去哪 |
|---|---|
| 用法 / 部署架构 / 版本更新历史 | `README.md` |
| 历史 bug 根因与核对要点（A-I 类） | `BUG_CHECKLIST.md` |
| 回归探针清单与断言 | `tests/e2e/_probe_*.js` 头部注释 |
