import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { parse } from "yaml";
import type { z } from "zod";

import { canonicalJsonDigest, sha256Hex } from "../canonical-json.js";
import {
  type DomainLandscape,
  type DomainModule,
  domainLandscapeSchema,
  domainModuleSchema,
  type SourceIndex,
  sourceIndexSchema,
} from "./contracts.js";
import { DomainCompilerError } from "./errors.js";

export type DomainSource = SourceIndex["sources"][number];
type Source = DomainSource;
type AuthorityAssertion = DomainModule["claims"][number]["authority_assertions"][number];
type Evolution = NonNullable<DomainModule["evolutions"]>[number];

export interface CompiledSourceSnapshot {
  readonly sourceId: string;
  readonly kind: Source["kind"];
  readonly title: string;
  readonly path: string;
  readonly contentSha256: string;
  readonly recordedAt: string;
  readonly license: string;
  readonly provenance: string;
  readonly authorityScopes: readonly string[];
}

export interface CompiledDomainClaim {
  readonly claimRef: string;
  readonly statement: string;
  readonly subjectRef: string;
  readonly kind: DomainModule["claims"][number]["kind"];
  readonly epistemicState: DomainModule["claims"][number]["epistemic_state"];
  readonly observability: DomainModule["claims"][number]["observability"];
  readonly authorityKinds: readonly AuthorityAssertion["kind"][];
  readonly sourceIds: readonly string[];
  readonly authorityAssertions: readonly {
    readonly authorityId: string;
    readonly kind: AuthorityAssertion["kind"];
    readonly sourceId: string;
    readonly scope: string;
  }[];
  readonly applicability: DomainModule["claims"][number]["applicability"];
  readonly validTime: DomainModule["claims"][number]["valid_time"];
  readonly recordedAt: string;
  readonly conflictsWith: readonly string[];
}

export interface CompiledDomainEvolution {
  readonly evolutionRef: string;
  readonly kind: Evolution["kind"];
  readonly predecessorRef: string;
  readonly successorRefs: readonly string[];
  readonly sourceIds: readonly string[];
  readonly recordedAt: string;
  readonly affectedMappingIds: readonly string[];
  readonly affectedLandscapeIds: readonly string[];
}

export interface CompiledDomainModule {
  readonly moduleId: string;
  readonly model?: DomainModule["model"];
  readonly modelDocuments?: readonly {
    readonly documentId: string;
    readonly title: string;
    readonly content: string;
    readonly contentSha256: string;
  }[];
  readonly version: string;
  readonly contentSha256: string;
  readonly recordedAt: string;
  readonly maintainerIds: readonly string[];
  readonly scope: DomainModule["scope"];
  readonly concepts: readonly {
    readonly conceptRef: string;
    readonly kind: string;
    readonly definition: string;
  }[];
  readonly relations: readonly {
    readonly relationRef: string;
    readonly subjectRef: string;
    readonly predicate: string;
    readonly objectRef: string;
  }[];
}

export interface CompiledDomainMapping {
  readonly mappingId: string;
  readonly version: string;
  readonly fromRef: string;
  readonly relation: DomainLandscape["mappings"][number]["relation"];
  readonly toRef: string;
  readonly scope: string;
  readonly required: boolean;
  readonly reviewerIds: readonly string[];
}

export interface CompiledDomainLandscape {
  readonly landscapeId: string;
  readonly version: string;
  readonly digest: string;
  readonly moduleReleaseCount: number;
  readonly mappingCount: number;
  readonly sourceSnapshotCount: number;
  readonly sourceDigests: Readonly<Record<string, string>>;
  readonly sourceSnapshots: readonly CompiledSourceSnapshot[];
  readonly moduleReleaseDigests: Readonly<Record<string, string>>;
  readonly modules: readonly CompiledDomainModule[];
  readonly mappings: readonly CompiledDomainMapping[];
  readonly authorityKinds: readonly string[];
  readonly claims: readonly CompiledDomainClaim[];
  readonly evolutions: readonly CompiledDomainEvolution[];
}

