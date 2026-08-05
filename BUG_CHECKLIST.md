# NoteSync Bug 核对清单

> 每次改完代码，子代理测试流程的**第 0 步**必须读本文件，逐项核对相关分类的条目，确认未引入回归。
> 核对范围：只核对与本次修改相关的分类（改删除线核对 A 类，改导出图片核对 B 类，以此类推）。

---

## 使用方法

> **第 0 步（必做，先于人工核对）：先跑自动化测试。**
> 仓库 `tests/` 目录已固化 A/B 类核心路径用例，改完代码、提交前必须全绿：
> - jsdom 单元/DOM 测试（A1-A7 核心）：`cd tests && npm test`
> - Playwright 真实浏览器 E2E（A7 选区+500ms linkify、B3 不刷新、B6 overflow 恢复）：`cd tests && npm run test:e2e`
> 自动化测试覆盖了人工最易漏的"删除线 DOM 手术 / 选区偏移 / 导出"回归点，比人工核对更可靠。
> 自动化全绿后，再进入下面的人工/子代理清单核对。

1. 改完代码后，测试子代理的第一步是读取本文件
2. 根据修改的功能，找到对应分类（A/B/C/D）
3. 逐项核对每个 bug 的「核对要点」复选框
4. 测试报告里必须包含「Bug 列表核对结果」段落，列出核对的编号和结果
5. 发版后若发现新 bug，追加到对应分类末尾

### 分类速查

| 分类 | 功能 | 条目数 | 触发核对的条件 |
|------|------|--------|----------------|
| A | 删除线 | 7 | 修改 strikeBtn / addStrikeToRange / removeStrikeFromRange / rangeIntersectsNode / contentHasS / linkifyEditor |
| B | 导出图片 | 7 | 修改 exportImage / exportImgBtn 事件 / html2canvas 调用 / 临时 div 渲染 |
| C | 缓存与图标 | 4 | 修改 favicon / manifest.json / Cache-Control 头 / icon-maskable 生成与路由 |
| D | PWA 与移动端 | 3 | 修改 manifest.json / 触摸事件 / 夜间模式 CSS |
| E | 选区与同步 | 4 | 修改 editor 输入/粘贴处理 / linkifyEditor / saveSelectionOffsets·restoreSelectionOffsets / cleanupLeadingTrailingBreaks / insertNodeAtCaret / 删除逻辑 / poll 远端合并 / selectionchange 钳制 |
| F | 光标与编辑 | 13 | 修改 Enter 处理 / cleanupLeadingTrailingBreaks / caretInsideNode / linkifyEditor 块内偏移 / ensureBlockWrapped / ensureCaret / repaintCaret / relocateCaretToVisible / isComposing |
| G | 撤销栈 | 1 | 修改 自建撤销栈 / captureState / applyState / recordIfChanged / syncCurrentState / undo / redo / keydown 拦截 Ctrl+Z/Y |
| H | 落地页/解锁/路由/图标/指纹 | 6 | 修改 landing 路由(ID_RE/extractId/导航) / 打开按钮禁用 / 解锁按钮禁用态样式 / 退出锁定禁用态 / 落地页中文输入过滤 / 指纹 WebAuthn PRF 逻辑（v5.15 起彻底移除） |
| I | 链接转换/粘贴/保存可靠性 | 6 | 修改 linkifyEditor / buildLinkSafe / trimUrlTrailing / urlRegex / paste 处理 / pasteTextNative / input 处理器 busy 分支 / saveLocal / scheduleSaveRetry / flushDirtySave / fetchRetry / copyBtn |

---

## A. 删除线功能

### A1 | 删除线：跨行选中后多出换行
- **版本**: v4.3
- **现象**: 跨行选中文字加删除线后，行之间多出空白换行
- **根因**: 一次性用 `<s>` 包裹整个 range，破坏了原有的行结构（`<p>` 或 `<br>`）
- **修复**: 改为逐个文本节点包裹 `<s>`，保留行结构
- **关联文件**: index.html → addStrikeToRange()
- **核对要点**:
  - [ ] 单行选中加删除线，行数不变
  - [ ] 跨行选中加删除线，行数不变
  - [ ] 跨行选中取消删除线，行数不变

### A2 | 删除线：取消时误伤同行其他文字
- **版本**: v4.3
- **现象**: 选中部分文字取消删除线，同行未选中的正常文字也被取消了
- **根因**: 取消时未区分完全覆盖与部分覆盖，直接移除了整个 `<s>` 标签
- **修复**: 区分完全覆盖（移除标签）与部分覆盖（拆分标签，只取消选中部分）
- **关联文件**: index.html → removeStrikeFromRange()
- **核对要点**:
  - [ ] 选中整行删除线取消 → 整行恢复
  - [ ] 选中行内部分删除线取消 → 只选中部分恢复，其余保持
  - [ ] 同行有正常文字 + 删除线文字，取消删除线不影响正常文字

### A3 | 删除线：normalize 后选区偏移
- **版本**: v4.3
- **现象**: 加/取消删除线后，光标位置错乱或选区跳到错误位置
- **根因**: 用旧的 Range 对象恢复选区，但 normalize() 已改变 DOM 结构，旧 Range 的 startContainer/endContainer 引用失效
- **修复**: normalize 前把选区转换为字符偏移量保存，normalize 后用字符偏移量重建选区
- **关联文件**: index.html → addStrikeToRange() / removeStrikeFromRange()
- **核对要点**:
  - [ ] 加删除线后光标停在原位
  - [ ] 取消删除线后光标停在原位
  - [ ] 连续多次加/取消，光标不漂移

### A4 | 删除线：单行选中无效
- **版本**: v4.3.1
- **现象**: 在单行内选中几个字，点击删除线按钮无反应
- **根因**: TreeWalker 的根节点设为 range.commonAncestorContainer，当单行选中时它是文本节点，文本节点没有子节点，TreeWalker 遍历结果为空
- **修复**: 当 commonAncestorContainer 是文本节点时，改用其 parentNode 作为 TreeWalker 的根
- **关联文件**: index.html → addStrikeToRange() / removeStrikeFromRange()
- **核对要点**:
  - [ ] 单行内选中 2 个字加删除线 → 有效
  - [ ] 单行内选中 2 个字取消删除线 → 有效
  - [ ] 跨行选中加/取消 → 有效（回归检查）

### A5 | 删除线：取消后无法重新加（回归高频点）
- **版本**: v5.1
- **现象**: 选中"乙丙丁"加删除线，再选中"丙"取消，再次选中"丙"加删除线无反应
- **根因**: 自定义 rangeIntersectsNode 函数的 compareBoundaryPoints 运算符写反。W3C 规范描述与 Chrome 实际行为相反：START_TO_END 应比较 range 的结束点与 nodeRange 的开始点，Chrome 中需要用 `>= 0` 而非 `<= 0`
- **修复**: START_TO_END 用 `>= 0`，END_TO_START 用 `<= 0`（与直觉相反，与 Chrome 实际行为一致）
- **关联文件**: index.html → rangeIntersectsNode()
- **核对要点**:
  - [ ] 选中正常文字加删除线 → 有效
  - [ ] 选中已加删除线文字取消 → 有效
  - [ ] **取消后再次选中加删除线 → 有效（核心回归点）**
  - [ ] 跨行选中加/取消 → 有效
  - [ ] PC Chrome 测试通过
  - [ ] 小米浏览器测试通过

### A6 | 删除线：空 `<s>` 标签误判为有效删除线
- **版本**: v5.1
- **现象**: 取消删除线后残留空 `<s></s>` 标签，导致 contentHasS 判定为"选中区域已有删除线"，再次点击按钮走取消逻辑而非添加逻辑
- **根因**: contentHasS 用 `querySelectorAll('s').length > 0` 判断，未检查 s 标签是否有实际内容
- **修复**: 改为 `Array.from(preview.querySelectorAll('s')).some(s => s.textContent.length > 0)`，只计非空标签
- **关联文件**: index.html → contentHasS 判断逻辑
- **核对要点**:
  - [ ] 加删除线 → 取消 → 再加，每次都有效
  - [ ] 连续多次加/取消同一区域，不残留空标签
    - [ ] DOM 中不残留 `<s></s>` 空标签（F12 检查）

### A7 | 删除线后选区丢失（光标跳开头 / 选中态消失）
- **版本**: v5.1
- **现象**: 选中一段文字后点击"添加删除线"或"取消删除线"，操作成功后原选中文字不再被选中——光标跳到笔记最前（或不选中任何文字）。期望：无论加/取消删除线，之前选中的文字选中态原样保留。
- **根因**: linkifyEditor() 在每次 input 事件后防抖 500ms 运行，会对长连续文本/URL/手机号识别并用 `textNode.replaceWith(...span.childNodes)` 把原始文本节点整个替换成新节点。（一层）删除线操作结束后 applyStrike 用字符偏移恢复了选区，但 500ms 后 linkify 重排 DOM，选区指向的旧文本节点被 detach；linkify 原先用 `sel.getRangeAt(0).cloneRange()` 保存、重排后 `addRange(savedRange)` 恢复，detached 的 Range 恢复抛异常被吞掉，选区塌缩。（二层）linkify 会在长词中插入零宽空格 `\u200B` 断行（如 `15.34`→`15.​34`），若偏移把 `\u200B` 计为一个字符，则 save(插入前) 与 restore(插入后) 时点不一致，选区终点按选区内 `\u200B` 个数往前漂移，导致丢尾字、且取消删除线时 `lastRange` 偏短走部分覆盖分支而残留 `<s>`。
- **修复**: linkifyEditor 改用字符偏移保存/恢复选区（复用 saveSelectionOffsets / restoreSelectionOffsets）；并让偏移计数**无视 `\u200B`**（新增 visibleLen / visibleToRealOffset，只计可见字符），使 `\u200B` 插入前后偏移一致，选区精确落在同一段可见文字上、不漂移。applyStrike 内偏移恢复保留不变（负责 500ms 内的即时反馈）。poll() 远程更新路径传 `{ keepSelection: false }` 走自身光标恢复，不与 linkify 打架。
- **关联文件**: index.html → linkifyEditor() / applyStrike() / poll() / saveSelectionOffsets() / restoreSelectionOffsets() / visibleLen() / visibleToRealOffset()
- **核对要点**:
  - [ ] 选中中间文字 → 点添加删除线 → 选中文字不变
  - [ ] 选中已加删除线文字 → 点取消删除线 → 选中文字不变
  - [ ] 选区内含长数字（如 15.34、743.42，linkify 会插 `\u200B` 断行）→ 加/取消后选区仍精确覆盖原文字、不丢尾字
  - [ ] 取消删除线后不残留 `<s>`（如 `<s>余元</s>`）
  - [ ] 跨行选中加/取消 → 选中态保留
  - [ ] 部分选中（同行正常文字 + 删除线文字）加/取消 → 选中态保留
  - [ ] 连续多次加/取消同一区域 → 每次选中态都保留
  - [ ] 操作后光标不跳到笔记最前

