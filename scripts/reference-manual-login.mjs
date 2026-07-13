import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const edgeUserDataDir = "C:\\Users\\A\\AppData\\Local\\Microsoft\\Edge\\User Data";
const starlessPath = "C:\\Users\\A\\Pictures\\2c93ddb569760d31b668e0544e888258.png";
const starsPath = "C:\\Users\\A\\Pictures\\745d1b982ffdbe2e3a6254b7bbef778a.png";

mkdirSync("qa", { recursive: true });

let context;
let browser;
let profileMode = "edge-profile";

try {
  context = await chromium.launchPersistentContext(edgeUserDataDir, {
    headless: false,
    executablePath: edgePath,
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    args: ["--profile-directory=Default"]
  });
} catch (error) {
  profileMode = `fallback-temp-profile: ${error.message}`;
  browser = await chromium.launch({
    headless: false,
    executablePath: edgePath
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
    acceptDownloads: true
  });
}

const page = context.pages()[0] || await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("https://zedastro.lovable.app/star-field-generator", {
  waitUntil: "domcontentloaded",
  timeout: 90000
});

await page.waitForTimeout(3000);

const loginButton = page.getByRole("button", { name: /登录|登入|login|sign in/i });
if ((await page.locator("input[type=file]").count()) === 0 && (await loginButton.count()) > 0) {
  await loginButton.first().click().catch(() => {});
}

console.log("If a login page is visible, please sign in in the opened Edge window.");
console.log("Waiting for the star-field upload controls...");

let fileInputs = 0;
const started = Date.now();
while (Date.now() - started < 300000) {
  await page.waitForTimeout(1000);
  fileInputs = await page.locator("input[type=file]").count();
  if (fileInputs >= 2) break;
}

let uploadResult = "no-upload-controls";
if (fileInputs >= 2) {
  await page.locator("input[type=file]").nth(0).setInputFiles(starlessPath);
  await page.locator("input[type=file]").nth(1).setInputFiles(starsPath);
  uploadResult = "uploaded-two-files";
  await page.waitForTimeout(18000);
}

await page.screenshot({ path: "qa/reference-generator-after-login.png", fullPage: false });

const info = await page.evaluate(() => {
  const bodyText = document.body.innerText;
  return {
    title: document.title,
    url: location.href,
    bodyText: bodyText.slice(0, 8000),
    fileInputCount: document.querySelectorAll("input[type=file]").length,
    buttons: [...document.querySelectorAll("button")].slice(0, 120).map((button, index) => ({
      index,
      text: button.innerText.trim().slice(0, 140),
      title: button.title
    })),
    selects: [...document.querySelectorAll("select,[role=combobox]")].slice(0, 80).map((element, index) => ({
      index,
      text: element.innerText.trim().slice(0, 220),
      aria: element.getAttribute("aria-label")
    })),
    sliders: [...document.querySelectorAll("input[type=range]")].slice(0, 80).map((input, index) => ({
      index,
      min: input.min,
      max: input.max,
      step: input.step,
      value: input.value,
      aria: input.getAttribute("aria-label")
    }))
  };
});

console.log(JSON.stringify({ profileMode, uploadResult, info, errors }, null, 2));

await context.close();
if (browser) await browser.close();
