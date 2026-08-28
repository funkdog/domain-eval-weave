import type { EvaluationRun, LoadedCapsule, ReleasedCapsule } from "@domaineval/weave/capsule";
import { evaluateObservedCandidate } from "@domaineval/weave/evaluator";
import {
  buildHarnessExperimentReport,
  type HarnessExperimentReport,
} from "@domaineval/weave/harness";
import { parseTddTaskEntry, projectTddMechanism } from "./tdd.js";

type TddTask = Parameters<typeof projectTddMechanism>[0]["task"];
type TddEvent = Parameters<typeof projectTddMechanism>[0]["events"][number];

export interface DshCostEvidence {
  readonly elapsed_ms: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}

function costDelta(control: number | null, treatment: number | null): number | null {
  return control === null || treatment === null ? null : treatment - control;
}

export interface DshHarnessProjection {
  readonly report: HarnessExperimentReport;
  readonly mechanism: {
    readonly control: ReturnType<typeof projectTddMechanism>;
    readonly treatment: ReturnType<typeof projectTddMechanism>;
  };
}

export function projectDshTddHarnessExperiment(input: {
  readonly experimentId: string;
  readonly task: TddTask;
  readonly control: EvaluationRun;
  readonly treatment: EvaluationRun;
  readonly controlEvents: readonly TddEvent[];
  readonly treatmentEvents: readonly TddEvent[];
  readonly controlCost: DshCostEvidence;
  readonly treatmentCost: DshCostEvidence;
}): DshHarnessProjection {
  const task = parseTddTaskEntry(input.task);
  const controlMechanism = projectTddMechanism({
    task,
    arm: "control",
    events: input.controlEvents,
  });
  const treatmentMechanism = projectTddMechanism({
    task,
    arm: "treatment",
    events: input.treatmentEvents,
  });
  const validity =
    controlMechanism.validity === "invalid" || treatmentMechanism.validity === "invalid"
      ? "invalid"
      : controlMechanism.validity === "insufficient" ||
          treatmentMechanism.validity === "insufficient"
        ? "insufficient"
        : "valid";
  return {
    report: buildHarnessExperimentReport({
      experimentId: input.experimentId,
      control: input.control,
      treatment: input.treatment,
      intervention: {
        intervention_id: "mattpocock-tdd",
        control: "disabled",
        treatment: "enabled",
      },
      activation: treatmentMechanism.activation,
      mechanismValidity: validity,
      costDelta: {
        elapsed_ms: costDelta(input.controlCost.elapsed_ms, input.treatmentCost.elapsed_ms),
        input_tokens: costDelta(input.controlCost.input_tokens, input.treatmentCost.input_tokens),
        output_tokens: costDelta(
          input.controlCost.output_tokens,
          input.treatmentCost.output_tokens,
        ),
      },
    }),
    mechanism: { control: controlMechanism, treatment: treatmentMechanism },
  };
}

interface ObservedDshArm {
  readonly candidateId: string;
  readonly candidateSha256: string;
  readonly observation: unknown;
  readonly events: readonly TddEvent[];
  readonly cost: DshCostEvidence;
}

export async function evaluateAndProjectDshTddHarnessExperiment(input: {
  readonly experimentId: string;
  readonly capsule: LoadedCapsule;
  readonly release: ReleasedCapsule;
  readonly requirementId: string;
  readonly evaluatorRef: string;
  readonly task: TddTask;
  readonly control: ObservedDshArm;
  readonly treatment: ObservedDshArm;
}): Promise<
  DshHarnessProjection & {
    readonly controlRun: EvaluationRun;
    readonly treatmentRun: EvaluationRun;
  }
> {
  const [control, treatment] = await Promise.all(
    [input.control, input.treatment].map((arm) =>
      evaluateObservedCandidate({
        capsule: input.capsule,
        release: input.release,
        evaluatorRef: input.evaluatorRef,
        requirementId: input.requirementId,
        candidateId: arm.candidateId,
        candidateSha256: arm.candidateSha256,
        observation: arm.observation,
      }),
    ),
  );
  if (control === undefined || treatment === undefined) {
    throw new Error("DSH Harness experiment requires exactly two observed arms");
  }
  return {
    ...projectDshTddHarnessExperiment({
      experimentId: input.experimentId,
      task: input.task,
      control: control.run,
      treatment: treatment.run,
      controlEvents: input.control.events,
      treatmentEvents: input.treatment.events,
      controlCost: input.control.cost,
      treatmentCost: input.treatment.cost,
    }),
    controlRun: control.run,
    treatmentRun: treatment.run,
  };
}
