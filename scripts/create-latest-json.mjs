import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = config.version;
const tag = process.env.RELEASE_TAG || `v${version}`;
const repository = process.env.RELEASE_REPOSITORY || "chushi-chef/git-account-switcher";
const releaseBaseUrl = `https://github.com/${repository}/releases/download/${tag}`;
const bundleDir = process.env.BUNDLE_DIR || join(root, "src-tauri", "target", "release", "bundle");
const platforms = {};

function assetUrl(fileName) {
  return `${releaseBaseUrl}/${encodeURIComponent(fileName)}`;
}

function addPlatform(platform, filePath) {
  const signaturePath = `${filePath}.sig`;
  if (!existsSync(filePath) || !existsSync(signaturePath)) {
    return;
  }

  platforms[platform] = {
    signature: readFileSync(signaturePath, "utf8").trim(),
    url: assetUrl(basename(filePath)),
  };
}

function newestFile(dir, predicate) {
  if (!existsSync(dir)) {
    return null;
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort((left, right) => {
      const leftName = basename(left);
      const rightName = basename(right);
      return rightName.localeCompare(leftName);
    })[0] ?? null;
}

function newestFileDeep(dir, predicate) {
  const matches = [];
  const visit = (currentDir) => {
    if (!existsSync(currentDir)) {
      return;
    }

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && predicate(entry.name, fullPath)) {
        matches.push(fullPath);
      }
    }
  };

  visit(dir);
  return matches.sort((left, right) => basename(right).localeCompare(basename(left)))[0] ?? null;
}

const pickFile = process.env.BUNDLE_DIR ? newestFileDeep : newestFile;
const windowsSetup = pickFile(join(bundleDir, "nsis"), (name) => name.endsWith("-setup.exe"))
  ?? newestFileDeep(bundleDir, (name) => name.endsWith("-setup.exe"));
if (windowsSetup) {
  addPlatform("windows-x86_64", windowsSetup);
}

const macIntel = pickFile(join(bundleDir, "macos"), (name) => name.endsWith(".app.tar.gz") && name.includes("x64"))
  ?? newestFileDeep(bundleDir, (name) => name.endsWith(".app.tar.gz") && name.includes("x64"));
if (macIntel) {
  addPlatform("darwin-x86_64", macIntel);
}

const macApple = pickFile(join(bundleDir, "macos"), (name) => name.endsWith(".app.tar.gz") && name.includes("aarch64"))
  ?? newestFileDeep(bundleDir, (name) => name.endsWith(".app.tar.gz") && name.includes("aarch64"));
if (macApple) {
  addPlatform("darwin-aarch64", macApple);
}

if (Object.keys(platforms).length === 0) {
  throw new Error("No signed updater artifacts were found. Run a signed `npm run tauri:build` first.");
}

if (!platforms["windows-x86_64"]) {
  throw new Error("Missing signed Windows updater artifact.");
}

if (!platforms["darwin-x86_64"] && !platforms["darwin-aarch64"]) {
  throw new Error("Missing signed macOS updater artifact.");
}

const manifest = {
  version,
  notes: process.env.RELEASE_NOTES || `Release ${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

const targetPath = join(bundleDir, "latest.json");
writeFileSync(targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Created ${targetPath}`);