---

## B. 导出图片功能

### B1 | 导出图片：文字重叠（TreeWalker 遍历跳过）
- **版本**: v5.0
- **现象**: 导出的图片中部分文字行重叠在一起
- **根因**: 用 childNodes.forEach 遍历并在循环内 replaceChild，导致数组索引错位，跳过部分文本节点，换行符未转为 `<br>`
- **修复**: 改用 TreeWalker 先收集所有文本节点到数组，再统一处理
- **关联文件**: index.html → exportImage() 的 onclone/临时 div 处理
- **核对要点**:
  - [ ] 多行文本导出，每行独立不重叠
  - [ ] 含删除线的文本导出正确
  - [ ] 含图片的笔记导出正确

### B2 | 导出图片：长 URL 不换行导致溢出
- **版本**: v5.0
- **现象**: 长 URL（如 file:/// 路径）在导出图片中溢出编辑区边界或与下一行重叠
- **根因**: html2canvas 不完全支持 word-break CSS，长连续字符串不换行
- **修复**: 在分隔符（/ . ? : = & # _ % -）后插入零宽空格 `\u200B` 辅助断行 + CSS `word-break:break-all` + `overflow-wrap:anywhere`
- **关联文件**: index.html → breakLongWords() / 临时 div 样式
- **核对要点**:
  - [ ] 含长 URL（>30 字符）的笔记导出，URL 正确换行
  - [ ] file:/// 开头的路径正确换行
  - [ ] https:// 开头的路径正确换行
  - [ ] 换行后不与下一行重叠

### B3 | 导出图片：点击按钮页面刷新（回归高频点）
- **版本**: v5.1
- **现象**: 点击"导出为图片并复制"按钮，页面整体刷新一次
- **根因**: `<button>` 缺少 `type="button"` 属性，默认 type 为 submit，触发表单默认提交行为
- **修复**: 所有 header 内的 button 元素加 `type="button"`
- **关联文件**: index.html → header 内所有 `<button>` 标签
- **核对要点**:
  - [ ] 点击导出按钮，页面不刷新
  - [ ] 点击复制按钮，页面不刷新
  - [ ] 点击上传按钮，页面不刷新
  - [ ] 点击删除线按钮，页面不刷新
  - [ ] 点击夜间模式按钮，页面不刷新
  - [ ] 点击锁定按钮，页面不刷新

### B4 | 导出图片：行间文字重叠
- **版本**: v5.1
- **现象**: 导出图片中相邻行的文字垂直方向重叠（如"8B"与下一行"file"重叠）
- **根因**: line-height 不足，html2canvas 渲染时行高压缩导致行间重叠
- **修复**: 改用临时 div 渲染（不修改 editor 内容），临时 div 的 line-height 设为 2.2
- **关联文件**: index.html → exportImage() 临时 div 样式
- **核对要点**:
  - [ ] 多行文本导出，行间距充足不重叠
  - [ ] 含长 URL 的多行笔记，URL 行与上下行不重叠
  - [ ] 编辑器内容在导出后未被修改

### B5 | 导出图片：移动端点击无效
- **版本**: v5.1
- **现象**: 手机上点击"导出为图片并复制"按钮，无任何反应
- **根因**: 只绑定了 click 事件，移动端部分浏览器（如小米浏览器）的 click 有延迟或不触发
- **修复**: 加 pointerdown（支持 PointerEvent 的设备）/ touchstart（不支持 PointerEvent 的设备）/ click 三事件，pointerdown 和 touchstart 内 preventDefault
- **关联文件**: index.html → exportImgBtn 事件绑定
- **核对要点**:
  - [ ] PC Chrome 点击导出 → 有效
  - [ ] 小米浏览器点击导出 → 有效
  - [ ] 手机 Chrome 点击导出 → 有效
  - [ ] 导出后不触发多次（防重复）

### B6 | 导出图片：editor 的 overflow 样式未恢复
- **版本**: v5.1
- **现象**: 导出图片后编辑器的滚动条消失或样式异常
- **根因**: 导出时临时修改了 editor.style.overflow，恢复代码写在 try 块内，若 html2canvas 抛异常则恢复代码不执行
- **修复**: 恢复代码移到 finally 块，确保无论成功或异常都执行
- **关联文件**: index.html → exportImage() 的 finally 块
- **核对要点**:
  - [ ] 导出成功后，编辑器滚动正常
  - [ ] 导出失败（如跨域图片）后，编辑器滚动仍正常
  - [ ] 连续多次导出，编辑器样式不累积异常

### B7 | 导出图片：跨域图片导致 SecurityError
- **版本**: v5.1
- **现象**: 笔记中含跨域图片时，导出报错 "SecurityError" 或图片区域空白
- **根因**: html2canvas 读取跨域 canvas 时触发污染，toBlob 抛 SecurityError，未捕获
- **修复**: catch 块判断 e.name === 'SecurityError'，提示"可能因外链图片跨域，请使用支持 CORS 的图床"
- **关联文件**: index.html → exportImage() 的 catch 块
- **核对要点**:
  - [ ] 含 Cloudinary 图片的笔记导出正常（useCORS: true）
  - [ ] 含其他域名图片时，有友好错误提示而非白屏
  - [ ] 错误提示后编辑器样式恢复正常（配合 B6）

---

## C. 缓存与图标

### C1 | favicon 更新后仍显示旧图标（双重缓存）
- **版本**: v5.0
- **现象**: 服务器已更新 favicon.svg，但浏览器标签页仍显示旧图标，即使强制刷新
- **根因**: 双重缓存——Cloudflare CDN 缓存（max-age=86400）+ 浏览器独立 favicon 缓存，两者都不随源站更新自动失效
- **修复**: favicon 引用加版本号 `?v=5.1` 绕过缓存 + 服务端 Cache-Control 设为 no-cache, no-store, must-revalidate
- **关联文件**: index.html → `<link rel="icon">` 标签 / server.js → favicon 路由响应头
- **核对要点**:
  - [ ] 更新 favicon 后，引用的版本号已递增
  - [ ] server.js 的 favicon 路由有 no-cache 头
  - [ ] 强制刷新后显示新图标

### C2 | favicon 有黑色背景
- **版本**: v5.0
- **现象**: 新 favicon 图标有黑色矩形背景，与顶栏 logo 的透明底不一致
- **根因**: SVG 未设置透明背景，渲染时默认填充黑色
- **修复**: SVG 设为透明底 + 金色细线 sync 图标（与顶栏 logo 完全一致）
- **关联文件**: favicon.svg
- **核对要点**:
  - [ ] favicon 背景透明
  - [ ] 图标颜色为金色细线
  - [ ] 与顶栏 logo 视觉一致

### C3 | PWA 图标更新后不生效
- **版本**: v5.0
- **现象**: 更新 manifest.json 的图标路径后，已安装的 PWA 仍显示旧图标
- **根因**: Chrome 安装 PWA 后独立缓存 icon，manifest 更新不会自动刷新已安装应用的图标
- **修复**: 需卸载 PWA（移动端长按删除 / PC 端 chrome://apps）后重新安装
- **关联文件**: manifest.json → icons 数组
- **核对要点**:
  - [ ] manifest.json 的 icon src 含版本号
  - [ ] 更新后提示用户卸载重装 PWA
  - [ ] 新安装的 PWA 显示新图标

