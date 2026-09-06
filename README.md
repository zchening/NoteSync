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

### 便签提醒

给整条笔记设一个提醒时间，到点弹系统通知（或页面内提示）。工具栏闹钟按钮 → 选「1 小时后 / 今晚 8 点 / 明天上午 9 点」，或自定义时间；已设提醒可随时取消，按钮呈高亮状态。

- **通知文案**默认取笔记首行（截 20 字），到点后弹系统通知，点击直达笔记
- **页面关了怎么办**：到点时如果页面没开，下次打开笔记会自动补弹提示条（已过 N 分钟）——这是 100% 兜底；页面开着则准点弹。安卓装成 App 后后台送达更可靠；iOS 需先添加到主屏幕才支持通知
- **隐私**：提醒内容与正文同一把密钥加密，服务器只存乱码，不知道你设了什么提醒、什么时候提醒
- 通知权限在第一次设提醒时才申请；被拒绝也不影响使用（自动降级为打开笔记时的提示条）

### PWA 支持

手机浏览器打开后，可"添加到主屏幕"作为独立应用使用，全屏体验、自定义 SVG 图标、离线可打开缓存页面。浏览器标签页标题显示为 "NoteSync"。每个笔记的快捷方式会打开对应笔记（而非默认笔记），Chrome 和小米浏览器均支持。

解锁后底部会弹出一次安装引导（Android/桌面点「安装」一键装；iOS 需在 Safari 分享菜单选「添加到主屏幕」），点 × 后不再提醒。

### 离线草稿：断网也能放心写

此前断网时虽然能打字，但页面一关、未同步的内容就丢了。现在每一次编辑在加密之后、上传之前，都会先把密文草稿存进浏览器本地存储（明文不落盘）：

- **保存成功** → 草稿自动清除
- **保存失败 / 中途关页 / 杀进程** → 草稿都在，下次打开笔记自动恢复，并立即补传
- **另一台设备已经写了新版本**（检测到服务端版本比草稿新）→ 顶部弹出提示条让你选：「恢复我的修改」或「丢弃」，绝不自动覆盖任何一方的数据


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
| v6.0 | 2026-09-06 | 十连修：误报冲突根治、改口令、历史版本、跨笔记提醒、jsQR扫码兜底 |
| v5.58 | 2026-09-06 | 五连修：冲突卡加宽、离线并入状态栏、菜单统一、盐根治 |
| v5.57 | 2026-09-06 | 真机九连修：通知直进正文、冲突浮卡、冷启回笔记、扫一扫 |
| v5.56 | 2026-09-06 | 真机六连修：冲突二选一、提醒恢复、诊断入口、离线三级兜底 |
| v5.55 | 2026-09-06 | 推送通知修通、APK离线看正文、时分滚轮、菜单精简 |
| v5.54 | 2026-09-06 | 页脚菜单替代双击返回、过期提醒静默、离线解锁 |
| v5.53 | 2026-09-06 | APK四连修：汉字上屏、IME兜底、退出edge-to-edge、返回键 |
| v5.52 | 2026-09-06 | APK直连线上、砍热更新、修多提醒、断网兜底、服务端安全三修 |
| v5.51 | 2026-09-05 | APK装小米：Capacitor7壳+Kotlin提醒+开机重排，关App也推送 |
| v5.50 | 2026-09-05 | 断网实时感知：1秒变离线、恢复自动回已同步 |
| v5.49 | 2026-09-05 | 新增离线阅读：断网看正文、旧草稿弹冲突条 |
| v5.48 | 2026-09-05 | 修小米Chrome弹键盘顶出菜单栏、提醒面板被遮 |
| v5.47 | 2026-09-05 | 时分分隔改全角空格、提醒卡加删除、临近30秒必弹 |
| v5.46 | 2026-09-05 | 提醒下划线只包时间、过期回归正文、悬停展示卡 |
| v5.45 | 2026-09-05 | 提醒四连改：时分框选中分钟、添加写正文带下划线 |
| v5.44 | 2026-09-05 | 到点卡居中、面板聚焦时间、恢复声音 |
| v5.43 | 2026-09-05 | 去自动弹键盘、面板居中、时分居中 |
| v5.42 | 2026-09-05 | 列表改文本节点防吃字、面板居中、时间默认+5分 |
| v5.41 | 2026-09-05 | 提醒纳入夜间保护、去重复闹钟图标 |
| v5.40 | 2026-09-05 | 提醒面板对齐弹窗风格、按钮更名添加提醒 |
| v5.39 | 2026-09-05 | 提醒面板极简+设事项、过期明示、按钮防夜黑块 |
| v5.38 | 2026-09-05 | 提醒/草稿/安装/版本条改实底，不透笔记文字 |
| v5.37 | 2026-09-05 | 多条提醒+点按设提醒+响铃卡；移除待办 |
| v5.36 | 2026-09-05 | 便签提醒：一键设时间、到点通知、关页补弹 |
| v5.35 | 2026-09-04 | 离线草稿不丢、冲突弹条自选、安装引导 |
| v5.34 | 2026-09-04 | 新增待办：行内点勾变待办、点框切换完成 |
| v5.33 | 2026-09-04 | 借壳日间上线：反色环境自动启用，像素级复原 |
| v5.32 | 2026-09-04 | 借壳日间：伪装夜间+滤镜，像素级复原日间 |
| v5.31 | 2026-09-04 | 深色模式收尾：确认浅色反色、新增提示条 |
| v5.30 | 2026-09-04 | 深色模式二阶段：升级?themedi实验台 |
| v5.29 | 2026-09-04 | 修国产浏览器深色下切日间被强制反色 |
| v5.28 | 2026-08-28 | 扫码配对弹层换行优化、红字警示保留 |
| v5.27 | 2026-08-27 | 新增biji可信域、落地页文案动态适配 |
| v5.26 | 2026-08-27 | 配对二维码走主站短链，规避小米相机拦截 |
| v5.25 | 2026-08-18 | 夜间兼容二：日间only light豁免强制反色 |
| v5.24 | 2026-08-18 | 夜间兼容：color-scheme声明对抗强制反色 |
| v5.23 | 2026-08-18 | 配对中转迁自有域名bridge.html、去github.io依赖 |
| v5.21 | 2026-08-06 | UI精简：状态栏移底栏、二维码弹层直出 |
| v5.20 | 2026-08-05 | 二维码配对，加设备免输网址与口令 |
| v5.19 | 2026-08-05 | 安全审查：封XSS、修粘贴光标、URL吞中文、存可靠 |
| v5.18 | 2026-08-04 | 同步优化：轮询4s→2s、移除同步浮层 |
| v5.17 | 2026-08-04 | 同步修复：轮询无条件4s基线、SSE仅加速 |
| v5.16 | 2026-08-04 | PWA图标修正：还原透明金logo |
| v5.15 | 2026-08-03 | 移除指纹、禁中文输入、解锁禁用、图标黑底 |
| v5.14 | 2026-08-03 | 落地页/解锁/路由/图标/指纹五项修复 |
| v5.13 | 2026-08-03 | 三击选行+空格修复：选区钳制防吞行 |
| v5.12 | 2026-08-03 | 自建撤销栈、多行粘贴修复 |
| v5.11 | 2026-08-03 | 回车光标回归修复：空块守卫 |
| v5.10 | 2026-08-03 | 光标不可绘制位修复：relocateCaretToVisible |
| v5.9 | 2026-08-03 | 光标看得见修复：caret-color触发重绘 |
| v5.8 | 2026-08-03 | 光标常驻修复：ensureCaret兜底重建 |
| v5.7 | 2026-08-03 | 光标不绘/吞行/撤销乱修复：ensureBlockWrapped |
| v5.6 | 2026-08-03 | 粘贴光标不显修复：空编辑器先包div |
| v5.5 | 2026-08-03 | backspace合并行修复：首部空块守卫 |
| v5.4 | 2026-08-03 | 链接识别与href修复：先拆后建 |
| v5.3 | 2026-08-03 | 编辑器四项修复：回车/网址/光标乱跳/消失 |
| v5.2 | 2026-08-02 | 选区与同步修复：偏移恢复光标、粘贴网址 |
| v5.1 | 2026-08-01 | 删除线与导出图修复：rangeIntersectsNode等 |
| v5.0 | 2026-08-01 | 视觉升级：暖纸白金配色、细线SVG、阅读栏 |
| v4.5 | 2026-08-01 | 极简首页+夜间时间调整+小米夜模/导出修复 |
| v4.4 | 2026-08-01 | PWA快捷方式修复：manifest动态start_url |
| v4.3.1 | 2026-07-28 | 单行删除线无效修复：TreeWalker改用父元素 |
| v4.3 | 2026-07-27 | 删除线重写：逐节点包裹、取消覆盖区分 |
| v4.2 | 2026-07-26 | 删除线功能：选中加线、再取消；Bootstrap图标 |
| v4.1 | 2026-07-23 | UI优化：favicon、标题简化、根跳默认笔记、tel识别 |
| v4.0 | 2026-07-23 | Cloudflare Tunnel接入：Caddy改HTTP、隧道绕过拦截 |
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
<summary>完整更新详情（共 75 个版本）</summary>

