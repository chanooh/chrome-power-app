import {existsSync, mkdirSync, writeFileSync} from 'fs';
import {join, resolve, sep} from 'path';
import {ensureProfileCachePath, getSettings} from '../utils/get-settings';

const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

const assertSafeSegment = (name: string, value: string) => {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
};

export const getRpaArtifactRoot = (profileCachePath = getSettings().profileCachePath) => {
  ensureProfileCachePath(profileCachePath);
  const root = join(profileCachePath, 'rpa', 'runs');
  mkdirSync(root, {recursive: true, mode: 0o700});
  return root;
};

export const getRpaRunRoot = (runId: number, profileCachePath = getSettings().profileCachePath) => {
  assertSafeSegment('run id', String(runId));
  const root = resolve(getRpaArtifactRoot(profileCachePath));
  const runRoot = resolve(root, String(runId));
  if (!runRoot.startsWith(`${root}${sep}`)) {
    throw new Error(`RPA run path escapes artifact root: ${runId}`);
  }
  mkdirSync(runRoot, {recursive: true, mode: 0o700});
  return runRoot;
};

export const getRpaProfileArtifactDir = (
  runId: number,
  profileId: string,
  profileCachePath = getSettings().profileCachePath,
) => {
  assertSafeSegment('profile id', profileId);
  const runRoot = resolve(getRpaRunRoot(runId, profileCachePath));
  const profileDir = resolve(runRoot, profileId);
  if (!profileDir.startsWith(`${runRoot}${sep}`)) {
    throw new Error(`RPA profile artifact path escapes run root: ${profileId}`);
  }
  mkdirSync(profileDir, {recursive: true, mode: 0o700});
  return profileDir;
};

export const resolveRpaArtifactPath = (artifactDir: string, fileName: string) => {
  assertSafeSegment('artifact file name', fileName);
  const root = resolve(artifactDir);
  const filePath = resolve(root, fileName);
  if (!filePath.startsWith(`${root}${sep}`)) {
    throw new Error(`RPA artifact path escapes profile artifact root: ${fileName}`);
  }
  return filePath;
};

export const writeRpaJsonArtifact = (
  artifactDir: string,
  fileName: string,
  payload: unknown,
) => {
  if (!existsSync(artifactDir)) {
    mkdirSync(artifactDir, {recursive: true, mode: 0o700});
  }
  const filePath = resolveRpaArtifactPath(artifactDir, fileName);
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return filePath;
};
