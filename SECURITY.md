# Security policy

## Reporting

When the repository becomes public, report vulnerabilities through GitHub private vulnerability reporting.
Do not open a public issue containing exploit details, credentials, private source material or production
data. Until a public security contact is selected, release readiness remains governed by the maintainers in
`GOVERNANCE.md`.

## Security boundaries

- Candidate code is untrusted and must execute only through a supported fail-closed sandbox.
- Unsupported platforms or missing sandbox executables are measurement invalidity; they never trigger an
  unsandboxed fallback.
- Candidate code cannot read Capsule sources, Claims, Requirements, Evaluators, cases, calibration labels or
  stored Runs.
- Network access is denied by default.
- Environment variables are allowlisted and exclude authentication, token, proxy and DSH configuration.
- Only synthetic fixtures are permitted in repository tests and examples.
- Runtime artifacts live outside the source repository and are persistent by default.

Historical DSH compatibility code has a larger trusted surface than `@domaineval/weave`; findings should state
which package boundary is affected.