### C4 | PWA 图标实底之争（v5.14 米白 → v5.15 误改黑底 → v5.16 还原备案前透明金 logo）
- **版本**: v5.14（首次加米白实底 #FBFBF8）/ v5.15（用户嫌米白不好看，误改黑底 #0F0F11）/ v5.16（用户点明要的是**备案前部署在 note.xuyinji.com.cn 的那个图标**，还原透明金 logo）
- **现象**: v5.15 把图标改黑底(#0F0F11)，用户实测不对——他要的是 ICP 备案前线上那个图标。核查 git 历史：`18d924d` 黑底版（#1C1C1A）仅存在 7 分钟即被 `b72c62f` 透明版取代、**从未上线**；ICP 备案（约 8/2）前线上跑的就是透明金 logo `favicon.svg`（`purpose: any maskable`）。所谓"黑底"是 Android 把透明 maskable SVG 填黑所致，并非一个显式黑底文件。
- **根因**: v5.15 把"用户喜欢的黑底观感"误当成"要一个显式黑底文件"，做了与备案前不符的改动；用户要的是还原真相文件，不是再加一层底色。
- **修复（v5.16 当前态）**: ① `favicon.svg` 恢复透明金 logo（`stroke="#8F7126"`、无背景矩形，与 `b72c62f` 一致）；② `manifest.json` 仅引用 `favicon.svg`（`background_color #fafafa`、`theme_color #2b6cff`），图标 src 加 `?v=5.16` 缓存破坏以强制刷新 PWA 图标；③ 删除 v5.14 新增的两张 `icon-maskable-192.png` / `icon-maskable-512.png` 及其 `server.js` 静态路由（回归备案前状态，无 maskable PNG）。
- **关联文件**: manifest.json / favicon.svg / server.js（已移除图标路由）/ ~~icon-maskable-192.png / icon-maskable-512.png（v5.16 删除）~~
- **核对要点**:
  - [ ] `favicon.svg` 不含任何 `fill="#0F0F11"` / `#FBFBF8` 矩形（透明金 logo）
  - [ ] `favicon.svg` 含 `stroke="#8F7126"` 金色描边
  - [ ] `manifest.json` 的 icons 仅含 `favicon.svg`（`purpose: any maskable`），无 `icon-maskable-*.png` 条目
  - [ ] 线上已删除 `icon-maskable-192.png` / `icon-maskable-512.png`（不再服务）
  - [ ] `server.js` 不再有 `/icon-maskable-*.png` 路由
  - [ ] 手机 Chrome 添加快捷方式后图标为透明金 logo（Android 按 maskable 填充，观感与备案前一致；真机验证）

---

## D. PWA 与移动端兼容

### D1 | PWA 快捷方式打开默认笔记而非目标笔记
- **版本**: v4.4
- **现象**: 为笔记 /noteA 创建桌面快捷方式，点击后打开的是默认笔记 /default 而非 /noteA
- **根因**: manifest.json 的 start_url 固定为 "/"，所有快捷方式都指向根路径
- **修复**: 服务端根据 `?start=` 查询参数动态返回 manifest.json，start_url 和 id 设为对应笔记路径；index.html 根据 noteId 动态设置 manifest link
- **关联文件**: server.js → manifest.json 路由 / index.html → manifest link
- **核对要点**:
  - [ ] 为笔记 A 创建快捷方式 → 打开笔记 A
  - [ ] 为笔记 B 创建快捷方式 → 打开笔记 B
  - [ ] 两个快捷方式互不干扰

### D2 | 小米浏览器夜间模式失效
- **版本**: v4.5
- **现象**: 小米浏览器夜间模式下，页面颜色被浏览器强制反转，手动切换夜间模式按钮无效
- **根因**: 小米浏览器夜间模式注入 CSS 强制覆盖页面元素颜色，普通 CSS 优先级不足
- **修复**: 对所有关键元素（body、editor、header、box、landing 等）的 background 和 color 属性加 `!important`
- **关联文件**: index.html → `<style>` 内所有颜色相关规则
- **核对要点**:
  - [ ] 小米浏览器夜间模式下，页面配色正确
  - [ ] 手动切换夜间模式 → 立即生效
  - [ ] 手动切换日间模式 → 立即生效
  - [ ] 自动切换（07:00/19:00）不受影响

### D3 | 移动端 touch 导致编辑器选区丢失
- **版本**: v5.1
- **现象**: 手机上选中文字后点击删除线按钮，选区在按钮触发前丢失，删除线加到错误位置或无效
- **根因**: 移动端 touch 事件在 click 前触发，touchstart 导致编辑器失焦，selection 丢失
- **修复**: 按钮用 pointerdown 事件（在 touchstart 前触发）拦截 + preventDefault 防止失焦；选区持久化跨 touch 事件保存
- **关联文件**: index.html → strikeBtn 事件绑定 / 选区保存逻辑
- **核对要点**:
  - [ ] 手机选中文字 → 点删除线 → 选中文字被加删除线
  - [ ] 手机选中删除线文字 → 点删除线 → 选中文字被取消
  - [ ] PC 鼠标选中 → 点删除线 → 正常（回归检查）

---

## E. 选区与同步

> **2026-8-2 复现/状态记录**：用户于备案前在线上 `note.xuyinji.com.cn/cs1`（口令 1）复现了 E1/E2/E3 全部三条，并于 15:12 要求"记录、待备案通过开解析后再修"。
> 但经核对项目日志：这三条**已在今日 13:27 修复并部署上线**（commit 132332c，本地 Playwright 验证 + 公网 `https://note.xuyinji.com.cn/` 含修复标记均通过）。`index.html` 源码修复函数为 `insertNodeAtCaret`（666 行）、`cleanupLeadingTrailingBreaks`（968 行，input 内调用）、`poll` 内 `restoreSelectionOffsets`（1033 行）+ `dirty` 守卫（1009-1012 行）。
> 故用户看到的应是 **13:27 之前的旧版本**现象，或浏览器/CDN 缓存未刷新（server.js 已发 no-cache，但 Cloudflare/nginx 层可能仍缓存）。
> 结论：**无需再写代码**。备案通过→重新开启域名解析后的动作是「硬刷新（绕过缓存）验证 v5.2 修复仍在 → 若仍复现，再排查回归/缓存，必要时重部署当前 index.html」。域名解析恢复前无法线上验证。

### E1 | 光标消失：聚焦时远端更新覆盖编辑器导致光标丢失
- **版本**: v5.2
- **现象**: 正在编辑笔记时，光标（黄标）偶尔整体消失，无法继续输入
- **根因**: `poll()` 检测到远端版本更新后直接 `editor.innerHTML = html` 替换内容。旧恢复逻辑在替换后才用 `sel.rangeCount > 0` 判断是否恢复光标，但替换 innerHTML 后选区已被清空（rangeCount=0），恢复被跳过，光标直接丢失；且旧逻辑把 `range.startOffset` 当作全局偏移、错配到 `editor.firstChild`，即便执行也落到错误位置
- **修复**: 改用 `saveSelectionOffsets/restoreSelectionOffsets`（与删除线/linkify 同一套偏移机制）在替换前保存、替换后恢复光标；并加 dirty 守卫——本机正聚焦且有未保存改动（`editor.innerHTML !== lastHtml`）时不覆盖编辑器，避免丢失输入与光标（远端内容在下次保存时由本机内容覆盖，属已知取舍，见 P0 同步冲突议题）
- **关联文件**: index.html → poll()
- **核对要点**:
  - [ ] 单设备编辑时，不触发远端更新，光标始终在
  - [ ] 两个标签页开同一笔记，A 编辑、B 保存，A 的光标不消失、且 A 的未保存输入不丢
  - [ ] 非聚焦时收到远端更新，内容更新后重新聚焦光标正常
  - [ ] 远端更新后光标停在原可见位置，不跳行

### E2 | 粘贴网址未自动转为可点击链接
- **版本**: v5.2
- **现象**: 从浏览器复制网址粘贴进笔记，网址以纯文本出现，不可点击
- **根因**: 粘贴处理依赖已废弃的 `document.execCommand('insertHTML'/'insertText')`。当编辑器光标状态异常（或与 E1 叠加光标丢失）或某些浏览器/移动端对 execCommand 支持不稳时，插入失败或退化为纯文本，网址不被包成 `<a>`
- **修复**: 改用基于 Selection/Range 的 `insertNodeAtCaret()` 直接插入节点（URL/手机号包成 `<a>` 片段，纯文本插文本节点），并兼容 `text/uri-list`（部分环境复制链接只给该格式）；插入后由 `input` 事件触发的 `linkifyEditor` 二次兜底
- **关联文件**: index.html → paste 事件 / insertNodeAtCaret()
- **核对要点**:
  - [ ] 粘贴 `http://www.baidu.com` → 生成 `<a>`，可点击打开
  - [ ] 粘贴含多行网址 → 每个网址都成链接
  - [ ] 粘贴普通文字 → 正常纯文本，不丢字
  - [ ] 粘贴 `http://a\nhttp://b` → 两个都成链接且各自独立一行
  - [ ] 移动端粘贴网址 → 成链接

### E3 | 删除多行选区后光标跳到第二行
- **版本**: v5.2
- **现象**: 选中含网址的多行文本（如 3 个 URL + 一二三 + 四五六）整段删除，期望光标停在第一行最左侧，结果落到第二行最左侧
- **根因**: 删除跨多个节点（linkify 生成的 `<a>` 与换行文本节点）的选区后，contenteditable 残留首行空行——一个孤立的 `<br>` 或一个以 `\n` 开头的文本节点，使后续内容被顶到第二行，光标随之落到第二行
- **修复**: 新增 `cleanupLeadingTrailingBreaks()`，在 `input` 事件中清理首/尾孤立换行（仅当存在后续/前导内容时才删，避免误删空白编辑器唯一的 `<br>` 导致光标消失）
- **关联文件**: index.html → input 事件 / cleanupLeadingTrailingBreaks()
- **核对要点**:
  - [ ] 选中 3 URL + 一二三 + 四五六 整段删除 → 光标停在第一行最左侧
  - [ ] 删除后编辑器无多余空行
  - [ ] 仅删除部分多行（如删前 4 行留 四五六）→ 光标在第一行最左侧
  - [ ] 空白编辑器输入时不会出现莫名的首行空行
  - [ ] 跨行删除普通文字（无网址）→ 光标同样停第一行

---

### E4 | 三击选行 + 空格 → 下一行被拽上来（块边界溢出）
- **版本**: v5.13
- **现象**: 输入两行（第一行 一二三四五六，第二行 七），三击选中第一行，按空格，期望第一行变" "、第二行保持"七"；实际第一行变成" 七"（第二行内容被合并上来）
- **根因**: Chromium 三击行选会把选区终点放到"下一行块的起点(offset 0)"，选区把两块之间的边界也包进去；随后任何替换/删除选区都会吞掉块边界、把下一行内容合并上来。NoteSync 自身此前未处理该边界溢出
- **修复**: 新增 `selectionchange` 守卫 + `isOverflowSelection()` / `clampOverflowSelection()`：检测"选区终点落在紧随其后的兄弟块起点、且未选中该块任何内容、正向溢出"的边界溢出模式，把选区终点钳制回当前块末尾。钳制后按空格只替换当前行、保留块结构
- **关联文件**: index.html → isOverflowSelection() / clampOverflowSelection() / selectionchange 监听
- **核对要点**:
  - [ ] 两行文本，三击第一行，按空格 → 第一行" "、第二行"七"（innerHTML = `<div> </div><div>七</div>`）
  - [ ] 普通跨两行拖选（选中了下一行内容）再按空格 → 不误钳制，行为正常
  - [ ] 反向选择（从第二行选到第一行开头）不误钳制
  - [ ] 三击后 Ctrl+Z 撤销仍正常（v5.12 自建撤销栈不回归）
  - [ ] 其他控件（密码框等）选区不受影响（守卫 `activeElement===editor`）

---

### E5 | 一端输入另一端必须刷新才同步：轮询兜底被 onopen 清掉、且只在 onerror 启动
- **版本**: v5.17
- **现象**: 在一端输入内容，另一端不会自动同步，必须手动刷新页面才能看到。用户此前体验为"几乎马上同步"。
- **根因（git 实证，非代码回归）**: 同步的"轮询兜底"自 v3.1 起就被设计成只在 `onerror` 时才 `setInterval(poll,10000)`；而 `onopen` 会 `clearInterval(pollTimer)` 把轮询关掉、完全依赖 SSE。该结构 2026-07-22 至今未变（v5.0 仅删了一行注释）。代码本身没回归——但线上访问链路走 Cloudflare 隧道/代理后，SSE 出现"连上但不投递"的悬挂态（连接建立、`onopen` 触发、事件既不送达也不报错），于是 `onerror` 永不触发 → 轮询永不起动 → 另一端收不到推送也没人轮询 → 只能刷新。即：以前 SSE 能端到端送达（`onmessage`→立即 `poll`，亚秒级）所以正常；现在 SSE 在隧道下不投递，暴露了"兜底依赖 onerror"这一潜伏弱点。
- **修复（v5.17，恢复 v2.x 的 4 秒自动同步体感 + 消除"必须刷新"）**:
  1. `startSync()` 无条件 `setInterval(poll, 4000)` 常驻（轮询变回 v2.x 基线，恢复"几乎马上同步"的可用体感）；SSE 退化为纯加速器（`onmessage`→立即 `poll()` 一次），`onopen` 不再清轮询。
  2. `connectSSE()` 的 `onerror` 立即 `poll()` 一次再 5s 重连（轮询兜底本就常驻，无需在此启动）。
  3. 新增 `visibilitychange`：设备从后台切回前台立即 `poll()` 一次。
  4. `poll()` 加 `if (!cryptoKey) return;` 守卫，已锁定态不再轮询、避免"同步中断"噪声。
  5. 远端落地轻提示「已从其他设备同步」（聚焦且本地有未保存改动时不提示，尊重 dirty 守卫）。
  6. 无论 SSE 是否可用，均 ≤4 秒自愈，彻底消除"必须刷新"。
- **关联文件**: index.html → startSync() / connectSSE() / poll() / visibilitychange 监听
- **核对要点**:
  - [ ] `unit/sync.test.js`：断言 `startSync` 建立 4000ms 无条件轮询 + `onopen` 不再 `clearInterval` + `onmessage` 触发 `poll`（精确锁死回归点）
  - [ ] `e2e/sync.test.js` T1：正常链路（SSE+轮询），A 输入后 B ≤5s 自动收到、无需刷新
  - [ ] `e2e/sync.test.js` T2（决定性）：`disableSSE` 关闭 SSE，仅靠 4s 轮询基线，B 仍 ≤5s 自动收到——旧代码（轮询被 onopen 清、SSE 又不可用）在此必失败
  - [ ] 两个标签页开同一笔记：A 输入、B 不聚焦，B 每 ≤4s 自动跟新；A 聚焦且有未保存输入时 B 不覆盖 A（dirty 守卫不回归 E1）
  - [ ] 设备从后台切回前台：B 立即同步一次
  - [ ] 已锁定后再解锁：轮询基线仍常驻、无"同步中断"刷屏
  - [ ] 单设备编辑：轮询每 4s 空跑一次、状态显示"已同步"、无异常

### E6 | v5.17 同步提示打扰 + 轮询 4 秒仍偏慢：用户反馈优化
- **版本**: v5.18
- **现象（用户原话）**: ①"要 4 秒那么久吗？"——认为兜底轮询间隔过长；②"自动同步是基操，有必要每次都显示'已从其他设备同步'吗？以前没有显示这句话自动同步体验就很好，现在显示了反而很打扰。"——明确不要同步提示浮层。
- **根因**: v5.17 把轮询基线设为 4000ms（恢复 v2.x 可用体感，但用户觉得仍慢），并新增了 `showSyncToast('已从其他设备同步')` 每次远端落地都弹一次轻提示。提示是 v5.17 为"验证修复"顺手加的，并非用户所求——自动同步本就是基操，频繁弹提示反而干扰。
- **修复（v5.18，听用户反馈回退过度设计）**:
  1. `POLL_INTERVAL` 从 `4000` 改为 `2000`：退化场景（SSE 被隧道缓冲挂死）同步延迟从 ≤4s 降到 ≤2s，回到用户记忆里"几乎秒同步"的体感；SSE 正常时仍是 `onmessage`→即时，不受影响。单用户自用，2s 一次轮询开销可忽略（无变化时只是一次版本号比对）。
  2. **彻底移除同步提示浮层**：删除 `showSyncToast()` 函数及其全部调用（`poll()` 内 `showSyncToast('已从其他设备同步')`），恢复 v2.x 静默自动同步体验。状态条"已同步"属常驻 UI、非打扰浮层，保留。
- **关联文件**: index.html → `POLL_INTERVAL` 常量、删除 `showSyncToast` 函数与调用；tests/unit/sync.test.js（断言 2000ms + `showSyncToast` 为 undefined）、tests/e2e/sync.test.js（T2 超时收 3500 证明 2s 基线 + 两端断言无 `#syncToast`）
- **核对要点**:
  - [ ] `index.html` 内 `showSyncToast` / `syncToast` / `已从其他设备同步` 三处字符串 0 命中（提示已彻底移除，非隐藏）
  - [ ] `unit/sync.test.js`：断言轮询基线 `c.ms === 2000` + `typeof window.showSyncToast === 'undefined'`
  - [ ] `e2e/sync.test.js` T1/T2：同步后 `document.getElementById('syncToast')` 为 false（真实 Chromium 确认无浮层）
  - [ ] `e2e/sync.test.js` T2（disableSSE）：仅靠 2s 轮询基线，B 在 3.5s 内收到（旧 4s 基线最坏 ~4s、且旧代码轮询被 onopen 清掉根本不会到）
  - [ ] 两端编辑互不覆盖（dirty 守卫 E1 不回归）、无 pageerror
  - [ ] 单设备编辑：轮询每 2s 空跑、状态"已同步"、无提示浮层弹出

---

### F1 | 按回车没反应：cleanup 把刚换出来的空行立刻删掉
- **版本**: v5.3
- **现象**: 没输入任何字符时按回车期望换行，结果毫无反应；在已有文字行尾按回车同样不换行
- **根因**: `input` 监听器**每次**都调 `cleanupLeadingTrailingBreaks()`。回车（无论浏览器默认行为还是 `execCommand('insertParagraph')`）产生的新块是"尾部空块且有前兄弟"，正好命中 cleanup 的删除条件，在同一个 input 事件里被立刻移除，DOM 回到回车前的状态。表现为"回车无效"。实测 `execCommand` 返回 `true` 但 `innerHTML` 不变，即是被 cleanup 回滚
- **修复**:
  1. `input` 监听器改用 `e.inputType` 门控：只有**删除类**输入（`delete*`）以及 `insertFromPaste` / `historyUndo` / `historyRedo` / 程序化派发（空 inputType）才调 cleanup；插入类尤其 `insertParagraph`/`insertLineBreak` 一律不清理
  2. cleanup 内新增 `caretInsideNode()` 守卫，不删光标所在的空块（保护用户主动创建、正准备输入的空行）
  3. 新增 Enter keydown 处理器：`preventDefault()` + `execCommand('insertParagraph')`（contenteditable 内部换行本就走它，能正确处理空块/行内元素拆分/跨块边界）；仅在 `execCommand` 返回 false 时走手动兜底，兜底路径置 `skipCleanupOnce = true` 后再 dispatch input
  4. `execCommand('defaultParagraphSeparator', false, 'div')`，与 cleanup/isBlankBlock 对块结构的预期一致
- **关联文件**: index.html → input 事件 / cleanupLeadingTrailingBreaks() / caretInsideNode() / keydown Enter 处理器
- **核对要点**:
  - [ ] 空编辑器连按两次回车 → 出现空行，光标不消失，空行上能正常输入
  - [ ] 有文字时行尾按回车 → 真的换行（`hello` → `hello<div><br></div>`）
  - [ ] 文字 + 回车 + 回车 + 输入 → 中间空行被保留（共 3 行）
  - [ ] **E3 不回归**：删除多行选区后仍无首/尾残留空行，光标停第一行最左侧
  - [ ] 用户主动创建的空行，在别处删字符后不被吃掉
  - [ ] 改 cleanup 触发条件时，务必确认没有漏掉某个删除类 inputType（否则残留空行回归）

### F2 | 裸域名网址不自动识别成可点击链接
- **版本**: v5.3
- **现象**: 复制粘贴 / 输入的网址没有变成可点击状态
- **根因**: `linkifyEditor()` 的 URL 正则只匹配带方案前缀的 `(?:https?|file|ftp)://...`。日常复制的 `www.baidu.com`、`example.com` 这类裸域名不含 `://`，`urlTest.test()` 直接为 false，TreeWalker 连节点都不接受，自然不链接
- **修复**: 扩展 URL 识别支持裸域名（`www.` 前缀或"域名.顶级域"形式），href 自动补 `http://`；同时加文件扩展名黑名单，避免 `README.md`、`file.txt` 这类被误判成链接；并把 linkify 反复运行时被拆成多段的同一条 URL 合并回一个 `<a>`
- **关联文件**: index.html → linkifyEditor()
- **核对要点**:
  - [ ] `www.baidu.com` / `example.com` 自动变链接，href 补上 `http://`
  - [ ] `README.md`、`file.txt`、`3.14`、`v1.2.3` 不被误识别成链接
  - [ ] 逐字输入 `http://www.baidu.com` 只生成**一个** `<a>`，不拆成两段
  - [ ] 已是链接的文本不被重复包裹

### F3 | 回车后光标瞬间跳到上一行末尾
- **版本**: v5.3
- **现象**: 输入"一二三四五六"，把光标移到"四"前按回车。光标先正确停在"四"左侧，随即快速跳到"三"右侧（上一行末尾）
- **根因**: 回车后 500ms 防抖的 `linkifyEditor()` 用**全局字符偏移**（`saveSelectionOffsets`/`restoreSelectionOffsets`，以 editor 根为作用域）保存/恢复光标。回车把内容拆成两个块后，"第二行开头（偏移 3）"与"第一行末尾（偏移 3）"在全局偏移上完全等价，恢复时落到了上一行末尾。纯文本不复现，因为没有 URL/长词就不会触发 linkify 重建节点
- **修复**: 新增 `blockOf()` 等块内偏移函数，linkify 改为以**块元素**（DIV/P 或编辑器根）为锚点保存/恢复光标。块元素在 linkify 重建文本节点时引用不变，可作为稳定锚点，跨块边界不再歧义
- **关联文件**: index.html → linkifyEditor() / blockOf()
- **核对要点**:
  - [ ] "一二三四五六 + URL"在"四"前回车 → 光标停"四"左侧，等 1 秒后仍不跳走
  - [ ] 含多条 URL 的行中间回车再输入 → 光标不丢、字落在正确位置
  - [ ] 删除线（A1-A7）仍正常：这套偏移机制与删除线共用，改动后需回归

### F4 | 光标偶发消失（linkify 重建 DOM 后选区恢复失败）
- **版本**: v5.3
- **现象**: 编辑过程中光标偶尔整体消失，无法继续输入（与 E1 的远端覆盖不同，本条由本机 linkify 触发）
- **根因**: linkify 用 `replaceWith` 重排文本节点、给长词插 `\u200B`，全局偏移恢复在越界/跨块时返回 null，选区未恢复即丢失
- **修复**: 同 F3 改块内锚点恢复，并在恢复失败时兜底把光标放回原块，不留空选区
- **关联文件**: index.html → linkifyEditor()
- **核对要点**:
  - [ ] 输入长 URL 后光标仍在
  - [ ] 回车 + 继续输入，光标稳定不丢
  - [ ] 页面无 JS 报错（`pageerror`）

### F5 | 链接文字改动后 href 陈旧 / 链接中间回车拆分再合并结尾段丢失
- **版本**: v5.4
- **现象**:
  1. 一个自动链接（如 `http://example.com/abcdef`）的文字被改动后，href 仍是旧值、不随之刷新（stale href）；
  2. 在链接**中间**回车把它拆成两行，再按 Backspace 合并回来时，结尾段（如 `def`）丢失，只剩前半段 `http://example.com/abc` 且 href 不对
- **根因**: `linkifyEditor()` 的 TreeWalker 在父节点是 `<a>` 时直接 `FILTER_REJECT`，导致**已生成的 `<a>` 内部文本永不被重新扫描**。于是：a) 链接文字改了、href 永远陈旧；b) 回车拆分后 Chromium 在合并时把后半段包进一个无语义 `<span>`（带 `background-color:transparent` 等重置样式），而 `normalize()` 只合并相邻*文本*节点、跨不过 `<span>`，URL 前后两段无法拼回
- **修复**: 在 linkify 开头统一"先拆后建"——
  1. 先把所有自动链接 `<a data-url="1">` 拆回纯文本（只拆自动链接，手动链接不受影响）；
  2. 再把 Chromium 自动插入的纯 `<span>` 包装层拍平（应用本身从不创建 span，这些无语义）；
  3. `editor.normalize()` 合并相邻文本节点；
  4. 最后从文本重新识别 URL / 手机号，重新生成 `<a>`（href 完全由当前文本推导，永不过时）。
  旧"合并紧邻前后 `<a>`"逻辑因此冗余，已删除（由 normalize 统一处理跨节点拼接）
