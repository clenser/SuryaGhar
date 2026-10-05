import asyncio, json, os
from playwright.async_api import async_playwright
CHROME = os.environ.get("CHROME_PATH")  # optional: path to a Chromium binary
EXPECT = {"Kolkata": (22.5726, 88.3639), "Kalna": (23.2167, 88.3667), "New Delhi": (28.6139, 77.2090), "Mumbai": (19.0760, 72.8777), "Bengaluru": (12.9716, 77.5946)}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME or None, args=["--no-sandbox","--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
        page = await b.new_page(viewport={"width":1440,"height":900})
        page_errors=[]
        page.on("pageerror", lambda e: page_errors.append(str(e)[:200]))
        await page.goto("http://127.0.0.1:5173/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        await page.click("header button:has-text('Advanced')")
        await page.wait_for_timeout(600)
        results={}
        for name,(lat,lng) in EXPECT.items():
            await page.click(f"button.test-site:has-text('{name if name!='New Delhi' else 'New Delhi'}')")
            await page.wait_for_timeout(2200)
            txt = await page.inner_text(".status-bar__segment--center")
            parts = txt.replace("°N","").replace("°E","").split()
            got=(float(parts[0]), float(parts[1]))
            ok = abs(got[0]-lat)<0.01 and abs(got[1]-lng)<0.01
            results[name]={"expected":[lat,lng],"map_centre":got,"moved_correctly":ok}
        print(json.dumps({"sites":results,"uncaught_page_errors":page_errors}, indent=1))
        await b.close()
asyncio.run(main())
