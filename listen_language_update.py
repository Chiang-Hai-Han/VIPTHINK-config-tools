from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "语种修改接口监听"
DEFAULT_PORT = 9224


def find_chrome() -> Path:
    candidates = [
        os.environ.get("CHROME_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for value in candidates:
        if value and Path(value).exists():
            return Path(value)
    found = shutil.which("chrome") or shutil.which("msedge")
    if found:
        return Path(found)
    raise FileNotFoundError("找不到 Chrome 或 Edge。")


def http_json(url: str, timeout: float = 2.0) -> object:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_debugger(port: int, timeout: int = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            http_json(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.5)
    raise TimeoutError("调试浏览器启动超时。")


def websocket_frame(text: str) -> bytes:
    data = text.encode("utf-8")
    length = len(data)
    header = bytearray([0x81])
    mask = os.urandom(4)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.extend([0x80 | 126, (length >> 8) & 255, length & 255])
    else:
        header.append(0x80 | 127)
        header.extend(length.to_bytes(8, "big"))
    header.extend(mask)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
    return bytes(header) + masked


def read_ws_frame(sock) -> str | None:
    first = sock.recv(2)
    if not first:
        return None
    length = first[1] & 0x7F
    if length == 126:
        length = int.from_bytes(sock.recv(2), "big")
    elif length == 127:
        length = int.from_bytes(sock.recv(8), "big")
    masked = bool(first[1] & 0x80)
    mask = sock.recv(4) if masked else b""
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            return None
        payload += chunk
    if masked:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    opcode = first[0] & 0x0F
    if opcode == 8:
        return None
    if opcode != 1:
        return ""
    return payload.decode("utf-8", errors="replace")


def connect_ws(ws_url: str):
    import base64
    import socket
    import ssl
    from urllib.parse import urlparse

    parsed = urlparse(ws_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    raw = socket.create_connection((host, port), timeout=5)
    sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host) if parsed.scheme == "wss" else raw
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request.encode("ascii"))
    response = sock.recv(4096)
    if b" 101 " not in response:
        raise RuntimeError(f"WebSocket 连接失败：{response[:200]!r}")
    sock.settimeout(1)
    return sock


class Cdp:
    def __init__(self, sock):
        self.sock = sock
        self.next_id = 1

    def send(self, method: str, params: dict | None = None) -> int:
        message_id = self.next_id
        self.next_id += 1
        payload = {"id": message_id, "method": method}
        if params is not None:
            payload["params"] = params
        self.sock.sendall(websocket_frame(json.dumps(payload, ensure_ascii=False)))
        return message_id

    def recv(self) -> dict | None:
        try:
            text = read_ws_frame(self.sock)
        except TimeoutError:
            return None
        except OSError:
            return None
        if not text:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None


def is_target_request(url: str, post_data: str) -> bool:
    """判断是否是修改课件语种相关的接口"""
    combined = url.lower()
    # 重点关注 add_edit_chapter 保存接口
    if "add_edit_chapter" in combined and "teacher_new" in combined:
        return True
    # 关注 chapter_list 查询
    if "chapter_list" in combined and post_data:
        try:
            data = json.loads(post_data)
            if data.get("chapter_namecode"):
                return True
        except (json.JSONDecodeError, TypeError):
            pass
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="监听语种修改相关接口（add_edit_chapter）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="调试端口")
    parser.add_argument("--seconds", type=int, default=300, help="监听秒数")
    parser.add_argument("--url", default="https://jy.vipthink.cn/", help="浏览器打开地址")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(exist_ok=True)
    output_path = OUTPUT_DIR / f"语种修改监听_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    user_data_dir = Path(tempfile.mkdtemp(prefix="language_debug_chrome_"))
    chrome = find_chrome()
    process = subprocess.Popen([
        str(chrome),
        f"--remote-debugging-port={args.port}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--disable-popup-blocking",
        args.url,
    ])
    print("=" * 60)
    print("调试浏览器已打开！请在浏览器中完成登录。")
    print()
    print("操作步骤：")
    print("1. 在打开的浏览器中登录 jy.vipthink.cn")
    print("2. 进入课件管理页面，搜索 s4_v8_01_TW")
    print("3. 点击编辑，找到语种字段，从「简体&普通话」改成「繁体&台湾话」")
    print("4. 点击保存")
    print()
    print(f"监听 {args.seconds} 秒，结果保存到：{output_path}")
    print("=" * 60)

    try:
        wait_for_debugger(args.port)
        tabs = http_json(f"http://127.0.0.1:{args.port}/json")
        page = next((tab for tab in tabs if tab.get("type") == "page"), tabs[0])
        cdp = Cdp(connect_ws(page["webSocketDebuggerUrl"]))
        cdp.send("Network.enable")
        cdp.send("Page.enable")

        requests: dict[str, dict] = {}
        captures: list[dict] = []
        deadline = time.time() + args.seconds
        while time.time() < deadline:
            event = cdp.recv()
            if not event or "method" not in event:
                continue
            method = event["method"]
            params = event.get("params", {})

            if method == "Network.requestWillBeSent":
                request = params.get("request", {})
                post_data = request.get("postData", "")
                url = request.get("url", "")
                if is_target_request(url, post_data):
                    requests[params.get("requestId", "")] = {
                        "url": url,
                        "method": request.get("method", ""),
                        "postData": post_data,
                    }
            elif method == "Network.responseReceived":
                request_id = params.get("requestId", "")
                if request_id not in requests:
                    continue
                request = requests[request_id]
                response = params.get("response", {})
                url = response.get("url", request.get("url", ""))
                if request.get("method") != "POST":
                    continue
                cdp.send("Network.getResponseBody", {"requestId": request_id})
                body = ""
                end = time.time() + 3
                while time.time() < end:
                    message = cdp.recv()
                    if message and message.get("id") == cdp.next_id - 1:
                        result = message.get("result", {})
                        body = result.get("body", "")
                        break
                captures.append({
                    "url": url,
                    "status": response.get("status"),
                    "request": request,
                    "responsePreview": body[:20000],
                })
                output_path.write_text(json.dumps(captures, ensure_ascii=False, indent=2), encoding="utf-8")
                remaining = int(deadline - time.time())
                print(f"[{len(captures)}] 已捕获接口：{url}")
                print(f"  请求数据：{request.get('postData', '')[:500]}")
                print(f"  响应状态：{response.get('status')}，剩余监听 {remaining} 秒")
    finally:
        output_path.write_text(json.dumps(captures, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n监听结束，结果文件：{output_path}")
        print("调试浏览器可以手动关闭。")
        process.poll()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