- **关联文件**: index.html → linkifyEditor()
- **核对要点**:
  - [ ] 改长链接文字 → 重新 linkify 后 href 与文字一致（stale-href 修复）
  - [ ] 链接中间回车 → 拆出的两行各自 `<a>` 的 href 与文本一致（不出现 `def` 配 `http://...abc`）
  - [ ] 拆出后按 Backspace 合并 → 还原成单个 `<a>`，href=完整 URL（C1 场景）
  - [ ] 删除线 B3/B4 后再 linkify 不破坏内容（`<s>` 不被拍平）
  - [ ] 邮箱/版本号/裸文件名仍不误判（P1 不受影响）
  - [ ] 逐字输入 `http://www.baidu.com` 仍只生成一个 `<a>`

### F6 | backspace 合并后续行时，首行空块被 cleanup 误删（内容上移）
- **版本**: v5.5
- **现象**: 笔记为 `第一行:""` / `第二行:"一"` / `第三行:"二"`，光标置于第三行"二"左侧按 Backspace。
  - **期望**: 第三行合并到第二行 → `第一行:""` / `第二行:"一二"`
  - **实际**: 首行空块被删，内容"上移"成 `第一行:"一二"`
- **根因**: `cleanupLeadingTrailingBreaks()` 首部删除分支只检查 `caretInsideNode(首部空块)`（光标是否落在该空块内）。本场景 backspace 先把第三行"二"合并进第二行（Chromium 还会把"二"包进一个无语义 `<span style="background-color:transparent">`），首行空块仍在最前，但光标此时落在合并后的第二行内（不在首行空块内）→ `caretInsideNode` 拦不住 → 首行空块被误删，后续内容整体"上移"一行
- **修复**: 新增 `caretAfterNode(n)` 守卫（光标落在 n 之后，即 n 在光标前面）。首部删除分支改为 `!caretInsideNode(首部) && !caretAfterNode(首部)`——只要光标在被删空块之后就不删，避免吞掉用户有意保留的首行空行。尾部分支保持不动（仍只护光标所在末尾块）
- **关联文件**: index.html → cleanupLeadingTrailingBreaks() / caretAfterNode()
- **核对要点**:
  - [ ] 首行空块 + 任意后续行，在后续行行首按 Backspace 合并 → 首行空块保留（不丢、不上移）
  - [ ] 用户主动创建的空行，在别处删字后仍保留（E3-4 不回归）
  - [ ] 删除多行选区后无残留多余空行（E3-1/2/3 不回归）
  - [ ] 仍有意删末尾多余空行时不误留（尾部逻辑未动）

