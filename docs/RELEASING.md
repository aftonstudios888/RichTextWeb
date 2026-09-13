# Release verification and registry recovery

The release pipeline publishes the exact npm tarball attached to a versioned GitHub release. It checks the release's SHA-256 manifest, installs that tarball in consumer projects, publishes with provenance, and compares the public registry's SHA-512 integrity and downloaded bytes. An npm command reporting success is not sufficient evidence that consumers can install the version.

Public metadata and tarball verification retry temporary HTTP 404, 429, 5xx, network, timeout, and interrupted download failures within one five-minute budget. Each request has a ten-second timeout and each backoff wait is at most thirty seconds. Authentication failures, malformed metadata, and immutable integrity mismatches fail immediately. The preparation step treats a missing public version as absent without waiting.

## Diagnose a missing version

First check the public version with `npm view @wieslawsoltes/richtextweb@<version> dist --json`. After the bounded verification window, a maintainer can inspect staged versions with `npm stage list @wieslawsoltes/richtextweb --json` in an authenticated npm session. These queries do not publish, approve, reject, or delete a version. A token that cannot inspect staged packages produces an unknown stage status, not an empty list. npm's OIDC publishing tokens cannot run stage inspection commands.

Distinguish these outcomes:

| Evidence                                                        | Next action                                                                                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Public metadata and tarball match the release                   | The version is available. Rerun the failed npm publication job; it will verify the existing version and skip publishing.            |
| An authenticated query finds the exact staged package           | A maintainer should inspect it and complete npm's staged-package approval with 2FA. Then rerun the failed npm publication job.      |
| Public version is missing and authenticated stage list is empty | Publication is unresolved. Preserve the logs and contact npm support; do not claim that a staged package is available for approval. |
| Stage inspection fails or authentication is unavailable         | A maintainer must inspect the package's staged versions using an authenticated npm session.                                         |
| Published metadata or bytes differ from the release             | Stop. Do not replace the release assets or overwrite the version. Investigate the collision.                                        |

The error `Cannot publish over previously staged version` alone does not prove that a maintainer can approve a stage. npm has an open registry issue reporting a successful ordinary publish followed by public 404, this conflict, and an empty stage list. Never approve or reject an unrelated stage, change package access policies, or repeatedly attempt to overwrite a version as a recovery measure.

References: [npm staged publishing](https://docs.npmjs.com/staged-publishing/), [npm stage command and authentication](https://docs.npmjs.com/cli/v11/commands/npm-stage/), [npm registry issue 9889](https://github.com/npm/cli/issues/9889).
