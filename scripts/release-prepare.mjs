import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const version = process.argv[2]?.replace(/^v/, "");

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: npm run release:prepare -- 0.1.2");
  process.exit(1);
}

const tag = `v${version}`;

function run(command, args) {
  console.log(`> ${[command, ...args].join(" ")}`);
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const dirty = output("git", ["status", "--porcelain"]);
if (dirty) {
  console.error("Release prepare needs a clean working tree.");
  console.error(dirty);
  process.exit(1);
}

if (output("git", ["tag", "--list", tag])) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

const packagePath = join(root, "package.json");
const packageJson = readJson(packagePath);
packageJson.version = version;
writeJson(packagePath, packageJson);

const lockPath = join(root, "package-lock.json");
const packageLock = readJson(lockPath);
packageLock.version = version;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = version;
}
writeJson(lockPath, packageLock);

const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
const tauriConfig = readJson(tauriConfigPath);
tauriConfig.version = version;
writeJson(tauriConfigPath, tauriConfig);

const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargoToml = readFileSync(cargoPath, "utf8").replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargoToml, "utf8");

const cargoLockPath = join(root, "src-tauri", "Cargo.lock");
const cargoLock = readFileSync(cargoLockPath, "utf8").replace(
  /(\[\[package\]\]\r?\nname = "git-account-switcher"\r?\nversion = ")[^"]+"/,
  `$1${version}"`,
);
writeFileSync(cargoLockPath, cargoLock, "utf8");

run("npm", ["run", "release:check"]);
run("npm", ["run", "build"]);
run("git", [
  "add",
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);
run("git", ["tag", tag]);

console.log(`Prepared ${tag}. Push with: git push origin main ${tag}`);
