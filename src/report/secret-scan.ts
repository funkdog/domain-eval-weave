const CREDENTIAL_IDENTIFIER_PATTERN =
  /(?:^|[^a-z0-9])(?:auth(?:orization)?|api|oauth(?:2)?|access|refresh|id|session|security|bearer|client|consumer|private|secret)[._\s-]*(?:token|key|secret|password|passphrase|verifier|code)(?=[^a-z0-9]|$)/i;

const PROVIDER_INDEPENDENT_CREDENTIAL_TERMINALS = new Set([
  "token",
  "secret",
  "password",
  "passphrase",
  "verifier",
]);

const CONTEXTUAL_CREDENTIAL_TERMINALS = new Set(["key", "code"]);

const CREDENTIAL_CONTEXT_TOKENS = new Set([
  "access",
  "api",
  "auth",
  "authentication",
  "authorization",
  "authn",
  "authz",
  "bearer",
  "client",
  "consumer",
  "credential",
  "credentials",
  "oauth",
  "private",
  "refresh",
  "secret",
  "security",
  "session",
]);

const STRUCTURED_KEY_PATTERN =
  /^(?:[-?]\s*)?(?:export\s+)?["']?([A-Za-z_$][A-Za-z0-9_$.-]{0,255})["']?\s*[:=]/;

const FORBIDDEN_PATTERNS = [
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /id[_-]?token/i,
  /oauth(?:2)?[_-]?token(?:[_-]?secret)?/i,
  /oauth[_-]?verifier/i,
  /consumer[_-]?(?:key|secret)/i,
  /authorization[_-]?code/i,
  /(?:session|security|bearer)[_-]?token/i,
  /device[_-]?code/i,
  /account[_-]?id/i,
  /client[_-]?secret/i,
  /api[_-]?key/i,
  /secret[_-]?access[_-]?key/i,
  /access[_-]?key[_-]?id/i,
  /(?:password|passwd|passphrase)\s*["']?\s*[:=]/i,
  /private[_-]?key/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\.openai-codex-auth\.json/i,
  /https?:\/\/[^\s]*oauth/i,
  /authorization:\s*bearer/i,
];

export class SecretScanError extends Error {
  readonly code = "SECRET_PATTERN_DETECTED";
}

function identifierTokens(identifier: string): string[] {
  return identifier
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

export function isCredentialKey(identifier: string): boolean {
  const tokens = identifierTokens(identifier);
  const terminal = tokens.at(-1);
  if (terminal === undefined) return false;
  if (PROVIDER_INDEPENDENT_CREDENTIAL_TERMINALS.has(terminal)) return true;
  if (!CONTEXTUAL_CREDENTIAL_TERMINALS.has(terminal)) return false;
  return tokens.slice(0, -1).some((token) => CREDENTIAL_CONTEXT_TOKENS.has(token));
}

export function isCredentialPathSegment(segment: string): boolean {
  let identifier = segment;
  while (true) {
    const separator = identifier.lastIndexOf(".");
    if (separator <= 0) break;
    const suffixTokens = identifierTokens(identifier.slice(separator + 1));
    if (
      suffixTokens.length !== 1 ||
      PROVIDER_INDEPENDENT_CREDENTIAL_TERMINALS.has(suffixTokens[0] ?? "") ||
      CONTEXTUAL_CREDENTIAL_TERMINALS.has(suffixTokens[0] ?? "")
    ) {
      break;
    }
    identifier = identifier.slice(0, separator);
  }
  return isCredentialKey(identifier);
}

function containsCredentialJsonKey(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }

  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    for (const [key, nested] of Object.entries(current)) {
      if (isCredentialKey(key)) return true;
      pending.push(nested);
    }
  }
  return false;
}

function containsStructuredCredentialKey(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const match = STRUCTURED_KEY_PATTERN.exec(line.trim());
    if (match?.[1] !== undefined && isCredentialKey(match[1])) return true;
  }
  return false;
}

export function containsCredentialIdentifier(text: string): boolean {
  if (CREDENTIAL_IDENTIFIER_PATTERN.test(text)) return true;
  const normalizedIdentifiers = text
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return (
    CREDENTIAL_IDENTIFIER_PATTERN.test(normalizedIdentifiers) ||
    containsCredentialJsonKey(text) ||
    containsStructuredCredentialKey(text)
  );
}

export function assertSecretFreeText(text: string): void {
  if (
    containsCredentialIdentifier(text) ||
    FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    throw new SecretScanError("artifact text matched a forbidden credential or OAuth pattern");
  }
}