### F7 | 粘贴文字到空编辑器后，选中按空格光标不显示（逻辑正确但视觉光标不绘制）
- **版本**: v5.6
- **现象**: 直接复制"一二三"进笔记 → 选中"一二三"按空格 → 第一行变成" "（单空格，功能正确，后续输入确实落在空格之后），但页面上看不到光标；而同样操作若改为在页面上逐字输入"一二三"则光标正常显示
- **根因**: 粘贴走 `paste` 处理器 → `insertNodeAtCaret(textNode)`，把纯文本作为**裸文本节点**直接插到 `#editor` 根下（无 `<div>` 包裹）。浏览器原生逐字输入会自动把内容包进 `<div>` 块，但我们的粘贴路径不会。contenteditable 根下出现裸文本节点属于非法结构，Chromium 据此不绘制光标（仅粘贴路径触发，逐字输入路径结构正常所以不受影响）
- **修复**:
  1. `insertNodeAtCaret()`：当插入的是纯文本节点且插入点直接在 editor 根（`range.startContainer === editor`，即空编辑器粘贴）时，先包进 `<div>` 再插入，使粘贴产物与浏览器原生输入结构一致
  2. 新增 `ensureBlockWrapped()`：把 editor 根下的裸文本/裸元素子节点收进一个 `<div>`（仅在根下没有任何块级 `<div>/<p>` 时执行）。**关键坑**：最初把它放在 `input` 监听器里同步调用，会与原生逐字输入竞争、破坏正在进行的按键（首字符丢失+末字符重复，如 `http://x.com`→`ttp://x.comh`）。改为放进 `linkifyEditor()`（input 后 500ms 防抖内执行），此时按键已结束、无竞争，安全
- **关联文件**: index.html → insertNodeAtCaret() / ensureBlockWrapped() / linkifyEditor()
- **核对要点**:
  - [ ] 粘贴"一二三"到空编辑器 → 内容应为 `<div>一二三</div>`（块级包裹，不再是根下裸文本节点）
  - [ ] 粘贴后选中全行按空格 → 应为 `<div> </div>`（块内单空格），且继续输入落在空格之后
  - [ ] 逐字输入路径仍正常（原样 `<div>` 包裹，不受影响）
  - [ ] `_rev_typing.js` 不因块整理而损坏（19/19，首字符不丢、末字符不重）
  - [ ] URL/手机号粘贴到空编辑器后也能正常被 linkify 识别（裸 `<a>` 由 ensureBlockWrapped 在 500ms 内收进 `<div>`）

### F8 | 视觉光标不绘制（逐字输两行后首行裸文本节点 + div 兄弟不被包裹）+ 选中+空格吞行 + Ctrl+Z 错乱
- **版本**: v5.7
- **现象**（用户逐字操作复现，非粘贴路径）：
  1. 编辑器两行：第一行"一二三"、第二行"四五六"。选中"一二三"按空格 → 期望第一行变" "且光标在空格后、第二行仍是"四五六"；实际第一行变成" 四五六"（第二行被吞）、光标在行末。继续 Ctrl+Z → 期望还原"一二三"选中态、第二行"四五六"；实际变成"四五六一二三"（两行顺序错乱）。
  2. 视觉光标不绘制（F7 残留）：即便结构看似正确，某些输入路径下光标仍不显示。
- **根因**: F7 的 `ensureBlockWrapped()` 用了 `hasBlock` 早退逻辑——只要 editor 根下**存在一个**块级 `<div>/<p>` 就整体 `return`，导致当"裸文本节点恰好和 `<div>` 做兄弟"时（**逐字输两行**后的第一行、或**粘贴到非空编辑器**）永远不会被包。根下出现裸文本节点 → contenteditable 视为非法结构 → Chromium 不绘制光标；且裸节点参与后续输入/撤销的 DOM 操作，连带引发"选中+空格吞掉第二行""Ctrl+Z 把两行顺序错乱"。
  - **关键教训（验证纪律）**：F7 当时只测了"粘贴到空编辑器"路径（首行即 `<div>`，无兄弟裸节点），漏了"逐字输两行"路径（首行是裸文本节点且与第二行 `<div>` 做兄弟）→ 报绿但用户侧仍复现。此后每个 fix 必须过**字面复现探针**，按用户原话步骤回放全绿才算修好。
- **修复**: `ensureBlockWrapped()` 改为**逐子节点**包裹——遍历 `editor.childNodes`，凡是非 `<div>/<p>` 的直接子节点（裸文本节点、或浏览器块合并产生的裸 `<span>` 等无语义元素）都各自包进一个新建 `<div>`，**不再有任何"整体早退"**。位置仍在 `linkifyEditor()` 的 500ms 防抖内（结构整理安全，不破坏正在进行的逐字输入；且 linkify 用全局可见字符偏移保存/恢复选区，包裹不改变光标位置）。
- **关联文件**: index.html → ensureBlockWrapped() / linkifyEditor()
- **核对要点**:
  - [ ] 逐字输入两行"一二三"/"四五六" → 结构应为 `<div>一二三</div><div>四五六</div>`
  - [ ] 选中第一行全选按空格 → 应为 `<div> </div><div>四五六</div>`（第二行**不**被吞），且光标可见、落在空格之后
  - [ ] 继续输入"七" → `<div> 七</div><div>四五六</div>`，字落在空格后
  - [ ] 上述后 Ctrl+Z → 还原 `<div>一二三</div><div>四五六</div>` 且"一二三"保持选中
  - [ ] 粘贴"一二三"到空编辑器 → 选中+空格 → `<div> </div>`，光标可见（F7 原场景不回归）
  - [ ] 字面复现探针 `tests/e2e/_probe_blockwrap.js` 全绿（逐字输两行→选中+空格→继续输入→Ctrl+Z，11/11）

### F10 | 解锁后 / 选中+空格后"无光标、无法输入或粘贴"（选区失效）
- **版本**: v5.8
- **现象**（用户精确复现，Chrome 151 真实浏览器，headless 难复现）：
  1. 打开隧道、输密码 1 解锁 → 笔记页面**没有光标、无法输入也无法粘贴**；刷新网页后光标才出现。
  2. 粘贴"一二三/四五六"→ 选中第一行"一二三"按空格（行变" "，吞行已被 F8 修好）→ 同样**没有光标、无法输入/粘贴**。
  - 用户明确诉求：**除"文字处于被选中状态"外，任何时刻笔记页面都应常驻光标**。
- **根因**: 解锁/加载内容（`editor.innerHTML = lastHtml`）、linkify 规范化（`ensureBlockWrapped`/`normalize` 移动或合并节点）、`cleanupLeadingTrailingBreaks` 删除空白块等任何改动 DOM 的操作，都可能让 `window.getSelection()` 指向**已被销毁/移动的节点**而失效。选区失效后 Chromium 不绘制光标，且因无有效插入点，input/paste 均无响应。刷新之所以恢复，是走了不同的焦点就绪时机。headless Playwright Chromium **不能复现**该真实浏览器行为（headless 下选区始终保持合法），故本 fix 靠"显式重建合法折叠光标"兜底，无法靠 headless 断言 100% 验证，需真实浏览器确认。
- **修复**: 新增 `ensureCaret()` 兜底函数——**仅当"当前选区非法"（rangeCount=0 / 起点节点已脱离文档 / 不在 editor 内）时才在末尾显式重建一个折叠光标（聚焦 editor + 建 Range + `addRange`，优先落在最后一个文本节点内）**；合法选区（含用户主动选中的文本）一律不动。挂点：
  - `unlock()`：解密内容载入后（先 `innerHTML=`，再 `ensureBlockWrapped`，再 `linkifyEditor`，最后 `ensureCaret()`），并补 `editor.contentEditable = true`。
  - `init()` 自动加载路径：同上。
  - `linkifyEditor()` 的 `finally`：规范化收尾兜底重建（覆盖"选中+空格后无 URL 提前 return"这条路径）。
  - 注意：移除原 `unlock`/`init` 里"先 `editor.focus()` 再 `innerHTML=`"的顺序——先 focus 空编辑器再整体替换 innerHTML 会让焦点/选区失联，改为"先设内容、再聚焦、再显式建光标"。
