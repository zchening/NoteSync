#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""NoteSync 发版·APK 国内直下推送（v9.3.2 起纳入发版流程）

作用：把某个 tag 的 App 更新元数据 + APK 文件推到云服务器，让 App「检查更新」
从国内域名 biji.xuyinji.com.cn/dl/latest.apk 直下，不再翻墙走 GitHub CDN。

用法：
    python tools/push_latest_apk.py v9.3.2
    python tools/push_latest_apk.py v9.3.2 --no-upload   # 只本地生成/校验 latest_app.json，不碰服务器

流程：
    1) gh api 取该 release 元数据（免鉴权走本机已登录的 gh）
    2) gh release download 取该 release 的 *.apk（带缓存：_apkdl 下已存在且尺寸吻合则跳过重下）
    3) 重写 latest_app.json：browser_download_url 指版本固定名 biji /dl/vX.Y.Z.apk（不可变副本，v9.5.4）、size=实际字节、name 保 .apk 后缀
    4) 上传（v9.5.4 倒装，杜绝 URL 指向未上传文件的 404 窗口）：先 apk/latest.apk（覆盖式，旧壳兼容）+ apk/vX.Y.Z.apk（不可变副本，只留最近 2 份），最后落 latest_app.json（备份旧版）
    5) 线上校验：/api/latest 返版本 URL、版本副本与 /dl/latest.apk HEAD 200、服务器 APK sha256 与本地一致