- **v5.58**：**验收五连修——含一次数据级根治（盐被空值冲掉）**。① **冲突卡加宽醒目 + 文案定稿**（用户反馈太窄、啰嗦）：`.confcard` 加宽到 `min(92vw,420px)`、按钮 44px 高、顶部 3px 强调色条、阴影加深；正文定稿「发现另一台设备上的更新，与本机未保存的修改不一致」，按钮定稿「保留本机 / 使用新版本」，draftBar 两态文案同句式。② **离线提示并入状态栏**：底部悬浮胶囊条退役（连带其让位规则 `.offlinebar:not(.hidden)+.upload-status` 一并删除），`offlineBar/offlineTime` 两个 id 保留并移入 `<footer>` 内（单测/双 e2e 免重写），文案改「离线·同步时间：X」。③ **页脚/菜单三端加大**：footer padding 14px/min-height 46px；☰ 22px + 44px 触控区；菜单项 46px/15px 全局生效（v5.57 的 body.native-app 专属规则并入全局）。④ **三端菜单与左下角统一**：扫一扫/日夜间切换/退出锁定全平台进菜单（`native-only`/`native-app` 机制整体退役），顶栏 themeBtn/lock 全平台隐藏；网页端新增自写扫码层 `scanWithWebCamera`（BarcodeDetector + getUserMedia 后置摄像头，Chrome/Edge/安卓可用；iOS Safari 明确提示「当前浏览器不支持扫码，请用 APP」）。⑤ **盐根治（数据级，正确口令恒定「解密失败」的根因）**：`bufToB64(null)` 产出空串 + 服务端 PUT 无条件覆写 salt → v5.54 离线缓存解锁路径不设 `serverSalt`，联网保存把服务端盐冲成 `''` → 下次解锁走随机盐 → 正确口令恒定失败（当次会话密钥在内存故表现为「有时候」）。三层修法：**服务端** PUT 空盐保留原盐（`salt: obj.salt→cur.salt`，需重新部署 server.js）；**前端** PUT 盐一律走 `currentSaltB64()`（serverSalt 缺失回退缓存盐，绝不写空）+ 离线解锁路径落地 `serverSalt`；**自愈**：解锁解密失败时先尝试「口令+缓存盐」解开缓存与服务端正文，两步都过则用缓存盐解锁并回写服务端盐（救回已损坏笔记），都不过才计失败。诊断面板新增 `salt=ok/NONE` 与 `cacheSalt=ok/none`。测试：jsdom **197/197**（新增 v558.test.js H1-H5；v557 G4/G7 改写为 v5.58 语义、G10 保留；v556 F8 版本号 58；qr 版本断言 5.58；offline.test.js O6 尾断言改写）+ e2e **34/34**（userbugs Bug2b 改走 ☰→菜单「退出锁定」）= **231 全绿**。版本对应：BUG_CHECKLIST 新增 **S 类**（S1-S5）

- **v5.57**：**真机验收九连修——v5.56 上线后逐项过堂揪出的体验与兜底断点**。① **点通知弹面板**（v5.54 设计失误）：通知本身就是提醒，点进去又弹一层提醒面板=重复打扰——`rem-notify-click` 监听整体退役，点通知只进笔记正文。② **下划线「有时候没有」**：poll/用服务器版恢复提醒（loadReminder）后，下划线重绘（scheduleRemMarkRefresh）只在正文 html 也变化的分支里跑——远端只动提醒没动正文时列表有、下划线无；两处恢复点后无条件补重绘。③ **chip「有时候不弹」双嫌疑**：`caretInfoInEditor` 要求光标所在块是 editor 直接子节点，裸文本节点（未包块）直接 return null——加裸文本兜底（时间串必在单个文本节点内连续，取节点自身文本+节点内偏移精确匹配）；中文输入法组合态内 selectionchange 触发的 chip 全被 isComposing 拦掉、组合结束后不再有机会——compositionend 监听里补一次触发。④ **冲突/草稿提示排版崩坏**（用户截图实锤：文案压成竖条、按钮挤出框外）：hintbar 单行条退役，改扫码配对同款浮卡（`.conflictbar+.confcard`：圆角 18+rise 入场+同款阴影，无遮罩不挡输入但须显式二选一）；文案统一「本机 vs 服务器」口径（发现冲突：选哪边？/ 保留本机修改 / 使用服务器版本），草稿卡两态文案同口径。⑤ **口令框无出口**：APP 里点退出锁定后不想解锁只能杀进程——口令框「解 锁」下加次级按钮「返回首页」（ghost-btn 样式）。⑥ **冷启动不回最后笔记**：v5.52 的自动跳转依赖 `notesync_last_note`，但该键**只在口令解锁路径写**——记住密钥/扫码配对进来的设备键从不更新，跳转形同虚设；自动解锁路径补写（配对成功 replace 重载后也走这条路，一处盖两条）。⑦ **主文档磁盘缓存从未落盘**（诊断 mainDocCache=none 实锤）：`super.onCreate()` 一执行 Capacitor 立刻发起首次主文档加载，`setWebViewClient` 装得太晚——每次冷启动主文档都绕过拦截器，缓存永远写不进、离线三级兜底形同虚设；装完 client 后缓存不存在即 `wv.reload()` 一次（进程内布尔防循环），此后拦截器接管、缓存落盘。⑧ **APP 菜单收纳+触控区**：日夜间切换/退出锁定从顶栏收进菜单（顶栏 8 枚图标手机上太小点着累），菜单项行高 ≥46px、字号 15，☰ 放大；PC 端不变（native-only/native-app 类驱动）。⑨ **APP「扫一扫」**：菜单新增（仅原生可见）→ `@capacitor-mlkit/barcode-scanning`（ML Kit 原生依赖打进 APK，相机权限运行时申请）→ 扫 PC「二维码配对」弹窗 → `parsePairLink` 解析主站短链/双域直链/裸路径（id 段兼容百分号编码、解码后按服务端 ID_RE 严校）→ assign 后走既有配对接收端自动解锁。诊断同步扩充：rem 行加 future（未来提醒数，scheduled=0 时分辨「全部过期」vs「没同步」）+ lastNativeSync（最近同步时刻与条数/no-bridge）。测试：jsdom **192/192**（新增 v557.test.js G1-G10；v556 F4 改写浮卡断言、F8 版本号 57；v554 E6 改写为「不再弹面板」护栏；qr 版本断言 5.57）+ e2e **34/34** = **226 全绿**。版本对应：BUG_CHECKLIST 新增 **R 类**（R1-R9）

