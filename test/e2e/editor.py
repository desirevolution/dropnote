"""Real-browser regression tests against the built app, not mocked CodeMirror.
Run from the repository root after npm run build; see test/e2e/README.md.
"""
import os
import http.client
from urllib.parse import urlsplit
import re
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def start_url(process, log):
    until = time.monotonic() + 20
    while time.monotonic() < until:
        text = log.read_text()
        match = re.search(r"dropnote listening on port (\d+)", text)
        if match:
            return f"http://127.0.0.1:{match[1]}"
        if process.poll() is not None:
            raise RuntimeError(f"Server exited:\n{text}")
        time.sleep(0.1)
    raise RuntimeError(f"Server did not start:\n{log.read_text()}")


def synced(page):
    expect(page.locator("#sync-status")).to_have_text("Synced", timeout=15000)
    expect(page.locator("#note .cm-content")).to_have_attribute("contenteditable", "true")


def editor(page):
    return page.locator("#note .cm-content")


def blur(page):
    editor(page).evaluate("el => el.blur()")


def action(page, selector):
    item = page.locator(selector)
    if not item.is_visible():
        page.locator("#editor-more > summary").click()
    item.click()


def view_options(page):
    action(page, "#note-view > summary")


def insert(page, text):
    editor(page).press("Control+End")
    page.keyboard.insert_text(text)
    synced(page)


def goto_note(page, url):
    page.goto(url)
    synced(page)


def create(page, base, slug, label):
    response = page.request.post(base + "/api/pads", data={"slug": slug, "displayName": label, "ttl": "never"})
    assert response.status == 201, response.text()
    return response.json()


def source_text(page):
    with page.expect_download() as result:
        action(page, "#download-note")
    return Path(result.value.path()).read_text(encoding="utf-8")


def geometry(page):
    # Compare measured logical line tops, not glyph baselines. Ignore the
    # invisible sizing element CodeMirror uses to compute gutter width.
    page.evaluate("document.fonts.ready")
    page.wait_for_function("""() => {
      const lines = [...document.querySelectorAll('#note .cm-line')];
      const nums = [...document.querySelectorAll('#note .cm-lineNumbers .cm-gutterElement')]
        .filter(el => getComputedStyle(el).visibility !== 'hidden' && /^\\d+$/.test(el.textContent.trim()));
      if (!lines.length || lines.length !== nums.length) return false;
      return lines.every((line, i) => Math.abs(line.getBoundingClientRect().top - nums[i].getBoundingClientRect().top) <= 2);
    }""")
    palette = page.evaluate("""() => ['#note .cm-editor', '#note .cm-scroller', '#note .cm-gutters', '#note-status-bar']
        .map(s => getComputedStyle(document.querySelector(s)).backgroundColor)""")
    assert len(set(palette)) == 1, palette