安全：v10.0.0 起走系统 ssh/scp + 本机 ~/.ssh/notesync_deploy 密钥（BatchMode，无密码交互、无重试锁定风险），
不再读取任何明文密码文件。
依赖：gh 已登录（zchening）；服务器 C:\ProgramData\ssh\administrators_authorized_keys 已收录本机公钥。
"""
import os, sys, json, time, hashlib, shutil, subprocess, tempfile, threading, glob

TAG_DEFAULT_DL = "https://biji.xuyinji.com.cn/dl/latest.apk"

def versioned_dl_url(tag):
    # v9.5.4：版本固定名下载 URL——apk/<tag>.apk 一经上传永不覆盖，「下载中途被新发版覆盖」的混装/截断
    # （packageInfo is null 根因）从源头掐死。tag 必须形如 v9.5.4，否则回退固定名（不拼脏文件名）。
    import re as _re
    if tag and _re.match(r"^v\d+(?:\.\d+)*$", tag):
        return "https://biji.xuyinji.com.cn/dl/%s.apk" % tag
    return TAG_DEFAULT_DL
HOST, USER, REMOTE_DIR = "124.221.92.225", "Administrator", "C:/Services/NoteSync"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK_CACHE_DIR = os.path.join(REPO, "_apkdl")


def _run(cmd, **kw):
    # v10.0.0：text 模式按 locale 解码子进程输出——远端 certutil 的中文表头是 GBK 字节，
    # 本地用 python -X utf8 跑就会解码失败（表现为 subprocess 内部 IndexError），
    # 上传明明全绿、却崩在最后一步校验。文本模式统一 errors='replace' 容错。
    if 'errors' not in kw:
        kw['errors'] = 'replace'
    return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)


def gh_release_meta(tag, tries=4):
    last = ""
    for i in range(tries):
        r = _run("gh api repos/zchening/NoteSync/releases/tags/%s" % tag)
        if r.returncode == 0:
            return json.loads(r.stdout)
        last = (r.stderr or "").strip()
        if i < tries - 1:
            print("[gh] api 取 release 第 %d 次失败（%s），退避重试…" % (i + 1, last.splitlines()[-1] if last else "?"))
            time.sleep(3 * (i + 1))
    sys.exit("gh api 取 release 失败（tag=%s，已重试 %d 次）：\n%s" % (tag, tries, last))


def _curl_range(url, s, e, out, retries=6):
    r = subprocess.run(['curl', '-sSL', '--fail', '--retry', str(retries), '--retry-delay', '3',
                        '--connect-timeout', '15', '--range', '%d-%d' % (s, e), '-o', out, url],
                       capture_output=True, text=True)
    return r.returncode == 0


def _fetch_apk_parallel(url, size, dest, nconn=16, rounds=6):
    parts = os.path.join(APK_CACHE_DIR, 'parts')
    os.makedirs(parts, exist_ok=True)
    for f in glob.glob(os.path.join(parts, 'part_*')):
        try: os.remove(f)
        except OSError: pass
    chunk = (size + nconn - 1) // nconn
    spans = []
    i = 0
    while i * chunk < size:
        s = i * chunk; e = min(s + chunk, size) - 1
        spans.append((i, s, e)); i += 1

    def partfile(i): return os.path.join(parts, 'part_%02d' % i)

    def grab(sp):
        k, s, e = sp
        _curl_range(url, s, e, partfile(k))

    def run_spans(spanset):
        ths = [threading.Thread(target=grab, args=(sp,)) for sp in spanset]
        for t in ths: t.start()
        for t in ths: t.join()
    run_spans(spans)  # 第一遍：全并行

    def missing():
        return [sp for sp in spans
                if (not os.path.exists(partfile(sp[0]))) or os.path.getsize(partfile(sp[0])) != (sp[2] - sp[1] + 1)]

    for _ in range(rounds):
        miss = missing()
        if not miss: break
        print('[apk] 补下缺失块 %d 段…' % len(miss)); run_spans(miss)
    if missing():
        raise RuntimeError('并行下载仍未凑齐（缺 %d 段）' % len(missing()))

    tmp = dest + '.part'
    with open(tmp, 'wb') as w:
        for k, s, e in spans:
            with open(partfile(k), 'rb') as r:
                shutil.copyfileobj(r, w)
    os.replace(tmp, dest)
    for f in glob.glob(os.path.join(parts, 'part_*')):
        try: os.remove(f)
        except OSError: pass


def fetch_apk(tag):
    """下载该 tag 的 *.apk 到 _apkdl，返回本地路径。缓存命中即跳过；否则 16 路并行分段快下。"""
    os.makedirs(APK_CACHE_DIR, exist_ok=True)
    dest = os.path.join(APK_CACHE_DIR, "app-release.apk")
    meta = gh_release_meta(tag)
    exp = None; url = None
    for a in meta.get("assets", []):
        if a["name"].lower().endswith(".apk"):
            exp = a["size"]; url = a.get("browser_download_url"); break
    if exp is None:
        sys.exit("release %s 里没有 .apk 资源" % tag)
    if os.path.isfile(dest) and os.path.getsize(dest) == exp:
        print("[apk] 缓存命中 _apkdl/app-release.apk（%d bytes，跳过重下）" % exp)
        return dest, exp
    if not url:
        sys.exit("release %s 的 apk 资源缺 browser_download_url" % tag)
    print("[apk] 16 路并行分段下载 %s（%d bytes）…" % (tag, exp))
    try:
        _fetch_apk_parallel(url, exp, dest)
    except Exception as e:
        sys.exit("并行下载 APK 失败：%s（可重跑或临时加 --no-upload 只看元数据）" % e)
    if not os.path.isfile(dest) or os.path.getsize(dest) != exp:
        got = os.path.getsize(dest) if os.path.isfile(dest) else "缺文件"
        sys.exit("APK 尺寸不符：本地 %s != release %s（疑似截断，重跑）" % (got, exp))
    return dest, exp


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def build_latest_json(meta, apk_size, summary=None):
    o = {
        "assets": [{
            "browser_download_url": versioned_dl_url(meta.get("tag_name", "")),  # v9.5.4：指向不可变版本副本
            "name": "app-release.apk",
            "size": apk_size,
        }],
        "summary": list(summary) if summary else [],
        "body": meta.get("body", ""),
        "published_at": meta.get("published_at", ""),
        "tag_name": meta.get("tag_name", ""),
    }
    return o


# ===== v10.0.0 部署通道：系统 ssh/scp + 本机 ed25519 部署密钥 =====
# paramiko 2.7.1（配 Python 3.8）对这台 Windows OpenSSH 9.5 的 publickey 与 password 认证均被实测拒绝
# （同一把密钥经系统 ssh 客户端一次通过，AUTH_OK）。密钥认证 + BatchMode 下重试不触发账户锁定，
# 且发版链路从此不再读任何明文密码文件——比原方案稳，也少一个泄密面。
SSH_KEY = os.path.expanduser("~/.ssh/notesync_deploy")
SSH_OPTS = ["-i", SSH_KEY, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new"]


def ssh_run(cmd, tries=3):
    last = ""
    for i in range(tries):
        r = _run(["ssh"] + SSH_OPTS + ["%s@%s" % (USER, HOST), cmd])
        if r.returncode == 0:
            return r.stdout.strip()
        last = (r.stderr or r.stdout or "").strip()
        time.sleep(3 * (i + 1))
    sys.exit("[ssh] 远端命令失败（%s…）：%s" % (cmd[:60], last))


def scp_put(local, remote, tries=3):
    last = ""
    for i in range(tries):
        r = _run(["scp", "-q"] + SSH_OPTS + [local, "%s@%s:%s" % (USER, HOST, remote)])
        if r.returncode == 0:
            return
        last = (r.stderr or "").strip()
        time.sleep(3 * (i + 1))
    sys.exit("[scp] 上传失败 %s → %s：%s" % (local, remote, last))


def remote_size(path):
    return int(ssh_run("powershell -NoProfile -Command \"(Get-Item '%s').Length\"" % path.replace("/", "\\")))


def remote_mkdir(remote_full):
    d = remote_full.replace("/", "\\").rsplit("\\", 1)[0]
    ssh_run("mkdir \"%s\" 2>nul & echo ok" % d)


def deploy_to_server(latest_json_local, apk_local, tag=None):
    import re as _re
    ts = str(int(time.time()))
    local_size = os.path.getsize(apk_local)

    # 闸 R1-P1：上传顺序倒装——两个 APK 文件先就位、latest_app.json 最后落。
    # 旧序（json→apk）在两次 put 之间，/api/latest 已指向还不存在的 /dl/vX.Y.Z.apk，全网手机点更新必 404。
    ra = REMOTE_DIR + "/apk/latest.apk"
    remote_mkdir(ra)
    scp_put(apk_local, ra)
    rs = remote_size(ra)
    print("[srv] apk/latest.apk local=%d remote=%d %s" % (local_size, rs, "OK" if rs == local_size else "MISMATCH!!"))
    assert rs == local_size, "APK 上传尺寸不符"

    # v9.5.4：不可变版本副本——latest_app.json 的下载 URL 指它，杜绝「下载中途 latest.apk 被覆盖」混装。
    if tag and _re.match(r"^v\d+(?:\.\d+)*$", tag):
        rv = REMOTE_DIR + "/apk/%s.apk" % tag
        scp_put(apk_local, rv)
        assert remote_size(rv) == local_size, "版本副本 %s 上传尺寸不符" % rv
        print("[srv] apk/%s.apk 已上传（不可变副本）" % tag)
        try:
            names = ssh_run("powershell -NoProfile -Command \"(Get-ChildItem '%s/apk' -Filter 'v*.apk' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 2 -ExpandProperty Name) -join ','\"" % REMOTE_DIR)
            for old in [n for n in names.split(",") if n]:
                ssh_run("del /q \"%s\\apk\\%s\" & echo ok" % (REMOTE_DIR.replace("/", "\\"), old))
                print("[srv] 清理旧副本 %s" % old)
        except Exception as e:
            print("[srv] 旧副本清理跳过（非致命）：%s" % e)

    # latest_app.json 最后落（备份再覆盖）：此刻 latest.apk 与版本副本都已在位，URL 切换零 404 窗口。
    rj = REMOTE_DIR + "/latest_app.json"
    if ssh_run("if exist \"%s\" (echo yes) else (echo no)" % rj.replace("/", "\\")) == "yes":
        ssh_run("ren \"%s\" \"latest_app.json.bak_%s\" & echo ok" % (rj.replace("/", "\\"), ts))
        print("[srv] latest_app.json 已备份 -> .bak_%s" % ts)
    else:
        print("[srv] latest_app.json 无旧文件")
    scp_put(latest_json_local, rj)
    assert remote_size(rj) == os.path.getsize(latest_json_local), "latest_app.json 上传尺寸不符"

    # latest_app.json 每次请求实时读，无需重启；仅校验
    o = ssh_run('curl -s http://localhost:8080/api/latest')
    got = json.loads(o)["assets"][0]["browser_download_url"]
    exp_url = versioned_dl_url(tag)
    assert got == exp_url, "线上 /api/latest 未指向 %s：%s" % (exp_url, got)
    o2 = ssh_run('curl -s -o NUL -w "%{http_code}" http://localhost:8080' + exp_url.split("com.cn", 1)[1])
    o = ssh_run('curl -s -o NUL -w "%{http_code}" http://localhost:8080/dl/latest.apk')
    print("[verify] /api/latest -> %s；版本副本 HEAD=%s；/dl/latest.apk HEAD=%s" % (got, o2, o))
    chk_file = ("%s.apk" % tag) if (tag and _re.match(r"^v\d+(?:\.\d+)*$", tag)) else "latest.apk"
    # v10.0.0 修两处：①原来把 certutil 中文表头里的字母也当十六进制字符拼进去，取末 64 位得到污染串
    # （实测一次成功上传被它报成不一致）——只认独立的 64 位十六进制串；
    # ②更严重的是这一步过去只 print、从不 assert，「服务器 sha256==本地」从来是靠人肉眼看的闸。
    # 现在真比对并判红，且把覆盖式 latest.apk 一并验，杜绝两个文件不同步。
    local_sha = sha256(apk_local)
    for f in filter(None, {chk_file, "latest.apk"}):
        raw = ssh_run('certutil -hashfile C:\\Services\\NoteSync\\apk\\' + f + ' SHA256')
        cand = _re.findall(r"[0-9a-fA-F]{64}", raw)
        assert cand, "无法从 certutil 输出解析出 sha256（%s）：%s" % (f, raw[:160])
        remote_sha = cand[0].lower()
        print("[verify] 服务器 %s sha256=%s" % (f, remote_sha))
        assert remote_sha == local_sha, "服务器 %s 与本地 APK sha256 不一致（%s ≠ %s）——OTA 未真正到位" % (f, remote_sha[:12], local_sha[:12])
    print("[verify] 本地 sha256=%s；%s 与 latest.apk 均一致" % (local_sha[:12], chk_file))


def main():
    args = sys.argv[1:]
    no_up = "--no-upload" in args
    summary = []
    if "--summary" in args:
        i = args.index("--summary")
        if i + 1 < len(args):
            summary = [s.strip() for s in args[i + 1].split("|") if s.strip()]
            args = args[:i] + args[i + 2:]
        else:
            args = args[:i]
    tags = [a for a in args if not a.startswith("--")]
    if not tags:
        sys.exit(__doc__)
    tag = tags[0]

    apk_local, apk_size = fetch_apk(tag)
    meta = gh_release_meta(tag)
    if summary:
        total = sum(len(s) for s in summary)
        if total > 40:
            print("[warn] summary 合计 %d 字 > 40（用户口径：整段 ≤40 字），请精简" % total)
    obj = build_latest_json(meta, apk_size, summary)
    local = sha256(apk_local)
    print("[pre] tag=%s apk=%d bytes sha256=%s url=%s summary=%d条" % (obj["tag_name"], apk_size, local, obj["assets"][0]["browser_download_url"], len(summary)))

    out_local = os.path.join(REPO, "latest_app.json")
    with open(out_local, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    print("[write] 已生成/更新仓库 latest_app.json -> %s" % out_local)

    if no_up:
        print("[done] --no-upload：仅本地生成，未推服务器。")
        return
    deploy_to_server(out_local, apk_local, tag)
    print("\n完成：下次 App 点「检查更新」将从 biji 域直下该 APK。若本版的 server.js /dl 路由有变更，另走正常部署重启 NoteSync。")


if __name__ == "__main__":
    main()