- **v5.56**：**真机验收六连修——合并吞噬（数据丢失级）+ 提醒三处断点 + 离线兜底加固 + APP 诊断入口 + 版本号治本**。① **合并吞噬 P0（v5.55 的提示从未兑现）**：poll 发现远端更新且本机「dirty」时执行 `localVer = note.v` **却不应用内容**——版本号被消费，下一轮 poll 条件不再成立，远端更新**永久吞掉**，随后本地保存静默覆盖服务端（「APP 加的提醒 PC 连文字都看不到」的根因）。修法：有未保存改动即挂起（`editor.innerHTML !== lastHtml`，不再要求正聚焦——失焦未存同样绝不覆盖）：stash `pendingRemoteNote` 快照 + 状态栏「远端有更新，待处理」+ 弹远端冲突条（复用草稿冲突条 UX：**保留我的**=明确覆盖远端直传 / **用服务器版**=丢弃本机未存修改、应用远端正文+提醒），拍板前零写入；saveLocal 在 apiPut 前设闸门（草稿已先落，关页也不丢）。② **提醒列表丢（PC 关标签/APP 杀进程重开后列表恒空）**：口令解锁路径（applyUnlocked）调 `loadReminder`，但「记住密钥」的**自动解锁路径**漏调——reminders 恒空，列表/下划线/页内调度全丢；一行补上（先于 linkify，下划线才画得出）。③ **提醒多端不同步**：`poll()` 只更新正文、从不碰 `note.rem`——应用远端时若 rem 密文变化即 `loadReminder` 恢复+重排+同步原生层（PC 加的手机无下划线根治；APP 加的 PC 看不到是 ① 的连带）。④ **APP 内诊断入口**：`?diag` 只认 URL query，APP 无地址栏、笔记名不能含 `?`——菜单新增「⌁ 诊断」（`__toggleDiag` 免 URL 开关 + localStorage 标记跨重载），浮层新增 rem/pendingRemote/localVer 与主文档缓存行（`RemBridge.cacheInfo` 只读：缓存存在性/大小 + intercept/fetchFail/cacheHit/assetHit + nativeVer）。⑤ **离线三级兜底**：v5.55 主文档缓存合并后未真机验证、验收即翻车（原生离线页出现=缓存未命中，JS 离线体系没机会跑）——MainActivity 加末级兜底：磁盘缓存也没有时回 **APK 内置壳**（CI 构建 cap sync 把当版 index.html 打进 `assets/public`，壳必然存在），壳起后 JS 缓存接管正文，「网络连接失败」页近乎不可达。⑥ **版本号治本**：`build.gradle` 在 v5.54/v5.55 两 tag 同为 54/"5.54"（发版从未 bump，APK 自报旧版、新旧 APK 无法区分）——本版起双 bump（56/"5.56"）+ CI 从 tag 自动注入（`GITHUB_REF_NAME#v` → sed build.gradle），永不漂移。原生推送链路（RemBridge 加密落盘 + setAlarmClock + BootReceiver 重排）经真机确认完好（重启无网不开 App 照推），未动。测试：jsdom **182/182**（新增 v556.test.js F1-F8：自动解锁挂点/poll 提醒同步/冲突闸门/冲突条形态/诊断入口/冲突两路径 jsdom 全流程/poll 远端提醒 jsdom 行为/Android+CI 形态；v555 E7 改写为新挂起语义）+ e2e **34/34** = **216 全绿**。版本对应：BUG_CHECKLIST 新增 **Q 类**（Q1-Q6）
- **v5.55**：**推送通知栏与离线阅读两个 P0 彻底修通** + 时/分滚轮 + 菜单二级收藏夹。① **推送 P0（v5.51 起隐藏三个版本）**：JS 读 `window.RemBridge`，但 Capacitor 7 把插件挂在 `window.Capacitor.Plugins.RemBridge`——全文无一处赋值 `window.RemBridge`，`syncRemindersToNative` 恒静默 return，**原生闹钟从未注册、通知从未发出**；且调用形态也错（JS 传数组，Kotlin `call.getArray("list")` 要 `{list:[...]}` 对象）。此前 jsdom mock 恰好叫 `window.RemBridge` 与真机形态不同，测试永远绿测不出——修复后 mock 严格按 Capacitor 真实形态。修法：取桥改 Capacitor.Plugins 优先（回退 window.RemBridge 保 jsdom）+ 传参 `{list}` + `ensureExactAlarmPermission` 解锁后自检（只引导一次）+ **RemReceiver 前台跳过通知**（`RemPlugin.isForeground` @JvmField @Volatile，MainActivity onResume/onPause 维护）——前台 JS 卡已负责，后台/Home/划掉/冷启一律推通知栏（用户拍板语义）。② **离线 P0**：v5.52 直连线上后，断网时 WebView 主文档加载失败 → `onReceivedError` 盖原生离线页 → JS 的 `notesync_cache_*` 离线体系根本没机会跑（SW 兜底在国产 ROM 实测兜不住）。修法：MainActivity `shouldInterceptRequest` 拦主文档（仅 main frame GET）——联网 native fetch（3s/6s 超时）落盘 `filesDir/cached_index.html` 并直返 WebView（热更新不受影响、永远线上最新），断网/失败回本地缓存文件，origin 不变 localStorage 无缝，JS 照常跑、离线解密阅读生效；原生 offline 页降级为「首装从未联网」最后兜底。③ **时/分滚轮**：v5.45 自建文本框退役，改 iOS 风滚轮（`makeWheel` 工厂：scroll-snap 吸附+中线高亮+上下渐隐 mask，`dataset.val` 唯一事实源 scroll 事件同步；桌面聚焦小时滚轮 ↑↓ 微调 Enter 确认、点项直达，触屏惯性滚动不聚焦）；日期保留原生日历；默认当前+5min 与已过时刻拦截不变。④ **菜单**：去 h1「菜单」；收藏夹收二级视图（主视图=返回首页/收藏笔记/▸收藏夹，二级带‹返回，开菜单总回主视图）；列表 ✕ 删除按钮退役（唯一删除入口=笔记内「☆ 取消收藏」，用户拍板）。⑤ **同步说真话**：poll dirty 跳过远端更新时状态栏显示「远端有更新，输入完成后合并」（不再假装已同步）+ `__pollSkipCount` 计数；`?diag` 新增 native/bridge/scheduled/exact + sse/lastSync/skip 诊断行——真机一眼确认闹钟真排上。⑥ **CI 坑两连**：`onPause` override 误用 protected（BridgeActivity 源码是 public，同 v5.51 onResume 坑，发版前自审拦下）；`isForeground` 误用 @JvmStatic（只生成静态 get/set、字段仍 private，Java 字段式访问编译失败，CI run 实锤后改 @JvmField 重建 tag）。测试：jsdom **174/174**（新增 v555.test.js：Capacitor 真实形态桥 mock/{list} 形态/滚轮取值与滚动同步/菜单二级/poll 跳过提示/诊断行）+ e2e **34/34**（V544/V545 适配滚轮）= **208 全绿**
- **v5.54**：① **页脚 ☰ 菜单 + 收藏体系**：footer 最左侧 ☰ 打开模态面板——返回首页（`location.assign('/')` 留历史、返回键可退回）、收藏/取消收藏切换、收藏夹列表（`notesync_favs` 本机存储、上限 20 挤掉最旧、点行直接进笔记、✕ 取消收藏），替代生硬的双击返回退出；菜单 CSS 全 var() 深色自适配，列表 DOM 用 textContent 构建。② **过期提醒彻底静默**（用户拍板）：删解锁时的 overdue 补弹；REM_DONE「已确认」map 机制整体退役（isRemDone/remDoneMap/markRemDone/unmarkDone 四函数 + REM_DONE_KEY 全删，正文识别与提醒过滤统一 `m.at > now` 纯时间判断）；原生 RemReceiver 加 **60 秒容差**——系统深睡后迟到补触发的闹钟静默丢弃，不再通知栏「诈尸」。③ **离线口令解锁回退**：点过退出/清过浏览器数据/重装后离线打开笔记，输口令不再卡死——unlock 失败且离线时用本地缓存盐派生密钥直接解密本地缓存进笔记（cachePut 落 salt 字段，旧缓存无盐安全回落原提示）。④ 补原生通知点击的 JS 监听（rem-notify-click → 打开提醒面板，v5.52 遗留）。测试：jsdom **165/165**（新增 v554.test.js E1-E6）+ e2e **34/34** = **199 全绿**。版本对应：BUG_CHECKLIST 新增 **P 类**（P1-P5）
- **v5.53**：APK 真机四连修（小米 Civi 3 / HyperOS 3 / 百度输入法实测）。① **汉字无法上屏**：根因锁定 `capacitor.config.json` 的 `captureInput:true`——官方文档明示它启用"更简单的键盘/替代 InputConnection 捕获按键"，把标准 IME 组字链（setComposingText/finishComposingText）替换成游戏用的 BaseInputConnection，中文候选上屏链路直接被打断（数字英文走简单 commit 路径所以正常）；叠加第二根因：部分 WebView+输入法组合下组字过程的 input 事件 `inputType` 为空串，旧 `needCleanup` 对空 inputType 也触发 DOM 清理手术→组字期间正文被动刀。修法：删 `captureInput` + editor input 监听器**开头**加 `isComposing` 旁路（组字期间只挂草稿保存、零 DOM 手术）+ `needCleanup` 移除空 inputType 条件 + 删死变量 `skipCleanupOnce`。② **首页短语注入后打开按钮卡灰**：百度输入法"个性短语"上屏走非标准 IME 路径不派发 `input` 事件，按钮状态无人刷新（英文逐字输入正常——同一 IME 事件链问题的两个面）；修法：landing 加 **250ms 轮询**对比输入框 value 变化补跑清理与按钮刷新，点击打开时清轮询。③ **菜单栏顶进双挖孔区且点不动**：`targetSdkVersion 35` 强制 edge-to-edge，WebView 延伸到状态栏下，header 顶进药丸挖孔区且该区域触摸被系统窗口消费不传 WebView；修法：两个 theme 加 `windowOptOutEdgeToEdgeEnforcement`（API 35 生效、老版本忽略；正解 viewport-fit=cover + safe-area-inset 留后续）。④ **返回键直接回桌面**：Capacitor 7 `BridgeActivity` 不接管返回键默认 finish；修法：`OnBackPressedCallback`——WebView 有历史先 `goBack()` 回首页换笔记，无历史才退出。另开 `webContentsDebuggingEnabled`（USB + chrome://inspect 真机看报错）。测试：jsdom **159/159**（新增 v553.test.js D1-D4：组字旁路/空 inputType 移除/轮询兜底形态/行为）+ e2e **34/34** = **193 全绿**；四路验证中功能核对与独立 review 两路撞平台 429 限流，以直接跑套件 + 关键派发点人工核对补偿。版本对应：BUG_CHECKLIST 新增 **O 类**（O1-O5）
- **v5.52**：APK 架构改道——**从「本地 assets + 热更新」改为 `server.url` 直连线上**（三方只读评审后定稿）。背景：v5.51 装真机后三个问题同时爆（每次打开都是首页要手输笔记名/输名字点"打开"没反应/新笔记输口令提示"无法连接服务器"），三个子代理独立评审共挖出 20+ 问题，根因不是单点 bug 而是**架构层没适配本地 origin**。① **根因链**：`MainActivity` 从未注入 `window.NOTESYNC_API_BASE` 与 `__NOTESYNC_NATIVE__` → API 请求全打到 WebView 自身 origin（必然失败）、SW 反而被注册；`index.html` 的 `noteId` 靠 `location.pathname` 取 → APK 里恒为 `/index.html` → 不仅进不了笔记，还导致 `KEY_STORE/DRAFT_KEY/CACHE_KEY/REM_DONE_KEY` 四类存储键**全部退化成同一个槽位**（多笔记密钥/草稿/缓存/提醒静默串台，比进不去更毒）；首页"打开"按钮 `location.href='/name'` 在 APK 里是 404；QR 配对 `location.replace` 死循环；服务端零 CORS 头。② **路线 A（直连线上）**：`capacitor.config.json` 加 `server.url="https://biji.xuyinji.com.cn"` —— WebView 直接加载线上页，与 Web **完全同源同路径**，上述 7 个问题一次性消失，服务端一个 CORS 头都不用加，且 SW 恢复注册（顺带成为断网兜底）。③ **砍掉热更新**：原实现下载 `index.html` 到 `filesDir/www-hot/` 却**没有任何代码加载它**（等于零收益），更严重的是它的 sha256 校验值也来自同一个接口——**服务端自证**，被 MITM 或服务器被控即可让 APK 执行任意 JS 并经桥接读到内存明文。路线 A 下直接删除（`server.js` 删 `/api/app-version`、`RemPlugin` 删 `checkUpdate`/`fetchAppVersion`/`downloadAndStore`、删测试 C1-C4）。④ **原生层三个 P0**：补 `POST_NOTIFICATIONS` 运行时申请（Android 13+ 不申请就是默认拒绝，**通知一条都不弹**）；PendingIntent requestCode 由 `at.toInt()`（毫秒转 int 溢出成负数、两条提醒互相覆盖只剩一条）改为 **0..9 列表索引**，`Reminder` 加 `idx` 字段、`readItems` 排序后 `mapIndexed` 重建（历史数据无 idx 也能自愈）；落盘 `.apply()`→`.commit()`（异步落盘时进程被杀提醒全丢）。⑤ **精确闹钟升级**：`setExactAndAllowWhileIdle` → `setAlarmClock`（官方定义"系统识别为最关键闹钟、必要时退出低电耗模式投递、从不调整投递时间"，国产 ROM 上更可靠；代价是状态栏多一个闹钟图标）；另加 `requestExactAlarm` 引导（我们声明了 `USE_EXACT_ALARM`，**安装即授予、用户不可撤销**，不经 Google Play 分发不受其用例限制，此分支仅为保险）。⑥ **冷启动自动进笔记**：`isNativeApp()` 用 Capacitor **官方注入**的 `window.Capacitor.isNativePlatform()`（零时机问题）判断，首页读到 `localStorage` 里的上次笔记名即 `location.assign` 跳入——**用 assign 而非 replace 是为了留历史，用户按返回键可退回首页换笔记**；`sessionStorage` 标记防止"退回首页又自动跳走"的死循环；Web 端恒不触发。⑦ **原生断网兜底页**：直连后断网会白屏，新增 `activity_offline.xml`（TextView + 重试按钮）叠加在 CoordinatorLayout 上层，自定义 `BridgeWebViewClient` 在 `onReceivedError`（主帧）时显示、点重试 `wv.reload()`；已确认 Capacitor 自带的 `errorPath` 配置未启用，与 `super.onReceivedError()` 不冲突。⑧ **服务端安全三修**：`getClientIP` 由 XFF **首段**改为**末段**（Caddy 把真实 IP 追加在末尾，取首段等于任何人都能靠轮换 XFF 头绕过失败锁定）；`/api/fail` 强制 `application/json` content-type 逼出预检（否则它是 simple 请求，任意恶意网页连发 10 次就能锁死别人的笔记，而 CORS 白名单对 simple 请求无效）；SSE 加全局 2000 连接上限。⑨ **其他**：BootReceiver 补 `TIME_SET`/`TIMEZONE_CHANGED`（改时间/时区后闹钟错乱）并改用 `goAsync()` 避免主线程跑 Keystore 触发 ANR；`onNewIntent` 冷启时 WebView 未就绪导致通知点击事件丢失 → 缓存 pending 在 `onResume` 补发 + JS 侧 readyState 感知。改动量：capacitor.config.json 1 行 + index.html ~20 行 + server.js −25/+12 行 + RemPlugin.kt 重写 + RemReceiver/BootReceiver/MainActivity 改 + 新增离线布局 + 测试 −4/+2。测试：jsdom **155/155** + e2e **34/34** = **189 全绿**。版本对应：BUG_CHECKLIST 新增 **N 类**（N1-N9：APK 直连改道与原生 P0）
- **v5.51**：APK 装小米——Capacitor 7 壳 + 自写 Kotlin RemPlugin + Keystore 加密 + AlarmManager 精确闹钟 + BootReceiver 重排 + 本地热更新 + GitHub Actions 云构建 release 签名，提醒关 App 也能推到通知栏（承接 v5.39 APK 方案暂缓）。**核心架构决策（零知识代价）**：① 推送 = 原生壳 + 设备本地加密镜像 + 系统闹钟（Web 层 setTimeout/SW/Notification 全部死路：加密密文 SW 解不开、国内 Android 无 FCM Web Push）。② **端到端密文落盘**：Android Keystore 生成不可导出 AES-GCM 密钥，提醒列表整体加密存 SharedPreferences；进程被杀 AlarmManager 系统级触发 BroadcastReceiver → 通知渠道 IMPORTANCE_HIGH + 锁屏强弹。③ **三处 JS 同步挂点**：loadReminder（解锁后服务端密文解密→立即镜像）/ persistReminders（设/改/删均同步）/ 启动 IIFE；每次读 `window.RemBridge`（不缓存 const），让 Capacitor webview ready 后注入生效。④ **跨设备限制诚实告知**：手机上设的必推，电脑/另一台设备设的需手机打开一次 App 解锁才能同步（关着 App 无法解密服务端新密文）——零知识加密的必然代价，非缺陷。⑤ **本地 assets + 启动热更新**：内置 `www/index.html` 秒开离线可用，启动并行 `GET /api/app-version`（server.js 新增直读磁盘算 sha256+size，5 秒缓存）→ 校验下载→落盘 `filesDir/www-hot/` → **下次冷启动生效**（不打断当前编辑）；校验失败静默回退。⑥ **GitHub Actions 云构建**：`push tag v*` → ubuntu-latest → JDK17 + Node22 → `npx cap sync android` → `./gradlew assembleRelease -Pandroid.injected.signing.*`（4 个 Secrets 注入 keystore+密码）→ 上传 artifact + 创建 Release，**本机零 Android SDK**。⑦ **签名一致性**：debug 签名云构建每次都新生成 → 第二次装必卸载重装；正式 keystore `D:\NoteSync-keys\notesync-release.p12`（PKCS12/RSA2048/有效期 10000 天）必须仓库外备份 2 处。⑧ **小米白名单五项（首次启动引导）**：自启动/省电策略无限制/通知权限/锁定后台/精确闹钟；漏配一项推送失败最难排查。⑨ **APK 内不注册 Service Worker**（`if (!window.__NOTESYNC_NATIVE__ && 'serviceWorker' in navigator)`）——SW 缓存与热更新打架。改动量：index.html 加 ~60 行（API_BASE 默认空串+RemBridge 适配+三个挂点+启动钩子+SW 条件化，既有 180 项零破坏）+ server.js +30 行 + capacitor.config.json + www/ 复制 + android/ 全套（Capacitor 7 生成）+ 4 个 Kotlin 文件（RemPlugin/RemReceiver/BootReceiver/MainActivity.java 单文件改）+ AndroidManifest 加 7 权限 + 2 receiver + .github/workflows/build-apk.yml + .gitignore 补 cap 产物过滤。测试：jsdom **158/158**（新增 `rem-bridge.test.js` B1-B8：API_BASE 默认空串/NOTE_API FAIL_API EventSource 拼接/SW 守卫/启动钩子/RemBridge 函数体形态/jsdom 静默路径 + `cap-update.test.js` C1-C4：路由/返回字段/缓存/index.html 正则目标）+ e2e **34/34** 无回归 = **192 全绿**；APK 真机推送验证（小米白名单五项）必须用户装上做。版本对应：BUG_CHECKLIST **新增 M 类**（M1-M8：APK 原生层首次落地），速查表新增 v5.51 行
- **v5.50**：断网实时感知（三方只读评审后定稿，修 v5.49 设计盲区）。用户实测：Chrome PWA 页面开着断网，页脚停在残影「已同步」、离线条永不出现——根因是 v5.49 离线判定只在「打开页面那一刻」（init 回退），运行时断网零感知（全文无 online/offline 监听），且断网瞬间若有保存在途，页脚会在「保存中…→保存失败」循环约 37 秒（重试间隔 3s/6s/12s，busy 期间轮询被挂起）。修复：① **offline/online 事件监听**——断网 0 秒页脚变「离线」+弹「离线 · 上次同步于 X」条；恢复联网削抖 400ms 后自动重拉+补传，成功即回「已同步」并收条；锁定态事件零噪声（cryptoKey 守卫）。② **lastSyncAt 语义**——只在 5 个真实服务端成功点更新（解锁/在线加载/保存/轮询/提醒保存），缓存时刻≠同步时刻不混用；离线条时间优先运行时同步时刻、回退缓存 savedAt，无已知时刻显示「—」不显示 1970。③ **失败分支按 navigator.onLine 分流**——本机离线显示「离线」+挂条（不再出现误导性「保存失败/同步中断」循环），服务器不可达仍显示「同步中断」不挂条。④ **离线快速失败**——fetchRetry 检测本机离线跳过退避（离线打开 1-2 秒落缓存正文、离线输口令不再白等 4-6 秒）；离线期间暂停保存退避重试，恢复联网 flushDirtySave 补传（草稿机制兜底不丢内容）。⑤ **补漏**——退出锁定清 lastSyncAt+收条；提醒保存成功也收条+刷新离线缓存；离线条可见时上传提示上移错位（同位 bottom:44px 叠放）。测试：jsdom 146/146（新增 offline.test.js O1~O6：fetch 桩走真实 unlock 断言事件生命周期/poll 失败分流/lastSyncAt 语义/锁定态零噪声）+ e2e 34/34（新增 offline_live.test.js：setOffline 真实断网 0 秒弹条、恢复自动收条）；jsdom 146 + E2E 34 = **180 全绿**

