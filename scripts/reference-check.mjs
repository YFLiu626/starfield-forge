import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const starlessPath = "C:\\Users\\A\\Pictures\\2c93ddb569760d31b668e0544e888258.png";
const starsPath = "C:\\Users\\A\\Pictures\\745d1b982ffdbe2e3a6254b7bbef778a.png";

mkdirSync("qa", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: edgePath
});

const page = await browser.newPage({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
  acceptDownloads: true
});

const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("https://zedastro.lovable.app/star-field-generator", {
  waitUntil: "domcontentloaded",
  timeout: 90000
});
await page.waitForTimeout(8000);

let uploadResult = "not-attempted";
const fileInputs = await page.locator("input[type=file]").count();
if (fileInputs >= 2) {
  await page.locator("input[type=file]").nth(0).setInputFiles(starlessPath);
  await page.locator("input[type=file]").nth(1).setInputFiles(starsPath);
  uploadResult = "uploaded-two-files";
  await page.waitForTimeout(12000);
} else if (fileInputs === 1) {
  await page.locator("input[type=file]").nth(0).setInputFiles(starsPath);
  uploadResult = "uploaded-one-file";
  await page.waitForTimeout(8000);
}

await page.screenshot({ path: "qa/reference-generator.png", fullPage: false });

const info = await page.evaluate(() => {
  const bodyText = document.body.innerText;
  return {
    title: document.title,
    url: location.href,
    bodyText: bodyText.slice(0, 5000),
    loginLikely: /login|sign in|登录|登入|邮箱|email|password|密码/i.test(bodyText),
    fileInputs: [...document.querySelectorAll("input[type=file]")].map((input, index) => ({
      index,
      accept: input.accept,
      id: input.id,
      name: input.name,
      aria: input.getAttribute("aria-label")
    })),
    buttons: [...document.querySelectorAll("button")].slice(0, 80).map((button, index) => ({
      index,
      text: button.innerText.trim().slice(0, 100),
      title: button.title
    })),
    selects: [...document.querySelectorAll("select,[role=combobox]")].slice(0, 60).map((element, index) => ({
      index,
      text: element.innerText.trim().slice(0, 180),
      aria: element.getAttribute("aria-label")
    }))
  };
});

await browser.close();

console.log(JSON.stringify({ uploadResult, info, errors }, null, 2));
