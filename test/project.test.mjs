import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredFiles = [
  "index.html",
  "src/main.js",
  "src/styles.css",
  "electron/main.cjs",
  "vite.config.js"
];

test("required application files exist and are non-empty", async () => {
  for (const file of requiredFiles) {
    const content = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(content.trim().length > 0, `${file} should not be empty`);
  }
});

test("package metadata and scripts are internally consistent", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.main, "electron/main.cjs");
  assert.equal(pkg.license, "MIT");
  for (const script of ["dev", "test", "build", "desktop", "package:installer"]) {
    assert.equal(typeof pkg.scripts[script], "string", `missing script: ${script}`);
  }
});

test("HTML references the application entry module", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /src\/main\.js/);
  assert.match(html, /id="star-canvas"/);
});