- **v5.49**：新增离线阅读「上次同步正文」（诊断源自用户报告「离线内容好像是很久以前的」）。根因：v5.48 及以前完全不支持离线读正文——离线打开要么落解锁遮罩+「无法连接」，要么显示旧草稿残留；而联网打开一直是最新版，旧内容纯属本地残留非服务端真相。三层改动：① **密文缓存层**——成功加载/解锁/保存正文时把 {ct, iv, v, savedAt} 缓存进 localStorage（notesync_cache_&lt;笔记名&gt;），只存密文不存明文，零知识属性不变；② **离线回退**——本地有密钥但 apiGet 拉不到服务端时，loadCachedBody 用缓存密文解密展示，底部浮出「离线 · 上次同步于 X」状态条（fixed bottom:44px 胶囊，浮于 #foot 上方，poll 恢复同步即收起），编辑器照常可编辑可起草稿，联网后续传；③ **旧草稿防覆盖**——restoreDraftIfNeeded 改为任何与当前正文不符的草稿一律弹冲突条确认，不再静默恢复（消除「离线旧草稿静默覆盖服务端最新」隐患），一致草稿自动清理。测试：jsdom 新增 cache.test.js C1~C4（缓存读写不含明文/离线回退/无缓存返回 false/状态条收起）+ pwa P3 重写为不静默覆盖 + qr_pairing 版本断言 5.49；e2e 新增 offline_cache.test.js（真实浏览器：保存→拦截 /api 模拟服务器不可达→重载→缓存正文+状态条断言）；jsdom 140/140 + E2E 33/33 = 173 全绿

