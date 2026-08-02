# NoteSync Bug 核对清单

> 每次改完代码，子代理测试流程的**第 0 步**必须读本文件，逐项核对相关分类的条目，确认未引入回归。
> 核对范围：只核对与本次修改相关的分类（改删除线核对 A 类，改导出图片核对 B 类，以此类推）。

---

## 使用方法

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
| C | 缓存与图标 | 3 | 修改 favicon / manifest.json / Cache-Control 头 |
| D | PWA 与移动端 | 3 | 修改 manifest.json / 触摸事件 / 夜间模式 CSS |

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
