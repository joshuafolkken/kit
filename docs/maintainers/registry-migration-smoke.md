# Smoke-testing the published npm migration

This page is how the published migration entry ([registry-migration.md](../registry-migration.md)) was
proven against fresh environments and throwaway copies of real consumers, and what that run recorded
(#7447). Back to the [maintainer index](./README.md).

## Procedure

`scripts/registry-migration/registry-migration-smoke.sh` runs every step under `env -i` with an
isolated HOME, XDG directories, npm cache and pnpm store, and `CI=1`. No user setting or token
reaches it. A consumer is cloned into the work directory and its remote is removed, so nothing is
written back to the source repository.

```bash
S=scripts/registry-migration/registry-migration-smoke.sh
W=$(mktemp -d)
bash $S entry $W <kit-version>                  # fetch the published tarball, check its sha512
bash $S copy $W <name> <consumer-repo> <ref>    # throwaway clone with no remote
printf '@joshuafolkken:registry=https://npm.pkg.github.com\n' > $W/home/.npmrc   # the user's old mapping, no token
bash $S hash $W <name>                          # sha256 of .npmrc, package.json, pnpm-lock.yaml
bash $S run $W <name> pnpm self-update 12.17.0  # only when the consumer pins another pnpm
bash $S run $W <name> node $W/entry/package/dist/registry-migrate.mjs <kit-version> --dry-run
bash $S run $W <name> node $W/entry/package/dist/registry-migrate.mjs <kit-version>
bash $S run $W <name> node $W/entry/package/dist/registry-migrate.mjs <kit-version>   # re-run: no diff
bash $S run $W <name> pnpm add -D @joshuafolkken/kit@<kit-version>
bash $S run $W <name> pnpm exec josh sync
bash $S run $W <name> pnpm install
bash $S run $W <name> pnpm check   # and the consumer's own test / build scripts
```

- `run` takes `pnpm` from `PATH`. A consumer whose `devEngines.packageManager.onFail` is `"error"`
  needs exactly the pinned pnpm there. Install it into the work directory
  (`npm install --prefix $W/pnpm pnpm@12.17.0 --userconfig=/dev/null`) and put
  `$W/pnpm/node_modules/.bin` first in `PATH` before calling the script.
- Compare `hash` output before and after each run. A stopped run must leave all three hashes as they
  were, and the re-run after a success must change nothing.
- Fresh environment: in an empty `git init` directory, run
  `bash $S run $W <name> pnpm --allow-build=esbuild dlx @joshuafolkken/kit@<kit-version> init`
  (README → Quick start B), then `josh sync` and `pnpm install`.
- The entry needs a version that is published and past the minimum release age. A candidate
  `pnpm pack` is not a substitute.

## Evidence (2026-11-17, kit 1.3164.0)

Consumers are anonymized; each is named by what it locked.

- Published entry: `https://registry.npmjs.org/@joshuafolkken/kit/-/kit-1.3164.0.tgz`, published
  2026-11-16T16:01Z, `latest`. Its sha512 matched the metadata
  (`sha512-W+CdNMpGhrmN//Uiyz8Q0Ti3mspYTdL/63li/EcnD/BkglnOWj5njvO7Fm1PXT+DOsHVD5w4mmUSm6mGGBRDIw==`).
  The first versions with the fixes from #7589 and #7684 stopped consumer B.
- Consumer B (SvelteKit app, kit `^1.1387.0` and app-kit `^0.126.0` from GitHub Packages through
  the user's mapping, pnpm 12.12.1, `onFail: "download"`, a custom `prepare:gh-packages`):
  - pnpm 12.12.1 → `Verified pnpm version: 12.17.0; actual: 12.12.1; no files changed`, exit 1,
    hashes unchanged.
  - After `pnpm self-update 12.17.0`: dry run `Planned: .npmrc, pnpm-lock.yaml`, exit 0, hashes
    unchanged. The real run `Changed: .npmrc, pnpm-lock.yaml`, exit 0. The re-run `Changed: none`,
    hashes unchanged.
  - `pnpm add -D @joshuafolkken/kit@1.3164.0`, `josh sync`, `pnpm install`, `pnpm check`
    (svelte-check 0 errors) and `pnpm build`: all exit 0. The consumer has no test script.
  - `pnpm config get @joshuafolkken:registry` → `https://registry.npmjs.org/`. No
    `npm.pkg.github.com` left in the lockfile. kit 1.3164.0 is locked with the integrity above. The
    transitive kit edge from app-kit resolves to the same version. The user's `~/.npmrc` is unchanged.
- Consumer B with another scope on GitHub Packages (`@other-scope:registry=https://npm.pkg.github.com`
  added to the project `.npmrc`): migration exit 0, and that mapping is kept beside the new npm mapping.
- Consumer B with a different artifact (the locked kit integrity replaced): dry run and real run
  `Artifact differs from locked bytes: @joshuafolkken/kit@1.1387.0`, exit 1, hashes unchanged.
- Consumer A (Cloudflare Workers app, kit 1.206.0 and app-kit 0.86.0, pnpm 11.25.0,
  `onFail: "error"`, a project `.npmrc` token line for GitHub Packages):
  - pnpm 11.25.0 → `ERR_PNPM_BAD_PM_VERSION`, exit 1, hashes unchanged.
  - With pnpm 12.17.0 → `@joshuafolkken/kit@1.206.0: Public npm request failed` and the same for
    app-kit 0.86.0 (missing versions), exit 1, hashes unchanged. It takes the
    [no-entry path](../registry-migration.md#when-the-entry-stops), confirmed in #7654.
- Fresh environment: `dlx @joshuafolkken/kit@1.3164.0 init`, `josh sync` and `pnpm install`:
  exit 0. The project `.npmrc` maps the scope to npm, and the lockfile has no GitHub URL. The project
  has no test or build script. With `minimumReleaseAge: 4320`, it resolves `^1.3092.0` to 1.3092.0.
  1.3164.0 was under three days old.

## Left for the consumer

These were not verified here:

- Builder settings: consumer A builds on Cloudflare Workers Builds, and its project `.npmrc`
  still reads `${NODE_AUTH_TOKEN}`. The builder's variables could not be read from here, so removing
  `NODE_AUTH_TOKEN` there is unverified. Follow
  [Work left after the migration](../registry-migration.md#work-left-after-the-migration).
- Custom CI: consumer A's `ci.yml` and `dast.yml`, and consumer B's `dast.yml` and `load.yml`,
  still pass `registry-url: https://npm.pkg.github.com` to `actions/setup-node`. `josh sync` leaves
  those workflows alone. They need the same remove-or-keep decision.
- Custom `prepare`: `josh sync` keeps consumer B's own `prepare:gh-packages`. kit 1.3164.0 still
  ships `scripts/gh/fix-gh-packages.ts`, so it does not fail: run without `CI` it exits 0 and changes
  nothing. Removing it stays the consumer's step.
