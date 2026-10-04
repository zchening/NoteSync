# -*- coding: utf-8 -*-
"""v9.3.0：从 docs/VERSION_LOG.md 提取指定版本的完整更新详情，拆条为可读 bullet，
供 GitHub Release body（CI 随版自动生成 + 本地 gh 回填历史）。无该版条目时输出为空并退出 1。
用法：python -X utf8 tools/gen_release_notes.py v9.3.0 > notes.md"""
import io
import re
import sys

_CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'  # 条目序号字符集（断行与转 bullet 共用一份，别再各写一遍）

def main():
    if len(sys.argv) < 2:
        sys.exit(2)
    tag = sys.argv[1].strip()
    ver = tag[1:] if tag.startswith('v') else tag
    text = io.open('docs/VERSION_LOG.md', encoding='utf-8').read()
    row = None
    for line in text.splitlines():
        if line.startswith('| v' + ver + ' |'):
            cells = line.split('|')
            if len(cells) >= 3:
                row = cells[1].strip() and '|'.join(cells[2:]).strip().rstrip('|').strip()
            break
    if not row:
        sys.exit(1)
    body = row.replace('**', '')
    # v10.1.7（发版闸 T3 点名）：圈号断行必须只认"条目起点"。旧写法见圈号就断，把「与 e2e ① 改为…」
    # 「e2e ④（粘贴恢复）」这类正文引用也拆成独立条，发布正文里 ① 重复出现、③ 被拦腰截断
    # （v10.1.6 起就带这个形状，一直没被抽到）。判据：圈号在串首、或前一个字符是句读/括号收尾才断。
    _BREAK_AFTER = '。；！?»）】)：:、'
    _WORDS = ('守护：', '守护随版', '教训：', '三 bump', '另修', '另：', '已知挂账', '前置守卫',
              '闸一', '闸二', '闸三', '闸四', '挂账', '本版', '发布')
    _C = set(_CIRCLED)
    chars = list(body)
    out_parts = []
    for i, ch in enumerate(chars):  # 一律只在"条目/小标题起点"断行：串首或紧跟句读
        if (i == 0 or chars[i - 1] in _BREAK_AFTER) and (ch in _C or any(body.startswith(w, i) for w in _WORDS)):
            out_parts.append('\n\n')
        out_parts.append(ch)
    body = ''.join(out_parts)
    # 每条圈数字段落转 bullet；合并多余空行
    out = []
    for para in [p.strip() for p in body.split('\n\n') if p.strip()]:
        if re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]', para):
            out.append('- ' + para)
        else:
            out.append(para)
    sys.stdout.write('## ' + tag + ' 完整更新详情\n\n' + '\n\n'.join(out) + '\n')

if __name__ == '__main__':
    main()