- **v5.48**：修复 Chrome 安卓键盘顶飞菜单栏（BUG_CHECKLIST 新增 D7）。长笔记光标定位末尾弹软键盘时，顶部菜单栏（header，含工具按钮）整行被推出屏幕外——根因：Chrome 安卓默认键盘行为是「只缩视觉视口」（resizes-visual），布局视口不缩、视觉视口整体下移平移让光标进入可见区，整页上移，文档流顶部的 header 出屏（笔记越长、光标越靠后症状越重；QQ/小米自带浏览器是压缩布局视口行为故一直正常）。修复：viewport meta 追加 `interactive-widget=resizes-content`（一行）——键盘弹出时布局视口整体压缩，header 恒贴可见区顶部、footer 贴键盘上沿、编辑器内滚把光标滚进来；Chrome Android 108+（2022-12）生效，旧内核/桌面/iOS 忽略此参数行为不变；副作用全正向：提醒面板弹键盘输入时间/事项时下半截不再被键盘遮挡。顺带修一个潜伏测试 bug：V545-2 断言写死浅色板 CTA 色，主题按时间切换（07:00/19:00），晚 7 点后跑套件必挂——改为按 body.dark 取对应板色（浅 #2563EB / 深 #7EB1FF）。测试：qr_pairing 新增 Q5b（meta 精确形态 + 旧形态禁残留）+ 版本断言 5.48；jsdom 136/136 + E2E 32/32 = 168 全绿

