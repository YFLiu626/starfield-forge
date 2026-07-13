import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const qaDir = path.join(root, "qa");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const starlessPath = "C:\\Users\\A\\Pictures\\2c93ddb569760d31b668e0544e888258.png";
const starsPath = "C:\\Users\\A\\Pictures\\745d1b982ffdbe2e3a6254b7bbef778a.png";

for (const filePath of [edgePath, starlessPath, starsPath]) {
  if (!existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
}

await mkdir(qaDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: edgePath,
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true
  });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.setInputFiles("#background-upload", starlessPath);
  await page.setInputFiles("#stars-upload", starsPath);
  await page.waitForFunction(
    () => /stars|星点/.test(document.querySelector("#scene-readout")?.textContent || ""),
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(2200);
  const frameA = await page.evaluate(() => document.querySelector("#star-canvas")?.toDataURL("image/png") || "");
  await page.waitForTimeout(900);
  const frameB = await page.evaluate(() => document.querySelector("#star-canvas")?.toDataURL("image/png") || "");
  const screenshotPath = path.join(qaDir, "local-starfield-after-travel-update.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const readout = await page.locator("#scene-readout").textContent();
  const status = await page.locator("#export-status").textContent();
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector("#star-canvas");
    return {
      width: canvas?.width || 0,
      height: canvas?.height || 0,
      dataUrlPrefix: canvas?.toDataURL("image/png").slice(0, 32) || ""
    };
  });
  const uiInfo = await page.evaluate(() => {
    const topbarText = document.querySelector(".topbar")?.innerText || "";
    const exportSize = document.querySelector('[data-setting="exportSize"]')?.value || "";
    return {
      hasCommunityNav: /社区|拍摄点|位置详情/.test(topbarText),
      exportSize
    };
  });

  await page.selectOption('[data-setting="exportFormat"]', "mp4");
  await page.evaluate(() => {
    const input = document.querySelector('[data-setting="recordSeconds"]');
    if (input) {
      input.value = "4";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.click("#download-video");
  const download = await downloadPromise;
  const savePath = path.join(qaDir, download.suggestedFilename());
  await download.saveAs(savePath);

  const result = {
    readout,
    status,
    canvasInfo,
    uiInfo,
    frameDiffRatio: roughStringDiffRatio(frameA, frameB),
    screenshotPath,
    videoPath: savePath,
    videoBytes: statSync(savePath).size
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}

function roughStringDiffRatio(a, b) {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  const step = Math.max(1, Math.floor(length / 20000));
  let checked = 0;
  let changed = 0;
  for (let i = 0; i < length; i += step) {
    checked += 1;
    if (a[i] !== b[i]) changed += 1;
  }
  return Number((changed / checked).toFixed(4));
}
