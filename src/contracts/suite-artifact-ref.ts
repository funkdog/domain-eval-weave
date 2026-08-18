const SUITE_ARTIFACT_PREFIX = "artifact://suite/";
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

declare const suiteArtifactRefBrand: unique symbol;

export type SuiteArtifactRef = string & { readonly [suiteArtifactRefBrand]: true };

export class SuiteArtifactReferenceError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "SuiteArtifactReferenceError";
  }
}

export function parseSuiteArtifactRef(input: unknown): SuiteArtifactRef {
  if (typeof input !== "string" || !input.startsWith(SUITE_ARTIFACT_PREFIX)) {
    throw new SuiteArtifactReferenceError("artifact ref must use the artifact://suite/ scheme");
  }
  const path = input.slice(SUITE_ARTIFACT_PREFIX.length);
  const segments = path.split("/");
  if (
    path.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment),
    )
  ) {
    throw new SuiteArtifactReferenceError("Suite artifact ref contains an unsafe path segment");
  }
  return input as SuiteArtifactRef;
}

export function suiteArtifactRefPath(ref: SuiteArtifactRef): string {
  return ref.slice(SUITE_ARTIFACT_PREFIX.length);
}
