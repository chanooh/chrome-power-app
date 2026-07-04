#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';

const VOLUME_PATH = '/Volumes/F';
const BUILD_ROOT = join(VOLUME_PATH, 'ChromePowerBuild');
const DEPOT_TOOLS_PATH = join(BUILD_ROOT, 'depot_tools');
const GIT_CACHE_PATH = join(BUILD_ROOT, 'git-cache');
const CIPD_CACHE_DIR = join(BUILD_ROOT, 'cipd-cache');
const VPYTHON_ROOT = join(BUILD_ROOT, 'vpython-root');
const CHROMIUM_ROOT = join(BUILD_ROOT, 'chromium');
const CHROMIUM_SRC = join(CHROMIUM_ROOT, 'src');
const TMP_DIR = join(BUILD_ROOT, 'tmp');
const CORE_ROOT = join(VOLUME_PATH, 'ChromePowerCore');
const VERSION = '150.0.7871.47';
const TAG = '150.0.7871.47';
const COMMIT = '0c3cca15d78645281db2d339b2dc3d6fad4ee90a';
const DEPOT_TOOLS_COMMIT = '1b1b01fa912786b88a79f3504176a275183839b5';
const ARCH = 'mac-arm64';
const BUILD_DIR_NAME = 'ChromePower-arm64';
const INSTALLED_VERSION_DIR = join(CORE_ROOT, 'chromium', VERSION, ARCH);
const INSTALLED_APP = join(INSTALLED_VERSION_DIR, 'Chromium.app');
const INSTALLED_EXECUTABLE = join(INSTALLED_APP, 'Contents', 'MacOS', 'Chromium');
const MANIFEST_PATH = join(INSTALLED_VERSION_DIR, 'manifest.json');
const XCODE_CANDIDATES = [
  '/Volumes/F/MacOffload/Xcode/Xcode.app/Contents/Developer',
  '/Volumes/F/Applications/Xcode.app/Contents/Developer',
  '/Applications/Xcode.app/Contents/Developer',
];
const GN_ARGS = [
  'target_os="mac"',
  'target_cpu="arm64"',
  'is_debug=false',
  'is_component_build=false',
  'symbol_level=0',
  'enable_nacl=false',
  'use_remoteexec=false',
  'use_lld=false',
];

const command = process.argv[2] || 'help';