- **v5.47**：提醒四项（用户拍板，BUG_CHECKLIST 新增 L9）。① **分隔符「 · 」→全角空格「　」**——6 处统一（面板回写正文/chip CTA 行/悬停展示卡/确认卡/到点卡片/面板列表；ASCII 连续空格在 HTML 里会塌缩成一个，故选全角）；itemAfterMatch 剥掉旧格式行残留的「·」，老笔记照常干净显示；存量正文不回改。② **「✅ 提醒已添加」两行卡新增「删除」伪按钮**（span+描边，三板锁色）——悬停展示卡与确认卡两处都有，点击走 removeReminder 彻底移除（列表清空+rem 显式 null 多端同步+下划线拆掉），chipDeleteAt 随 hideTimeChip 清除防误删；删除后光标仍在时间上时 chip 回到蓝色「添加提醒」CTA（预期状态转换）。③ **修复临近触发 30 秒窗口差**——旧逻辑 expired（at≤now+30s）先拦 chip 而下划线阈值是 at≤now，窗口内「有下划线却不弹卡」（v5.46 核对 G 项曾判无害，实为真 bug）；改为已添加分支优先、口径与下划线一致，未添加分支「过去不能设提醒」硬规则不变。④ **面板列表左对齐+显式升序**——#remBoxList .rem-row 覆盖 .qr-box 居中改 text-align:left（v5.46 部署 spec 的宽泛禁串 text-align:left 同步收窄为精确形态 #remBoxForm input{text-align:left}），渲染处显式 sort 升序（最近在最上）。测试：theme 新增 v5.47 断言组、timechip 新增 TC14/TC15、e2e 新增 V547-1~5（真实鼠标点击下划线/30 秒窗口/两处删除按钮/面板排序左对齐）；jsdom 135/135 + E2E 32/32 = 167 全绿

- **v5.46**：提醒标记三改（用户逐项拍板，BUG_CHECKLIST L6 修订 + 新增 L8）。① **过期/已提醒过的时间完全回归普通正文**——remMatchesFor 直接跳过过期与已确认匹配，正文无下划线不变灰（v5.45 rem-past 灰态样式三处退役：静态 CSS/动态板/SHELL_CSS）；hasRemText 早退条件同步排除过期时间。② **下划线只包时间串**——v5.45 的时间+事项整段方案退役，删除事项延展正则，` · 事项` 不带下划线；回写格式保持 `YYYY-M-D H:MM · 事项`（· 两侧空格）不变。③ **已添加的未来时间悬停两行展示卡**——maybeShowTimeChip 新增分支：复用 feedback 两行样式（第一行「✅ 提醒已添加」/第二行「时间 · 事项」，事项空只显时间），纯展示不可点（chipData 置空防误触旧目标）、无定时器，光标移开由 selectionchange 立即消失；未添加时间仍是蓝色 CTA 形态。开发期抓到真 bug：hasRemText 跨函数引用了 remMatchesFor 的局部 `now` → ReferenceError → 整轮 linkify 罢工标记建不出——**jsdom 源码断言测不出，真实浏览器 e2e 暴露**（教训入库 L8）。测试：theme 断言组改写 + timechip 新增 TC12d + e2e _verify_v545 更新为 v5.46 语义并新增 V546-1（5 项）；jsdom 132/132 + E2E 27/27 = 159 全绿

- **v5.45**：提醒功能四连改（用户逐项拍板，BUG_CHECKLIST L 类扩至 L5-L7）。① **面板时间区自建时/分输入框**——原生时间控件段选区是内核硬边界，自建后打开面板焦点直接落分钟框且值全选（真选中「16」，select() 标准 API 必中）；时输满两位自动跳分钟、越界钳制（25→23/90→59）、失焦补零；桌面守卫保留触屏不聚焦。② **面板添加回写正文**——成功后在光标所在处插入 `YYYY-M-D H:MM · 事项`（insertNodeAtCaret 纯 DOM，input 事件链照常：Ctrl+Z 单步撤销/800ms 保存/500ms linkify）。③ **已设提醒文本下划线**——`u.rem-mark` 由 linkify 先拆后建统一管理，只有解析值存在于提醒列表才包（未添加的日期绝不标记）；到点确认/同刻重设变灰（rem-past）、删除提醒标记消失（scheduleRemMarkRefresh 防抖刷新）；双板锁色防夜间吃字。④ **chip 改版**——14px 加大、尾部蓝色 CTA「添加提醒」（浅 #2563EB/深 #7EB1FF）、点添加变两行确认卡（✅ 提醒已添加 / 时间 · 事项）停 3 秒、过期时间完全不浮 chip（零打扰）。测试：theme v5.45 断言组 2 个 + reminder/timechip/qr_pairing 断言同步 + e2e 新增 `_verify_v545.test.js` 4 项（回写下划线/撤销/chip 蓝色 CTA/确认卡/变灰/删除消失/过期零打扰）；jsdom 130/130 + E2E 26/26 = 156 全绿

- **v5.44**：一次性解决用户四连报（提醒 UI 四项，BUG_CHECKLIST 新增 L 类固化）。① **到点卡片不在正中心 + 标题/正文不居中**——根因：`#remCard` 复用通用 rise 入场，to 帧 transform:none 在动画结束抹掉 translate(-50%,-50%) 居中偏移，卡片左上角钉在屏幕中心点；改挂 **remRise 专用入场**（from/to 两帧保留偏移）+ 整卡 text-align:center（标题「提醒」/正文「时间 · 事项」/「已过 X 分钟」全居中）。② **打开面板默认选中分钟**——聚焦三代未真正生效：写在 renderRemPanel 末尾时 remMask 仍 hidden，**display:none 容器内聚焦静默无效**（探针实测）；新增 focusRemTimeInput() 由 toggleRemPanel 在 mask 显示后调用，仅桌面环境（hover+fine）聚焦防移动端键盘挤偏复发；实测 Chromium 对时间控件 selectionStart=null、段导航只认真实按键，"选区钉死分钟段"为内核硬边界，**聚焦生效即网页侧极限**（方向键/数字键直调、点分钟段即改）。③ **事项框「（可留空）」删除**——placeholder 精简为「事项」。④ **到点没声音**——每次响铃新建 AudioContext，到点无手势 ctx 恒 suspended 静音；**首次手势解锁全局 remAudioCtx**（含 iOS/国产内核必需静音 buffer），响铃复用不关闭。测试：theme.test.js v5.44 断言组（remRise 挂载/整卡居中/桌面守卫聚焦/placeholder/单次 ctx 创建/静音 buffer）+ reminder placeholder 断言更新 + e2e 新增 `_verify_v544.test.js` 4 项（真实 Chromium 实测卡片正中心±2px/文字居中/聚焦时序/音频 running）；jsdom 128/128 + E2E 22/22 = 150 全绿
- **v5.43**：修复 v5.42 两处自伤——① **面板不在正中心**：v5.42 的「打开面板自动聚焦时间框」在移动端立即弹起软键盘压缩视口，`.mask` 在压缩视口内居中导致面板整体偏上（扫码配对弹窗无输入框无键盘故无此问题），删除自动聚焦与 showPicker，用户点时间框自唤选择器；默认 +5 分钟保留 ② **时间/事项内容不居中**：v5.42 把 `#remBoxForm input` 锁成 text-align:left（"输入件惯例"自作主张，用户实际要居中），删除后输入框内容继承 `.qr-box` 的 text-align:center。上线前子代理核对 11/11 全过；踩坑复刻：v5.43 断言「禁 inp.focus()」被**注释里的 inp.focus() 字样**命中（与 v5.40 forbidden 命中注释同源），注释改措辞后通过——源码断言/禁串写法均须考虑注释。测试：theme.test.js 新增 v5.43 断言组；jsdom 126/126 + E2E 18/18 = 144 全绿

