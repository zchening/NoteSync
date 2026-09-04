# NoteSync

> 一个极简的端到端加密便签同步工具。多个设备，同一段文字和图片，几秒自动同步。

![端到端加密](https://img.shields.io/badge/加密-端到端-blue)
![零依赖](https://img.shields.io/badge/后端-零依赖-green)
![自托管](https://img.shields.io/badge/部署-自托管-orange)
![Caddy + DNSPod](https://img.shields.io/badge/HTTPS-Caddy%20%2B%20DNSPod-success)
![夜间模式](https://img.shields.io/badge/主题-深色%2F浅色-purple)

---

# 📖 第一部分：使用指南

> 普通用户看这一部分就够了。

## 这是什么

我做了一个这样的小工具，用于多个设备自动同步文本和图片。

比如你想要在电脑和手机上同步一段文字，或者一张截图。

## 快速开始

**第 1 步**：在 PC 浏览器输入 `https://note.xuyinji.com.cn/xxx`（记为**网址 A**），其中 `xxx` 是任意英文、数字或两者组合。首次访问需要输入一个口令（记为**口令 a**，比如 `12345` 或 `zhangsan`）。

**第 2 步**：在手机浏览器输入**网址 A**，同理手机首次访问也要输入**口令 a**。（也可以不输网址和口令：在已解锁的电脑上用「扫码配对」生成二维码，手机扫一下直接打开，见下文[扫码配对](#扫码配对添加新设备免输口令)。）

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

### 扫码配对（添加新设备，免输口令）

给笔记添加新设备时，不用敲网址、不用输口令：

1. 在已解锁的设备上，点右上角的「二维码」图标，二维码直接显示；
2. 新设备扫这个码，笔记直接打开；
3. 之后这台设备会记住密钥，像其它设备一样自动解锁、自动同步。

> **注意**：二维码里带着解锁密钥，**等同于口令**——只在自己的设备之间扫，不要截图发给别人。二维码显示 60 秒后自动隐藏，需要时再点一次图标即可。密钥放在网址 `#` 之后的部分，浏览器从不把它发给服务器，服务器依然只能看到密文。

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
| 反代 | Caddy（HTTPS） | 按 Host 分流：xuyinji.com.cn/www→静态根，note→反代 8080；Let's Encrypt 自签 |
| 隧道 | 无（DNSPod 直连） | 域名 DNSPod 解析到 124.221.92.225，Caddy 自签 HTTPS；已弃用 Cloudflare Tunnel |
| 进程管理 | nssm | Windows 服务，开机自启 |

```mermaid
flowchart TD
    Browser[浏览器] -->|HTTPS :443| Caddy[Caddy 反代+静态]
    Caddy -->|Host=note| Node[NoteSync :8080]
    Caddy -->|Host=xuyinji| Site[静态站 C:/Services/xuyinji]
    Node -->|读写| Storage[(data/notes/*.json)]
    Browser -->|加解密| Crypto[Web Crypto API]
    style Browser fill:#bbf,stroke:#333
    style Caddy fill:#cfc,stroke:#333
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

> 当前生产架构（2026-08 起）：反代用 **Caddy**（非 nginx），域名走 **DNSPod** 直连（非 Cloudflare Tunnel），Caddy 自签 Let's Encrypt HTTPS。Cloudflare Tunnel / cloudflared 已弃用。

1. 安装 [Node.js 20+](https://nodejs.org/)
2. 部署 `server.js`、`index.html`、`bridge.html`（配对中转页）到目标目录（如 `C:/Services/NoteSync/`）
3. 用 [nssm](https://nssm.cc/) 注册两个 Windows 服务：`NoteSync`（运行 `node server.js`，端口 8080）、`NoteSyncProxy`（运行 `caddy.exe`，读取 `Caddyfile` 做 HTTPS 反代/静态分流）
4. `Caddyfile` 按 Host 分流：`xuyinji.com.cn`/`www` → 静态根 `C:/Services/xuyinji/`（v5.26 起含 `/note/*` → 302 `note.xuyinji.com.cn/*` 配对短链中转，规避小米相机对 note 子域二维码的网址安全拦截）；`note.xuyinji.com.cn` → `https://` 反代 `127.0.0.1:8080`（含 `/bridge.html` 静态路由，兼容 v5.23-v5.25 旧配对码）。Caddy 自动 Let's Encrypt 签 HTTPS
5. DNSPod 加 A 记录 `xuyinji.com.cn`/`www`/`note` → 服务器 IP（DNS only，不开代理）
6. 腾讯云安全组 + Windows 防火墙放通 80/443

> **为什么不再用 Tunnel**：ICP 备案通过后，域名可合规直连国内服务器（DNSPod→124.221.92.225），Caddy 自签 HTTPS 满足 secure context（NoteSync 的 `crypto.subtle` 解锁前提）。Cloudflare 橙云会把域名解析到境外节点，触发接入商「解析指向境外」扫描→取消接入→ICP 作废，故必须灰云/直连。

### noteId 规则

- 允许字符：`a-z` `A-Z` `0-9` `_` `-`
- 长度：1-64 字符
- 中文及其它字符被拒绝（前后端一致，v5.15 起；`_` `-` 于 v5.19 恢复）
- 不符合规则的 URL 返回 400

## 限制

- 每个笔记是单编辑区，不支持富文本格式（纯文字 + 图片 + 链接 + 删除线）
- last-write-wins 合并策略，同时编辑可能覆盖（SSE 实时推送 + 版本号检测）
- 限流数据存内存，服务重启清零
- 无口令修改功能（新建 URL 代替）
- 无笔记列表页（知道 URL 才能访问）

## 更新历史

| 版本 | 日期 | 摘要 |
|------|------|------|
| v5.33 | 2026-09-04 | 借壳日间正式上线：反色环境自动启用，像素级复原日间 |
| v5.32 | 2026-09-04 | 借壳日间方案：内部伪装夜间+滤镜，像素级复原日间 |
| v5.31 | 2026-09-04 | 深色模式收尾：确认对手浅色检测型反色，新增提示条 |
| v5.30 | 2026-09-04 | 深色模式取证二阶段：升级 ?themedi 实验台 |
| v5.29 | 2026-09-04 | 修系统深色下国产浏览器切日间被强制反色 |
| v5.28 | 2026-08-28 | 扫码配对弹层文案换行优化，红字警示保留 |
| v5.27 | 2026-08-27 | 新增 biji 并行可信域，落地页文案动态适配 |
| v5.26 | 2026-08-27 | 配对二维码改走主站可信短链，规避小米相机拦截 |
| v5.25 | 2026-08-18 | 夜间模式兼容二：日间态升级 only light 豁免强制反色 |
| v5.24 | 2026-08-18 | 夜间模式兼容：新增 color-scheme 声明对抗强制反色 |
| v5.23 | 2026-08-18 | 配对中转页迁至自有域名 note.xuyinji.com.cn/bridge.html（去 github.io 第三方依赖，国内可靠）；server.js 加 /bridge.html 静态路由 |
| v5.21 | 2026-08-06 | UI 精简：状态栏移底栏 + 二维码弹层直出（移除配对链接行） |
| v5.20 | 2026-08-05 | 二维码配对，添加新设备免输网址与口令 |
| v5.19 | 2026-08-05 | 代码审查专项修复：存储型 XSS 封堵 + 粘贴换行/光标修复 + URL 吞中文 + 保存可靠性 + 笔记名 `_` `-` 恢复 |
| v5.18 | 2026-08-04 | 同步优化：轮询 4000→2000ms + 移除同步提示浮层 |
| v5.17 | 2026-08-04 | 同步修复：轮询改无条件 4s 基线 + SSE 仅作加速器，彻底消除「一端输入另一端须刷新」 |
| v5.16 | 2026-08-04 | PWA 图标修正：还原备案前透明金 logo |
| v5.15 | 2026-08-03 | 指纹彻底移除 + 落地页禁止中文输入 + 退出锁定解锁按钮禁用 + PWA 图标恢复黑底 |
| v5.14 | 2026-08-03 | 落地页/解锁/路由/图标/指纹 五项体验修复 |
| v5.13 | 2026-08-03 | 三击选行+空格修复（选区边界钳制，避免吞行） |
| v5.12 | 2026-08-03 | 自建撤销栈 + 多行粘贴修复 |
| v5.11 | 2026-08-03 | 回车光标回归修复（空块守卫，尊重原生落点） |
| v5.10 | 2026-08-03 | 光标「不可绘制位置」修复（relocateCaretToVisible） |
| v5.9 | 2026-08-03 | 光标「看得见」修复（repaintCaret 只切 caret-color 触发重绘） |
| v5.8 | 2026-08-03 | 光标常驻修复（ensureCaret 兜底重建折叠光标） |
| v5.7 | 2026-08-03 | 光标不绘制/吞行/撤销错乱 修复（ensureBlockWrapped 逐子节点包裹） |
| v5.6 | 2026-08-03 | 粘贴光标不显示修复（空编辑器粘贴先包 div） |
| v5.5 | 2026-08-03 | backspace 合并行修复（首部空块删除 caretAfterNode 守卫） |
| v5.4 | 2026-08-03 | 链接识别与 href 修复（linkify 改为「先拆后建」） |
| v5.3 | 2026-08-03 | 编辑器四项修复（回车无反应/网址自动识别/光标乱跳/光标偶尔消失） |
| v5.2 | 2026-08-02 | 选区与同步修复（偏移保存恢复光标/粘贴网址/清理孤立换行/dirty 守卫） |
| v5.1 | 2026-08-01 | 删除线与导出图片修复（rangeIntersectsNode 比较符/长 URL 断行/临时 div 渲染） |
| v5.0 | 2026-08-01 | 视觉升级（暖纸白+墨色+金色配色、细线 SVG、720px 阅读栏、落地页动画） |
| v4.5 | 2026-08-01 | 根路径改极简首页 + 夜间模式切换时间调整 + 小米浏览器夜间模式/导出图片修复 |
| v4.4 | 2026-08-01 | PWA 快捷方式修复（manifest 动态返回每个笔记 start_url） |
| v4.3.1 | 2026-07-28 | 修复单行选中删除线无效（TreeWalker 根节点为文本节点时改用父元素） |
| v4.3 | 2026-07-27 | 删除线功能重写（逐节点包裹，取消覆盖区分） |
| v4.2 | 2026-07-26 | 删除线功能（选中加删除线，再次取消；Bootstrap Icons） |
| v4.1 | 2026-07-23 | UI 优化（自定义 favicon、标题简化、根路径跳默认笔记、手机号自动识别 tel:） |
| v4.0 | 2026-07-23 | Cloudflare Tunnel 接入（Caddy 改 HTTP-only、出站隧道绕过 SNI/RST/备案拦截） |
| v3.3 | 2026-07-22 | 服务器稳定性修复（停宝塔 nginx、停 deveco/mimo、Caddy 降级 HTTP/1.1） |
| v3.2 | 2026-07-22 | 修复 SSE 不稳定（Caddy flush + 15s 心跳）+ URL 自动检测改 input 事件 |
| v3.1 | 2026-07-22 | 恢复自动同步 + PWA 支持 + 连接失败重试 + SSE 重连 + 「退出本机」改「退出」 |
| v3.0 | 2026-07-22 | SSE 实时推送（替代轮询）+ 复制/导出图片 + 冲突保护 + 关 HTTP/3 |
| v2.3 | 2026-07-21 | 修复桌面端点超链接进入编辑模式（mousedown 拦截）+ 禁缓存 |
| v2.2 | 2026-07-21 | 点超链接新标签页打开（不进编辑模式） |
| v2.1 | 2026-07-21 | 粘贴 URL 自动转可点击链接 |
| v2.0 | 2026-07-21 | 图片同步（Cloudinary 图床）+ 夜间模式 |
| v1.0 | 2026-07-21 | 初始版本，纯文字端到端加密同步 |

<details>
<summary>完整更新详情（共 47 个版本）</summary>

- **v5.33**：借壳日间正式上线——`darkShellActive()` 判定：小米/QQ 浏览器 UA + 系统深色自动启用，`localStorage['notesync_darkshell']` 可强制开（'1'）/关（'0'）。借壳日间（用户语义日间）= 内部伪装夜间（body.dark + color-scheme:dark，对手判定已深色而放行）+ html `filter:invert(1)` + `#theme-shell` 预反色日间板（滤镜一翻像素级复原），与对手行为解耦：对手开着它放行、滤镜翻色；对手关着滤镜独立翻色，两种设置显示一致。关键改动：① 手动切换改走 `themeWantsDark` 语义状态变量——借壳时 body 恒为 dark，若读 body class 会判错切换方向；② 系统深浅切换监听 `matchMedia` change 实时重判借壳开关并重应用（手动语义保持，自动语义走时间规则）；③ `MutationObserver` 重排回调同时维护 override/shell 顺序（shell 永远压轴，守卫条件防 observer 自触发死循环）；④ `mountThemeOverride` 在 shell 激活时保持 shell 尾部压轴；⑤ 借壳激活时 `setupDarkEnvHint` 提示条不再弹出（问题已被接管）；⑥ `?themedi` 的借壳按钮保留为手动演示工具。刷新/重进回时间规则、手动切换不持久化的约定不变。测试：jsdom 单测 77/77（theme.test.js 18→25 项，新增借壳激活/卸载/开关切换/禁用/顺序 7 项）、Playwright E2E 18/18 无回归，共 95 项全绿
- **v5.32**：借壳日间方案——用户在 v5.31 实验中的关键观察（「切夜间正常 → 点滤镜后页面显示日间样式」）直接破题：对手放行深色页面，而我们的滤镜能把深色翻成浅色，两者组合即完整日间模式。原理：**内部伪装夜间**（`body.dark` + `color-scheme:dark`，对手判定页面已深色而放行）+ **html 套 `filter:invert(1)`** + **`#theme-shell` 输出目标日间色的预反色值**（如目标米白底 `#FBFBF8` 预写 `#040407`，金色点缀 `#8F7126` 预写 `#708ED9`，滤镜一翻即像素级精确复原日间配色，非"近似反色"）+ **img/canvas 自带一层 `filter:invert(1)`** 与 html 层叠加双重反转（图片/二维码保持原样，canvas 白底黑码经 canvas 翻+html 翻复原）。方案的数学性质：与对手行为完全解耦——对手开着时它放行深色页面、滤镜负责翻色；对手关着时滤镜独立完成翻色，两种设置下显示一致。`?themedi` 将「滤镜抵消」实验替换为「借壳日间试一下」一键验证（再按退出），要求在浏览器夜间模式开/关两种设置下各验一次。v5.31 提示条（`setupDarkEnvHint`）保留为借壳不适用环境的兜底。测试：jsdom 单测 70/70、Playwright E2E 18/18 无回归，共 88 项全绿
- **v5.31**：深色模式收尾——用户真机实验反馈：① 滤镜抵消（`html` 套 `invert(1) hue-rotate(180deg)`）开着时切日间仍不正常 → **确认对手不是无条件反色，而是「浅色检测型」**：检测页面是否浅色，浅色才反、深色放行（负负得正不成立——我们 invert 后页面渲染变深，对手直接放行，用户看到的仍是反色日间）；② 夜间模式在系统深色下完全正常（对手放行深色页面）。结论：**在开启"网页夜间"的小米/QQ 浏览器里，日间模式被强制改色是浏览器功能设计，页面侧无法阻止**（Chrome 因尊重 `only light` 豁免不受影响）。落地：① 新增 `setupDarkEnvHint()` 深色环境提示条——仅在小米/QQ 浏览器 UA + 系统深色 + 页面日间三条件同时满足时出现，说清原因 + 「切到夜间（推荐）」一键切换 + 引导在浏览器设置把夜间模式改关闭/加白名单，「我知道了」后本次会话不再打扰（纯内存 flag，刷新即重置，符合主题"不持久化"约定）；监听 `matchMedia` change + 页内切主题 + 10s 兜底轮询三个时机；Chrome 不弹（UA 不命中）零打扰；② `?themedi` 探针重做为「白块A（position:fixed）vs 白块B（relative 文档流）」同色对照——若 A 白 B 黑说明对手跳过 fixed 层、全页 fixed 容器化绕过仍可行，若都黑则彻底定论；上一版 RELATIVE/ABSOLUTE 中灰探针移除（用户反馈看不懂，改为白块+口语化判据）。测试：jsdom 单测 70/70、Playwright E2E 18/18 无回归，共 88 项全绿
- **v5.30**：深色模式取证二阶段——用户在小米浏览器（Chrome 135 内核）真机 `?themedi` 取证，结论确凿：`computed(body).background = rgb(251,251,248)`（CSS 层完全正确）、`CSS.supports('color-scheme','only light') = true`（内核新到不缺能力）、meta 全部同步成功，但整页**渲染**成深色，且探针「纯白→黑、纯黑→白」——**对手是渲染层强制反色，无视 `only light` 豁免，页面侧 CSS 理论无解**。本地用 Chromium `--enable-features=WebContentsForceDark` 模拟复现失败（桌面 Force Dark 尊重 only light，页面未被反色），反证小米的反色层是 MIUI 自研、不走 Chromium 原生路径。另从真机截图发现关键线索：`?themedi` 浮层（`position:fixed`）的中灰底+白字未被反色 → 对手可能**跳过 fixed 定位层**。据此把 `?themedi` 升级为实验台：① 新增 RELATIVE/ABSOLUTE 两组中灰定位探针（与浮层 FIXED 形成三组对照，插在 body 最前，z-index 99998），用户真机对比三块颜色即可定位对手的豁免规则（若仅 fixed 保持中灰 → 可全页容器化绕过）；② 新增「滤镜抵消」开关——给 `<html>` 套 `filter:invert(1) hue-rotate(180deg)`，对手若无条件全局反色则负负得正复原，对手若放行已深色页面则等效自带深色模式，一键肉眼判定 E 组可行性；③ 读数增加 `html.style.filter` 行。诊断工具增强，业务零改动。测试：jsdom 单测 70/70、Playwright E2E 18/18 无回归，共 88 项全绿
- **v5.29**：系统深色模式下国产浏览器切日间被强制反色（承接 v5.24/v5.25 的夜间模式兼容线）——用户实测：小米手机系统深色时，Chrome 日/夜切换正常，但 QQ 浏览器与小米自带浏览器「夜间正常、日间异常」；系统浅色时全部正常。根因四条：① **架构**：`shouldBeDark()` 只看本地时间，全文无 `prefers-color-scheme`，与浏览器「跟随系统」的网页夜间模式不同步；② **v5.25 回归（直接技术原因）**：`only` 关键字需 Chromium 98+，X5/小米 WebView 版本滞后会把 `color-scheme: only light` **整条声明解析失败并丢弃**，于是回落到 `:root` 的 `light dark`——那等于主动声明「我支持深色」，比 v5.24 的 `light` 更容易被反色（夜间态写 `dark` 谁都认，所以只坏浅色）；③ 对手分三层：CSS 注入型（可拦）／样式计算层／**合成器层 `filter: invert(1) hue-rotate(180deg)` 像素反色（X5 采用，CSS 完全够不着）**；④ `#theme-override` 挂在 `head` 里，插得比浏览器注入还早，`!important` 白写。修复：① **降级链**——`CSS.supports('color-scheme','only light')` 探测，支持写 `only light`，不支持退回标准 `light`，并加**写回校验**（读回为空说明声明被内核丢弃，补写标准值，绝不留窗口）；② **静态兜底**——`head` 的 `meta[name=color-scheme]` 与 `:root` 的 `color-scheme` 由 `light dark` 改回 `light`，另加 `meta[name=theme-color]`（部分国产引擎据此采样页面主色）；③ **覆盖加固**——`mountThemeOverride()` 改挂 `document.documentElement.appendChild`（DOM 最末位，同优先级下后者胜），`DOMContentLoaded`/`load` 各补挂一次，加 `MutationObserver` 监听 `head`/`documentElement` 的 childList 并把 override 顶回末尾（守卫条件 `ov.nextSibling` 防自触发死循环）；覆盖规则扩充 `-webkit-text-fill-color`、删除线 `s/strike/del` 颜色锁定、`#landing` 径向渐变保留（此前浅色覆盖把渐变刷成纯色）；④ **取证**——新增 `?themedi` 诊断浮层（`setupThemeDiag`，复用 `?diag` 套路），输出 UA／`CSS.supports`／`prefers-color-scheme`／`computed(body).background`／meta 内容／全部 style 标签指纹，内嵌**中灰 #808080 + 纯白 + 纯黑 + 白色 img** 四探针——中灰在 invert 前后视觉不变（`invert(128)=127`），是区分「CSS 注入型」与「像素反色型」的照妖镜。主题策略**刻意不变**：默认按时间（07:00/19:00），手动切换仅当前会话内存态、不写 localStorage，刷新或重新解锁回时间规则（用户明确要求）。顺带修：`tests/unit/server.test.js` 硬编码的 node 路径改用 `process.execPath`（受管 node 目录漂移成 `22.22.2-2` 导致 7 项 ENOENT 假失败）；`tests/helpers.js` 的 `loadApp()` 增加可选 `extraBeforeParse` 参数以支持内核能力打桩。测试纪律：jsdom 单测 65/65（`theme.test.js` 由 4 项扩到 18 项，覆盖现代内核/旧内核/「嘴上支持实际丢弃」三种场景 + 挂载位置 + MutationObserver 顶回 + 不持久化）、Playwright E2E 11/11 无回归，共 76 项全绿，退出码 0。已知边界：若真机取证确认是 X5 合成器像素反色型，页面侧 CSS 无解，需上「自反色抵消」（`filter` 会破坏 `position:fixed` 与 `backdrop-filter`，风险高，待取证后决定）或引导用户在浏览器里把本站加入夜间模式白名单
- **v5.27**：biji 并行可信域（承接 v5.26 的小米相机拦截规避线）——用户新增 `biji.xuyinji.com.cn` 作为与 `note.xuyinji.com.cn` 并列的可信入口，两域反向代理到同一后端 `127.0.0.1:8080`、共享同一套笔记库（物理同进程同库，零同步延迟）。修复点：① 落地页两处写死域名提示（`在网址后加笔记名即可，如 note.xuyinji.com.cn/notes` 与 `note.xuyinji.com.cn/biji`）改为 `<span class="dyn-domain">` 占位 + JS 注入 `location.hostname`，biji/note/apex 各显示各自域名；② `buildPairingUrl()` 在 note 分支后、兜底前新增 `biji.xuyinji.com.cn` 显式直出分支（产 `https://biji.xuyinji.com.cn/<笔记名>#k=<密钥>`，无中转），与 note 分支并列、意图明确（此前靠 else 兜底也能直出，但隐式）；note 域中转逻辑（`xuyinji.com.cn/note/*` 302）完全不变。部署：Caddyfile 新增 `https://biji.xuyinji.com.cn` 反向代理块（含 SSE `/api/note/*/stream` 特殊处理，与 note 块同构），`caddy reload` 自动签 Let's Encrypt；biji 实测：小米相机扫 `biji.xuyinji.com.cn/notes` 弹通用免责提示（与扫 baidu 同表现，属小米对所有网址二维码的通用提示，非域名信誉标记），点确定浏览器正常打开。测试纪律：jsdom 单测 51/51（新增 Q8：biji 直出分支源断言）、Playwright E2E 11/11（flow 3 + sync 2 + userbugs 6）无回归，共 62 项全绿， 退出码 0

- **v5.28**：扫码配对弹层文案排版优化——用户反馈第一行过长、断句随机难看。修复（纯 UI 微文案，服务端零改动、零知识不变）：① 灰字指令行在第一个逗号处主动断行（「用另一台设备扫描二维码，」/「直接打开此笔记，无需输入口令。」），避免浏览器在约 318px 内容区内随机截断；② 红字警示行压成 16/16 字两行（「二维码含解锁密钥，等同你的口令：」/「仅限自有设备间扫码，勿截图外传。」），保留「等同口令」等价警告（二维码=口令一样敏感）与「设备间」含义，砖红警示色 #C0453E 维持线上不变。测试纪律：jsdom 单测 51/51 + Playwright E2E 11/11 无回归，共 62 项全绿，退出码 0

- **v5.26**：配对二维码改走主站可信短链（承接 v5.22/v5.23 的拦截规避线）——用户实测：v5.23 中转页迁回 `note.xuyinji.com.cn` 后，小米相机扫配对二维码再次弹风险提示（"此链接有风险可能性……"），点确定跳转后立即弹回相机；而扫 `xuyinji.com.cn`/`baidu.com` 正常、同一码在微信/QQ浏览器打开正常——站点链路本身健康（LE 证书 SAN 匹配、各路由 200），问题在小米扫码瞬间的网址安全判定：v5.23 链接形态 `bridge.html#t=<双重百分号编码 URL>&k=<43 位高熵密钥>` 是钓鱼跳转页的典型指纹。用户对照实验 `xuyinji.com.cn/go.html`（跳转 note 子域）小米相机可正常打开，给出关键事实：**小米只校验扫码瞬间二维码内的 URL，浏览器内跳转不再复检**。修复：① `buildPairingUrl()` 生产域名（`note.xuyinji.com.cn`）下改产 `https://xuyinji.com.cn/note/<noteId>#k=<密钥>`（载荷 129B→78B，QR v8/49 模块→v5/37 模块）；仓库 `Caddyfile` 主站块新增 `handle_path /note/* { redir https://note.xuyinji.com.cn{path} 302 }`——目标写死本站 note 子域，非开放重定向；302 的 Location 不含片段时浏览器自动拼回原请求的 `#k=`，落点即接收端既有 `tryPairingUnlock` 入口，**接收端零改动**；② 密钥全程走 fragment，服务器与跳转环节不可见，零知识模型不变；③ 本地/自建部署（hostname 非 note.xuyinji.com.cn）保持直连形态，E2E 探针与自部署不受影响；④ `bridge.html` 文件与 `server.js` 路由保留，v5.23-v5.25 已外发配对码不失效。测试纪律：jsdom 单测 50/50（新增 Q6/Q7：生产短链形态源断言 + jsdom 本地直连功能断言）、`_probe_qr_pairing` 21/21、`_probe_v520_blind` 44/44、`_probe_v520_blind_static` 29/29、Playwright E2E 11/11，共 155 项全绿，退出码 0
- **v5.25**：夜间模式兼容二（D5，承接 v5.24/D4）——用户实测 v5.24 后反馈：小米/QQ浏览器夜间模式设"**跟随系统**"+ 手机系统深色模式时，页内切日间**仍无效**（v5.24 只缓解了"手动开夜间模式"场景）。根因：两条反色路径机制不同——手动开走"智能适配"（读页面 `color-scheme` 声明，v5.24 的 `light` 声明可生效）；"跟随系统"走 Chromium **Auto-Dark / force-dark** 强制暗色算法，该路径**不豁免** `color-scheme: light`——Chrome 官方（web.dev "Prevent Auto Dark Mode"）规定的豁免标记是 `color-scheme: only light`（明确声明"此页只支持浅色，禁止自动变暗"），v5.24 差就差在没加 `only`。修复：① `applyTheme(false)` 时 `documentElement.style.colorScheme` 声明 `only light`（夜间仍 `dark`）；② `<head>` 静态加 `<meta name="color-scheme" content="light dark">`，`applyTheme` 动态把 content 同步为 `only light`/`dark`（静态 meta 首帧即被浏览器读到，早于 JS，对国产内核更稳）；③ `:root` CSS 由 `color-scheme:light` 改 `light dark`。已知边界（丑话）：若小米/QQ魔改内核连 `only light` 都无视（纯暴力滤镜），页面侧无解，只能浏览器设置里把夜间模式从"跟随系统"改手动关、或把 `note.xuyinji.com.cn` 加夜间模式白名单。配套修复：`qr_pairing.test.js` 硬编码版本断言 5.23→5.25（v5.24 发版时跑测试在改版本号之前，该断言漂移未暴露——流程教训：**改 APP_VERSION 后必须重跑单元测试**）。测试：jsdom 单测 48/48（`theme.test.js` 增至 4 断言：dark、only light、meta content 同步、初始与 shouldBeDark 一致）、Playwright E2E 11/11 无回归
- **v5.24**：夜间模式兼容小米/QQ浏览器强制反色——根因：小米浏览器/QQ浏览器"夜间模式"在渲染层对页面强制反色，页内日/夜切换按钮其实生效（图标切换）但被浏览器盖掉，视觉上"切换无效"；页面此前未声明 `color-scheme`，浏览器默认按"未适配浅色"处理而强制套暗。修复：`:root` 声明 `color-scheme:light`、`body.dark` 声明 `color-scheme:dark`；`applyTheme()` 同步写 `document.documentElement.style.colorScheme`，向浏览器明确声明当前配色方案，使其停止对本页强制反色（D4，承接 D2 的 `!important` 覆盖机制，增量新增、不冲突）。注意：`color-scheme` 能对抗"遵守标准的智能适配"夜间模式，对个别老版本"纯滤镜暴力反色"仍可能无效——那种情况需关掉浏览器自带夜间模式或把 `note.xuyinji.com.cn` 加进排除名单。测试：jsdom 单测 47/47（含新增 `theme.test.js` 3 项断言：切日间→`color-scheme:light`、切夜间→`dark`、初始与 `shouldBeDark` 一致）、Playwright E2E 11/11 无回归、独立子代理 Playwright 真机专项验证（点击 `#themeBtn` 后 `documentElement.style.colorScheme` 在 light↔dark 切换、D1/D2/D3 核对无回归），共 59 项全绿
- **v5.23**：配对中转页迁至自有域名——v5.22 用 `bridge.html` 解决了小米相机拦截风险域名白屏的问题，但 bridge 部署在 GitHub Pages（`zchening.github.io`），属第三方境外依赖、国内偶发不可达，与已备案的国内 HTTPS 主站自相矛盾。本版将 `BRIDGE_URL` 由 `https://zchening.github.io/NoteSync/bridge.html` 改为 `https://note.xuyinji.com.cn/bridge.html`，并把 `bridge.html` 部署到自有已备案域名（Caddy 静态服务）。`server.js` 新增 `/bridge.html` 显式静态路由（`text/html`, no-cache），否则会被 SPA 兜底返回 index.html 导致桥页失效（`buildPairingUrl()` 生成的仍是 `…/bridge.html#t=<目标>&k=<密钥>`，仅域名变了）。密钥仍走 URL fragment（`#k=`），不经过任何服务器，零知识安全模型不变；小米相机拦截绕开机制保留。配套：仓库 `Caddyfile` 同步为线上完整 https 版（此前缺根域/www 静态块且 note 块仍是 http，属漂移）。测试：jsdom 单测 44/44（含版本号断言同步至 5.23）、Playwright E2E 11/11 无回归、线上 `/bridge.html` 返回中转页（非 SPA index.html）+ `/healthz`=200 验证通过
- **v5.22**：中转页二维码——小米系统相机扫码无法打开 trycloudflare 临时域名（被安全模块标记为风险域名，弹出警告后白屏跳回）。新增 `bridge.html` 部署至 GitHub Pages，`buildPairingUrl()` 改为生成 `https://zchening.github.io/NoteSync/bridge.html#t=<目标>&k=<密钥>` 中转 URL。github.io 为可信域名，不被任何安全系统拦截。bridge.html 读取 hash 参数后 `location.replace` 跳转到目标 trycloudflare 地址，`#k=` 触发 `tryPairingUnlock` 自动解锁。密钥全程走 URL fragment，不经过 GitHub 服务器，零知识安全模型不变。测试：单元测试 7/7 + 模块测试 3/3 + 全链路测试 3/3（含 XSS 协议拦截、密钥 URL-safe base64 往返无损、错误密钥拒绝、未初始化笔记拒绝）
- **v5.21**：UI 精简——状态栏移至底栏 + 二维码弹层直出（承接 v5.20）——用户反馈两项体验调整。① **状态从顶栏移到底栏（全端）**：移动端顶栏按钮过多，"已同步"被挤得无法与绿点同行；顶栏状态区整体移除，底栏变为纯状态条「● 状态字」，圆点颜色语义不变（已同步绿、其余灰），`setStatus()` 单一写入；底栏原文案随之精简——"已解锁"状态本就由状态字编码（已同步即已解锁，锁定时显示已退出/已锁定/无法连接），"端到端加密"标语已在落地页与解锁弹窗表达，无需在底栏常驻重复。② **二维码弹层改直出 + 移除配对链接行**：点二维码图标即渲染二维码（去掉"显示配对二维码"二次点击）；60 秒自动隐藏保留，到期后弹层内变为「重新显示」按钮；移除二维码下方的配对链接文字行，密钥不再以文字形式出现在屏幕（取舍：两台电脑互配只能扫码）。安全姿态不变：60 秒暴露窗口、「勿截图外传」警示、fragment 零知识、J2 的 KEY_STORE 缺失兜底（触发点改为打开弹层时）。测试纪律：jsdom 单测 44/44（+1 底栏状态条结构）、静态盲测 `_probe_v520_blind_static` 29/29（+2：链接行零残留、状态移底栏）、`_probe_qr_pairing` 21/21（P2/P3 改直出断言+二维码内容像素级比对）、对抗盲测 `_probe_v520_blind` 44/44（+1 链接行移除；J1 由观察改硬断言：自动补写密钥并直出）、Playwright E2E 11/11、v5.19 四探针 80/80 复跑全绿，共 229 项，退出码 0
- **v5.20**：二维码配对（快速档）——添加新设备免输网址与口令（承接 v5.19）——此前添加第二台设备需在新设备上手动敲入笔记 URL 与口令，手机上又慢又易错。新增：顶栏「二维码」按钮，弹层按需生成并显示当前笔记的配对二维码，另一台设备扫码即直接解锁，全程免口令。配对链接为 `笔记URL#k=<URL-safe base64 AES密钥>`。安全设计：① 密钥放在 URL fragment（`#` 之后），fragment 从不发送到服务器——密钥仅经「发送端屏幕→接收端摄像头」点对点传递，服务器仍只见密文，零知识不变；② 二维码本身即密钥（等同口令），故弹层按需显示（先点「显示配对二维码」）、60 秒自动隐藏、并明示「勿截图外传」；③ 接收端解锁成功后立即 `history.replaceState` 把密钥从地址栏与浏览器历史移除；④ 密钥错误/被篡改时回退口令输入界面并提示「配对链接无效或已失效」，错误密钥不落地；⑤ 配对成功后密钥写入接收端 localStorage，此后该设备与普通设备无异（自动解锁、双向同步）；⑥ 拒绝配对到未初始化的笔记（服务端无 salt 即回退）——发布前独立盲测发现：缺此守卫时任意密钥都能对空笔记"配对成功"并凭空向服务器写入脏笔记（J1，同版修复，见 BUG_CHECKLIST）；⑦ KEY_STORE 缺失但内存有密钥时「显示配对二维码」自动重新导出补写，不做静默哑按钮（J2，盲测发现，同版修复）。实现：内联 qrcode-generator 1.4.4（MIT，约 20KB）保持单文件零依赖，canvas 渲染（4 模块静区）；接收端复用既有 `importKey`/`applyUnlocked` 路径；**服务端零改动**（零知识架构天然支持，fragment 不进请求）。测试纪律：jsdom 单测 43/43（新增 `qr_pairing` 7 项：URL-safe base64 全字节往返、`parsePairingKey` 合法/非法 8 例、弹层结构、内联库真实 URL 出码）、Playwright E2E 11/11 无回归、新增探针 `_probe_qr_pairing` 21/21（真实 server.js + 双浏览器上下文全链路：按需显示/链接与本机密钥一致/免口令解锁/内容解密一致/hash 剥离/密钥落地/反向同步/刷新后自动解锁/错误密钥回退）、v5.19 四探针（review_bugs/undo_paste/save_reliability/v519_independent）80/80 复跑全绿；发布前另派独立盲测：静态层 `_probe_v520_blind_static` 27/27 + 对抗 E2E `_probe_v520_blind` 43/43（自研独立 QR 解码器从画布像素还原载荷与配对链接逐字比对、含 +/= 填充密钥往返无损、fragment 垃圾注入拒绝、非法长度密钥优雅回退、429 锁定不绕过、错误密钥不破坏已存密钥、hash 剥离彻底至 performance 导航条目）——盲测发现 J1/J2 两 bug，均同版修复并复跑全绿，共 225 项，退出码 0
- **v5.19**：代码审查专项修复——存储型 XSS 封堵 + 粘贴换行/光标修复 + URL 吞中文修复 + 保存可靠性 + 笔记名 `_` `-` 恢复（I1-I6，承接 v5.18）——应用户要求对全项目做 bug 排查（代码审查 + 真实 Chromium 探针逐项实证），确认 4 个严重缺陷与若干小问题，经批准后按方案修复：① **I1 linkify 存储型 XSS（高危）**：`linkifyEditor` 用 `span.innerHTML = text.replace(...)` 字符串拼接构建链接，实测 `" onmouseover="alert(1)` 属性注入成立、`<img onerror>` JS 执行、`<b>` 等标签篡改正文，且随加密同步跨设备传播、可窃取 localStorage 内其它笔记的 AES 密钥。修复：新增 `buildLinkSafe()` 用 DOM API 组装（`createTextNode` + `createElement('a')` 属性赋值天然转义），替换整段 innerHTML 拼接；链接化规则（URL 优先、denyAsUrl、ZWSP 断行）逐条对齐原实现。② **I2 行中粘贴嵌套块 + 光标跳行首（高危）**：粘贴把每行无条件包 `<div>`，"abc|def" 中粘 "XY" 渲染成三行、光标落块首。修复：空编辑器保留拆块路径；非空走 `pasteTextNative()`（`execCommand('insertText'/'insertParagraph')` 原生合并拆段），`pasteInFlight` 使整个粘贴作为单步入撤销栈。③ **I3 URL 吞中文**："看https://baidu.com。很好" 的 "。很好" 被吞进链接文本与 href。修复：urlRegex 字符类排除 CJK 区段、URL 在中文处即停；`trimUrlTrailing()` 兜底修剪尾部中文标点；ASCII 尾部行为不动（保护以 `)` 结尾的合法 URL）。④ **I4 保存可靠性**：busy（保存中）输入曾被直接丢弃（无保存无撤销）、保存失败无重试。修复：busy 分支标记 `pendingResave` + 照常记撤销栈，saveLocal finally 补挂 300ms 保存；失败退避重试 3s/6s/12s 至多 3 次；`flushDirtySave()` 挂 visibilitychange→hidden 与 pagehide 兜底。⑤ **I5 笔记名恢复 `_` `-`**：v5.15 收紧成纯字母数字误伤旧笔记（400 打不开），前后端同步放宽为 `[A-Za-z0-9_-]{1,64}`（中文仍拒）；fetchRetry 对 4xx 不再重试且错误带 status，unlock/init 对 400 提示"笔记名不合法"；落地页输入框加 maxlength=64。⑥ **I6 复制剥离 ZWSP**：copyBtn 复制前剥离长词/链接内的零宽断行符。**补充（独立验证子代理发现）**：单行笔记常见形态是裸文本节点挂根，此时行中粘贴多行会残留「裸文本 + `<div>` 做兄弟」的非法结构并以该形态保存/同步，`pasteTextNative` 收尾补 `ensureBlockWrapped()`+`normalize()`，包块前后用块内偏移保存/恢复选区（否则光标跳行尾）。测试纪律：jsdom 单测 36/36（含 ID_RE 放宽新断言）、Playwright E2E 11/11（flow/sync/userbugs 无回归）、探针 `_probe_review_bugs` 10/10（XSS/粘贴/中文标点逐条翻转验证）+ `_probe_undo_paste` 13/13 + `_probe_save_reliability` 8/8（真实 localhost 服务器、可控 apiPut 注入延迟/失败，验证 busy 补存、3s 重试、flush 兜底、撤销完整）+ `_probe_v519_independent` 49/49（独立子代理全新设计、真实 PBKDF2 解锁，覆盖 I1-I6 全部修复点与结构不变量），共 127 项全绿，退出码 0
- **v5.18**：同步优化——轮询 4000→2000ms + 移除同步提示浮层（E6，承接 v5.17）——用户两条反馈：①"要 4 秒那么久吗"；②"自动同步是基操，每次弹'已从其他设备同步'很打扰，以前没显示体验就很好"。根因：v5.17 把轮询基线设为 4000ms（仅恢复 v2.x 体感、用户仍嫌慢），并顺手加了每次远端落地弹一次的 `showSyncToast` 提示——那是 v5.17 为验证修复加的，并非用户所求。修复：① `POLL_INTERVAL` 4000→2000，退化场景（SSE 被隧道缓冲挂死）同步延迟从 ≤4s 降到 ≤2s，回到"几乎秒同步"体感；SSE 正常时仍 `onmessage` 即时，不受影响；单用户 2s 一次轮询开销可忽略（无变化时只是版本号比对）。② **彻底移除同步提示浮层**：删除 `showSyncToast()` 函数及其在 `poll()` 内调用，恢复 v2.x 静默自动同步（状态条"已同步"属常驻 UI、非打扰浮层，保留）。测试纪律：jsdom 单测 35/35（新增断言 `POLL_INTERVAL=2000` + `typeof window.showSyncToast==='undefined'`）、Playwright E2E `sync` 2/2（T2 `disableSSE` 仅靠 2s 轮询、超时收紧到 3.5s 证明基线、并断言同步后无 `#syncToast`）+ `flow` 3/3，退出码 0
- **v5.17**：同步修复——轮询改无条件 4s 基线（恢复 v2.x 体感）+ SSE 仅作加速器，彻底消除"一端输入另一端必须刷新才同步"的失败模式（E5，承接 v5.16）——用户反馈"一端输入另一端不自动同步、要手动刷新"，且明确"这块逻辑我从没让你改过、以前几乎秒同步"。git 核查确认：同步核心代码自 v3.1（2026-07-22）至 v5.16 **一字未改**，退化是环境因素而非代码回归——v4.0 起走 Cloudflare Tunnel，代理缓冲使 SSE 进入"已连上但不投递"的挂起态，`onerror` 永不触发 → 旧代码只在 `onerror` 才启动的轮询兜底也永不启动 → 对端只能手动刷新。根因：轮询兜底仅挂在 SSE `onerror` 上，正常连接时 `onopen` 还会 `clearInterval(pollTimer)` 把轮询掐掉。修复（恢复 v2.x 的无条件 4s 轮询基线）：① `startSync()` 无条件 `setInterval(poll, 4000)` 常驻基线（不再只在 onerror 启动），SSE 退化也不影响；② `connectSSE` `onopen` 不再 `clearInterval`（SSE 纯加速器，不再有资格掐轮询）；③ `onmessage` 收到推送直接 `poll()` 立即拉最新；④ `onerror` 保留断线重连（5s 后重连），同时立即 `poll()`；⑤ `visibilitychange` 回前台立即 `poll()`（手机切回秒同步）；⑥ `poll()` 加守卫：已锁定（无 `cryptoKey`）时 return 避免"同步中断"噪声，`busy` 时 return 防重入，远端落地后 `showSyncToast('已从其他设备同步')`。测试纪律：jsdom 单测 35/35（新增 `sync.test.js` 断言 `startSync` 无条件 `setInterval`、`onopen` 不 `clearInterval`、`onmessage` 触发 `poll`）、Playwright E2E `sync` 2/2（T1 SSE+轮询、T2 `disableSSE` 仅轮询仍 ≤5s 收到——旧代码在此必失败）+ `flow` 3/3，退出码 0
- **v5.16**：PWA 图标修正——还原备案前透明金 logo（C4 再反转，承接 v5.15）——用户指出 v5.15 改出的「黑底」并非他要的；他要的是**ICP 备案前部署在 note.xuyinji.com.cn 的那个图标**。核查 git 历史：`18d924d` 黑底版(#1C1C1A)仅存在 7 分钟即被 `b72c62f` 透明版取代、**从未上线**；备案（约 8/2）前线上跑的就是透明金 logo `favicon.svg`（`purpose: any maskable`），所谓「黑底」是 Android 把透明 maskable SVG 填黑所致。故 v5.16 还原真相文件：① `favicon.svg` 恢复透明金 logo（`stroke="#8F7126"`、无背景矩形）；② `manifest.json` 仅引用 `favicon.svg`（`background_color #fafafa`、`theme_color #2b6cff`），图标 src 加 `?v=5.16` 缓存破坏以强制刷新 PWA 图标；③ 删除 v5.14 新增的两张 `icon-maskable-192/512.png` 及其 `server.js` 静态路由（回归备案前状态，无 maskable PNG）。测试纪律：jsdom 单测 34/34（含图标翻转断言：manifest 仅 favicon.svg、favicon 透明无 #0F0F11）、Playwright E2E 9/9（含 manifest 仅 favicon.svg + favicon 透明断言），退出码 0
- **v5.15**：指纹彻底移除 + 落地页禁止中文输入 + 退出锁定解锁按钮禁用 + PWA 图标恢复黑底（H4 移除 + H5 + H6 + C4 反转，承接 v5.14）——用户就刚发的 v5.14 提了 8 条反馈，逐条归并成本版四处改动：① **H4 指纹解锁彻底移除（用户主动要求"彻底移除指纹功能"）**：v5.14 用的 WebAuthn **PRF 扩展**在大陆 Android Chrome 上极不可靠（本质是通行密钥/平台凭证，常需 GMS/翻墙才能注册），且失败会甩一长串错误码、退出后还弹"是否开启指纹"。用户明确"我要求的是指纹解锁，怎么给我搞什么通行秘钥，而且好像不翻墙还用不了"——WebAuthn/PRF 是 web 端指纹唯一可行路径，在大陆环境不可靠，留着纯添堵。**决定整段删除**：`bio-banner`/`bioBtn`/`BIO_STORE`、`supportsWebAuthnPRF`/`deriveBiometricKEK`/`aesGcmWrapBytes`/`aesGcmUnwrap`/`enrollBiometric`/`unlockWithBiometric`/`updateBioUI`/`offerBiometricEnrollment` 全部代码 + DOM + CSS 清零，前端 grep 零残留（10+ 标识符 + 「指纹」+ `.bio` 样式全 0 命中），口令解锁路径不受影响。② **H5 落地页笔记名禁止中文输入**：v5.14 的 H1 曾"放宽 ID_RE 接受中文"，但用户实测中文笔记名能跳转、却**无论设什么口令都进不去**（中文经 URL 编码后路由/密钥派生错位），属于"能打开却永远解不开"的半吊子。用户改口"干脆笔记名输入框就不支持输入中文"。修复：前端 `#landingInput` 的 `input`+`compositionend` 监听过滤非 `[A-Za-z0-9]`（拼音组字期间不误删），下方提示「仅支持英文和数字」；后端 `server.js` `ID_RE` **收回** `/^[A-Za-z0-9]{1,64}$/`（与前端禁止双保险，1–64 位 ASCII）。③ **H6 退出锁定后解锁按钮回到禁用态**：登录一次→退出(`#lock`)→还没输口令时，解锁按钮仍是启用态（bug）。修复：`#lock` 处理里清空口令后显式 `$('#ok').disabled = true`。④ **C4 PWA 图标恢复黑底（后 v5.16 已推翻）**：v5.15 把 maskable 图标改黑底(#0F0F11)，但用户核实后要的是备案前透明金 logo，故 v5.16 再反转回透明。测试纪律：jsdom 单测 36/36（含指纹移除断言、中文过滤、黑底、ID_RE 收紧），官方 E2E `userbugs` 9/9（真实 Chromium 逐条对照四改动，含指纹移除 DOM/函数断言、中文过滤、退出禁用态、黑底像素），退出码 0
- **v5.14**：落地页/解锁/路由/图标/指纹 五项体验修复（H1/H2/H3/H4 + C4，承接 v5.13）——用户反馈五类问题，逐条定位并修复：① **H1 落地页笔记名不支持中文**：根因 `server.js` `ID_RE` 用 `/^[a-zA-Z0-9_-]{1,32}$/` 拒绝中文、且 `extractId` 未 `decodeURIComponent`，中文笔记名被 400 拒绝、URL 编码后路由失败；修复：ID_RE 放宽为 `/^[^\x00-\x1f\/\\?#%]{1,64}$/`（接受 Unicode，仅禁控制符与 `/ \ ? # %`），`extractId` 与 SSE id 均 `decodeURIComponent`，客户端 `#landingBtn` 点击走 `encodeURIComponent` 导航，manifest `start_url` 用 `encodeURI`。② **H2 笔记名为空时"打开"按钮禁用**：`#landingBtn` 初始 `disabled`，`landingInput` 的 input 监听按 `value.trim()` 空否切换。③ **H3 口令为空时"解锁"按钮禁用且样式有意弱化**：`#ok` 初始 `disabled`，`pw` 监听按空否切换；新增统一禁用态 `.box button:disabled,#landing button:disabled{background:var(--line);color:var(--muted);cursor:not-allowed;box-shadow:none}`。**踩坑（真实 bug，子代理在真实 Chromium 揪出）**：初版禁用态在真机下仍显示成"启用"样式——根因 `applyTheme()` 注入的主题覆盖 `.box button{...!important}` 与 `#landing button{...!important}` 用 `!important` 压过了禁用态；修复把主题覆盖限定为 `:not(:disabled)`，禁用态自然回落到 muted 基样式（且随深浅色主题变量自动跟随）。④ **H4 手机端指纹解锁**：纯前端 WebAuthn **PRF 扩展**，不碰后端、不破坏端到端加密——注册时建平台凭证(prf 扩展)→取 assertion 拿 PRF 输出→HKDF-SHA256 派生 KEK→AES-GCM 包裹主密钥存 `localStorage BIO_STORE`；解锁时取 assertion(prf eval 存盐)→解包→`importKey`→`applyUnlocked`；口令始终为兜底，iOS 不支持 PRF 时自动隐藏指纹按钮。⑤ **C4 PWA 图标黑色底**：manifest 原用透明 `favicon.svg` 作图标，Android 自适应图标把透明区填黑；新增米白底(#FBFBF8)金 logo 的 `icon-maskable-192/512.png`（`purpose:"maskable"`），并给 `favicon.svg` 加米白 `<rect>`。测试纪律：jsdom 单测 39/39（含新增 userbugs 10/10、server 集成 8/8 验证中文路由与静态资源）、官方 E2E `flow` 3/3 + 新增 `userbugs` 5/5（真实 Chromium 逐条对照五 bug，含禁用态 computed-style 校验）；E2E teardown 卡死/抛错（Windows/Playwright 环境）通过 harness 6s 超时竞速 + 失败计数 `process.exit` 解决，退出码 0
- **v5.13**：三击选行+空格修复（E4，承接 v5.12）——根因：Chromium 三击行选把选区终点放到"下一行块起点（offset 0）"，选区把块边界也包了进去；随后空格替换/删除选区顺手吞掉块边界，两行被合并成 `<div> 七</div>`（"七"被拽上第一行），这是浏览器 contenteditable 固有行为而非逻辑错误。修复：新增 `selectionchange` 守卫 + `isOverflowSelection()`/`clampOverflowSelection()`，检测"选区终点落在紧随其后的兄弟块起点、且未选中该块任何内容、正向溢出"的边界溢出模式，把终点钳制回当前块末尾；守卫很窄，正常跨行拖选（选中了下一行内容）不被误伤；钩子 `__isOverflowSelection`/`__clampOverflowSelection` 供测试。测试：jsdom 单测 21/21（含 triple_click 6/6）、Playwright 4 脚本共 33 项断言全绿（含 G1/B 回归）
- **v5.12**：自建撤销栈 + 多行粘贴修复（G1+B，承接 v5.11）——根因：原生 UndoManager 无法选择性排除程序化改动（linkify/poll 等），导致"按了没反应/回退的不是上一步"，且 Chromium 在 `contentEditable=false↔true` 切换时清空整个原生栈。修复：废弃原生栈、改用自管栈——用户 input 压快照、程序化改动仅 `syncCurrentState()` 不压栈、突发连续打字 700ms 内合并为单步，Ctrl+Z/Y 永远命中用户上一步；粘贴纯文本按行拆 `<div>`、空编辑器先清占位 `<br>`，消除顶部多余空行。测试：jsdom 6/6、Playwright 探针 `_probe_undo_paste` 13/13 + `_probe_user_bugs` 10/10、官方 E2E `flow` 3/3 全绿
- **v5.11**：回车光标回归修复（承接 v5.10）——F12 的 `relocateCaretToVisible()` 把"空块光标（rects=0 但位置合法）"与"坏偏移光标（rects=0 且不可绘制）"混为一谈，导致回车产生的空块在 500ms 后 linkify 触发 `ensureCaret(true)` 时，被跨块拽回上一行有字处。新增**空块守卫**：光标所在块经 TreeWalker 扫描无任何非空文本节点时直接 return 不 relocate，尊重浏览器原生落点；含内容块仍走原 relocate 逻辑（F12 不回归）。**本轮恢复项目测试纪律**：主代理跑全套回归 + `_probe_f13.js`(6/6)，并派子代理独立写 `_probe_f13_edge.js` 做模块/全链路/功能分层测试(16/16，覆盖连续空块、行中回车、回车后立刻输入、含 URL 回车、选中态等)，两层全绿才部署
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

</details>

## License

MIT