function log(message) {
  console.log(`[chromium-core] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function run(cmd, args, options = {}) {
  log(`${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: buildEnv(),
    ...options,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

function output(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function buildEnv() {
  const developerDir = resolveXcodeDeveloperDir(false);
  return {
    ...process.env,
    PATH: `${DEPOT_TOOLS_PATH}:${process.env.PATH || ''}`,
    GIT_CACHE_PATH,
    CIPD_CACHE_DIR,
    VPYTHON_VIRTUALENV_ROOT: VPYTHON_ROOT,
    TMPDIR: TMP_DIR,
    DEPOT_TOOLS_UPDATE: '0',
    DEPOT_TOOLS_METRICS: '0',
    DEVELOPER_DIR: developerDir || process.env.DEVELOPER_DIR || '',
  };
}

function assertMacArm64() {
  if (process.platform !== 'darwin') {
    fail('Chromium managed core build is only supported on macOS.');
  }
  if (process.arch !== 'arm64') {
    fail(`Expected arm64 host, got ${process.arch}.`);
  }
}

function assertMountedApfsVolume() {
  if (!existsSync(VOLUME_PATH)) {
    fail(`${VOLUME_PATH} is not mounted.`);
  }
  const info = output('diskutil', ['info', VOLUME_PATH], {env: process.env});
  if (!/Mounted:\s+Yes/.test(info)) {
    fail(`${VOLUME_PATH} is not mounted.`);
  }
  if (!/File System Personality:\s+APFS/.test(info)) {
    fail(`${VOLUME_PATH} must be APFS for Chromium source/build workloads.`);
  }
  if (/Owners:\s+Disabled/.test(info)) {
    log('warning: ownership is disabled on /Volumes/F; run `diskutil enableOwnership /Volumes/F` if Xcode or Chromium tools report permission issues.');
  }
}

function resolveXcodeDeveloperDir(required = true) {
  const match = XCODE_CANDIDATES.find(candidate => existsSync(join(candidate, 'usr', 'bin', 'xcodebuild')));
  if (!match && required) {
    fail(
      'Full Xcode was not found. Put Xcode.app at /Volumes/F/Applications/Xcode.app or /Applications/Xcode.app.',
    );
  }
  return match || '';
}

function assertXcode() {
  const developerDir = resolveXcodeDeveloperDir(true);
  const env = {...process.env, DEVELOPER_DIR: developerDir};
  const sdkPath = output('xcrun', ['--show-sdk-path'], {env});
  const sdkVersion = output('xcrun', ['--show-sdk-version'], {env});
  if (!sdkPath.includes('Xcode.app')) {
    fail(`Expected full Xcode SDK, got ${sdkPath}`);
  }
  log(`using Xcode developer dir: ${developerDir}`);
  log(`using macOS SDK: ${sdkVersion} (${sdkPath})`);
}

function ensureDirectories() {
  for (const dir of [BUILD_ROOT, GIT_CACHE_PATH, CIPD_CACHE_DIR, VPYTHON_ROOT, CHROMIUM_ROOT, TMP_DIR, CORE_ROOT]) {
    mkdirSync(dir, {recursive: true});
  }
}

function ensureDepotTools() {
  if (!existsSync(DEPOT_TOOLS_PATH)) {
    run('git', ['clone', 'https://chromium.googlesource.com/chromium/tools/depot_tools.git', DEPOT_TOOLS_PATH], {
      env: process.env,
    });
  }
  run('git', ['fetch', 'origin', DEPOT_TOOLS_COMMIT], {cwd: DEPOT_TOOLS_PATH, env: process.env});
  run('git', ['checkout', '--detach', DEPOT_TOOLS_COMMIT], {cwd: DEPOT_TOOLS_PATH, env: process.env});
}

function prepare() {
  assertMacArm64();
  assertMountedApfsVolume();
  ensureDirectories();
  assertXcode();
  ensureDepotTools();
  log('prepare complete');
}

function syncChromium() {
  prepare();
  if (!existsSync(CHROMIUM_SRC)) {
    run('fetch', ['--git-cache', 'chromium'], {cwd: CHROMIUM_ROOT});
  }
  run('git', ['fetch', 'origin', `refs/tags/${TAG}:refs/tags/${TAG}`], {cwd: CHROMIUM_SRC});
  run('git', ['checkout', '--detach', COMMIT], {cwd: CHROMIUM_SRC});
  const currentCommit = output('git', ['rev-parse', 'HEAD'], {cwd: CHROMIUM_SRC});
  if (currentCommit !== COMMIT) {
    fail(`Chromium checkout mismatch: expected ${COMMIT}, got ${currentCommit}`);
  }
  run('gclient', ['sync', '--with_branch_heads', '--with_tags'], {cwd: CHROMIUM_ROOT});
  log('sync complete');
}

function writeGnArgs() {
  const outDir = join(CHROMIUM_SRC, 'out', BUILD_DIR_NAME);
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'args.gn'), `${GN_ARGS.join('\n')}\n`, 'utf8');
  return outDir;
}

function buildChromium() {
  if (!existsSync(CHROMIUM_SRC)) {
    fail('Chromium source is missing. Run `npm run chromium:sync` first.');
  }
  assertMacArm64();
  assertMountedApfsVolume();
  assertXcode();
  ensureDepotTools();
  const outDir = writeGnArgs();
  run('gn', ['gen', `out/${BUILD_DIR_NAME}`], {cwd: CHROMIUM_SRC});
  run('autoninja', ['-C', `out/${BUILD_DIR_NAME}`, 'chrome'], {cwd: CHROMIUM_SRC});
  const builtApp = join(outDir, 'Chromium.app');
  if (!existsSync(builtApp)) {
    fail(`Build completed but Chromium.app was not found: ${builtApp}`);
  }
  log(`build complete: ${builtApp}`);
}

function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function installCore() {
  const builtApp = join(CHROMIUM_SRC, 'out', BUILD_DIR_NAME, 'Chromium.app');
  const builtExecutable = join(builtApp, 'Contents', 'MacOS', 'Chromium');
  if (!existsSync(builtExecutable)) {
    fail(`Built Chromium executable not found: ${builtExecutable}`);
  }
  mkdirSync(INSTALLED_VERSION_DIR, {recursive: true});
  if (existsSync(INSTALLED_APP)) {
    rmSync(INSTALLED_APP, {recursive: true, force: true});
  }
  cpSync(builtApp, INSTALLED_APP, {recursive: true});
  const executableHash = sha256(INSTALLED_EXECUTABLE);
  const manifest = {
    schemaVersion: 1,
    kind: 'chromium',
    version: VERSION,
    tag: TAG,
    commit: COMMIT,
    arch: ARCH,
    platform: 'darwin',
    executablePath: INSTALLED_EXECUTABLE,
    gnArgs: GN_ARGS,
    depotToolsCommit: DEPOT_TOOLS_COMMIT,
    executableSha256: executableHash,
    builtAt: new Date().toISOString(),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log(`installed core: ${INSTALLED_APP}`);
  log(`wrote manifest: ${MANIFEST_PATH}`);
}

function verifyCore() {
  assertMountedApfsVolume();
  if (!existsSync(MANIFEST_PATH)) {
    fail(`Manifest not found: ${MANIFEST_PATH}`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (manifest.version !== VERSION || manifest.commit !== COMMIT || manifest.arch !== ARCH) {
    fail('Manifest version, commit, or arch does not match the locked Chromium core.');
  }
  if (!existsSync(INSTALLED_EXECUTABLE) || !statSync(INSTALLED_EXECUTABLE).isFile()) {
    fail(`Installed executable not found: ${INSTALLED_EXECUTABLE}`);
  }
  const executableHash = sha256(INSTALLED_EXECUTABLE);
  if (executableHash !== manifest.executableSha256) {
    fail('Installed executable sha256 does not match manifest.');
  }
  const versionOutput = output(INSTALLED_EXECUTABLE, ['--version']);
  if (!versionOutput.includes(VERSION)) {
    fail(`Chromium version mismatch: ${versionOutput}`);
  }
  log(`verified executable: ${versionOutput}`);
}

function printHelp() {
  console.log(`Usage: node scripts/chromium-core.mjs <command>

Commands:
  prepare       Check /Volumes/F, Xcode, SDK, and depot_tools.
  sync          Checkout Chromium ${TAG} at ${COMMIT} under /Volumes/F.
  build         Build Chromium arm64 from the checked out source.
  install-core  Copy Chromium.app into /Volumes/F/ChromePowerCore and write manifest.
  verify        Validate installed manifest/hash/version.
`);
}

try {
  if (command === 'prepare') {
    prepare();
  } else if (command === 'sync') {
    syncChromium();
  } else if (command === 'build') {
    buildChromium();
  } else if (command === 'install-core') {
    installCore();
  } else if (command === 'verify') {
    verifyCore();
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`[chromium-core] ${(error).message}`);
  process.exit(1);
}