- **v5.42**：修复提醒列表文字在该用户内核仍被吃字 + 面板居中 + 默认 +5 分钟。**列表文字换实现**——v5.41 的 span 颜色双保险（字面色+text-fill 双 !important）在该内核仍失效（标题能看到、唯独列表 span 被吃，判定为内核对 span 元素盒的独立 bug），改**裸文本节点**渲染（`document.createTextNode`，无元素盒，元素级夜间规则无从命中）；颜色改由行容器 `.rem-row` 锁定（color+text-fill+`background:none!important` 三保险，动态两板 + SHELL_CSS 三份名单同步）；行布局 flex→**grid 1fr auto**（文字列 + × 列），支撑文字居中。**面板居中**——remPanel 补挂 `qr-box` class（v5.40 复用 .box 时漏挂，配对弹窗整体 text-align:center 而提醒面板左对齐），标题「提醒」/列表文字居中，输入件内容保持左对齐（`#remBoxForm input{text-align:left}`）。**默认时间**——当前 +5 分钟（12:35 开面板默认 12:40），打开面板自动聚焦时间框、支持 showPicker 的浏览器直接弹选择器；「默认选中分钟段」为浏览器内置控件（UA shadow DOM）无标准 API，如实告知用户为尽力行为。上线前**子代理逐项核对 17 项全过**（用户硬性要求新增流程）；唯一低风险备注（匿名 grid item 无 min-width:0 理论可撑宽）已被事项 maxLength=20 从数据源封死。测试：R12 断言更新（+5min/qr-box/无 span）+ theme.test.js 新增 v5.42 断言组 + 版本断言 5.42；jsdom 125/125 + E2E 18/18 = 143 全绿

- **v5.41**：修复提醒 UI 文字被浏览器夜间注入吃掉 + 去重复闹钟图标（用户报：①到点卡片两个 ⏰ 太 low ②「知道了」黑按钮看不见字 ③已设提醒列表变纯黑块无文字）。**根因**——`#remCard`（v5.37）与 `#remBoxList`（v5.40）不在 v5.29 深色对抗覆盖名单里：夜间 CSS 注入型浏览器把 `color:var(--bg)` 的白字强制改黑 → 黑底黑字；列表行右「×」按钮又被 `.box button:not(:disabled)` 的反色 `!important` 卷成实底黑块，左侧文字无保护被吃 → 整行只剩一个黑块。**修复**——三份覆盖名单（动态日板/夜板 themeOverrideCss + 借壳日间 SHELL_CSS 预反色板）各补 7 条规则：#remCard 卡片实底、标题/条目/「已过 X 分钟」/「知道了」/列表文字全部 `-webkit-text-fill-color !important` 双保险；「×」按钮显式恢复描边极简（`background:none!important` + `--line` 描边），不再被反色规则卷走。**去 emoji**——到点卡片标题「⏰ 提醒」→「提醒」、条目/chip 文案（设提醒/已过期）同步去前缀；系统通知栏保留 ⏰（系统层 emoji 醒目，不在页面 UI 内）。测试：theme.test.js 新增 3 项（动态两板规则断言 + SHELL_CSS 规则断言 + 页面内 ⏰ 清理且通知保留）；jsdom 124/124 + E2E 18/18 = 142 全绿

- **v5.40**：提醒面板升级为扫码配对同款模态 + 到点卡片视觉统一（用户点名"弹出框风格要与项目 UI 一致，包括到点提醒的弹出框"）。**面板模态化**——顶部 hintbar 横条退役，改 `.mask`（模糊遮罩）+ `.box`（380px 圆角 18 卡片）模态，直接复用 `.box` 的输入框（46px 高、focus accent 描边 + ring）/主按钮（全宽实底反色）/深色覆盖保护圈，与扫码配对完全一致；结构 = 标题「提醒」+ 设置行（时间默认当前 + 事项可留空 + **「添加提醒」**按钮，"定时"更名用户拍板）+ 分隔线 + 已设条目（× 时间 · 事项），**设置行永远首行**（静态 DOM 顺序，已设多少条都不挤位）；点遮罩空白或 Esc 关闭；事项框 **Enter 直接确认**（= 点添加提醒，已过时刻同样 accent 拦截）；chip 与模态互斥回归（遮罩挡正文，v5.39 的 below-panel 下移退役）。**到点卡片 #remCard**——视觉对齐 `.box`（圆角 18、rise 入场动画、同款阴影、标题 18px/600、「知道了」改全宽实底反色 div 伪按钮对齐主按钮外观），**不加遮罩**（到点是通知不是操作门槛，不打断输入）；div 底座保留因 remCard 不在 `.box` 覆盖保护圈内。测试：R12 重写模态断言（含 form 先于 list 的 compareDocumentPosition 顺序锁）+ 新增 R12c（Esc/遮罩关闭/Enter 确认走真实 PUT）+ TC12c 改模态互斥 + R15 断言改 remMask；jsdom 121/121 + E2E 18/18 = 139 全绿

- **v5.39**：提醒面板极简 + 时间 chip 过期明示 +「知道了」按钮防夜间黑块。**面板极简重构**——删三个快捷按钮（1小时后/今晚8点/明早9点）、「提醒我：」「再加：」标签与常驻发现性提示（`remQuickTargets`/`noteFirstLine` 退役）；新形态 = 已设条目（× 时间+事项）+ 时间选择器（默认当前时刻）+ 事项输入框（placeholder「事项（可留空）」）+「定时」；所选时刻已过 → 输入框 `--fg` 加重 900ms 且不发 PUT（不引新色值）；事项留空按空入库，通知标题退「该看笔记了」。**chip 三改**——① 去掉与提醒面板互斥（面板开着也浮出，`below-panel` 下移错位）；② 过期时间不再无声无息：`collectTimeMatches` 返回项带 `expired` 标记（非法值仍不返回），chip 灰态「⏰ 已过期 …」虚线边、点击无效；③ 事项提取 `itemAfterMatch`：时间串同行后文截 20 字，无后文为空（**不退笔记首行**，用户拍板留空就留空）。**「知道了」按钮**——button→div 伪按钮（role=button + tabindex + Enter/Space 键盘可达）+ 描边样式（border/文字同源 `--fg`、透明底）：国产浏览器夜间模式对原生表单控件强制深色导致按钮"全黑"，div 不受表单 UA 强制样式影响。测试：R11 改 itemAfterMatch、R12 重写极简断言、新增 R12b（红边拦截/留空入库）/TC12b（过期灰态点击无效）/TC12c（去互斥 below-panel）；jsdom 120/120 + E2E 18/18 = 138 全绿。⚠ 老坑复现拦截：顶层 `let` 不挂 window，R12b 初稿 `window.reminders` 断言必炸，改走 remBtn 状态验证

- **v5.38**：修复浮层提示条透出笔记文字——用户报「点闹钟弹出框在笔记文字后面」，取证为 `.hintbar`（remPanel/draftBar/installBar 三条共用）与 `#versionToast` 背景用 `var(--hover)`=rgba(...,.05)（95% 透明），浮在正文上文字透出被误判层级（z-index:55/60 本身无问题，v5.24 起就存在，v5.37 面板变大变常用才显眼）。修复：两处背景改实底 `var(--box-bg)`（随日/夜主题，与提醒卡片/时间 chip 同材质）；按钮 hover 态的 `--hover` 半透明不动；深色壳覆盖块（动态 `${p.bg}` 与静态 `#040407`）本就是实底无需改。测试：theme.test.js 新增实底断言（正则抓规则文本，断言含 `var(--box-bg)` 且不含 `var(--hover)`），jsdom 117/117 + E2E 18/18 = 135 全绿。⚠ 工程坑：同一文件多处 Edit 并行下发会竞态覆盖（.hintbar 改动把 versionToast 改动冲掉，回归断言当场抓住），同文件多处修改必须串行执行

