export interface DoctorCheck {
  readonly id: string;
  run(): Promise<void>;
}

export interface DoctorCheckResult {
  readonly id: string;
  readonly status: "pass" | "fail";
  readonly code?: "DOCTOR_CHECK_FAILED";
}

export interface DoctorReport {
  readonly schema_version: 1;
  readonly ready: boolean;
  readonly checks: readonly DoctorCheckResult[];
}

export async function runDoctor(checks: readonly DoctorCheck[]): Promise<DoctorReport> {
  const results: DoctorCheckResult[] = [];
  for (const check of checks) {
    try {
      await check.run();
      results.push({ id: check.id, status: "pass" });
    } catch {
      results.push({ id: check.id, status: "fail", code: "DOCTOR_CHECK_FAILED" });
    }
  }
  return {
    schema_version: 1,
    ready: results.every((result) => result.status === "pass"),
    checks: results,
  };
}
