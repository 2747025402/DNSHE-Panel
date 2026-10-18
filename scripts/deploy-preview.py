# -*- coding: utf-8 -*-
"""部署 DNSHE 只读候选并绑定候选域名。

凭据只从标准 Cloudflare 环境变量读入内存，绝不写入命令行、日志或仓库；生产 Worker 名称和域名不改。
默认目标仍是 1.shydns.cc.cd；可通过 PREVIEW_HOSTNAME、PREVIEW_WORKER、PREVIEW_CONFIG
选择独立候选（例如 3.shydns.cc.cd + wrangler.preview3.toml），复用 D1/KV 读取同一数据，
业务写路由由 PREVIEW_READ_ONLY 阻断。
必需 CLOUDFLARE_ACCOUNT_ID，以及 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY。
仅更新候选 Secret 时读取 AES_KEY；PREVIEW_SKIP_SECRET=1 保留远端密钥。代理沿用 HTTP(S)_PROXY。
"""
import json, os, re, shutil, subprocess, sys, time, tomllib, urllib.error, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTNAME = os.environ.get("PREVIEW_HOSTNAME", "1.shydns.cc.cd")
WORKER = os.environ.get("PREVIEW_WORKER", "dnshe-panel-preview")
CONFIG = os.environ.get("PREVIEW_CONFIG", "wrangler.preview.toml")
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")

def fail(message):
    print("FAIL:", message)
    raise SystemExit(1)

# Validate the whole target before reading credentials or invoking any external API.
# A partial environment override must never deploy one Worker and bind another.
TARGETS = {
    ("1.shydns.cc.cd", "dnshe-panel-preview", "wrangler.preview.toml"),
    ("2.shydns.cc.cd", "dnshe-panel-preview-2", "wrangler.preview2.toml"),
    ("3.shydns.cc.cd", "dnshe-panel-preview-3", "wrangler.preview3.toml"),
}
if (HOSTNAME, WORKER, CONFIG) not in TARGETS:
    fail("候选目标三元组不一致或不在白名单；未读取凭据、未部署或绑定域名")
try:
    with open(os.path.join(ROOT, CONFIG), "rb") as config_file:
        target_config = tomllib.load(config_file)
except (OSError, tomllib.TOMLDecodeError):
    fail("候选配置无法读取或解析；未读取凭据、未部署")
if target_config.get("name") != WORKER or target_config.get("vars", {}).get("PREVIEW_READ_ONLY") != "1":
    fail("候选配置的 Worker 名称或只读保护不匹配；未读取凭据、未部署")
if target_config.get("triggers", {}).get("crons"):
    fail("候选配置不得启用 Cron；未读取凭据、未部署")
if len(sys.argv) > 1:
    if sys.argv[1:] != ["--check-target"]:
        fail("仅支持 --check-target 离线预检参数")
    print(json.dumps({"hostname": HOSTNAME, "worker": WORKER, "config": CONFIG,
                      "read_only": True, "cron": False, "credentials_read": False}, ensure_ascii=False))
    raise SystemExit(0)

ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
email = os.environ.get("CLOUDFLARE_EMAIL", "").strip()
key = os.environ.get("CLOUDFLARE_API_KEY", "").strip()
skip_secret = os.environ.get("PREVIEW_SKIP_SECRET") == "1"
aes = os.environ.get("AES_KEY", "") if not skip_secret else ""
if not re.fullmatch(r"[a-fA-F0-9]{32}", ACCOUNT):
    fail("需设置有效的 CLOUDFLARE_ACCOUNT_ID；未部署或绑定域名")
if not token and not (email and key):
    fail("需设置 CLOUDFLARE_API_TOKEN，或 CLOUDFLARE_EMAIL 与 CLOUDFLARE_API_KEY；未部署")
if not skip_secret and not aes:
    fail("更新候选密钥需设置 AES_KEY；保留已有密钥时设置 PREVIEW_SKIP_SECRET=1；未部署")

env = {**os.environ, "MSYS_NO_PATHCONV": "1"}
auth_headers = ({"Authorization": f"Bearer {token}"} if token else
                {"X-Auth-Email": email, "X-Auth-Key": key})

