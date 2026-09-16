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
    3) 重写 latest_app.json：browser_download_url 固定成 biji /dl/latest.apk、size=实际字节、name 保 .apk 后缀
    4) 上传 latest_app.json（备份旧版）+ apk/latest.apk（固定名直接覆盖，服务器永远只留一个 APK）
    5) 线上校验：/api/latest 返 biji URL、/dl HEAD 200、服务器 APK sha256 与本地一致

安全：服务器密码只从 C:\\Temp\\new_server_pwd.txt 读，绝不打印；对 paramiko banner 限速退避重试。
依赖：pip install paramiko；gh 已登录（zchening）。
"""
import os, sys, json, time, hashlib, shutil, subprocess, tempfile

TAG_DEFAULT_DL = "https://biji.xuyinji.com.cn/dl/latest.apk"
HOST, USER, REMOTE_DIR = "124.221.92.225", "Administrator", "C:/Services/NoteSync"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PWD_FILE = r"C:\Temp\new_server_pwd.txt"
APK_CACHE_DIR = os.path.join(REPO, "_apkdl")


def _run(cmd, **kw):
    return subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True, text=True, **kw)


def gh_release_meta(tag):
    r = _run("gh api repos/zchening/NoteSync/releases/tags/%s" % tag)
    if r.returncode != 0:
        sys.exit("gh api 取 release 失败（tag=%s）：\n%s" % (tag, (r.stderr or "").strip()))
    return json.loads(r.stdout)


def fetch_apk(tag):
    """下载该 tag 的 *.apk 到 _apkdl，返回本地路径。带缓存避免重复慢下。"""
    os.makedirs(APK_CACHE_DIR, exist_ok=True)
    dest = os.path.join(APK_CACHE_DIR, "app-release.apk")
    meta = gh_release_meta(tag)
    exp = None
    for a in meta.get("assets", []):
        if a["name"].lower().endswith(".apk"):
            exp = a["size"]; break
    if exp is None:
        sys.exit("release %s 里没有 .apk 资源" % tag)
    if os.path.isfile(dest) and os.path.getsize(dest) == exp:
        print("[apk] 缓存命中 _apkdl/app-release.apk（%d bytes，跳过重下）" % exp)
        return dest, exp
    print("[apk] gh release download %s（GitHub 国内直下较慢，请稍候）..." % tag)
    r = _run("gh release download %s -R zchening/NoteSync -p '*.apk' -D '%s' -c" % (tag, APK_CACHE_DIR))
    if r.returncode != 0:
        sys.exit("下载 APK 失败：\n%s" % (r.stderr or r.stdout))
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
            "browser_download_url": TAG_DEFAULT_DL,
            "name": "app-release.apk",
            "size": apk_size,
        }],
        "summary": list(summary) if summary else [],
        "body": meta.get("body", ""),
        "published_at": meta.get("published_at", ""),
        "tag_name": meta.get("tag_name", ""),
    }
    return o


def deploy_to_server(latest_json_local, apk_local):
    import paramiko, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
    with open(PWD_FILE, "r", encoding="utf-8") as f:
        password = f.read().strip()

    def connect():
        last = None
        for i in range(6):
            try:
                s = paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                s.connect(HOST, username=USER, password=password, banner_timeout=90, auth_timeout=60, timeout=60)
                return s
            except Exception as e:
                last = e; print("[ssh] attempt %d 失败，退避：%s" % (i + 1, e)); time.sleep(10 + i * 5)
        raise last

    ssh = connect()
    sftp = ssh.open_sftp()
    ts = str(int(time.time()))

    def ensure_parents(remote_full):
        parts = remote_full.split("/")[:-1]; cur = ""
        for p in parts:
            cur = (cur + "/" + p) if cur else p
            if cur:
                try: sftp.mkdir(cur)
                except Exception: pass

    # latest_app.json：备份再覆盖
    rj = REMOTE_DIR + "/latest_app.json"
    try: sftp.stat(rj); sftp.rename(rj, rj + ".bak_" + ts); print("[srv] latest_app.json 已备份 -> .bak_%s" % ts)
    except Exception: print("[srv] latest_app.json 无旧文件")
    sftp.put(latest_json_local, rj)
    assert sftp.stat(rj).st_size == os.path.getsize(latest_json_local), "latest_app.json 上传尺寸不符"

    # apk/latest.apk：固定名直接覆盖（不备份，服务器只留最新一个）
    ra = REMOTE_DIR + "/apk/latest.apk"
    ensure_parents(ra)
    sftp.put(apk_local, ra)
    remote_size = sftp.stat(ra).st_size
    local_size = os.path.getsize(apk_local)
    print("[srv] apk/latest.apk local=%d remote=%d %s" % (local_size, remote_size, "OK" if remote_size == local_size else "MISMATCH!!"))
    assert remote_size == local_size, "APK 上传尺寸不符"

    def run(cmd):
        _, o, e = ssh.exec_command(cmd); o.channel.recv_exit_status()
        return o.read().decode("utf-8", "replace").strip(), e.read().decode("utf-8", "replace").strip()

    # latest_app.json 每次请求实时读，无需重启；仅校验
    o, _ = run('curl -s http://localhost:8080/api/latest')
    got = json.loads(o)["assets"][0]["browser_download_url"]
    assert got == TAG_DEFAULT_DL, "线上 /api/latest 未指向 biji：%s" % got
    o, _ = run('curl -s -o NUL -w "%{http_code}" http://localhost:8080/dl/latest.apk')
    print("[verify] /api/latest -> %s；/dl HEAD=%s" % (got, o))
    o, _ = run('certutil -hashfile C:\\Services\\NoteSync\\apk\\latest.apk SHA256')
    remote_sha = "".join(ch for ch in o if ch in "0123456789abcdefABCDEF")
    print("[verify] 服务器 APK sha256=%s" % remote_sha[-64:])
    sftp.close(); ssh.close()


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
    deploy_to_server(out_local, apk_local)
    print("\n完成：下次 App 点「检查更新」将从 biji 域直下该 APK。若本版的 server.js /dl 路由有变更，另走正常部署重启 NoteSync。")


if __name__ == "__main__":
    main()
