import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const checks = [];
const warnings = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pass(message) {
  checks.push({ ok: true, message });
}

function fail(message) {
  checks.push({ ok: false, message });
}

function warn(message) {
  warnings.push(message);
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function cargoVersion() {
  const raw = readText(join(root, "src-tauri", "Cargo.toml"));
  const match = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function cargoLockVersion() {
  const raw = readText(join(root, "src-tauri", "Cargo.lock"));
  const match = raw.match(/\[\[package\]\]\r?\nname = "git-account-switcher"\r?\nversion = "([^"]+)"/);
  return match?.[1] ?? null;
}

function manifestDefaultRepository() {
  const raw = readText(join(root, "scripts", "create-latest-json.mjs"));
  const match = raw.match(/RELEASE_REPOSITORY\s*\|\|\s*"([^"]+)"/);
  return match?.[1] ?? null;
}

function repositoryFromUpdaterEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.hostname.toLowerCase() === "github.com" &&
      parts.length >= 5 &&
      parts[2] === "releases" &&
      parts[3] === "latest" &&
      parts[4] === "download"
    ) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    return null;
  }
  return null;
}

const packageJson = readJson(join(root, "package.json"));
const packageLock = readJson(join(root, "package-lock.json"));
const tauriConfig = readJson(join(root, "src-tauri", "tauri.conf.json"));
const version = packageJson.version;
const expectedTag = `v${version}`;
const versions = {
  "package.json": packageJson.version,
  "package-lock.json": packageLock.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion(),
  "src-tauri/Cargo.lock": cargoLockVersion(),
};

if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  pass(`Version ${version} is valid semver.`);
} else {
  fail(`Version ${version} is not valid semver.`);
}

for (const [file, fileVersion] of Object.entries(versions)) {
  if (fileVersion === version) {
    pass(`${file} version matches ${version}.`);
  } else {
    fail(`${file} version is ${fileVersion || "missing"}, expected ${version}.`);
  }
}

if (tauriConfig.bundle?.createUpdaterArtifacts === true) {
  pass("Tauri updater artifacts are enabled.");
} else {
  fail("src-tauri/tauri.conf.json must set bundle.createUpdaterArtifacts to true.");
}

const updater = tauriConfig.plugins?.updater;
if (updater?.pubkey) {
  pass("Updater public key is configured.");
} else {
  fail("Updater public key is missing.");
}

const endpoint = updater?.endpoints?.[0] || "";
if (endpoint.includes("/releases/latest/download/latest.json")) {
  pass("Updater endpoint points to the latest release manifest.");
} else {
  fail("Updater endpoint should point to releases/latest/download/latest.json.");
}

const updaterRepository = repositoryFromUpdaterEndpoint(endpoint);
const manifestRepository = existsSync(join(root, "scripts", "create-latest-json.mjs"))
  ? manifestDefaultRepository()
  : null;
if (updaterRepository && manifestRepository && updaterRepository.toLowerCase() === manifestRepository.toLowerCase()) {
  pass(`Updater endpoint repository matches manifest repository ${manifestRepository}.`);
} else {
  fail(
    `Updater endpoint repository (${updaterRepository || "unknown"}) must match manifest repository (${manifestRepository || "unknown"}).`,
  );
}

if (existsSync(join(root, ".github", "workflows", "desktop-ci.yml"))) {
  pass("Desktop CI workflow exists.");
} else {
  fail("Desktop CI workflow is missing.");
}

const releaseWorkflowPath = join(root, ".github", "workflows", "desktop-release.yml");
if (existsSync(releaseWorkflowPath)) {
  const releaseWorkflow = readText(releaseWorkflowPath);
  if (releaseWorkflow.includes('tags:') && releaseWorkflow.includes('"v*"')) {
    pass("Desktop Release workflow is tag-triggered.");
  } else {
    fail('Desktop Release workflow should trigger on "v*" tags.');
  }
  if (releaseWorkflow.includes("TAURI_SIGNING_PRIVATE_KEY")) {
    pass("Desktop Release workflow reads the Tauri signing secret.");
  } else {
    fail("Desktop Release workflow does not read TAURI_SIGNING_PRIVATE_KEY.");
  }
  if (releaseWorkflow.includes("npm run release:manifest")) {
    pass("Desktop Release workflow generates latest.json.");
  } else {
    fail("Desktop Release workflow does not generate latest.json.");
  }
} else {
  fail("Desktop Release workflow is missing.");
}

if (!existsSync(join(root, "scripts", "create-latest-json.mjs"))) {
  fail("Manifest script is missing.");
} else {
  pass("Manifest script exists.");
}

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  warn("TAURI_SIGNING_PRIVATE_KEY is not set in this shell. That is fine locally if GitHub Secrets are configured.");
} else {
  pass("TAURI_SIGNING_PRIVATE_KEY is available in this shell.");
}

console.log(`Release preflight for ${expectedTag}`);
for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.message}`);
}
for (const message of warnings) {
  console.log(`WARN ${message}`);
}

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error(`Release preflight failed with ${failed.length} issue(s).`);
  process.exit(1);
}

console.log("Release preflight passed.");
