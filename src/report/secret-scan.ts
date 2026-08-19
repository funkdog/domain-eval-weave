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

export function assertSecretFreeText(text: string): void {
  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new SecretScanError("artifact text matched a forbidden credential or OAuth pattern");
  }
}
