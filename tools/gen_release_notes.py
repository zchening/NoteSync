# -*- coding: utf-8 -*-
"""v9.3.0：从 docs/VERSION_LOG.md 提取指定版本的完整更新详情，拆条为可读 bullet，
供 GitHub Release body（CI 随版自动生成 + 本地 gh 回填历史）。无该版条目时输出为空并退出 1。
用法：python -X utf8 tools/gen_release_notes.py v9.3.0 > notes.md"""
import io
import re
import sys

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
    # 断行：圈数字分条 + 段落词前换行（①-⑳ 与常见小结词），把 2000 字长行拆成可读块
    body = re.sub(r'(?=[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])', '\n\n', body)
    body = re.sub(r'(?=(?:守护：|守护随版|教训：|三 bump|闸[一二三四]?|另修|另：|已知挂账|挂账|发布|前置守卫|本版))', '\n\n', body)
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
