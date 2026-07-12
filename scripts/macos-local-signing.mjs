import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

const identityName = 'Chrome Power Local';
const keychain = path.join(homedir(), 'Library/Keychains/login.keychain-db');

let existingIdentity = '';
try {
  existingIdentity = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
} catch {
  existingIdentity = '';
}
if (existingIdentity.includes(`"${identityName}"`)) {
  console.log(`${identityName} already exists in the login Keychain.`);
  process.exit(0);
}

const workDir = mkdtempSync(path.join(tmpdir(), 'chrome-power-signing-'));
const configPath = path.join(workDir, 'openssl.cnf');
const keyPath = path.join(workDir, 'key.pem');
const certPath = path.join(workDir, 'certificate.pem');
const bundlePath = path.join(workDir, 'identity.p12');
const password = randomBytes(24).toString('hex');

writeFileSync(
  configPath,
  `[req]
prompt = no
distinguished_name = subject
x509_extensions = extensions

[subject]
CN = ${identityName}
O = Chrome Power Local Development

[extensions]
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
`,
  {mode: 0o600},
);

try {
  execFileSync(
    'openssl',
    [
      'req',
      '-new',
      '-newkey',
      'rsa:3072',
      '-x509',
      '-sha256',
      '-days',
      '3650',
      '-nodes',
      '-config',
      configPath,
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    {stdio: 'inherit'},
  );
  execFileSync('openssl', [
    'pkcs12',
    '-export',
    '-inkey',
    keyPath,
    '-in',
    certPath,
    '-name',
    identityName,
    '-passout',
    `pass:${password}`,
    '-out',
    bundlePath,
  ]);
  execFileSync(
    'security',
    [
      'import',
      bundlePath,
      '-k',
      keychain,
      '-P',
      password,
      '-T',
      '/usr/bin/codesign',
      '-T',
      '/usr/bin/security',
    ],
    {stdio: 'inherit'},
  );
  console.log(`${identityName} was created for stable local code signing.`);
} finally {
  rmSync(workDir, {recursive: true, force: true});
}
