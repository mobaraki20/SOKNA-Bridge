# SOKNA Bridge — independent core contract

SOKNA Bridge is a general-purpose local automation, browser control and QA bridge.
It must function without SOKNA Cafe or any other application under test.

## Invariants

- Runtime, installer, browser tools and Native Host have no dependency on an application-specific repository, domain, port, database or service.
- Scenario recipes, site maps and authentication fixtures are optional external inputs; an example is never an installer default.
- An approved browser origin does not imply permission to click, type, submit, purchase or mutate data. Interaction requires explicit authorization for that run.
- Fresh installation registers no application repositories or credentials by default.
- Upgrades preserve user-controlled installation roots, configuration and permissions or fail with an actionable error; never silently reset them.
- Read-only operations cannot be upgraded to state-changing operations merely by a caller-supplied `mutating: false` flag.
- Commands are correlated, de-duplicated and auditable across retries and Native Host restarts. An unknown outcome is never reported as success.
- Every test result distinguishes source tests, isolated executable tests, Windows build, installed Windows UAT, browser integration and application-specific UAT.
- No CI push or PR qualification step may create releases, deploy, mutate production configuration or auto-merge.

## Separation

`native/`, `extension/`, `maintenance/`, `installer/`, and core `tools/` contain product-independent behavior.
Optional application examples belong in `examples/<app>/` and must not be loaded automatically.

## Current qualification gate

This development branch is **not a release candidate**. A successful GitHub Actions Windows job proves the source can build and its scoped tests pass on a runner. It does *not* prove installed upgrade, rollback, browser registration, printer hardware or operator UAT.

GitHub Actions must keep `permissions: contents: read` for qualification workflows. Merging into `release/r14-final`, tagging and publishing require separate explicit approval.
