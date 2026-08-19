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

const ASSIGNMENT_KEY_PATTERN = /^(?:export\s+)?["']?([A-Za-z_$][A-Za-z0-9_$.-]{0,255})["']?\s*=/;

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
  return segment.split(".").some((component) => isCredentialKey(component));
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

function skipHorizontalWhitespace(text: string, start: number): number {
  let cursor = start;
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  return cursor;
}

function readQuotedYamlKey(
  text: string,
  start: number,
): { key?: string; cursor: number; ambiguous?: true } | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return undefined;
  let cursor = start + 1;
  while (cursor < text.length) {
    if (quote === '"' && text[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (text[cursor] !== quote) {
      cursor += 1;
      continue;
    }
    if (quote === "'" && text[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }
    const encoded = text.slice(start, cursor + 1);
    let key: string;
    if (quote === '"') {
      try {
        key = JSON.parse(encoded);
      } catch {
        return { cursor: cursor + 1, ambiguous: true };
      }
    } else {
      key = encoded.slice(1, -1).replaceAll("''", "'");
    }
    return { key, cursor: cursor + 1 };
  }
  return undefined;
}

type YamlMappingKey = { key: string } | { ambiguous: true };

function hasMappingColonBeforeBoundary(text: string, start: number): boolean {
  let cursor = start;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === ":") return true;
    if (
      character === "\n" ||
      character === "\r" ||
      character === "," ||
      character === "}" ||
      character === "]"
    ) {
      return false;
    }
    cursor += 1;
  }
  return false;
}

function readYamlMappingKeyAt(text: string, start: number): YamlMappingKey | undefined {
  let cursor = skipHorizontalWhitespace(text, start);
  if (
    (text[cursor] === "-" || text[cursor] === "?") &&
    (text[cursor + 1] === " " || text[cursor + 1] === "\t")
  ) {
    cursor = skipHorizontalWhitespace(text, cursor + 1);
  }

  if (text[cursor] === '"' || text[cursor] === "'") {
    const quoted = readQuotedYamlKey(text, cursor);
    if (quoted === undefined) {
      return hasMappingColonBeforeBoundary(text, cursor + 1) ? { ambiguous: true } : undefined;
    }
    cursor = skipHorizontalWhitespace(text, quoted.cursor);
    if (text[cursor] !== ":") return undefined;
    return quoted.ambiguous === true || quoted.key === undefined
      ? { ambiguous: true }
      : { key: quoted.key };
  }

  const keyStart = cursor;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === ":") {
      const key = text.slice(keyStart, cursor).trim();
      return key.length > 0 ? { key } : undefined;
    }
    if (
      character === "\n" ||
      character === "\r" ||
      character === "," ||
      character === "{" ||
      character === "}" ||
      character === "[" ||
      character === "]"
    ) {
      return undefined;
    }
    cursor += 1;
  }
  return undefined;
}

function containsYamlCredentialKey(text: string): boolean {
  const candidateOffsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n" || text[index] === "{" || text[index] === "[" || text[index] === ",") {
      candidateOffsets.push(index + 1);
    }
  }
  return candidateOffsets.some((offset) => {
    const candidate = readYamlMappingKeyAt(text, offset);
    return candidate !== undefined && ("ambiguous" in candidate || isCredentialKey(candidate.key));
  });
}

function containsStructuredCredentialKey(text: string): boolean {
  if (containsYamlCredentialKey(text)) return true;
  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT_KEY_PATTERN.exec(line.trim());
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
