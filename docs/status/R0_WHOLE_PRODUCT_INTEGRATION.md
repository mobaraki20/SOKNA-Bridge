# R0 Whole-product Integration — Development Validation

Status: development integration checkpoint complete; the recorded local regression passed. This is **not** Windows exact-RC acceptance and does not authorize contact with the home PC.

## Integration invariants
- Runtime dependency order is ArtifactRoot -> Workspace/Grant -> Browser/Provider -> Component/Automation.
- Installer payload owns the full `runtime/v2.6.0` tree and separately builds the Browser and Artifact Provider runners at the paths expected by runtime discovery.
- Whole-product maintenance health requires ping/capabilities, owned runtime PID/version, ArtifactRoot, Workspace registry, Browser runner, Artifact Provider runner, and Component/Automation registry.
- Component acquisition/application crosses Artifact Provider verification and managed ArtifactRoot before install/activation.
- Scheduled/triggered automation creates a fresh job-bound P5 grant per run; submission failures restore the scheduler claim and completion revokes the grant/releases concurrency state.
- Support bundles include only redacted known runtime registries/transactions/audits; they do not include jobs, component payloads, or downloaded artifacts.
- Windows full-profile install acceptance now exercises the stronger whole-product health and verifies that core Workspace/Grant/Component/Automation state appears in the redacted support bundle.

## Evidence boundary
Local Linux can execute source/Node/Go regression and Windows Go cross-build. It cannot claim .NET publish, Inno compilation, PowerShell Windows runtime acceptance, or exact-RC Windows CI. Those remain later gates.

## Next gate
Freeze R1 as an exact source Release Candidate and make CI verify/build that exact commit. Home PC remains forbidden until exact-RC Windows CI passes.