- **关联文件**: index.html → ensureCaret() / unlock() / init() / linkifyEditor()
- **核对要点**:
  - [ ] 解锁后：编辑器有合法折叠光标（activeElement=editor、rangeCount=1、起点节点 isConnected、位于内容末尾），可继续输入/粘贴。
  - [ ] 选中第一行+空格后：光标仍合法、可继续输入（不再"无光标/无法输入"）。
  - [ ] 用户主动选中文本时：光标不被 `ensureCaret` 打扰（选中态保留）。
  - [ ] 字面复现探针 `tests/e2e/_probe_blockwrap.js` 仍全绿（F8 不回归）。
- **遗留**: F10 只解决了"选区失效"这一半。用户实测 v5.8 后场景 1（解锁）已好，场景 2（选中+空格）仍无光标但**能打字** → 说明选区是合法的，问题在绘制层，见 F11。

### F11 | 选中+空格后"看不见光标但能打字"（caret 绘制相位未刷新）
- **版本**: v5.9
- **现象**: 承接 F10。用户实测 v5.8：解锁后光标正常（F10 场景 1 已修复）；但**选中"一二三"按空格后，光标不显示，却可以继续打字**。
  - "能打字"是关键信号：说明 Selection **是合法的**（有有效插入点），F10 的 `ensureCaret` 判定合法遂不介入 —— 所以这不是选区失效，是**渲染问题**。
- **根因**: linkify 的大幅 DOM 重排（拆链接 → 拍平 span → `normalize()`）之后，caret 的**布局位置完全正确**（`getClientRects()` 有值、高 22px、块高 32px、focus 正常），但 Chromium 的 **caret 绘制相位没有被刷新**，caret 停在不可见状态。
  - 排查中排除的两个假设（探针实测）：① `<div> </div>` 高度为 0 → 否，块高 32px 正常；② `white-space:pre-wrap` 行尾空格 hanging 影响 caret 定位 → 否，`pre-wrap` 与 `break-spaces` 下 caret 距行首均为 5.02px，完全一致。
  - **headless 完全测不出**：所有 layout/focus/selection 指标在 headless 里都正常，因为 headless 不做真实合成。诊断脚本 `tests/e2e/_probe_caret_space.js` 即为此结论的证据。
- **修复**: 新增 `repaintCaret()`——**只切换 `editor.style.caretColor`（transparent → rAF 后还原）触发 caret 的 paint invalidation，不动 DOM、不动选区、不动焦点**。`ensureCaret(forceRepaint)` 增参：选区合法时若 `forceRepaint` 则调 `repaintCaret()`；`linkifyEditor()` 的 `finally` 改为 `ensureCaret(true)`。
  - 同时新增输入法组字保护：`isComposing` 标志（`compositionstart`/`compositionend`），组字期间 `ensureCaret`/`repaintCaret` 一律跳过，避免吞拼音。
- **⚠️ 本轮踩坑（务必牢记）**: 最初 `repaintCaret()` 里还做了 `sel.removeAllRanges(); sel.addRange(r)`（想"重启闪烁相位"，位置不变、自认无副作用），结果**打断了 Chromium 的撤销事务分组 → Ctrl+Z 失效**，`_probe_blockwrap` 由 11/11 掉到 9/11。**教训同 F9：在 contenteditable 里任何对选区/DOM 的程序化干预都可能连锁破坏 undo 栈，"位置没变"不等于"无副作用"。** 去掉选区重设、只留样式切换后恢复 11/11。
- **不采用 `blur()+focus()`**: 它是 Chromium 重建 caret 绘制状态最可靠的手段，但会**打断中文输入法组字（吞拼音）**，对中文用户代价不可接受，故弃用。
- **配套：`?diag` 光标诊断浮层**。URL 加 `?diag` 在右下角显示实时只读读数（focus / caretColor / rangeCount / collapsed / 起点节点+offset / isConnected / rects 数 / caret bcr / 所在块高度+html / editor.innerHTML 片段）。`pointer-events:none` 不抢焦点，不带参数时零开销。**用途：caret 类 bug 在 headless 是盲区，靠它从真实浏览器一次性取到读数，避免反复盲改。**
- **关联文件**: index.html → repaintCaret() / ensureCaret() / linkifyEditor() / setupCaretDiag() / isComposing
- **核对要点**:
  - [ ] 选中第一行+空格后：光标可见且能继续打字。
  - [ ] Ctrl+Z 仍能正确撤销（`_probe_blockwrap` 11/11，本轮曾在此翻车）。
  - [ ] 用户选中态不被折叠（`repaintCaret` 只在 `isCollapsed` 时动作）。
  - [ ] 中文输入法组字期间不被干预（不吞拼音）。
  - [ ] `caretColor` 不残留 `transparent`（否则光标真会永久消失）。
  - [ ] 不带 `?diag` 时无浮层、无额外定时器。
  - [ ] 验收探针 `tests/e2e/_probe_f11.js` 16/16 全绿。

### F12 | 选中+空格后"光标不可见且 rects=0"（光标落在不可绘制位置）
- **版本**: v5.10
- **现象**: 承接 F11。用户用 v5.9 带 `?diag` 截图反馈：选中"一二三"按空格后，诊断浮层显示：
  - `focus=editor docFocus=true ranges=1 collapsed=true connected=true inEditor=true` → 选区完全合法
  - **`rects=0 bcr=0,0,0,0`** → Chromium 无法计算光标绘制坐标
  - `mode="TEXT" \r\n四五六\n"@1` → 光标落在 `\r\n` 换行符中间（offset=1）
  - editor HTML: `<div> \r\n四五六\n</div>` → 第一行只剩一个空格+换行
- **根因**: F10 覆盖了"选区失效"（节点 detach / 不在 editor 内），F11 覆盖了"选区合法但绘制相位未刷新"（rects>0 但画不出来）。但还有**第三种状态**：选区合法、Chromium 也知道焦点在哪，但光标所在的文本偏移是一个**对渲染器来说"不存在"的位置**——如 CRLF 中间、纯空白文本节点内部——此时 `getClientRects()` 返回空、`getBoundingClientRect()` 全零，Chromium 根本不知道把像素画在屏幕哪里。
  - 这就是 F11 的 `repaintCaret()`（只切 caret-color）无效的原因：颜色切换触发了重绘请求，但渲染器仍然算不出坐标。
  - headless Playwright 在探针 `_probe_f12.js` 中**成功复现**了此场景（rects=0 → relocate 后 rects=1），说明这次不是 headless 盲区。
- **修复**: 新增 `relocateCaretToVisible(range)` 函数，在 `ensureCaret(forceRepaint)` 的"选区合法"分支中增加**第二层检测**：
  1. 选区合法 + 折叠态 + `getClientRects().length === 0` → 判定"光标在不可绘制位置"
  2. 在同块内生成候选偏移（当前 offset±1~4、节点首尾）→ 同块其他非空文本节点的首尾 → 相邻块的首个非空文本节点
  3. 逐个尝试 `setStart + collapse + getClientRects()`，取第一个 `rects > 0` 的位置
  4. 所有候选都失败 → 回退到 ensureBlockWrapped + 编辑器末尾重建
  5. 关键：只在 `isCollapsed` 时动作，用户选中态完全不碰
- **关联文件**: index.html → relocateCaretToVisible() / ensureCaret()
- **核对要点**:
  - [ ] 用户截图场景（选中一行按空格后）：?diag 显示 rects≥1、光标可见。
  - [ ] 不破坏选中态（D 断言通过）。
  - [ ] Ctrl+Z 正常（E 断言通过）。
  - [ ] 空白块内也能重定位到可见位置（C2 断言通过）。
  - [ ] 验收探针 `tests/e2e/_probe_f12.js` 7/7 全绿。

### F13 | 回车后光标从第二行空块被拽回第一行（F12 引入的回归）
- **版本**: v5.11
- **现象**: 用户在内置浏览器登录、第一行输入"一"、光标在"一"后，按回车换行。
  期望：光标停在第二行最前面。实际：先跳到第二行、约 500ms 后**又被拉回第一行"一"后面**。
- **根因**: F12 的 `relocateCaretToVisible()` 把**两种 rects=0 混为一谈**：
  1. 有内容的块里、光标落在坏偏移（CRLF 中间）→ 该 relocate；
  2. **刚回车产生的空块**（`<div></div>` 或 `<div><br></div>`）→ Chromium 对空块折叠光标的
     `getClientRects()` 返回 0（纯 API 怪癖，光标位置完全合法、实际能画出来）→ **不该 relocate**。
  回车 500ms 后 `linkifyEditor()` 收尾调 `ensureCaret(true)`，检测到 rects=0 → 误判为"坏偏移" →
  `relocateCaretToVisible` 的"跨块搜索"分支跑到相邻有字的第一行"一" → 把光标 setStart 过去。
- **修复**: `relocateCaretToVisible` 入口加**空块守卫**：光标所在块若经 TreeWalker 扫描没有任何
  **非空文本节点** → 直接 `return` 不 relocate（尊重浏览器原生落点）。含内容块（如 F12 的"四五六"）
  仍走原逻辑。只在 `isCollapsed` 时动作，选中态不碰。
- **测试纪律反思（重要）**: F12 那轮**只写了复现用户截图的单场景探针、没派子代理做分层测试**，
  导致这条"回车空块"的相邻场景成为盲区、回归漏网。F13 起恢复项目纪律：
  - 主代理跑已有全套回归 + 新写 `_probe_f13.js`（6/6）；
  - **派子代理独立写 `_probe_f13_edge.js` 做模块/全链路/功能分层测试**（16/16，覆盖连续空块、
    行中回车、回车后立刻输入、含 URL 回车、选中态等边缘场景）。
  - 两层全绿才部署。
- **关联文件**: index.html → relocateCaretToVisible() 空块守卫 / ensureCaret()
- **核对要点**:
  - [ ] 单行末尾回车 → 光标停第二行空块、不跳回。
  - [ ] 连续回车产生多个空块 → 光标停在最后一个空块。
  - [ ] 行中回车 → 拆行且光标在新块开头。
  - [ ] 回车后立刻输入 → 字符进新块、光标跟随。
  - [ ] 含 URL 行回车 → 链接保留、光标在空块。
  - [ ] 不回归 F12（含内容块坏偏移仍 relocate）。
  - [ ] 验收探针 `tests/e2e/_probe_f13.js` 6/6 + `tests/e2e/_probe_f13_edge.js` 16/16 全绿。

---

## G. 撤销（Ctrl+Z / Ctrl+Y）

### G1 | Ctrl+Z 没反应 / 回退的不是上一步
- **版本**: v5.12
- **现象**: 用户精确复现两类问题——
  1. 有时按 Ctrl+Z「没反应」（连按多次内容才动，甚至要按几十次）；
  2. 有时按了「回退的不是上一步」（比如刚输入一段带网址的文字，按一次 Ctrl+Z 不是撤销刚打的字，而是穿透到更早的、看不见的程序化改动）。