def run(args, stdin=None):
    if args and args[0] == "npx":
        args[0] = shutil.which("npx.cmd") or shutil.which("npx") or "npx.cmd"
    proc = subprocess.run(args, cwd=ROOT, input=stdin, text=True, capture_output=True,
                          encoding="utf-8", errors="replace", env=env)
    out = (proc.stdout or "") + (proc.stderr or "")
    for secret in (aes, token, key, email):
        if secret:
            out = out.replace(secret, "***REDACTED***")
    print(out[-2500:])
    if proc.returncode:
        fail(f"命令失败（退出码 {proc.returncode}）")

print(f"候选源: {ROOT}")
run(["npx", "wrangler", "deploy", "--config", CONFIG, "--keep-vars"])
if not skip_secret:
    run(["npx", "wrangler", "secret", "put", "AES_KEY", "--config", CONFIG], stdin=aes)
else:
    print("跳过 AES_KEY secret 更新（候选已有同名密钥）")

opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}) if PROXY
                                   else urllib.request.ProxyHandler())

def api_request(url, method="GET", data=None):
    last = None
    for attempt in range(3):
        req = urllib.request.Request(url, method=method, data=data,
                                     headers={**auth_headers, "Content-Type": "application/json"})
        try:
            with opener.open(req, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            # Never include the response body: Cloudflare may echo account metadata.
            fail(f"Cloudflare API 请求失败（HTTP {exc.code}）")
        except (urllib.error.URLError, TimeoutError) as exc:
            last = type(exc).__name__
            if attempt < 2:
                time.sleep(4 * (attempt + 1))
    fail(f"Cloudflare API 请求超时（已重试 3 次：{last or 'unknown'}）")

zones_url = "https://api.cloudflare.com/client/v4/zones?" + urllib.parse.urlencode({
    "name": "shydns.cc.cd", "status": "active", "per_page": "50"
})
zones = api_request(zones_url)
matches = [z for z in (zones.get("result") or []) if z.get("name") == "shydns.cc.cd"]
if len(matches) != 1 or not matches[0].get("id"):
    fail("无法确认 shydns.cc.cd 的唯一 zone id；未执行候选域名绑定")
zone_id = matches[0]["id"]
payload = json.dumps({"hostname": HOSTNAME, "service": WORKER, "environment": "production", "zone_id": zone_id}).encode()
try:
    data = api_request(f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/domains",
                       method="PUT", data=payload)
except SystemExit:
    raise
if not data.get("success"):
    fail("绑定候选域名失败（Cloudflare API 未成功）")
result = data.get("result") or {}
print(json.dumps({"hostname": result.get("hostname", HOSTNAME), "service": result.get("service", WORKER),
                  "enabled": result.get("enabled"), "environment": result.get("environment"),
                  "certificate": result.get("cert_id")}, ensure_ascii=False))

# PUT succeeds before the edge certificate is necessarily ready. Confirm the
# persisted domain record and report the current certificate state without
# treating a pending cert as a successful HTTPS probe.
domains_url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/domains"
current = None
last_error = None
for _ in range(3):
    try:
        domains = api_request(domains_url)
    except urllib.error.URLError as exc:
        # The local proxy can reset an otherwise successful API connection;
        # keep the binding result and retry the read-only verification.
        last_error = type(exc).__name__
        time.sleep(5)
        continue
    current = next((item for item in (domains.get("result") or [])
                    if item.get("hostname") == HOSTNAME and item.get("service") == WORKER), None)
    if current and (current.get("cert_id") or current.get("enabled") is False):
        break
    time.sleep(5)
if not current:
    fail("候选域名 PUT 已返回，但列表中尚未出现对应记录" + (f"（读取重试：{last_error}）" if last_error else ""))
print(json.dumps({"hostname": current.get("hostname"), "service": current.get("service"),
                  "enabled": current.get("enabled"), "certificate": current.get("cert_id"),
                  "status": current.get("status")}, ensure_ascii=False))
print("候选部署与域名绑定已完成；生产 dnshe-panel / shydns.cc.cd 未修改。")
