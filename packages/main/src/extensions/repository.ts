import {createHash} from 'crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import {basename, dirname, extname, join, relative, resolve, sep} from 'path';
import {tmpdir} from 'os';
import extract from 'extract-zip';
import type {DB} from '../../../shared/types/db';
import type {
  ExtensionImportResult,
  ExtensionManifestInfo,
  ExtensionVerificationResult,
} from '../../../shared/types/extension';
import {ensureProfileCachePath, getSettings} from '../utils/get-settings';

type ExtensionManifest = {
  name?: string;
  version?: string;
  manifest_version?: number;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  update_url?: string;
};

const IGNORED_HASH_ENTRIES = new Set(['.DS_Store']);
const SAFE_UID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const getExtensionRepositoryRoot = (profileCachePath = getSettings().profileCachePath) =>
  join(profileCachePath, 'extensions');

export const getExtensionRepositoryPath = (
  extensionUid: string,
  profileCachePath = getSettings().profileCachePath,
) => {
  if (!SAFE_UID_PATTERN.test(extensionUid)) {
    throw new Error(`Invalid extension uid: ${extensionUid}`);
  }
  const root = resolve(getExtensionRepositoryRoot(profileCachePath));
  const repoPath = resolve(root, extensionUid);
  if (repoPath === root || !repoPath.startsWith(`${root}${sep}`)) {
    throw new Error(`Extension path escapes repository root: ${extensionUid}`);
  }
  return repoPath;
};

export const getExtensionCurrentPath = (
  extensionUid: string,
  profileCachePath = getSettings().profileCachePath,
) => join(getExtensionRepositoryPath(extensionUid, profileCachePath), 'current');

export const createExtensionUid = (existingId?: number) =>
  existingId ? `extension-${existingId}` : `extension-${Date.now()}`;

const walkFiles = (root: string): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root, {withFileTypes: true}).flatMap(entry => {
    const fullPath = join(root, entry.name);
    if (entry.isSymbolicLink()) return [];
    if (entry.isDirectory()) return walkFiles(fullPath);
    if (!entry.isFile() || IGNORED_HASH_ENTRIES.has(entry.name)) return [];
    return [fullPath];
  });
};

