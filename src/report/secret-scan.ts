const FORBIDDEN_PATTERNS = [
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /device[_-]?code/i,
  /account[_-]?id/i,
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
