#!/usr/bin/env node

import {createHash} from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {join} from 'node:path';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {get as httpGet} from 'node:http';
import {createServer} from 'node:net';

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
const PATCHSET_VERSION = 'native-fingerprint-kernel-v1';
const FINGERPRINT_ENGINE_VERSION = 'native-macos-v2';
const PATCHSET_PATH = join(
  process.cwd(),
  'patches',
  'chromium',
  VERSION,
  'native-fingerprint-kernel.patch',
);
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

function commandSucceeds(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'ignore',
    env: buildEnv(),
    ...options,
  });
  return result.status === 0;
}

function output(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    env: buildEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  assertMetalToolchain(env, developerDir);
}

function assertMetalToolchain(env, developerDir) {
  try {
    execFileSync('xcrun', ['metal', '-v'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    let buildVersion = '<build version from `xcodebuild -showComponent MetalToolchain`>';
    try {
      const component = execFileSync('xcodebuild', ['-showComponent', 'MetalToolchain', '-json'], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      buildVersion = JSON.parse(component).buildVersion || buildVersion;
    } catch {
      // Keep the generic command hint below when Xcode cannot report component metadata.
    }
    fail(
      [
        'Xcode Metal Toolchain is missing; Chromium cannot compile ANGLE Metal shaders.',
        `Run: DEVELOPER_DIR=${developerDir} xcodebuild -runFirstLaunch`,
        `Then run: DEVELOPER_DIR=${developerDir} xcodebuild -downloadComponent MetalToolchain -buildVersion ${buildVersion}`,
      ].join('\n'),
    );
  }
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
  verifyPatchset({requireApplied: true});
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

function assertChromiumCheckout() {
  if (!existsSync(CHROMIUM_SRC)) {
    fail('Chromium source is missing. Run `npm run chromium:sync` first.');
  }
  const currentCommit = output('git', ['rev-parse', 'HEAD'], {cwd: CHROMIUM_SRC});
  if (currentCommit !== COMMIT) {
    fail(`Chromium checkout mismatch: expected ${COMMIT}, got ${currentCommit}`);
  }
}

function getPatchsetSha256() {
  if (!existsSync(PATCHSET_PATH)) {
    fail(`Chromium patchset not found: ${PATCHSET_PATH}`);
  }
  return sha256(PATCHSET_PATH);
}

function verifyPatchset({requireApplied = false} = {}) {
  assertChromiumCheckout();
  getPatchsetSha256();
  const reverseApplies = commandSucceeds('git', ['apply', '--reverse', '--check', PATCHSET_PATH], {
    cwd: CHROMIUM_SRC,
  });
  if (reverseApplies) {
    log(`patchset applied: ${PATCHSET_VERSION}`);
    return;
  }
  const forwardApplies = commandSucceeds('git', ['apply', '--check', PATCHSET_PATH], {
    cwd: CHROMIUM_SRC,
  });
  if (forwardApplies && !requireApplied) {
    log(`patchset is clean and ready to apply: ${PATCHSET_VERSION}`);
    return;
  }
  if (forwardApplies && requireApplied) {
    fail(`Patchset ${PATCHSET_VERSION} is not applied. Run \`npm run chromium:patch\`.`);
  }
  fail(`Patchset ${PATCHSET_VERSION} does not apply cleanly and is not fully applied.`);
}

function patchChromium() {
  assertMacArm64();
  assertMountedApfsVolume();
  assertChromiumCheckout();
  getPatchsetSha256();
  if (commandSucceeds('git', ['apply', '--reverse', '--check', PATCHSET_PATH], {cwd: CHROMIUM_SRC})) {
    log(`patchset already applied: ${PATCHSET_VERSION}`);
    return;
  }
  run('git', ['apply', PATCHSET_PATH], {cwd: CHROMIUM_SRC});
  verifyPatchset({requireApplied: true});
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
    fingerprintEngineVersion: FINGERPRINT_ENGINE_VERSION,
    patchsetVersion: PATCHSET_VERSION,
    chromiumPatchsetSha256: getPatchsetSha256(),
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
  if (
    manifest.fingerprintEngineVersion !== FINGERPRINT_ENGINE_VERSION ||
    manifest.patchsetVersion !== PATCHSET_VERSION ||
    manifest.chromiumPatchsetSha256 !== getPatchsetSha256()
  ) {
    fail('Manifest patchset metadata does not match the native fingerprint patchset.');
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
  return verifyCdpStartup();
}

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Could not allocate a local CDP port.'));
          return;
        }
        resolve(port);
      });
    });
  });
}

