import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

export const PHASE3C_EQUIVALENT_CANDIDATES = [
  "equivalent-typed-rejection",
  "equivalent-reason-variation",
  "equivalent-persistence-layout",
  "relaxation-malformed-refund-effect",
] as const;

const transformationSchema = z.enum([
  "typed_rejection",
  "reason_variation",
  "persistence_layout",
  "malformed_refund_effect",
]);
const manifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    candidates: z.array(
      z.strictObject({
        candidate_id: z.enum(PHASE3C_EQUIVALENT_CANDIDATES),
        transformations: z.array(transformationSchema).min(1),
      }),
    ),
  })
  .superRefine((value, context) => {
    const ids = value.candidates.map((entry) => entry.candidate_id);
    if (
      ids.length !== PHASE3C_EQUIVALENT_CANDIDATES.length ||
      ids.some((id, index) => id !== PHASE3C_EQUIVALENT_CANDIDATES[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "equivalent Candidate manifest must be complete and canonical",
      });
    }
  });

type Transformation = z.infer<typeof transformationSchema>;

function replaceUnique(source: string, search: string, replacement: string): string {
  const first = source.indexOf(search);
  if (first < 0 || first !== source.lastIndexOf(search)) {
    throw new Error("Phase 3C equivalent transformation lost its unique Gold anchor");
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

function replaceExactCount(
  source: string,
  search: string,
  replacement: string,
  expectedCount: number,
): string {
  if (source.split(search).length - 1 !== expectedCount) {
    throw new Error("Phase 3C equivalent transformation anchor count drifted");
  }
  return source.replaceAll(search, replacement);
}

function transform(source: string, transformation: Transformation): string {
  switch (transformation) {
    case "typed_rejection":
      return replaceUnique(
        replaceUnique(
          source,
          'throw new Error("order ownership mismatch");',
          'return { status: "rejected" };',
        ),
        'throw new Error("after-sales required");',
        'return { status: "rejected" };',
      );
    case "reason_variation":
      return replaceUnique(
        replaceUnique(
          replaceUnique(
            replaceUnique(source, '"carrier_handoff_committed"', '"handoff already committed"'),
            'reason: "cancellation committed"',
            'reason: "order transition committed"',
          ),
          'reason: "inventory compensated"',
          'reason: "inventory reservation released"',
        ),
        'reason: "paid cancellation requests refund"',
        'reason: "refund handoff requested for paid order"',
      );
    case "persistence_layout":
      return replaceExactCount(
        replaceUnique(source, "value.schemaVersion !== 2", "value.storageRevision !== 2"),
        "schemaVersion: 2,",
        "storageRevision: 2,",
        2,
      );
    case "malformed_refund_effect":
      return replaceUnique(
        source,
        "    ];\n    const events = facts.map((fact, offset) =>",
        [
          "    ];",
          "    if (refundRequested) {",
          "      facts.push({",
          '        type: "refund_requested",',
          '        outcome: "pending",',
          '        reason: "malformed duplicate without currency",',
          "        amount: refundAmount,",
          "      });",
          "    }",
          "    const events = facts.map((fact, offset) =>",
        ].join("\n"),
      );
  }
}

export async function materializePhase3cEquivalentCandidate(input: {
  readonly candidateId: (typeof PHASE3C_EQUIVALENT_CANDIDATES)[number];
  readonly packRoot: string;
  readonly scratchRoot: string;
}): Promise<string> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(`${input.packRoot}/calibration/equivalent-variants.json`, "utf8")),
  );
  const entry = manifest.candidates.find(
    (candidate) => candidate.candidate_id === input.candidateId,
  );
  if (entry === undefined) throw new Error("Phase 3C equivalent Candidate is absent from manifest");
  const candidateRoot = `${input.scratchRoot}/equivalents/${input.candidateId}`;
  await mkdir(`${input.scratchRoot}/equivalents`, { recursive: true, mode: 0o700 });
  await cp(`${input.packRoot}/calibration/gold-equivalent`, candidateRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  const sourcePath = `${candidateRoot}/src/order-service.ts`;
  let source = await readFile(sourcePath, "utf8");
  for (const transformation of entry.transformations) source = transform(source, transformation);
  await writeFile(sourcePath, source, "utf8");
  return candidateRoot;
}
