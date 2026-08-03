# NoteSync

> 一个极简的端到端加密便签同步工具。多个设备，同一段文字和图片，几秒自动同步。

![端到端加密](https://img.shields.io/badge/加密-端到端-blue)
![零依赖](https://img.shields.io/badge/后端-零依赖-green)
![自托管](https://img.shields.io/badge/部署-自托管-orange)
![Cloudflare Tunnel](https://img.shields.io/badge/HTTPS-Cloudflare_Tunnel-success)
![夜间模式](https://img.shields.io/badge/主题-深色%2F浅色-purple)

---

# 📖 第一部分：使用指南

> 普通用户看这一部分就够了。

## 这是什么

我做了一个这样的小工具，用于多个设备自动同步文本和图片。

比如你想要在电脑和手机上同步一段文字，或者一张截图。

## 快速开始

**第 1 步**：在 PC 浏览器输入 `https://note.xuyinji.com.cn/xxx`（记为**网址 A**），其中 `xxx` 是任意英文、数字或两者组合。首次访问需要输入一个口令（记为**口令 a**，比如 `12345` 或 `zhangsan`）。

**第 2 步**：在手机浏览器输入**网址 A**，同理手机首次访问也要输入**口令 a**。

**第 3 步**：然后两个设备间输入任何文字或 emoji 表情，自动在几秒内同步。

```mermaid
sequenceDiagram
    participant PC as 💻 电脑
    participant Cloud as ☁️ 网站
    participant Phone as 📱 手机
    PC->>Cloud: ① 打开网址 + 输口令
    Cloud-->>PC: ② 笔记打开
    PC->>Cloud: ③ 输入文字
    Phone->>Cloud: ④ 打开同一网址 + 输同一口令
    Cloud-->>Phone: ⑤ 文字自动出现
    Note over PC,Phone: ⑥ 之后两边随便打字，几秒自动同步
```

## 使用场景

### 场景一：临时分享

如果你要在自己设备和别人的设备同步文件，可以随便输入个 URL，比如 `https://note.xuyinji.com.cn/tmp`，然后随便输个口令比如 `111`，用完以后不再使用就行了。

```mermaid
flowchart LR
    A["💻 你<br/>打开网址 /tmp<br/>输口令 111"] --> B["☁️ 网站"]
    C["📱 朋友<br/>打开同一网址<br/>输同一口令"] --> B
    A -->|"你输入文字"| B
    B -.->|"几秒后<br/>朋友手机出现"| C
    style A fill:#bbf,stroke:#333
    style C fill:#cfc,stroke:#333
```

### 场景二：常用笔记

可以设定一个 URL 作为常用的网址，比如 `https://note.xuyinji.com.cn/zhangsan`。然后在 PC 浏览器上保存这个网址，同时在手机浏览器把这个网址保存到手机桌面（看上去像 app 图标一样），以后就可以随时在自己的多个设备之间同步内容。

```mermaid
flowchart TD
    subgraph 一次设置
        A["💻 电脑<br/>收藏书签"] --> D["🔖 网址 /zhangsan"]
        B["📱 手机<br/>添加到桌面<br/>（像 app 图标）"] --> D
    end
    subgraph 以后随时用
        D --> E["💻 点书签打开"]
        D --> F["📱 点图标打开"]
        E <-->|"打字自动同步"| F
    end
    style D fill:#bbf,stroke:#333
    style E fill:#cfc,stroke:#333
    style F fill:#cfc,stroke:#333
```

### 多笔记互不干扰

每个 URL 对应一个唯一的口令，互相完全隔离。你可以按用途创建多个笔记：

```mermaid
flowchart TD
    A["📖 /zhangsan<br/>你的日记本<br/>口令：随便定一个长的"]
    B["📋 /tmp<br/>临时记事本<br/>口令：111"]
    C["📝 /meeting<br/>会议记录本<br/>口令：8888"]
    A --> D["各管各的<br/>互不干扰"]
    B --> D
    C --> D
    style A fill:#cfc,stroke:#333
    style B fill:#fcc,stroke:#333
    style C fill:#bbf,stroke:#333
    style D fill:#ffd,stroke:#333
```

> 目前没做口令修改功能。要换口令就新建一个 URL，旧的不管就行。

## 安全说明

### 你的内容只有你能看

口令是端到端加密的——服务器只存密文，加解密全在浏览器完成。所以虽然是我开发的，但我也没法知道你输入的内容。这就是"零知识"设计。

简单说：**你输的口令和文字，从没离开过你的浏览器**。服务器上存的是一堆看不懂的乱码，连我也解不开。

### 防爆破保护

为防止有人拿到你的网址后暴力试口令，系统会自动锁定：

- 同一个设备连续输错口令 **10 次**，这个网址会被锁住 **30 分钟**
- 锁住期间谁也进不去（即使口令对了也不行）
- 所以建议常用笔记用长一点的口令（比如一句话），临时分享用短口令无所谓

### 图片同步

除了文字，也支持图片同步。三种上传方式：

- **粘贴**：Ctrl+V 粘贴截图，自动上传并显示
- **拖拽**：把图片文件拖进编辑区
- **按钮**：点上传按钮（细线 SVG 图标）选择图片

图片上传后直接显示在文字中间，可以像文字一样删除、剪切、复制。图片不加密（明文存第三方图床），文字仍端到端加密。

### 超链接与手机号

笔记中的 `http://` 和 `https://` 开头的网址会自动变成可点击的金色链接，点击在新标签页打开。中国大陆手机号（1 开头 11 位）也会自动识别为可点击链接，移动端点击直接跳转拨号界面。无论是粘贴、手动输入还是其他设备同步来的内容，都会自动识别并转为链接。点击链接不会进入编辑模式。

### 删除线

选中文字后点击右上角删除线按钮（带横线的 T 图标），给选中文字添加删除线；再次选中已加删除线的文字点击按钮即可取消。支持跨行选中、部分取消（只取消选中部分的删除线，不影响同行其他文字）。

### 夜间模式

按北京时间自动切换：07:00 切换日间模式，19:00 切换夜间模式。每分钟检查一次，页面刷新后恢复自动模式。也可手动点太阳/月亮按钮切换，手动切换后本次会话不再自动切换。

### 复制与导出

- **复制到剪贴板**：复制全部内容（文字+图片），粘贴到 Notion / Word / 小米笔记 / iPhone 备忘录等支持富文本的应用时图文保留；粘贴到微信、飞书等纯文本输入框时只保留文字
- **导出为图片**：将编辑区渲染为 PNG 图片并复制到剪贴板，可直接 Ctrl+V 粘贴到聊天窗口

### 实时同步

编辑后自动保存，其他设备通过 SSE（Server-Sent Events）亚秒级收到更新并自动加载。连接断开时自动重试 + SSE 自动重连 + 轮询兜底，确保各种网络环境下都能恢复同步。

### PWA 支持

手机浏览器打开后，可"添加到主屏幕"作为独立应用使用，全屏体验、自定义 SVG 图标、离线可打开缓存页面。浏览器标签页标题显示为 "NoteSync"。每个笔记的快捷方式会打开对应笔记（而非默认笔记），Chrome 和小米浏览器均支持。

---

---

# 🔧 第二部分：技术细节

> 开发者或想自己部署的人看这一部分。

## 技术架构

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | 原生 HTML/JS | contenteditable 编辑器，Web Crypto API |
| 加密 | AES-256-GCM | 对称加密，IV 随机生成 |
| 密钥派生 | PBKDF2 | 20 万次迭代，SHA-256 |
| 图片存储 | Cloudinary | 浏览器直传，Unsigned Upload Preset |
| 图片压缩 | Canvas API | 上传前压缩至 1920px，JPEG 85% |
| 实时同步 | SSE (Server-Sent Events) | 服务端推送更新通知，亚秒级同步 |
| 截图导出 | html2canvas | 编辑区渲染为 PNG，2x 分辨率 |
| PWA | manifest.json + Service Worker | 可安装到主屏幕，离线可打开 |
| 后端 | Node.js | 零依赖，单文件 `server.js` |
| 存储 | JSON 文件 | 每笔记独立 `data/notes/{id}.json` |
| 反代 | nginx | HTTP-only（端口 80），HTTP/1.1 |
| 隧道 | Cloudflare Tunnel | 出站隧道绕过运营商 SNI 干扰，Cloudflare 负责 HTTPS |
| 进程管理 | nssm | Windows 服务，开机自启 |

```mermaid
flowchart TD
    Browser[浏览器] -->|HTTPS| CF[Cloudflare 边缘]
    CF -->|加密隧道| Tunneld[cloudflared 出站]
    Tunneld -->|HTTP :80| Nginx[nginx :80]
    Nginx -->|反代| Node[Node.js :8080]
    Node -->|读写| Storage[(data/notes/*.json)]
    Browser -->|加解密| Crypto[Web Crypto API]
    style Browser fill:#bbf,stroke:#333
    style CF fill:#cfc,stroke:#333
    style Tunneld fill:#ffd,stroke:#333
    style Nginx fill:#cfc,stroke:#333
    style Node fill:#fcc,stroke:#333
    style Storage fill:#f9f,stroke:#333
    style Crypto fill:#bbf,stroke:#333
```

### 加密流程

```mermaid
flowchart LR
    A[口令] --> B[PBKDF2<br/>20 万次迭代]
    B --> C[AES-256-GCM 密钥]
    C --> D[加密明文]
    D --> E[密文]
    E --> F[服务器只存密文]
    F --> G[其他设备拉取密文]
    G --> H[浏览器解密]
    H --> I[显示明文]
    style A fill:#bbf,stroke:#333
    style F fill:#f9f,stroke:#333,stroke-width:2px
    style I fill:#cfc,stroke:#333
```

**关键点**：口令从不离开浏览器，服务器和管理员都看不到明文。

### 图片同步方案

图片采用第三方图床方案，**不经过你的服务器**，零流量消耗：

```mermaid
flowchart LR
    A[浏览器] -->|压缩 1920px| B[Canvas]
    B -->|直传| C[Cloudinary]
    C -->|返回 URL| A
    A -->|URL 存入加密文本| D[你的服务器]
    D -->|密文| E[其他设备]
    E -->|解密显示图片| F[从 Cloudinary 拉取]
    style A fill:#bbf,stroke:#333
    style C fill:#cfc,stroke:#333
    style D fill:#fcc,stroke:#333
    style F fill:#cfc,stroke:#333
```

| 设计决策 | 选择 | 原因 |
|---------|------|------|
| 图片存储 | Cloudinary | 免费额度足够个人用 |
| 上传方式 | Unsigned Upload Preset | 无需暴露 API Secret |
| 图片加密 | 不加密 | 能用 Cloudinary 变换，复杂度低 |
| 服务器流量 | 零 | 浏览器直传 Cloudinary |
| 压缩 | 1920px / JPEG 85% | 兼顾质量和体积 |
| 编辑器 | contenteditable | 图片内嵌显示，可删除/剪切 |

自部署需在 `index.html` 中替换 Cloudinary 配置（`CLOUD_NAME` 和 `UPLOAD_PRESET`），并在 Cloudinary 控制台创建 Unsigned Upload Preset。

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/note/:id` | 读取笔记密文 |
| PUT | `/api/note/:id` | 写入笔记密文 |
| POST | `/api/fail/:id` | 上报解密失败（用于限流） |
| GET | `/healthz` | 健康检查 |
| GET | `/*` | 返回前端页面（SPA 路由） |

### 限流机制

- 限流维度：IP + noteId 组合
- 失败阈值：10 次
- 计数窗口：10 分钟（窗口内无新失败则清零）
- 锁定时长：30 分钟（锁定期间连正确口令也拒）
- 存储方式：内存 Map，服务重启清零

## 自部署

### Linux（一键脚本）

```bash
bash install.sh
```

脚本自动安装 Node.js、nginx、certbot，配置 HTTPS 和 systemd 服务。

### Windows（手动）

1. 安装 [Node.js 20+](https://nodejs.org/) 和 [nginx](https://nginx.org/en/docs/windows.html)
2. 部署 `server.js`、`index.html`、`nginx.conf`（或站点配置）到目标目录
3. 用 [nssm](https://nssm.cc/) 注册 Node 为 Windows 服务（服务名 `NoteSync`）
4. nginx 配置为 HTTP-only（端口 80），TLS 由 Cloudflare 负责
5. 安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 并创建 Cloudflare Tunnel
6. DNS 创建 CNAME 记录指向 `{tunnel-id}.cfargotunnel.com`（橙云代理）

> **为什么用 Tunnel**：国内服务器直接暴露 443 端口会触发运营商 SNI 检查和 RST 注入，80 端口触发备案拦截。Cloudflare Tunnel 使用出站连接绕过这两层限制。

### noteId 规则

- 允许字符：`a-z` `A-Z` `0-9` `_` `-`
- 长度：1-32 字符
- 不符合规则的 URL 返回 400

## 限制

- 每个笔记是单编辑区，不支持富文本格式（纯文字 + 图片 + 链接 + 删除线）
- last-write-wins 合并策略，同时编辑可能覆盖（SSE 实时推送 + 版本号检测）
- 限流数据存内存，服务重启清零
- 无口令修改功能（新建 URL 代替）
- 无笔记列表页（知道 URL 才能访问）

## 更新历史

- **v5.10**：光标"不可绘制位置"修复（承接 v5.9）——v5.9 的 `repaintCaret()`（切换 caret-color 触发重绘）对"能打字但光标不可见"仍无效。用户带 `?diag` 截图揭示真正根因：**`getClientRects()=0`、`bcr=0,0,0,0`**——光标落在 `\r\n` 换行符中间（offset=1），Chromium 无法计算绘制坐标。新增 `relocateCaretToVisible()`：在 `ensureCaret()` 合法选区分支增加** rects=0 检测**，若光标在"不可绘制位置"则广度优先搜索最近的有可见 rect 的文本偏移（当前 offset±N → 同块其他非空文本节点 → 相邻块），逐个尝试取第一个 `getClientRects()>0` 的位置落点。探针 `_probe_f12.js` 7/7 全绿，headless 中成功复现 rects=0→relocate 后 rects=1
- **v5.9**：光标"看得见"修复（承接 v5.8）——v5.8 解决了「选区失效导致无光标且无法输入」，但用户实测发现另一半问题：**选中一行按空格后光标不显示、却能正常打字**。能打字说明选区合法，问题不在选区而在**绘制**：linkify 大幅重排 DOM 后，caret 布局位置完全正确（`getClientRects()` 有值、块高正常、focus 正常），但 Chromium 的 caret 绘制相位未被刷新。新增 `repaintCaret()`——**只切换 `caret-color`（transparent → 下一帧还原）触发 paint invalidation，不动 DOM、不动选区、不动焦点**；`linkifyEditor()` 收尾改调 `ensureCaret(true)`。不采用 `blur()+focus()`（虽最可靠但会打断中文输入法组字、吞拼音），并新增 `isComposing` 组字保护。踩坑记录：最初版本在重绘时顺手重设了同位置选区，**打断浏览器撤销事务分组导致 Ctrl+Z 失效**（探针 11/11→9/11），去掉后恢复。另新增 `?diag` 光标诊断浮层（右下角实时只读显示 focus / rects / caret 位置 / 块高 / DOM 片段，`pointer-events:none` 不抢焦点，不带参数零开销）——因 caret 类问题在 headless 环境完全无法复现，需要一条从真实浏览器直接取读数的通道
- **v5.8**：光标常驻修复——新增 `ensureCaret()` 兜底：解锁载入内容、`linkifyEditor` 规范化、`cleanupLeadingTrailingBreaks` 删除空块等任何改动 DOM 的操作后，若 `window.getSelection()` 指向已被销毁/移动的节点而失效（表现为"无光标、无法输入/粘贴"），则在内容末尾显式重建一个合法折叠光标（仅当选区非法时动作，用户主动选中的文本不被打扰）。修复"解锁后无光标"与"选中+空格后无光标"两类场景，满足"除选中态外任何时刻常驻光标"的诉求。移除原"先 focus 再整体替换 innerHTML"的隐患顺序
- **v5.7**：光标不绘制 / 吞行 / 撤销错乱 修复——`ensureBlockWrapped()` 由"存在一个块就整体跳过"改为**逐子节点包裹**：凡 editor 根下非 `<div>/<p>` 的直接子节点（裸文本节点、或浏览器块合并产生的裸 `<span>` 等无语义元素）都各自收进新建 `<div>`，不再有"整体早退"。修复 F7 残留的"逐字输两行后首行裸文本节点与 div 做兄弟不被包裹 → Chromium 不绘制光标"，以及由此连带的"选中第一行+空格吞掉第二行""Ctrl+Z 把两行顺序错乱"。位置仍在 `linkifyEditor()` 的 500ms 防抖内，不破坏逐字输入；新增字面复现探针 `tests/e2e/_probe_blockwrap.js`（逐字输两行→选中+空格→继续输入→Ctrl+Z 严格回放，11/11 全绿）
- **v5.6**：粘贴光标不显示修复——粘贴纯文本到空编辑器时 `insertNodeAtCaret` 会把文本作为裸文本节点直接插到 `#editor` 根下（无 `<div>` 包裹），而浏览器原生逐字输入会自动包进 `<div>`；contenteditable 根下的裸文本节点属非法结构，导致 Chromium 不绘制光标（粘贴"一二三"→选中按空格后光标逻辑正确但视觉不可见，逐字输入则正常）。修复：空编辑器粘贴时把文本先包进 `<div>` 再插入；新增 `ensureBlockWrapped()` 兜底（把根下裸文本/裸元素收进 `<div>`），并放在 `linkifyEditor()` 的 500ms 防抖内执行以避免与原生逐字输入竞争破坏按键
- **v5.5**：backspace 合并行修复——首部空块删除增加 `caretAfterNode` 守卫，光标落在该空块之后时不再误删，修复"首行空块被吞、内容整体上移"（`cleanupLeadingTrailingBreaks` 只护光标所在块不够，还要护光标之后的块）
- **v5.4**：链接识别与 href 修复——linkify 改为"先拆后建"：先把自动链接 `<a data-url="1">` 拆回纯文本、再拍平 Chromium 块合并时产生的无语义 `<span>`、`editor.normalize()` 合并相邻文本节点、最后从文本重新生成 `<a>`。修复链接文字改动后 href 陈旧、以及链接中间回车拆分再合并时结尾段丢失
- **v5.3**：编辑器四项修复——回车无反应（`cleanupLeadingTrailingBreaks` 误删刚创建的空行，改为按 inputType 门控 + 保护光标所在空块）；网址自动识别（裸域名 + 左边界断言 `(?<![@\w.-])` + TLD 白名单，修复 `x@y.com`、版本号误判）；光标乱跳（跨块选区改用块内偏移，不再用编辑器全局字符偏移）；光标偶尔消失（input 监听器无差别 cleanup 改按 inputType 分流）
- **v5.2**：选区与同步修复——`poll()` 远端更新改为偏移保存/恢复光标（不再因替换 innerHTML 丢光标）；粘贴网址改用 `insertNodeAtCaret` 直接插节点（兼容 `text/uri-list`），修复粘贴不自动成链接；删除多行选区后新增 `cleanupLeadingTrailingBreaks` 清理首/尾孤立换行，修复光标跳行；`poll` 增加 dirty 守卫，编辑中收到远端更新不再覆盖当前未保存输入
- **v5.1**：删除线与导出图片修复——删除线 `rangeIntersectsNode` 的 `compareBoundaryPoints` 比较运算符对调修复边界检测失效（Chrome 实际行为与规范描述相反）；`contentHasS` 改为只计非空 `<s>` 标签，修复取消后重新加删除线无效；长 URL 断行修复（CSS `overflow-x:hidden` + `overflow-wrap:anywhere` + `word-break:break-all`，`file:///` 和 `ftp://` 协议纳入 linkify，长文本在分隔符后插入零宽空格）；导出图片改为临时 div 渲染（不修改 editor 内容，消除页面刷新），`line-height:2.2` 防行间重叠，`pointerdown`/`touchstart`/`click` 三事件跨平台支持，所有 button 加 `type="button"` 防默认提交
- **v5.0**：视觉升级——全新配色（暖纸白 #FBFBF8 + 墨色 #1C1C1A + 金色 #8F7126，深色模式纯墨黑 #0F0F11）；emoji 图标全部替换为 1.7px 细线 SVG；编辑器收窄为 720px 居中阅读栏（17px 字号、1.9 行距）；落地页 Georgia 衬线大字 + 入场动画；解锁弹窗毛玻璃模糊背景；选中文本金色高亮、细滚动条；小米浏览器夜间模式对抗 CSS 同步更新新色值。同时修复：favicon 改为透明底金色细线图标（与顶栏 logo 一致）+ 版本号绕过 Cloudflare/浏览器双重缓存；manifest.json 主题色更新为金色 #8F7126、背景色 #FBFBF8、图标路径加版本号；导出图片文字重叠彻底修复（TreeWalker 安全遍历 + 长 URL 零宽空格断词 + word-break CSS + finally 恢复样式 + SecurityError 跨域提示）
- **v4.5**：根路径改为极简首页（不再跳转到默认笔记，提供输入框直接打开笔记）；夜间模式自动切换时间调整为 07:00 日间/19:00 夜间；修复小米浏览器手动切换夜间模式失效（!important 对抗 CSS 注入）；修复移动端导出图片失败（TreeWalker 改递归遍历 + 不支持剪贴板时降级下载）
- **v4.4**：PWA 快捷方式修复——manifest.json 动态返回每个笔记的 start_url，Chrome 安装/创建快捷方式时打开对应笔记而非默认笔记
- **v4.3.1**：修复单行选中删除线无效问题——TreeWalker 根节点为文本节点时改用其父元素，使单行内选中文字能正确添加/取消删除线
- **v4.3**：删除线功能重写——逐个文本节点包裹 `<s>` 保留行结构（修复跨行选中导致多出换行）；取消删除线时区分完全/部分覆盖（修复误伤同行其他文字）；选区位置改用字符偏移量保存恢复（修复 normalize 后选区偏移）；夜间模式改为按北京时间自动切换（04:59 日间/19:05 夜间，手动切换后本次会话停止自动）；index.html 添加 no-cache 头防止移动端缓存旧版
- **v4.2**：删除线功能——选中文字点击按钮加删除线，再次点击取消；使用 Bootstrap Icons 图标
- **v4.1**：UI 优化——自定义 favicon 图标（SVG 笔记本样式）、浏览器标题简化为 "NoteSync"、根路径自动跳转到默认笔记、手机号自动识别为可点击 tel: 链接（移动端点击拨号）
- **v4.0**：Cloudflare Tunnel 接入——Caddy 改为 HTTP-only（端口 80），cloudflared 出站隧道绕过运营商 SNI 检查/RST 注入和备案拦截；DNS 从 A 记录改为 CNAME 指向 `*.cfargotunnel.com`；Cloudflare SSL 模式 Flexible
- **v3.3**：服务器稳定性修复——停掉宝塔 nginx 解决端口 80 冲突、停掉 deveco/mimo 释放 500MB 内存、Caddy 降级 HTTP/1.1 only 解决 HTTP/2+SSE 兼容性
- **v3.2**：修复 SSE 连接不稳定（Caddy flush_interval -1 + 服务端 15 秒心跳保活）；URL 自动检测改为 input 事件触发（不依赖 paste，移动端也能识别）
- **v3.1**：去掉冲突提示恢复自动同步、PWA 支持（可安装到主屏幕）、连接失败自动重试、SSE 断线自动重连、"退出本机"改为"退出"
- **v3.0**：SSE 实时推送（替代 4 秒轮询）、复制到剪贴板 + 导出为图片、冲突保护（编辑时不覆盖）、上传图标改 📤、关闭 HTTP/3 强制 HTTP/2、nginx CSP 修复、install.sh 域名参数化
- **v2.3**：修复桌面端点击超链接进入编辑模式的问题（改用 mousedown 拦截）；index.html 禁止缓存确保始终加载最新版本
- **v2.2**：点击超链接直接在新标签页打开（不进入编辑模式）
- **v2.1**：粘贴 URL 自动转为可点击链接
- **v2.0**：图片同步（Cloudinary 图床）+ 夜间模式
- **v1.0**：初始版本，纯文字端到端加密同步

## License

MIT