export const computeExtensionDirectorySha256 = (root: string) => {
  const hash = createHash('sha256');
  const files = walkFiles(root).sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
  for (const file of files) {
    const relativePath = relative(root, file);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
};

const findManifestPath = (root: string) => {
  const direct = join(root, 'manifest.json');
  if (existsSync(direct)) return direct;
  const candidates = walkFiles(root).filter(file => basename(file) === 'manifest.json');
  if (candidates.length !== 1) {
    throw new Error('Extension package must contain exactly one manifest.json.');
  }
  return candidates[0];
};

const normalizeExtractedRoot = (sourceRoot: string, targetRoot: string) => {
  const manifestPath = findManifestPath(sourceRoot);
  const extensionRoot = dirname(manifestPath);
  cpSync(extensionRoot, targetRoot, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
};

const readManifest = (extensionRoot: string): ExtensionManifest => {
  const manifestPath = join(extensionRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Extension manifest.json is missing.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ExtensionManifest;
  if (!manifest.name || !manifest.version || !manifest.manifest_version) {
    throw new Error('Extension manifest must include name, version, and manifest_version.');
  }
  return manifest;
};

const manifestInfo = (manifest: ExtensionManifest, updateUrlRemoved: boolean): ExtensionManifestInfo => ({
  name: manifest.name!,
  version: manifest.version!,
  manifest_version: manifest.manifest_version!,
  description: manifest.description,
  permissions: manifest.permissions || [],
  host_permissions: manifest.host_permissions || [],
  update_url_removed: updateUrlRemoved,
});

const readAndSanitizeManifest = (extensionRoot: string): {
  manifest: ExtensionManifest;
  info: ExtensionManifestInfo;
} => {
  const manifestPath = join(extensionRoot, 'manifest.json');
  const manifest = readManifest(extensionRoot);
  const updateUrlRemoved = typeof manifest.update_url === 'string';
  if (updateUrlRemoved) {
    delete manifest.update_url;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return {
    manifest,
    info: manifestInfo(manifest, updateUrlRemoved),
  };
};

const prepareSource = async (sourcePath: string, tempRoot: string) => {
  if (!existsSync(sourcePath)) {
    throw new Error(`Extension source does not exist: ${sourcePath}`);
  }
  const sourceStat = lstatSync(sourcePath);
  const extractedRoot = join(tempRoot, 'source');
  mkdirSync(extractedRoot, {recursive: true});

  if (sourceStat.isDirectory()) {
    cpSync(sourcePath, extractedRoot, {recursive: true, force: true});
    return 'directory' as const;
  }

  if (sourceStat.isFile() && extname(sourcePath).toLowerCase() === '.zip') {
    await extract(sourcePath, {dir: extractedRoot});
    return 'zip' as const;
  }

  throw new Error('Only .zip files and extension directories are supported.');
};

export const importExtensionToRepository = async (
  sourcePath: string,
  existingExtension?: DB.Extension,
): Promise<ExtensionImportResult & {extension: Partial<DB.Extension>}> => {
  const settings = getSettings();
  ensureProfileCachePath(settings.profileCachePath);
  const repositoryRoot = getExtensionRepositoryRoot(settings.profileCachePath);
  mkdirSync(repositoryRoot, {recursive: true});

  const extensionUid = existingExtension?.extension_uid || createExtensionUid(existingExtension?.id);
  const repositoryPath = getExtensionRepositoryPath(extensionUid, settings.profileCachePath);
  const currentPath = getExtensionCurrentPath(extensionUid, settings.profileCachePath);
  const tempRoot = mkdtempSync(join(tmpdir(), 'chrome-power-extension-import-'));
  const normalizedRoot = join(tempRoot, 'normalized');
  const nextPath = join(repositoryPath, 'next');

  try {
    const sourceType = await prepareSource(sourcePath, tempRoot);
    mkdirSync(normalizedRoot, {recursive: true});
    normalizeExtractedRoot(join(tempRoot, 'source'), normalizedRoot);
    const {info} = readAndSanitizeManifest(normalizedRoot);
    const sha256 = computeExtensionDirectorySha256(normalizedRoot);

    rmSync(nextPath, {recursive: true, force: true});
    mkdirSync(repositoryPath, {recursive: true});
    cpSync(normalizedRoot, nextPath, {recursive: true, force: true});
    rmSync(currentPath, {recursive: true, force: true});
    renameSync(nextPath, currentPath);

    const extension: Partial<DB.Extension> = {
      extension_uid: extensionUid,
      source_type: sourceType,
      manifest_version: info.manifest_version,
      sha256,
      permissions: JSON.stringify(info.permissions),
      host_permissions: JSON.stringify(info.host_permissions),
      repository_path: repositoryPath,
      current_path: currentPath,
      update_url_removed: info.update_url_removed,
      path: currentPath,
      name: existingExtension?.name || info.name,
      version: info.version,
      description: existingExtension?.description || info.description,
    };

    return {
      success: true,
      message: 'Extension imported successfully.',
      extensionId: existingExtension?.id,
      path: currentPath,
      currentPath,
      repositoryPath,
      version: info.version,
      sha256,
      manifest: info,
      extension,
    };
  } catch (error) {
    rmSync(nextPath, {recursive: true, force: true});
    return {
      success: false,
      error: (error as Error).message,
      message: (error as Error).message,
      extension: {},
    };
  } finally {
    rmSync(tempRoot, {recursive: true, force: true});
  }
};

export const verifyExtensionRepository = (
  extension: DB.Extension,
): ExtensionVerificationResult => {
  const extensionId = extension.id || 0;
  const path = extension.current_path || extension.path;
  if (!path || !existsSync(path)) {
    return {
      success: false,
      extensionId,
      message: 'Extension current path does not exist.',
      path,
      expectedSha256: extension.sha256,
    };
  }
  if (!statSync(path).isDirectory()) {
    return {
      success: false,
      extensionId,
      message: 'Extension current path is not a directory.',
      path,
      expectedSha256: extension.sha256,
    };
  }

  try {
    const manifest = readManifest(path);
    const updateUrlPresent = typeof manifest.update_url === 'string';
    const info = manifestInfo(manifest, !updateUrlPresent && !!extension.update_url_removed);
    const actualSha256 = computeExtensionDirectorySha256(path);
    const hashMatches = !extension.sha256 || actualSha256 === extension.sha256;
    return {
      success: hashMatches && !updateUrlPresent,
      extensionId,
      message: updateUrlPresent
        ? 'Extension manifest still contains update_url.'
        : hashMatches
          ? 'Extension verified successfully.'
          : 'Extension hash mismatch.',
      path,
      expectedSha256: extension.sha256,
      actualSha256,
      manifest: info,
      updateUrlPresent,
    };
  } catch (error) {
    return {
      success: false,
      extensionId,
      message: (error as Error).message,
      path,
      expectedSha256: extension.sha256,
    };
  }
};

export const parseExtensionJsonArray = (value?: string[] | string | null): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
