# Security policy

## Supported versions

This package is pre-1.0. Only the latest published version receives fixes.
There is no back-porting.

## Report a vulnerability

Report it in private through GitHub Security Advisories. Use "Report a
vulnerability" under the Security tab of the repository, or open this page:

<https://github.com/butshouldwe/oxlint-config/security/advisories/new>

Do not open a public issue for a suspected vulnerability.

Expect an acknowledgment within 7 days.

## Scope

In scope:

- the published package: `index.js`, `index.d.ts` and the package metadata;
- the scripts under `scripts/`: the package checks and the public source
  export.

Out of scope:

- oxlint, Ultracite, `@effect/tsgo` and every other dependency. Report those
  upstream.
- A lint rule that misses a case. That is a bug, not a vulnerability. Open a
  public issue.