const SOURCE_AUTHORITY: Readonly<Record<Source["kind"], AuthorityAssertion["kind"]>> = {
  implementation_artifact: "implementation_maintainer",
  industry_guidance: "industry_expert",
  industry_standard: "industry_standard",
  provider_contract: "service_provider",
  product_policy: "product_owner",
  internal_contract: "internal_finance_owner",
  network_rules: "payment_network",
  regulation: "regulator",
};

interface LoadedYaml<T> {
  readonly value: T;
  readonly raw: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePhysicalDirectory(path: string, code: string): Promise<void> {
  return lstat(path)
    .then((entry) => {
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new DomainCompilerError(code, "expected one physical directory", path);
      }
    })
    .catch((error: unknown) => {
      if (error instanceof DomainCompilerError) throw error;
      throw new DomainCompilerError(code, "cannot read directory", path);
    });
}

async function resolvePhysicalFile(root: string, relativePath: string): Promise<string> {
  const candidate = resolve(root, relativePath);
  const displacement = relative(root, candidate);
  if (
    displacement === "" ||
    displacement === ".." ||
    displacement.startsWith("../") ||
    isAbsolute(displacement)
  ) {
    throw new DomainCompilerError(
      "path_outside_landscape",
      "path escapes Landscape root",
      relativePath,
    );
  }

  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(candidate);
  } catch {
    throw new DomainCompilerError(
      "artifact_not_found",
      "referenced artifact does not exist",
      relativePath,
    );
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new DomainCompilerError(
      "artifact_not_physical_file",
      "referenced artifact must be one physical file",
      relativePath,
    );
  }

  const physical = await realpath(candidate);
  const physicalDisplacement = relative(root, physical);
  if (
    physicalDisplacement === "" ||
    physicalDisplacement === ".." ||
    physicalDisplacement.startsWith("../") ||
    isAbsolute(physicalDisplacement)
  ) {
    throw new DomainCompilerError(
      "path_outside_landscape",
      "physical path escapes Landscape root",
      relativePath,
    );
  }
  return physical;
}

export async function readDomainYaml<T extends z.ZodType>(
  root: string,
  relativePath: string,
  schema: T,
  invalidCode: string,
  preflight?: (raw: unknown) => void,
): Promise<LoadedYaml<z.infer<T>>> {
  const path = await resolvePhysicalFile(root, relativePath);
  let raw: unknown;
  try {
    raw = parse(await readFile(path, "utf8"));
  } catch {
    throw new DomainCompilerError("invalid_yaml", "artifact is not valid YAML", relativePath);
  }
  preflight?.(raw);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new DomainCompilerError(
      invalidCode,
      result.error.issues[0]?.message ?? "invalid artifact",
      relativePath,
    );
  }
  return { value: result.data, raw };
}

export async function resolveDomainRoot(inputRoot: string): Promise<string> {
  await requirePhysicalDirectory(inputRoot, "invalid_landscape_root");
  return realpath(inputRoot);
}

function preflightLandscape(raw: unknown): void {
  if (!isRecord(raw) || !Array.isArray(raw.module_releases)) return;
  for (const release of raw.module_releases) {
    if (
      isRecord(release) &&
      typeof release.version === "string" &&
      release.version.toLowerCase() === "latest"
    ) {
      throw new DomainCompilerError(
        "floating_release_reference",
        "Landscape references must pin exact Module Releases",
        typeof release.module_id === "string" ? release.module_id : undefined,
      );
    }
  }
}

function preflightModule(raw: unknown, locator: string): void {
  if (!isRecord(raw) || !Array.isArray(raw.claims)) return;
  for (const claim of raw.claims) {
    if (!isRecord(claim)) continue;
    for (const axis of ["kind", "epistemic_state", "observability"] as const) {
      if (!(axis in claim)) {
        throw new DomainCompilerError(
          "claim_axes_incomplete",
          `Claim must declare independent ${axis} axis`,
          `${locator}#${String(claim.claim_id ?? "unknown-claim")}`,
        );
      }
    }
  }
}