def run(browser, base):
    context = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900}, color_scheme="light", accept_downloads=True)
    errors = []
    context.on("page", lambda page: page.on("pageerror", lambda e: errors.append(str(e))))
    a = context.new_page()
    b = context.new_page()
    source = create(a, base, "e2e-source", "Source notes")
    target = create(a, base, "e2e-target", "Target notes")
    source_url = base + source["path"] + "?view=note"
    target_url = base + target["path"] + "?view=note"
    goto_note(a, source_url)
    goto_note(b, source_url)
    insert(a, "# Heading\n## Subheading\n- [ ] Backup\n" + "wrapped text " * 24 + "\nhttps://example.org\n")
    blur(a)
    expect(b.locator("#note .smart-task")).to_have_attribute("aria-checked", "false")
    a.locator("#note .smart-task").click()
    expect(b.locator("#note .smart-task")).to_have_attribute("aria-checked", "true")
    synced(a)
    action(a, "#undo-note")
    expect(b.locator("#note .smart-task")).to_have_attribute("aria-checked", "false")
    action(a, "#redo-note")
    expect(b.locator("#note .smart-task")).to_have_attribute("aria-checked", "true")
    synced(a)
    print("PASS: live checklist sync and undo/redo", flush=True)

    view_options(a)
    a.locator("#line-numbers").check()
    a.locator("#note-view > summary").click()
    blur(a)
    geometry(a)
    # The theme switch lives inside a collapsed Appearance menu.
    a.locator("#appearance-menu > summary").click()
    expect(a.locator("#theme-toggle")).to_be_visible()
    a.locator("#theme-toggle").click()
    expect(a.locator("html")).to_have_attribute("data-theme", "dark")
    geometry(a)
    view_options(a)
    a.locator("#markdown-formatting").uncheck()
    a.locator("#note-view > summary").click()
    geometry(a)
    view_options(a)
    a.locator("#markdown-formatting").check()
    a.locator("#note-view > summary").click()
    print("PASS: actual CodeMirror gutters and surface in both themes and raw mode", flush=True)

    # Keep a help dialog open while the other client inserts at the start.
    insert(a, "Important")
    editor(a).press("Shift+Home")
    action(a, "#editor-help")
    expect(a.locator("#editor-help-dialog")).to_be_visible()
    editor(b).press("Control+Home")
    b.keyboard.insert_text("Remote prefix\n")
    synced(b)
    expect(a.locator("#note .cm-content")).to_contain_text("Remote prefix")
    a.locator('[data-help-tab="markdown"]').click()
    a.locator('[data-help-insert="bold"]').click()
    synced(a)
    assert "**Important**" in source_text(a)
    print("PASS: relative insertion anchor during simultaneous edit", flush=True)

    # Typing the actual trigger must open the picker without a background file replay.
    lookups = []
    a.on("request", lambda request: lookups.append(request.url) if "/api/space-references/" in request.url else None)
    editor(a).press("Control+End")
    a.keyboard.type("[[")
    expect(a.locator("#reference-picker")).to_be_visible()
    expect(a.locator("#reference-results button").filter(has_text="▤ Target notes")).to_be_visible()
    assert not lookups, lookups
    a.locator("#reference-query").press("Escape")
    expect(a.locator("#reference-picker")).to_be_hidden()
    # Cancel preserves the typed trigger; remove it from this fixture.
    editor(a).press("Control+End")
    editor(a).press("Backspace")
    editor(a).press("Backspace")
    synced(a)

    # Use a selected label as an alias, and select a real Space by ID.
    insert(a, "\nGo to target")
    editor(a).press("Shift+Home")
    editor(a).press("Control+k")
    expect(a.locator("#reference-picker")).to_be_visible()
    a.locator("#reference-query").fill("Target notes")
    a.locator("#reference-results button").filter(has_text="▤ Target notes").click()
    synced(a)
    raw = source_text(a)
    assert f'[[space:{target["spaceId"]}|Go to target|alias]]' in raw, raw
    blur(a)
    expect(a.locator("#note .smart-reference").filter(has_text="Go to target")).to_be_visible()
    # The protected search must not replace the alias by default.
    editor(a).press("Control+h")
    a.locator("[data-find]").fill("Go to target")
    a.locator("[data-replace]").fill("damaged")
    expect(a.get_by_role("button", name="Replace all", exact=True)).to_be_disabled()
    a.locator("[data-find]").press("Escape")
    assert "Go to target|alias" in source_text(a)
    print("PASS: reference picker, stable ID, alias and replace protection", flush=True)

    # Upload and reference a foreign attachment, without visiting it in A.
    goto_note(b, target_url)
    b.locator("#files-tab").click()
    b.locator("#attachment-input").set_input_files({"name": "config.txt", "mimeType": "text/plain", "buffer": b"reference bytes"})
    expect(b.locator("#attachments")).to_contain_text("config.txt")
    expect(b.locator("#sync-status")).to_have_text("Synced")
    insert(a, "\n")
    editor(a).press("Control+k")
    a.locator('[data-reference-filter="files"]').click()
    a.locator("#reference-query").fill("Target notes")
    a.locator("#reference-results button").filter(has_text="▸ Target notes").click()
    a.locator("#reference-results button").filter(has_text="config.txt").click()
    synced(a)
    blur(a)
    with a.expect_download() as download:
        a.locator("#note .smart-reference").filter(has_text="config.txt").click(modifiers=["Control"])
    assert Path(download.value.path()).read_bytes() == b"reference bytes"
    assert a.url == source_url
    print("PASS: explicit foreign file browse and download", flush=True)

    # Read-only help must not expose a working Insert action.
    a.locator("#read-mode").check()
    expect(editor(a)).to_have_attribute("contenteditable", "false")
    action(a, "#editor-help")
    expect(a.locator("#editor-help-dialog")).to_be_visible()
    assert not a.locator("[data-help-insert]:visible").count()
    a.locator("#editor-help-close").click()
    a.locator("#read-mode").uncheck()
    synced(a)
    # Explicit reference navigation overrides the saved Files view in B.
    blur(a)
    a.locator("#note .smart-reference").filter(has_text="Go to target").click(modifiers=["Control"])
    expect(a).to_have_url(re.compile(r"/p/e2e-target\?.*view=note"))
    synced(a)
    expect(a.locator("#note-tab")).to_have_attribute("aria-selected", "true")
    a.locator("#space-back").click()
    expect(a).to_have_url(source_url)
    synced(a)
    print("PASS: read-only help and explicit reference navigation/history", flush=True)

    # Add a local file, then redeem a real public share through a separate
    # guest-origin browser context. The transport bridge preserves the guest
    # Host/Origin checks without needing DNS or a TLS reverse proxy in CI.
    goto_note(b, source_url)
    b.locator("#files-tab").click()
    b.locator("#attachment-input").set_input_files({"name": "local.txt", "mimeType": "text/plain", "buffer": b"guest local bytes"})
    row = b.locator("#attachments li").filter(has_text="local.txt")
    expect(row).to_be_visible()
    expect(b.locator("#sync-status")).to_have_text("Synced")
    blob_id = row.get_attribute("data-blob-id")
    assert blob_id and re.fullmatch(r"[0-9a-f]{32}", blob_id), blob_id
    insert(a, f'\n[[file:{source["spaceId"]}/{blob_id}|local.txt]]')
    response = a.request.put(base + "/api/pads/e2e-source/guest-link", headers={"Origin": "http://127.0.0.1"}, data={"duration": "1h", "password": "guest password for test", "oneTime": False})
    assert response.status == 200, response.text()
    guest_url = response.json()["link"]["url"]
    guest_context = browser.new_context(locale="en-US", accept_downloads=True)
    g = guest_context.new_page()
    g.on("pageerror", lambda e: errors.append(str(e)))
    private_calls = []
    backend = urlsplit(base)

    def forward_guest(route):
        request = route.request
        url = urlsplit(request.url)
        if url.scheme == "blob":
            route.continue_()
            return
        if url.scheme != "https" or url.hostname != "localhost" or not (url.path.startswith("/g/") or url.path == "/fonts/IBMPlexMono-Regular.woff2"):
            private_calls.append(request.url)
            route.abort()
            return
        headers = {k: v for k, v in request.all_headers().items() if k.lower() not in ("host", "connection", "accept-encoding", "content-length")}
        headers["Host"] = url.netloc
        conn = http.client.HTTPConnection(backend.hostname, backend.port, timeout=15)
        try:
            conn.request(request.method, url.path + ("?" + url.query if url.query else ""), body=request.post_data_buffer, headers=headers)
            answer = conn.getresponse()
            data = answer.read()
            reply = {k: v for k, v in answer.getheaders() if k.lower() not in ("connection", "transfer-encoding", "content-length", "keep-alive")}
            route.fulfill(status=answer.status, headers=reply, body=data)
        finally:
            conn.close()

    g.route("**/*", forward_guest)
    g.add_init_script("localStorage.setItem('theme', 'dark')")
    g.goto(guest_url)
    expect(g.locator("html")).to_have_attribute("data-theme", "dark")
    g.locator("#guest-passphrase").fill("guest password for test")
    g.locator("#guest-open").click()
    expect(g.locator("#guest-content")).to_be_visible()
    g.wait_for_function("document.fonts.check('16px \"IBM Plex Mono\"') && [...document.fonts].some(f => f.family.includes('IBM Plex Mono') && f.status === 'loaded')")
    expect(g.locator("#guest-note .cm-content")).to_contain_text("Go to target")
    expect(g.locator("#guest-note .smart-reference")).to_have_count(1)
    expect(g.locator("#guest-note .smart-reference")).to_contain_text("local.txt")
    expect(g.locator("#guest-note .smart-task")).to_be_disabled()
    with g.expect_download() as downloaded:
        g.locator("#guest-note .smart-reference").click()
    assert Path(downloaded.value.path()).read_bytes() == b"guest local bytes"
    g.locator("#guest-more > summary").click()
    g.locator("#guest-help").click()
    expect(g.locator("#editor-help-dialog")).to_be_visible()
    assert not g.locator("[data-help-insert]").count()
    assert not private_calls, private_calls
    guest_context.close()
    print("PASS: real plain guest redemption, sanitized references, local download and help", flush=True)

    for width in (768, 375, 320):
        a.set_viewport_size({"width": width, "height": 800})
        a.wait_for_function("""() => {
          const root = document.querySelector('#note-tools');
          const direct = root.querySelector('.editor-direct-actions');
          const more = root.querySelector('#editor-more');
          return direct.getBoundingClientRect().width + more.getBoundingClientRect().width <= root.clientWidth + 1;
        }""")
        assert a.locator("#copy-note").count() == 1
    view_options(a)
    a.locator("#show-status-bar").uncheck()
    expect(a.locator("#note-status-bar")).to_be_hidden()
    expect(a.locator("#sync-status")).to_be_visible()
    assert not errors, errors
    print("PASS: responsive toolbar, status fallback, no page errors", flush=True)
    context.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="dropnote-e2e-") as temp:
        log = Path(temp) / "server.log"
        env = dict(os.environ, PORT="0", DATA_DIR=str(Path(temp) / "data"), BASE_URL="http://127.0.0.1", MULTIUSER="false", GUEST_LINKS="true", GUEST_BASE_URL="https://localhost", INSTANCE_PIN="", MAX_TTL="never", PAD_PATH="/p", RATE_LIMIT_MAX="1000")
        with log.open("w") as output:
            server = subprocess.Popen(["node", "src/main.ts"], cwd=ROOT, env=env, stdout=output, stderr=subprocess.STDOUT)
            try:
                base = start_url(server, log)
                with sync_playwright() as p:
                    options = {"executable_path": os.environ["CHROMIUM_PATH"]} if os.environ.get("CHROMIUM_PATH") else {}
                    browser = p.chromium.launch(**options)
                    try:
                        run(browser, base)
                    finally:
                        browser.close()
            except Exception:
                print(log.read_text(), flush=True)
                raise
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