- **根因**: 之前依赖浏览器**原生 UndoManager**，但它有两个致命缺陷无法绕过：
  1. **无法"选择性排除"**——`linkifyEditor()` 在每次 input 后 500ms 用 `replaceWith`/`normalize` 重排 DOM 把网址包成 `<a>`，`poll()` 远端同步时整段 `innerHTML=` 替换，这些**程序化改动统统被塞进原生撤销栈**。用户按一次 Ctrl+Z 要先穿过好几个"看不见"的 linkify/同步步骤才轮到自己的输入 → 表现为"按了没反应 / 回退错位"。
  2. **contentEditable 切换会清空整个原生栈**：曾试过用 `editor.contentEditable='false'` 三明治规避，实测 Chromium 切回可编辑态会**清空全部原生撤销记录**，反而让 Ctrl+Z 彻底失效（更糟）。
- **修复**: 彻底放弃原生栈，**自建撤销栈**（`undoStack` / `redoStack`）：
  1. `input` 事件里 `recordIfChanged(it)`：用户真实编辑（打字/删除/粘贴/回车/删除线/插图）内容变化时压入"上一步"快照；同一输入突发内的连续逐字输入按 700ms 时间窗合并为一步（贴近 Chrome 的"一次打字突发=一步撤销"）。
  2. `linkifyEditor()` / `poll()` 等**程序化改动**只调 `syncCurrentState()` 把当前内容同步为"已提交状态"，**绝不压栈** → Ctrl+Z 永远命中用户的上一步，linkify 不再产生任何撤销步。
  3. `editor` 上的 `keydown` 拦截 `Ctrl/Cmd+Z`（撤销）、`Ctrl/Cmd+Shift+Z` 与 `Ctrl/Cmd+Y`（重做），`preventDefault` 接管，不再走原生栈；组字期间（isComposing）放行不拦截。
  4. 快照为 `{html, sel}`：撤销时用 `restoreSelectionOffsets` 按可见字符偏移恢复选区（与删除线/linkify 同一套机制，无视 `\u200B` 漂移）；恢复后 `ensureCaret(true)` 兜底光标绘制。
  5. `unlock()` / `init()` 加载内容后重置基线（`undoStack=[]; lastState=captureState()`），`#lock` 退出时清空栈。
- **关联文件**: index.html → 撤销栈声明与 `captureState/applyState/recordIfChanged/syncCurrentState/undo/redo` / `input` 监听器末尾 / `linkifyEditor` finally / `poll` 远端同步段 / `unlock`/`init`/`#lock` / 新增 `keydown` 拦截 / `window.__undoState`·`window.__undoReset` 调试钩子
- **核对要点**:
  - [ ] 输入含网址的一段文字 → 连续输入合并为**单个**撤销条目（`__undoState().u===1`）
  - [ ] 等 linkify 跑完后 `u` **仍为 1**（linkify 不新增撤销步——这是 60 次按压根因的直接反证）
  - [ ] 一次 Ctrl+Z 即回退整段输入（不再"按了没反应"），`presses<=2`
  - [ ] 一次 Ctrl+Z 后内容确实变化（非空时必变），不穿透到程序化改动
  - [ ] Ctrl+Y 重做能恢复（含已链接态，URL 内 `\u200B` 不可见，比对需剥离）
  - [ ] 选中整行+空格后 Ctrl+Z → 第一行还原、选区仍合法（connected）
  - [ ] 连续多次 Ctrl+Z 不越界崩溃、无 JS 异常（pageerror）
  - [ ] 粘贴整段后一次 Ctrl+Z 撤销粘贴（粘贴是用户动作，应可撤销）
  - [ ] 空编辑器连按回车、行尾回车等（F1/F13）仍正常，不被撤销栈逻辑干扰
  - [ ] 删除线加/取消（A1-A7）、链接中间回车（F5）、块整理（F7/F8）在按过 Ctrl+Z 后不回归
  - [ ] 验收探针 `tests/e2e/_probe_undo_paste.js` 13/13 全绿（Bug B 粘贴 + Bug A 撤销粒度/选中+空格）

---

## H. 落地页 / 解锁 / 路由 / 图标 / 指纹

### H1 | 落地页笔记名不支持中文（路由拒绝中文 ID）
- **版本**: v5.14
- **现象**: 首页输入框输入中文笔记名（如"我的日记"）→ 点"打开"要么无反应、要么服务端返回 400；中文名经 URL 编码后也无法定位笔记
- **根因**: `server.js` 的 `ID_RE` 用 `/^[a-zA-Z0-9_-]{1,32}$/` 只认 ASCII，中文被 400 拒绝；`extractId` 未对路径段 `decodeURIComponent`，客户端编码后的路径（`%E6%88%91...`）路由失败
- **修复**: `ID_RE` 放宽为 `/^[^\x00-\x1f\/\\?#%]{1,64}$/`（接受 Unicode，仅禁控制符与 `/ \ ? # %`）；`extractId` 与 SSE 推送 id 均 `decodeURIComponent`；客户端 `#landingBtn` 点击走 `encodeURIComponent` 导航；`manifest.json` 动态 `start_url` 用 `encodeURI`
- **关联文件**: server.js（ID_RE/extractId/SSE id）/ index.html（landing 导航）/ manifest.json（start_url）
- **核对要点**:
  - [ ] 中文笔记名 → 打开后能定位并读写（PUT/GET 不 400）
  - [ ] 中文名编码后 URL 正常路由（服务端 decode 回来）
  - [ ] 含空格/特殊可见字符（如 `my note!`）的笔记名也能用
  - [ ] 仍拒绝非法字符：`/ \ ? # %` 与不可见控制符（\x00-\x1f）返回 400
  - [ ] manifest 快捷方式 `start_url` 中文编码正确（D1 不回归）

### H2 | 笔记名为空时"打开"按钮禁用
- **版本**: v5.14
- **现象**: 首页未输入笔记名时，"打开"按钮应不可点击，防止误开默认/空笔记
- **根因**: 原 `#landingBtn` 无禁用逻辑，空名也能点
- **修复**: `#landingBtn` 初始 `disabled`；`landingInput` 的 input 监听按 `value.trim()` 空否切换 `disabled`
- **关联文件**: index.html → `#landingBtn` / `landingInput` 监听
- **核对要点**:
  - [ ] 输入框为空 → 打开按钮 `disabled`、不可点
  - [ ] 输入任意非空内容 → 按钮立即可点
  - [ ] 清空内容 → 按钮恢复 `disabled`
  - [ ] 只输入空格（trim 后空）→ 仍 `disabled`（边界）

### H3 | 口令为空时"解锁"按钮禁用 + 禁用态被主题 `!important` 压穿（真实 bug）
- **版本**: v5.14
- **现象**: 未输口令时"解锁"按钮不可点击；用户明确要求"禁用状态设计得好看点"。初版禁用态在真机下仍显示成"启用"样式（深色底浅字），等于没禁用，违反用户诉求
- **根因**: ① 原 `#ok` 无禁用逻辑；② `applyTheme()` 注入的主题覆盖 `.box button{...!important}` 与 `#landing button{...!important}` 用 `!important` 压过了禁用态基样式，导致禁用态仍取启用色。**这是子代理在真实 Chromium 用 computed-style 校验揪出的真实实现缺陷**
- **修复**: `#ok` 初始 `disabled`，`pw` 监听按空否切换；新增统一禁用态 `.box button:disabled,#landing button:disabled{background:var(--line);color:var(--muted);cursor:not-allowed;box-shadow:none}`；把 `applyTheme` 的主题覆盖限定为 `:not(:disabled)`，禁用态自然回落 muted 基样式，且随深浅色主题变量自动跟随
- **关联文件**: index.html → `#ok` / `pw` 监听 / 禁用态 CSS / `applyTheme()` 的 `:not(:disabled)` 限定
- **核对要点**:
  - [ ] 口令为空 → 解锁按钮 `disabled`、不可点
  - [ ] 输入任意口令 → 按钮立即可点
  - [ ] **禁用态在真机/计算样式下确实弱化**（computed `background === var(--line)` 米白、`color === var(--muted)`、非启用深色）——本 bug 核心价值点
  - [ ] 禁用态在深色/浅色主题下都正确跟随（不再被主题 `!important` 压穿）

### H4 | 手机端指纹解锁（WebAuthn PRF）【已彻底移除于 v5.15】
> **【v5.15 移除】** 用户实测 v5.14 指纹在大陆 Android Chrome 上不可用（WebAuthn PRF 本质是通行密钥/平台凭证，常需 GMS/翻墙），且退出后仍弹"是否开启指纹"提示、失败甩一长串错误码。用户明确"彻底移除指纹功能"。v5.15 整段删除该能力（前端零残留：`supportsWebAuthnPRF`/`enrollBiometric`/`unlockWithBiometric`/`updateBioUI`/`offerBiometricEnrollment`/`BIO_STORE`/`bioBtn`/`bio-banner` 全清除，grep 命中 0），仅保留口令解锁。历史实现细节（PRF 注册/解包、BIO_STORE、iOS 隐藏等）与对应核对要点已不再适用，故从检查清单移除，仅保留本移除记录。

### H5 | 落地页笔记名输入框禁止中文输入（前端过滤 + 后端再收紧）
> **【v5.19 修正】** `_` 与 `-` 已恢复为合法字符（前后端 `[A-Za-z0-9_-]{1,64}`），v5.15 的纯字母数字收紧误伤了早期带 `_`/`-` 的旧笔记，详见 I5。**中文仍被拒绝**，本条"禁止中文"的结论不变。
- **版本**: v5.15
- **现象**: v5.14 的 H1 曾"放宽 ID_RE 接受中文"，但用户实测中文笔记名能跳转、却**无论设什么口令都进不去**——中文经 URL 编码后路由/密钥派生错位，属于"能打开却永远解不开"的半吊子。用户改口"干脆笔记名输入框就不支持输入中文"
- **根因**: 中文笔记名在端到端加密模型下本就不该出现（口令派生与 noteId 强绑定 ASCII）；v5.14 为"支持中文"放宽前后端，反而制造了打不开的体验
- **修复**: 前端 `#landingInput` 的 `input` + `compositionend` 监听过滤非 `[A-Za-z0-9]`（拼音组字期间不误删），下方提示「仅支持英文和数字」；后端 `server.js` `ID_RE` **收回** `/^[A-Za-z0-9]{1,64}$/`（与前端禁止双保险，1–64 位 ASCII），含中文/特殊字符的 PUT/stream 直接 400
- **关联文件**: index.html（landing 过滤+提示）/ server.js（ID_RE 收紧）
- **核对要点**:
  - [ ] 输入框输入中文 → 被实时过滤掉，只留英文/数字
  - [ ] 输入"我的MyNote123" → 余 "MyNote123"，并提示「仅支持英文和数字」
  - [ ] 符号（空格/!@# 等）被过滤，不残留
  - [ ] 纯英文/数字笔记名 → 正常「打开」导航 `/<name>` 并解锁
  - [ ] 后端：含中文笔记名 PUT/GET 返回 400 bad id（ID_RE 收紧）
  - [ ] 仍拒绝非法字符 `/ \ ? # %` 与控制符（v5.14 H1 的拒绝项保留）