export function validateSourceAuthority(
  assertion: { readonly kind: string; readonly source_id: string; readonly scope: string },
  sourcesById: ReadonlyMap<string, Source>,
  unknownCode: string,
  locator: string,
): void {
  const source = sourcesById.get(assertion.source_id);
  if (source === undefined) {
    throw new DomainCompilerError(
      unknownCode,
      "Authority assertion references an unknown source",
      locator,
    );
  }
  if (SOURCE_AUTHORITY[source.kind] !== assertion.kind) {
    throw new DomainCompilerError(
      "authority_scope_mismatch",
      `Source kind ${source.kind} cannot establish ${assertion.kind} authority`,
      locator,
    );
  }
  if (!source.authority_scopes.includes(assertion.scope)) {
    throw new DomainCompilerError(
      "authority_scope_mismatch",
      "Authority assertion scope is not granted by its evidence source",
      locator,
    );
  }
}

function conceptReference(moduleId: string, localReference: string): string {
  return `${moduleId}#${localReference}`;
}

function splitConceptReference(reference: string): readonly [string, string] | undefined {
  const separator = reference.indexOf("#");
  if (
    separator <= 0 ||
    separator === reference.length - 1 ||
    reference.indexOf("#", separator + 1) >= 0
  ) {
    return undefined;
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

function sortedRecord(
  entries: readonly (readonly [string, string])[],
): Readonly<Record<string, string>> {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

async function validateSourceSnapshots(
  root: string,
  sourceIndex: SourceIndex,
): Promise<ReadonlyMap<string, Source>> {
  const sourcesById = new Map(sourceIndex.sources.map((source) => [source.source_id, source]));
  for (const source of sourceIndex.sources) {
    const path = await resolvePhysicalFile(root, `sources/${source.path}`);
    const actualDigest = sha256Hex(await readFile(path));
    if (actualDigest !== source.content_sha256) {
      throw new DomainCompilerError(
        "source_content_digest_mismatch",
        "Source snapshot bytes do not match the indexed digest",
        source.source_id,
      );
    }
  }
  return sourcesById;
}

function validateModuleReferences(module: DomainModule): void {
  const conceptIds = new Set(module.concepts.map((concept) => concept.concept_id));
  const claimIds = new Set(module.claims.map((claim) => claim.claim_id));
  if (module.model) {
    const model = module.model;
    const references = model.structures
      .flatMap((structure) => [
        structure.concept_ref,
        ...(structure.owner_ref ? [structure.owner_ref] : []),
      ])
      .concat(model.flows.flatMap((flow) => flow.concept_refs));
    const unknownConcept = references.find((reference) => !conceptIds.has(reference));
    const states = new Set(model.states.map((state) => state.state_id));
    const unknownState = model.transitions
      .flatMap((transition) => [transition.from, transition.to])
      .find((state) => !states.has(state));
    if (unknownConcept || unknownState) {
      throw new DomainCompilerError(
        "unknown_model_reference",
        "Structured model references an unknown Concept or state",
        `${module.module_id}#${unknownConcept ?? unknownState}`,
      );
    }
  }
  for (const relation of module.relations) {
    if (!conceptIds.has(relation.subject_ref) || !conceptIds.has(relation.object_ref)) {
      throw new DomainCompilerError(
        "unknown_concept_reference",
        "Module relation references an unknown local Concept",
        `${module.module_id}#${relation.relation_id}`,
      );
    }
  }
  for (const claim of module.claims) {
    if (!conceptIds.has(claim.subject_ref)) {
      throw new DomainCompilerError(
        "unknown_concept_reference",
        "Claim references an unknown local Concept",
        `${module.module_id}#${claim.claim_id}`,
      );
    }
    for (const conflict of claim.conflicts_with ?? []) {
      if (!claimIds.has(conflict)) {
        throw new DomainCompilerError(
          "unknown_claim_reference",
          "Claim conflict references an unknown local Claim",
          `${module.module_id}#${claim.claim_id}`,
        );
      }
    }
  }
  for (const evolution of module.evolutions ?? []) {
    if (
      !conceptIds.has(evolution.predecessor_ref) ||
      evolution.successor_refs.some((reference) => !conceptIds.has(reference)) ||
      evolution.successor_refs.includes(evolution.predecessor_ref)
    ) {
      throw new DomainCompilerError(
        "unknown_evolution_concept_reference",
        "Evolution must bind distinct local predecessor and successor Concepts",
        `${module.module_id}#${evolution.evolution_id}`,
      );
    }
    if (evolution.kind === "split" && evolution.successor_refs.length < 2) {
      throw new DomainCompilerError(
        "invalid_evolution_lineage",
        "A split must retain at least two successor Concepts",
        `${module.module_id}#${evolution.evolution_id}`,
      );
    }
  }
}

function validateClaimSources(
  module: DomainModule,
  sourcesById: ReadonlyMap<string, Source>,
  referencedSourceIds: Set<string>,
  authorityKinds: Set<string>,
): void {
  for (const sourceId of module.model?.source_ids ?? []) {
    const source = sourcesById.get(sourceId);
    if (!source) {
      throw new DomainCompilerError(
        "unknown_source_reference",
        "Structured model references an unknown source",
        sourceId,
      );
    }
    if (Date.parse(source.recorded_at) > Date.parse(module.release.recorded_at)) {
      throw new DomainCompilerError(
        "source_recorded_after_release",
        "Model Release cannot predate its source snapshot",
        sourceId,
      );
    }
    referencedSourceIds.add(sourceId);
  }
  for (const claim of module.claims) {
    const locator = `${module.module_id}#${claim.claim_id}`;
    const validFrom = Date.parse(claim.valid_time.from);
    const validTo = claim.valid_time.to === undefined ? undefined : Date.parse(claim.valid_time.to);
    if (validTo !== undefined && validTo <= validFrom) {
      throw new DomainCompilerError(
        "invalid_claim_valid_time",
        "Claim valid-time end must be after its start",
        locator,
      );
    }
    const claimRecordedAt = Date.parse(claim.recorded_at);
    if (claimRecordedAt > Date.parse(module.release.recorded_at)) {
      throw new DomainCompilerError(
        "claim_recorded_after_release",
        "Module Release cannot predate a contained Claim",
        locator,
      );
    }
    if (
      claim.source_ids.length === 0 &&
      !(claim.kind === "hypothesis" && claim.epistemic_state === "unknown")
    ) {
      throw new DomainCompilerError(
        "claim_source_required",
        "Only an explicitly unknown hypothesis may omit sources",
        locator,
      );
    }
    for (const sourceId of claim.source_ids) {
      const source = sourcesById.get(sourceId);
      if (source === undefined) {
        throw new DomainCompilerError(
          "unknown_source_reference",
          "Claim references an unknown source",
          locator,
        );
      }
      if (Date.parse(source.recorded_at) > claimRecordedAt) {
        throw new DomainCompilerError(
          "claim_precedes_source_evidence",
          "Claim cannot be recorded before its evidence source",
          locator,
        );
      }
      referencedSourceIds.add(sourceId);
    }
    for (const assertion of claim.authority_assertions) {
      validateSourceAuthority(
        assertion,
        sourcesById,
        "unknown_authority_source_reference",
        locator,
      );
      if (!claim.source_ids.includes(assertion.source_id)) {
        throw new DomainCompilerError(
          "authority_source_not_claim_evidence",
          "Authority evidence must also be bound to the Claim",
          locator,
        );
      }
      referencedSourceIds.add(assertion.source_id);
      authorityKinds.add(assertion.kind);
    }
  }
  for (const evolution of module.evolutions ?? []) {
    const locator = `${module.module_id}#${evolution.evolution_id}`;
    const evolutionRecordedAt = Date.parse(evolution.recorded_at);
    if (evolutionRecordedAt > Date.parse(module.release.recorded_at)) {
      throw new DomainCompilerError(
        "evolution_recorded_after_release",
        "Module Release cannot predate a contained evolution",
        locator,
      );
    }
    for (const sourceId of evolution.source_ids) {
      const source = sourcesById.get(sourceId);
      if (source === undefined) {
        throw new DomainCompilerError(
          "unknown_source_reference",
          "Evolution references an unknown provenance source",
          locator,
        );
      }
      if (Date.parse(source.recorded_at) > evolutionRecordedAt) {
        throw new DomainCompilerError(
          "evolution_precedes_source_evidence",
          "Evolution cannot be recorded before its provenance source",
          locator,
        );
      }
      referencedSourceIds.add(sourceId);
    }
  }
}

function validateMappings(
  landscape: DomainLandscape,
  conceptRefs: ReadonlySet<string>,
  modules: readonly DomainModule[],
): void {
  const maintainersByModule = new Map(
    modules.map((module) => [
      module.module_id,
      new Set(module.maintainers.map((maintainer) => maintainer.maintainer_id)),
    ]),
  );
  for (const mapping of landscape.mappings) {
    for (const [side, reference] of [
      ["from", mapping.from_ref],
      ["to", mapping.to_ref],
    ] as const) {
      if (splitConceptReference(reference) === undefined || !conceptRefs.has(reference)) {
        throw new DomainCompilerError(
          mapping.required ? "unresolved_required_mapping" : "unknown_mapping_reference",
          `${side} side of Mapping references an unknown Concept`,
          mapping.mapping_id,
        );
      }
    }
    const from = splitConceptReference(mapping.from_ref);
    const to = splitConceptReference(mapping.to_ref);
    if (from === undefined || to === undefined) continue;
    const fromMaintainers = maintainersByModule.get(from[0]);
    const toMaintainers = maintainersByModule.get(to[0]);
    if (
      fromMaintainers === undefined ||
      toMaintainers === undefined ||
      !mapping.reviewers.some((reviewer) => fromMaintainers.has(reviewer)) ||
      !mapping.reviewers.some((reviewer) => toMaintainers.has(reviewer))
    ) {
      throw new DomainCompilerError(
        "mapping_reviewer_scope_mismatch",
        "Mapping must be reviewed by an owner from each endpoint Module",
        mapping.mapping_id,
      );
    }
  }
}

function compileEvolutions(
  landscape: DomainLandscape,
  modules: readonly DomainModule[],
): readonly CompiledDomainEvolution[] {
  const evolutions: CompiledDomainEvolution[] = [];
  for (const module of modules) {
    for (const evolution of module.evolutions ?? []) {
      const evolvedConceptRefs = new Set([
        conceptReference(module.module_id, evolution.predecessor_ref),
        ...evolution.successor_refs.map((reference) =>
          conceptReference(module.module_id, reference),
        ),
      ]);
      const derivedMappingIds = landscape.mappings
        .filter(
          (mapping) =>
            evolvedConceptRefs.has(mapping.from_ref) || evolvedConceptRefs.has(mapping.to_ref),
        )
        .map((mapping) => mapping.mapping_id)
        .sort();
      const declaredMappingIds = [...evolution.impact.affected_mapping_ids].sort();
      const derivedLandscapeIds = [landscape.landscape_id];
      const declaredLandscapeIds = [...evolution.impact.affected_landscape_ids].sort();
      if (
        canonicalJsonDigest(derivedMappingIds) !== canonicalJsonDigest(declaredMappingIds) ||
        canonicalJsonDigest(derivedLandscapeIds) !== canonicalJsonDigest(declaredLandscapeIds)
      ) {
        throw new DomainCompilerError(
          "evolution_impact_mismatch",
          "Evolution impact report must equal the mechanically derived affected set",
          `${module.module_id}#${evolution.evolution_id}`,
        );
      }
      evolutions.push({
        evolutionRef: `${module.module_id}#${evolution.evolution_id}`,
        kind: evolution.kind,
        predecessorRef: conceptReference(module.module_id, evolution.predecessor_ref),
        successorRefs: evolution.successor_refs.map((reference) =>
          conceptReference(module.module_id, reference),
        ),
        sourceIds: [...evolution.source_ids],
        recordedAt: evolution.recorded_at,
        affectedMappingIds: derivedMappingIds,
        affectedLandscapeIds: derivedLandscapeIds,
      });
    }
  }
  return evolutions.sort((left, right) => left.evolutionRef.localeCompare(right.evolutionRef));
}

export async function compileDomainLandscapeDirectory(
  inputRoot: string,
): Promise<CompiledDomainLandscape> {
  const root = await resolveDomainRoot(inputRoot);

  const [{ value: landscape, raw: rawLandscape }, { value: sourceIndex }] = await Promise.all([
    readDomainYaml(
      root,
      "landscape.yaml",
      domainLandscapeSchema,
      "invalid_domain_landscape",
      preflightLandscape,
    ),
    readDomainYaml(root, "sources/index.yaml", sourceIndexSchema, "invalid_source_index"),
  ]);
  const sourcesById = await validateSourceSnapshots(root, sourceIndex);

  const modules: DomainModule[] = [];
  const modelDocuments = new Map<string, NonNullable<CompiledDomainModule["modelDocuments"]>>();
  const moduleIds = new Set<string>();
  const moduleReleaseDigests = new Map<string, string>();

  for (const release of landscape.module_releases) {
    const loaded = await readDomainYaml(
      root,
      release.path,
      domainModuleSchema,
      "invalid_domain_module",
      (raw) => preflightModule(raw, release.module_id),
    );
    const actualDigest = canonicalJsonDigest(loaded.raw);
    if (actualDigest !== release.content_sha256) {
      throw new DomainCompilerError(
        "module_content_digest_mismatch",
        "Module content does not match the Landscape release pin",
        release.module_id,
      );
    }
    if (
      loaded.value.module_id !== release.module_id ||
      loaded.value.release.version !== release.version ||
      moduleIds.has(release.module_id)
    ) {
      throw new DomainCompilerError(
        "module_identity_mismatch",
        "Module identity or exact version does not match the Landscape reference",
        release.module_id,
      );
    }
    moduleIds.add(release.module_id);
    modules.push(loaded.value);
    moduleReleaseDigests.set(release.module_id, actualDigest);
    if (loaded.value.model) {
      const documents: NonNullable<CompiledDomainModule["modelDocuments"]>[number][] = [];
      for (const document of loaded.value.model.documents) {
        const path = await resolvePhysicalFile(root, document.path);
        const bytes = await readFile(path);
        if (sha256Hex(bytes) !== document.content_sha256) {
          throw new DomainCompilerError(
            "model_document_digest_mismatch",
            "Model document bytes differ from the pinned digest",
            document.document_id,
          );
        }
        documents.push({
          documentId: document.document_id,
          title: document.title,
          content: bytes.toString("utf8"),
          contentSha256: document.content_sha256,
        });
      }
      modelDocuments.set(release.module_id, documents);
    }
  }

  const referencedSourceIds = new Set<string>();
  const authorityKinds = new Set<string>();
  const conceptRefs = new Set<string>();
  const claims: CompiledDomainClaim[] = [];
  for (const module of modules) {
    validateModuleReferences(module);
    validateClaimSources(module, sourcesById, referencedSourceIds, authorityKinds);
    for (const concept of module.concepts) {
      const reference = conceptReference(module.module_id, concept.concept_id);
      if (conceptRefs.has(reference)) {
        throw new DomainCompilerError(
          "concept_identity_collision",
          "Concept identity collision",
          reference,
        );
      }
      conceptRefs.add(reference);
    }
    for (const claim of module.claims) {
      claims.push({
        claimRef: `${module.module_id}#${claim.claim_id}`,
        statement: claim.statement,
        subjectRef: conceptReference(module.module_id, claim.subject_ref),
        kind: claim.kind,
        epistemicState: claim.epistemic_state,
        observability: claim.observability,
        authorityKinds: claim.authority_assertions.map((assertion) => assertion.kind).sort(),
        sourceIds: [...claim.source_ids],
        authorityAssertions: claim.authority_assertions.map((assertion) => ({
          authorityId: assertion.authority_id,
          kind: assertion.kind,
          sourceId: assertion.source_id,
          scope: assertion.scope,
        })),
        applicability: claim.applicability,
        validTime: claim.valid_time,
        recordedAt: claim.recorded_at,
        conflictsWith: [...(claim.conflicts_with ?? [])],
      });
    }
  }
  validateMappings(landscape, conceptRefs, modules);
  const evolutions = compileEvolutions(landscape, modules);

  const sourceSnapshots = [...referencedSourceIds]
    .map((sourceId) => {
      const source = sourcesById.get(sourceId);
      if (source === undefined) {
        throw new DomainCompilerError(
          "unknown_source_reference",
          "Unknown referenced source",
          sourceId,
        );
      }
      return source;
    })
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  const sourceDigests = sortedRecord(
    sourceSnapshots.map((source) => [source.source_id, source.content_sha256] as const),
  );
  const compiledModuleDigests = sortedRecord([...moduleReleaseDigests.entries()]);
  const compiledSourceSnapshots: readonly CompiledSourceSnapshot[] = sourceSnapshots.map(
    (source) => ({
      sourceId: source.source_id,
      kind: source.kind,
      title: source.title,
      path: source.path,
      contentSha256: source.content_sha256,
      recordedAt: source.recorded_at,
      license: source.license,
      provenance: source.provenance,
      authorityScopes: [...source.authority_scopes],
    }),
  );
  const digest = canonicalJsonDigest({
    landscape: rawLandscape,
    moduleReleaseDigests: compiledModuleDigests,
    sourceSnapshots: compiledSourceSnapshots,
  });
  const compiledModules: readonly CompiledDomainModule[] = modules
    .map((module) => {
      const contentSha256 = moduleReleaseDigests.get(module.module_id);
      const documents = modelDocuments.get(module.module_id);
      if (module.model !== undefined && documents === undefined) {
        throw new DomainCompilerError(
          "compiler_invariant_violation",
          "Validated model documents are unavailable",
          module.module_id,
        );
      }
      if (contentSha256 === undefined) {
        throw new DomainCompilerError(
          "compiler_invariant_violation",
          "Validated Module digest is unavailable",
          module.module_id,
        );
      }
      return {
        moduleId: module.module_id,
        ...(documents === undefined ? {} : { model: module.model, modelDocuments: documents }),
        version: module.release.version,
        contentSha256,
        recordedAt: module.release.recorded_at,
        maintainerIds: module.maintainers.map((maintainer) => maintainer.maintainer_id),
        scope: module.scope,
        concepts: module.concepts.map((concept) => ({
          conceptRef: conceptReference(module.module_id, concept.concept_id),
          kind: concept.kind,
          definition: concept.definition,
        })),
        relations: module.relations.map((relation) => ({
          relationRef: `${module.module_id}#${relation.relation_id}`,
          subjectRef: conceptReference(module.module_id, relation.subject_ref),
          predicate: relation.predicate,
          objectRef: conceptReference(module.module_id, relation.object_ref),
        })),
      };
    })
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  const compiledMappings: readonly CompiledDomainMapping[] = landscape.mappings
    .map((mapping) => ({
      mappingId: mapping.mapping_id,
      version: mapping.version,
      fromRef: mapping.from_ref,
      relation: mapping.relation,
      toRef: mapping.to_ref,
      scope: mapping.scope,
      required: mapping.required,
      reviewerIds: [...mapping.reviewers],
    }))
    .sort((left, right) => left.mappingId.localeCompare(right.mappingId));

  return {
    landscapeId: landscape.landscape_id,
    version: landscape.release.version,
    digest,
    moduleReleaseCount: modules.length,
    mappingCount: landscape.mappings.length,
    sourceSnapshotCount: sourceSnapshots.length,
    sourceDigests,
    sourceSnapshots: compiledSourceSnapshots,
    moduleReleaseDigests: compiledModuleDigests,
    modules: compiledModules,
    mappings: compiledMappings,
    authorityKinds: [...authorityKinds].sort(),
    claims: claims.sort((left, right) => left.claimRef.localeCompare(right.claimRef)),
    evolutions,
  };
}
