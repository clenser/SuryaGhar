import asyncio, json, os
from playwright.async_api import async_playwright

CHROME = os.environ.get("CHROME_PATH")  # optional: path to a Chromium binary
OUT = os.environ.get("SCREENSHOT_DIR", "docs/screenshots")

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME or None, args=["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        report = {}
        for name, vp, mobile in [("desktop", {"width": 1440, "height": 900}, False), ("mobile", {"width": 390, "height": 844}, True)]:
            ctx = await browser.new_context(viewport=vp, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
            page = await ctx.new_page()
            logs = []
            page.on("console", lambda m: logs.append(f"{m.type}: {m.text[:160]}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: logs.append(f"pageerror: {str(e)[:160]}"))
            await page.goto("http://127.0.0.1:5173/", wait_until="domcontentloaded")
            await page.wait_for_timeout(4000)
            await page.screenshot(path=f"{OUT}/{name}-01-initial.png")
            report[name] = {"console_sample": logs[:12], "console_count": len(logs)}

            if name == "desktop":
                # Search: type a query, let debounce + backend error occur
                await page.fill("input[aria-label='Search location']", "Kolkata")
                await page.wait_for_timeout(2500)
                await page.screenshot(path=f"{OUT}/desktop-02-search-state.png")
                # Layers + advanced
                await page.keyboard.press("Escape")
                await page.click("button[aria-label='Map layers']")
                await page.wait_for_timeout(500)
                await page.screenshot(path=f"{OUT}/desktop-03-layers.png")
                await page.click("input[aria-label='Advanced mode']", force=True)
                await page.wait_for_timeout(400)
                await page.screenshot(path=f"{OUT}/desktop-04-advanced.png")
                # Test site jump (uses map flyTo; map tiles may not load in sandbox)
                await page.click("button.test-site:has-text('Kalna')")
                await page.wait_for_timeout(1800)
                await page.screenshot(path=f"{OUT}/desktop-05-place-selected.png")
                # Keyboard focus visibility
                await page.keyboard.press("Tab")
                await page.wait_for_timeout(200)
                await page.screenshot(path=f"{OUT}/desktop-06-focus.png")
            if name == "mobile":
                await page.click("button[aria-label='Map layers']")
                await page.wait_for_timeout(500)
                await page.screenshot(path=f"{OUT}/mobile-02-layers-sheet.png")
            await ctx.close()
        await browser.close()
        print(json.dumps(report, indent=1))

asyncio.run(main())