### H6 | 退出锁定后解锁按钮未回到禁用态
- **版本**: v5.15
- **现象**: 登录一次 → 点"退出"(#lock) → 还没输口令时，解锁按钮仍是启用态，可误点（与 H3"口令为空禁用"诉求不一致）
- **根因**: `#lock` 处理只清了口令框值和错误文案，没把解锁按钮 `#ok` 重置为 `disabled`
- **修复**: `#lock` 处理内清空口令后显式 `$('#ok').disabled = true`（退出锁定：清空口令后解锁按钮必须回到禁用态）
- **关联文件**: index.html → `#lock` 处理器
- **核对要点**:
  - [ ] 解锁进入后点"退出" → 口令框清空、`#ok` 为 `disabled`、不可点
  - [ ] 退出后重新输入口令 → 按钮立即可点（H3 不回归）
  - [ ] 退出后未输入时按钮确为禁用态（无"空口令也能点"的窗口期）

---

## I. 链接转换 / 粘贴 / 保存可靠性（v5.19 代码审查发现）

### I1 | linkify 用 innerHTML 字符串拼接 → 存储型 XSS + 内容篡改
- **版本**: v5.19 修复（缺陷自 linkify 引入字符串拼接起长期存在）
- **现象**: 文本含 `" onmouseover="alert(1)` 时可给链接注入任意属性；文本含 `<img src=x onerror=...>` 直接执行 JS；`<b>bold</b>` 被解析成元素、纯文本内容被篡改。真实 Chromium 实测：属性注入成立、onerror 执行 count=1
- **根因**: `span.innerHTML = text.replace(urlRegex, ...'<a href="' + normalizeHref(m) + '"...')` 把用户文本当 HTML 解析，无任何转义。笔记内容随加密同步跨设备传播 → 存储型 XSS，可窃取 localStorage 内其它笔记的 AES 密钥
- **修复**: 新增 `buildLinkSafe()`：DocumentFragment + `createTextNode`（纯文本）+ `createElement('a')` 属性赋值（href/target/rel 天然转义），按"URL 优先于手机号、denyAsUrl 保持纯文本、链接文本与长词插 ZWSP"重建匹配序列，替换原 innerHTML 拼接段
- **关联文件**: index.html → buildLinkSafe() / linkifyEditor()
- **核对要点**:
  - [ ] 输入 `https://a.com/x"onmouseover="alert(1)` → linkify 后无 onmouseover 属性（探针 R4）
  - [ ] 输入 `<b>bold</b> see https://x.com` → `<b>bold</b>` 原样为纯文本，链接正常（探针 R5）
  - [ ] 普通 URL/裸域名/手机号链接化行为不回归（E2E flow/userbugs）

### I2 | 行中粘贴产生嵌套 <div>（多出换行）且光标跳到行首
- **版本**: v5.19
- **现象**: 在 "abc|def" 中间粘贴 "XY" 得到三行（abc/XY/def）；粘贴多行 "X\nY" 得到四行；粘贴后继续打字出现在行首。真实 Chromium 实测确认
- **根因**: 粘贴处理把每一行无条件包成 `<div>` 块后 `insertNodeAtCaret`，行中粘贴形成嵌套块结构，光标落入新块开头
- **修复**: 空编辑器保留原拆块路径（避免占位 `<br>` 残留空行）；非空编辑器改 `pasteTextNative()`——`execCommand('insertText')` 行内合并 + `execCommand('insertParagraph')` 原生拆段，光标位置天然正确；`pasteInFlight` 标志让整个粘贴作为单步压入自建撤销栈（recordIfChanged 期间不逐条记录）。**补充（独立验证发现）**：单行笔记常见形态是裸文本节点挂根，此时行中粘贴多行，`insertParagraph` 留下「裸文本节点 + `<div>` 做兄弟」的非法结构（`abX<div>Yc</div>`），linkify 早退不整理 → 以该形态保存/同步、其上回车产生真嵌套块；故 `pasteTextNative` 在 undo 压栈后补 `ensureBlockWrapped()`+`normalize()` 并重捕获 lastState（不压撤销栈）。注意包块会把光标所在裸文本节点搬进新 `<div>`、选区被折叠丢失 → 整理前先用块内偏移保存选区、整理后恢复（同 linkifyEditor），否则光标会跳到行尾（复测中发现并修复）；末了 `ensureCaret(true)` 兜底
- **关联文件**: index.html → paste 处理器 / pasteTextNative() / recordIfChanged()
- **核对要点**:
  - [ ] 行中粘贴单行 → 一行合并（abcXYdef），无嵌套块（探针 R1）
  - [ ] 行中粘贴多行 → 正确两行 [abcX, Ydef]（探针 R2/R2b）
  - [ ] 粘贴后光标在粘贴内容末尾，继续打字接续其后
  - [ ] 一次 Ctrl+Z 整体撤销粘贴（_probe_undo_paste / _probe_review_bugs）
  - [ ] 空编辑器粘贴多行无空首行（探针 R7）
  - [ ] 单行（裸文本挂根）行中粘贴多行后根下全为块级子节点（_probe_v519_independent I2 不变量）

### I3 | URL 正则吞掉尾部中文标点与后续文字
- **版本**: v5.19
- **现象**: "看https://baidu.com。很好" 的链接文本与 href 变成 `https://baidu.com。很好`，点击 404
- **根因**: urlRegex 字符类 `[^\s<]+` 不排除 CJK，中文标点/汉字都被当作 URL 的一部分
- **修复**: urlTest/urlRegex 字符类排除 CJK 区段（汉字/CJK 标点/全角符号：`\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF\uFF01-\uFF60\u3000-\u303F`），URL 在中文处即停；`trimUrlTrailing()` 兜底修剪尾部中文标点。ASCII 尾部行为不动（保护 `...(消歧义)` 类以 `)` 结尾的合法 URL）
- **关联文件**: index.html → linkifyEditor() / trimUrlTrailing()
- **核对要点**:
  - [ ] "看https://baidu.com。很好" → 链接仅到 `https://baidu.com`，"。很好" 为纯文本（探针 R3）
  - [ ] 中文标点（，！？等）紧跟 URL 均不被吞
  - [ ] 英文尾部标点行为不变（句点/括号结尾 URL 不回归）

### I4 | busy 期间输入被丢弃 + 保存失败无重试
- **版本**: v5.19
- **现象**: 保存进行中（网络慢时数秒）继续输入，这些输入不挂保存定时器、不记撤销栈——保存完成后即丢失；保存失败后无任何重试，用户不察觉则内容永久不同步
- **根因**: input 处理器首行 `if (busy) return;` 直接丢弃；saveLocal catch 只改状态文案
- **修复**: ① busy 分支改为标记 `pendingResave` 并照常记撤销栈/linkify，saveLocal 的 finally 补挂 300ms 保存；② 非锁定失败走 `scheduleSaveRetry()` 退避重试（3s/6s/12s，至多 3 次，成功清零）；③ `flushDirtySave()` 挂 visibilitychange→hidden 与 pagehide，切后台/关页前兜底写出
- **关联文件**: index.html → input 处理器 / saveLocal() / scheduleSaveRetry() / flushDirtySave()
- **核对要点**:
  - [ ] busy 期间输入不丢：补存内容为最新版（探针 _probe_save_reliability S1）
  - [ ] 保存失败 ~3s 后自动重试成功（探针 S2）
  - [ ] flushDirtySave 立即写出脏内容（探针 S3）
  - [ ] 正常输入保存节奏不变（800ms 防抖，E2E sync 不回归）

### I5 | 笔记名恢复 `_` `-` 支持 + 400 提示 + 长度上限提示
- **版本**: v5.19（修正 v5.15 H5 的过度收紧）
- **现象**: v5.15 把 ID_RE 收紧成纯字母数字，早期带 `_`/`-` 的旧笔记打不开（400）；超长名/非法名 URL 直接打开时前端重试 ~9s 后误报"无法连接服务器"
- **根因**: `ID_RE = /^[A-Za-z0-9]{1,64}$/` 误伤旧笔记名；fetchRetry 对 4xx 也重试
- **修复**: 前后端同步放宽为 `[A-Za-z0-9_-]{1,64}`（server.js ID_RE + 落地页 sanitizeName，中文仍拒绝）；fetchRetry 错误带 `status`，4xx 不重试；unlock/init 对 400 显示"笔记名不合法（仅英文、数字、下划线、短横线）"；`#landingInput` 加 `maxlength="64"`
- **关联文件**: server.js → ID_RE / index.html → sanitizeName / fetchRetry / unlock / init / landingInput
- **核对要点**:
  - [ ] `ab-c`、`my_note` GET/PUT 返回 200（server.test.js）
  - [ ] 中文/斜杠/控制字符仍 400 bad id（既有断言不回归）
  - [ ] 落地页输入 `a-b@c d!` → 余 `a-bcd`；`my_note-1` 完整保留（unit userbugs）
  - [ ] 400 时提示"笔记名不合法"而非"无法连接服务器"，且无 ~9s 重试等待

### I6 | 复制到剪贴板带出 ZWSP 断行符
- **版本**: v5.19
- **现象**: 复制笔记内容粘贴到其它应用，长词/链接里混有零宽空格（\u200B）
- **根因**: linkify 为长词/链接文本插入 ZWSP 辅助断行，copyBtn 直接复制 innerHTML/innerText
- **修复**: copyBtn 复制前对 html 与 text 统一 `.replace(/\u200B/g, '')`
- **关联文件**: index.html → copyBtn 处理器
- **核对要点**:
  - [ ] 含长链接的笔记复制后，粘贴到纯文本环境无不可见字符

---

## 版本与 bug 对应速查

| 版本 | 涉及 bug 编号 |
|------|---------------|
| v4.3 | A1, A2, A3 |
| v4.3.1 | A4 |
| v4.4 | D1 |
| v4.5 | D2 |
| v5.0 | B1, B2, C1, C2, C3 |
| v5.1 | A5, A6, A7, B3, B4, B5, B6, B7, D3 |
| v5.2 | E1, E2, E3 |
| v5.3 | F1, F2, F3, F4 |
| v5.4 | F5 |
| v5.5 | F6 |
| v5.6 | F7 |
| v5.7 | F8 |
| v5.8 | F10 |
| v5.9 | F11 |
| v5.10 | F12 |
| v5.11 | F13 |
| v5.12 | G1 |
| v5.13 | E4 |
| v5.15 | H4(移除), H5, H6, C4(误改黑底) |
| v5.16 | C4(还原备案前透明金 logo；删 maskable PNG + 路由) |
| v5.19 | I1, I2, I3, I4, I5(含 H5 的 ID_RE 修正), I6 |
| v5.14 | H1, H2, H3, H4, C4 |