function readCdpVersion(port) {
  return new Promise((resolve, reject) => {
    const req = httpGet(
      {
        hostname: '127.0.0.1',
        port,
        path: '/json/version',
        timeout: 1000,
      },
      res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`CDP returned HTTP ${res.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`CDP returned invalid JSON: ${error.message}`));
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('CDP request timed out.'));
    });
    req.on('error', reject);
  });
}

async function waitForCdpVersion(port, child, getStderr) {
  const deadline = Date.now() + 30000;
  let lastError = new Error('CDP did not respond yet.');
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`Chromium exited before CDP became available.\n${getStderr()}`);
    }
    try {
      return await readCdpVersion(port);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  fail(`Timed out waiting for CDP on 127.0.0.1:${port}: ${lastError.message}\n${getStderr()}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(3000).then(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

async function verifyCdpStartup() {
  const profileRoot = join(VOLUME_PATH, 'ChromePowerCache', 'managed-chromium', VERSION);
  mkdirSync(profileRoot, {recursive: true});
  const profileDir = mkdtempSync(join(profileRoot, 'verify-'));
  const port = await getFreeLocalPort();
  const args = [
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--disable-component-update',
    '--disable-sync',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
    '--disable-gpu',
    'about:blank',
  ];
  let stderr = '';
  log(`starting CDP smoke test on 127.0.0.1:${port}`);
  const child = spawn(INSTALLED_EXECUTABLE, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: buildEnv(),
  });
  child.stderr.on('data', chunk => {
    stderr = `${stderr}${chunk.toString()}`.slice(-4000);
  });
  try {
    const version = await waitForCdpVersion(port, child, () => stderr.trim());
    const browserVersion = String(version.Browser || '');
    if (!browserVersion.includes(VERSION)) {
      fail(`CDP browser version mismatch: ${browserVersion}`);
    }
    log(`verified CDP startup: ${browserVersion}`);
  } finally {
    await stopProcess(child);
    rmSync(profileDir, {recursive: true, force: true});
  }
}

function printHelp() {
  console.log(`Usage: node scripts/chromium-core.mjs <command>

Commands:
  prepare       Check /Volumes/F, Xcode, SDK, and depot_tools.
  sync          Checkout Chromium ${TAG} at ${COMMIT} under /Volumes/F.
  patch         Apply the ChromePower native fingerprint patchset.
  verify-patchset
                Validate that the patchset is applied or cleanly applicable.
  build         Build Chromium arm64 from the checked out source.
  install-core  Copy Chromium.app into /Volumes/F/ChromePowerCore and write manifest.
  verify        Validate installed manifest/hash/version and CDP startup.
`);
}

try {
  if (command === 'prepare') {
    prepare();
  } else if (command === 'sync') {
    syncChromium();
  } else if (command === 'patch') {
    patchChromium();
  } else if (command === 'verify-patchset') {
    verifyPatchset();
  } else if (command === 'build') {
    buildChromium();
  } else if (command === 'install-core') {
    installCore();
  } else if (command === 'verify') {
    await verifyCore();
  } else {
    printHelp();
  }
} catch (error) {
  console.error(`[chromium-core] ${(error).message}`);
  process.exit(1);
}
