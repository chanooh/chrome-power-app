import {safeStorage} from 'electron';

const MASK = '******';

export const hasSensitiveVariables = (variables?: Record<string, string>) =>
  !!variables && Object.values(variables).some(value => value !== undefined && value !== null && value !== '');

export const maskSensitiveVariables = (variables?: Record<string, string>) => {
  if (!variables) return {};
  return Object.fromEntries(Object.keys(variables).map(key => [key, MASK]));
};

export const encryptSensitiveVariables = (variables?: Record<string, string>) => {
  if (!hasSensitiveVariables(variables)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is unavailable. Sensitive RPA variables cannot be saved.');
  }
  return safeStorage.encryptString(JSON.stringify(variables)).toString('base64');
};

export const decryptSensitiveVariables = (encrypted?: string | null): Record<string, string> => {
  if (!encrypted) return {};
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is unavailable. Sensitive RPA variables cannot be read.');
  }
  const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  const parsed = JSON.parse(decrypted);
  return parsed && typeof parsed === 'object' ? parsed : {};
};

export const mergeVariables = (...sources: Array<Record<string, string> | undefined>) => {
  const result: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null) {
        result[key] = String(value);
      }
    }
  }
  return result;
};

export const resolveVariablePath = (
  expression: string | undefined,
  variables: Record<string, string>,
) => {
  if (!expression) return undefined;
  if (!expression.includes('.')) return variables[expression];
  return variables[expression] ?? variables[expression.replace(/^profile\.meta\./, 'profile.')];
};

export const renderTemplateValue = (
  value: string | undefined,
  variables: Record<string, string>,
) => {
  if (!value) return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    return resolveVariablePath(key, variables) ?? '';
  });
};
