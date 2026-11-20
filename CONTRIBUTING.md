# Contributing

Thanks for wanting to improve this config. Two rules up front:

1. **The checks are the contract.** Every check below passes before a change
   lands. A check you did not run is not a pass.
2. **The toolchain pins are exact.** The peer versions of oxlint, Ultracite,
   `@effect/tsgo` and `oxlint-tsgolint` are pinned, and a test compares the
   complete resolved config. A version bump or a rule change that moves any
   rule or severity fails that test until you update it on purpose.

## Set up

You need Node 26 or later, pnpm 12.6.0, Python 3.11 or later and
gitleaks 8.21.2.

```sh
pnpm install --frozen-lockfile
bash scripts/install-check-tools.sh
export PATH="$PWD/.tools:$PATH"
```

The second command installs the pinned gitleaks into `.tools/` on Linux
x86_64. On another platform, install gitleaks 8.21.2 on your PATH.

## Run the checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm publish:check
```

## Propose a change

1. Branch from `main`. Keep one concern per pull request.
2. Run every check above.
3. Open a pull request. Say what changed, why, and how you verified it. The
   commands you ran and their output are better than a description.

Commit messages use a conventional prefix (`feat:`, `fix:`, `docs:`, `ci:`,
`chore:`, `test:`) and a short imperative subject.

## How a pull request lands

This repository is an export of a canonical repository. No pull request is
merged here.

1. A maintainer takes your change into the canonical repository, with you as
   the author of the commit.
2. The change is reviewed there.
3. The change comes back to this repository in the next export commit.
4. The maintainer links your pull request to that commit and closes it.

A closed pull request with a link to a commit on `main` means the change
landed.

## Releases

A maintainer publishes releases. A published version is never overwritten.

## Security

Do not open a public issue for a suspected vulnerability. See
[SECURITY.md](SECURITY.md) for the private channel.

## License

Contributions are accepted under the MIT license. See [LICENSE](LICENSE).