- **v5.37**：多条提醒 + 笔记时间识别点击设提醒 + 实底提醒卡片；移除待办功能。**多条提醒**——rem 密文字段不变（服务端零改动、零知识不破），明文 `{at,text}` → `{list:[{at,text}...]}`（升序、上限 10 条），读取旧格式自动迁移；REM_DONE 由单时间戳改 JSON map（旧值兼容）；调度最近一条、触发后自动排下一条；面板逐条「×」取消、快捷按钮变「再加」。**时间识别**——纯函数 `parseTimeMatches`/`matchTimeAt`：支持 `2026-09-02 07:00`、`2026/9/6 7:05`、`9-6 07:00`（无年份补当年、已过进位明年）、`9月8日 08:30`；过去时间（含 30 秒内）不命中；光标落在时间文本上（selectionchange 防抖 250ms）浮出 `#timeChip`「⏰ 设提醒」，点 chip 即 addReminder（pointerdown/touchstart/mousedown 三连 preventDefault 防焦点丢失，chipData 先消费防三连双触发）；**不改正文 DOM**（linkify 拍平 span 的约束），chip 是编辑器外浮层。**提醒卡片**——remBar 半透明提示条退役，改 `#remCard` 居中实底卡片（var(--box-bg)/var(--fg)/var(--line) 主题变量，不进三处反色覆盖块），多条列表 + 已过时长 + 「知道了」全清；fireReminder 无条件弹卡片（页内主通道不再依赖通知权限）+ WebAudio 双音（页面可见时）+ navigator.vibrate 震动。**移除待办**（v5.34 引入，整体下线）——删 todoBtn 按钮 + 创建链 + 勾选链 + 方框 CSS + 11 项测试；工具栏回 8 个按钮；旧笔记里 class="todo" 残留无害，渲染退化普通文本。锁定时同步清提醒态（卡片/chip/面板全收）。测试：reminder.test.js 重写 15 项（list 上传/迁移/多条补弹/REM_DONE map/旧 done 兼容/显式 null/上限/同刻覆盖/单条触发/SW 通知/面板/server 语义/锁定清理），新增 timechip.test.js 13 项（正则解析/边界/集成 chip），jsdom 116/116 + E2E 18/18 = 134 全绿。⚠ 跨 realm 坑：jsdom window 创建的数组与 Node 数组 deepStrictEqual 原型不等，断言空数组改用 length；jsdom 无 PointerEvent，pointerdown 监听未挂载，集成测试走 mousedown
- **v5.36**：便签提醒（L1+L2 本地方案，不上 Web Push——那需要服务端存明文提醒时间，零知识破防）。**数据**：`rem` 字段与正文同一把 key 加密的 `{ct,iv}` JSON 串，`server.js` PUT 透传时**显式传参才更新、未传保留原值**（`obj.rem !== undefined` 判断，null 是显式取消）——否则任何一台设备的普通正文保存都会抹掉另一台设备刚设的提醒；服务端依旧只见密文。**设置**：工具栏第 9 个按钮（闹钟），面板快捷「1 小时后 / 今晚 8 点（过 20:00 自动变明晚）/ 明天上午 9 点 / datetime-local 自定义」，默认文案取笔记首行截 20 字；设置即完整保存（正文 + rem 一起 PUT，v 递增 SSE 广播其他设备实时拿到）；权限 `requestPermission` 只在用户主动设提醒时申请，被拒自动降级。**触发三通道**：① 页内 `setTimeout` → SW `showNotification`（tag 固定 `notesync-rem` 系统去重）或 `new Notification`；② 过期未确认 → 解锁时 `loadReminder` 补弹 `remBar` 提示条「已过 N 分钟」（唯一 100% 兜底，`REM_DONE` 时间戳防同机重复弹，跨设备重复弹接受）；③ Notification Triggers API 探测性支持（`showTrigger` in Notification.prototype，至今未正式落地，不指望）。**iOS 未装 PWA**：面板内如实提示「需先添加到主屏幕才能收到通知」，不装糊涂；sw.js 补 `notificationclick`（聚焦已开窗口否则打开）；`Math.min(at-now, 2^31-1)` 防 setTimeout 溢出。按钮高亮态 `#remBtn.on` 用 `var(--fg)/var(--hover)` 不引新色。测试：新增 `unit/reminder.test.js` 11 项（rem 上传/恢复调度/过期补弹/确认去重/显式 null 取消/权限降级/SW 通知/首行截断/面板渲染/server 透传语义/无 pushManager），jsdom 110/110 + E2E 18/18 = 128 全绿。⚠ 测试教训：页面顶层 `let` 声明（reminder 等）是**词法绑定不挂 window**，测试不能 `window.reminder` 读/写——必须走真实函数路径（`setReminder`）建立状态，直接赋值 `window.reminder=x` 是无效属性
- **v5.35**：离线草稿 + 安装引导。**离线草稿**——此前"离线能写"是假的：保存失败只有 3s/6s/12s 退避重试，页面一关未同步内容直接蒸发。现在 `saveLocal` 加密成功后、上传前先把密文草稿同步落盘 `localStorage['notesync_draft_{noteId}']`（含 `ct/iv/baseV/at`，与正文同一把 AES key，明文不落盘零知识不变）：上传成功即清；失败/中途关页/杀进程草稿都在。解锁时 `applyUnlocked` 末尾走 `restoreDraftIfNeeded` 三分支：① 解不开（口令换过/损坏）→ 静默丢弃；② `baseV !== note.v`（另一台设备已保存新版本）→ 顶部冲突条「恢复我的修改 / 丢弃」，**绝不自动覆盖**；③ 无冲突 → 静默恢复进编辑器并 `scheduleDraftResave`（400ms 后补传）。关键不变量：`lastHtml` 恢复时保持为服务端内容，`saveLocal` 靠 `innerHTML !== lastHtml` 检测差异才会真正补传（补传再失败草稿重写仍在）。**安装引导**——Android/桌面 Chromium 靠 `beforeinstallprompt`（preventDefault 暂存，解锁后点「安装」一键装）；iOS 无此事件，如实提示走 Safari 分享菜单「添加到主屏幕」；`appinstalled` 收尾、`notesync_install_dismissed='1'` 记住拒绝、会话内不重弹、standalone 模式不弹、与草稿冲突条互斥不叠条、解锁后才弹不在落地页打扰。**sw.js 重写**——缓存名改由注册 URL `?v=APP_VERSION` 驱动（版本号单一来源仍是 index.html，发版即换名、activate 清旧名，根治此前 `notesync-v1` 硬编码导致发版后离线用户拿旧壳的隐患）；预缓存补 `favicon.svg`；html2canvas CDN（固定 1.4.1）纳入 cache-first（no-cors opaque response 可整体缓存），离线时「导出为图片」不再失效。提示条样式只用 `var(--*)` 主题变量跟随内部主题，借壳滤镜自动翻色，无需进反色覆盖块。测试：新增 `unit/pwa.test.js` 11 项（失败落盘/成功清除/无冲突恢复补传/冲突弹条不覆盖/恢复推送/丢弃清除/坏草稿静默丢/SW 版本注册/iOS 引导/dismiss 记忆/standalone 不弹），注入 Node webcrypto + TextEncoder 走真实 AES-GCM 加解密；全套 jsdom 99/99 + Playwright E2E 18/18 = 117 全绿。⚠ 测试基建教训：测试中途 throw 时末尾 `dom.window.close()` 执行不到 → jsdom 实例泄漏 → 事件循环永不排空 → 整个测试进程挂死到超时（todo.test.js 曾同坑），所有用例必须 `t.after(close)` 兜底
- **v5.34**：新增待办功能（工具栏第 8 个按钮，紧跟删除线）。设计取舍——状态只挂在**根级块的 class + `data-done` 属性**上，不插 `contenteditable=false` 元素、不重建块：① `linkifyEditor` 会拍平全部 `<span>`，任何 span 标记方案都会被它吃掉；② `ensureBlockWrapped` 只包裹裸节点、不碰已有块，根级 div/p 的 class 是唯一安全落点；③ 方框与勾由 CSS `::before`/`::after` 绘制，切换完成态只改一个属性值，**DOM 结构零变化** → 撤销栈（抓 innerHTML）、linkify、同步三者天然兼容。交互：光标停在行内点一下即变待办（无需先选中文字），点方框切换完成态，选中多行可批量转换。两个坑：① 不能依赖 `lastRange`——它只在**非折叠选区**时才被 selectionchange 更新，折叠光标下恒为 null，故 `todoBlocksInRange()` 实时读 selection、`lastRange` 仅兜底；② 判定锁定态用 `getAttribute('contenteditable')` 而非 `isContentEditable`（后者依赖渲染层，jsdom 未实现）。样式**只使用 `currentColor` + `opacity`，不引入任何新颜色值**，因此无需进入那三处反色对抗覆盖块。移动端按钮由 7 个增至 8 个，360px 屏按原尺寸会溢出（40+17+90+8×31=395px>360px），故 560px 断点下收紧为 gap 6px / 按钮 27px / 图标 16px。测试：新增 `unit/todo.test.js` 11 项（折叠光标、批量、混合态、序列化、点方框命中、点文字不误触、linkify 后存活、CSS 无新颜色、移动端不溢出），全套 jsdom 88/88 + Playwright E2E 18/18 = 106 全绿
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
