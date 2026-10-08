const ARTIFACT_PREFIX = "artifact://campaign/";
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

declare const artifactRefBrand: unique symbol;

export type ArtifactRef = string & { readonly [artifactRefBrand]: true };

export class ArtifactReferenceError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactReferenceError";
  }
}

export function parseArtifactRef(input: unknown): ArtifactRef {
  if (typeof input !== "string" || !input.startsWith(ARTIFACT_PREFIX)) {
    throw new ArtifactReferenceError("artifact ref must use the artifact://campaign/ scheme");
  }

  const path = input.slice(ARTIFACT_PREFIX.length);
  const segments = path.split("/");
  if (
    path.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".." || !SAFE_SEGMENT.test(segment),
    )
  ) {
    throw new ArtifactReferenceError("artifact ref contains an unsafe path segment");
  }

  return input as ArtifactRef;
}

export function artifactRefPath(ref: ArtifactRef): string {
  return ref.slice(ARTIFACT_PREFIX.length);
}
