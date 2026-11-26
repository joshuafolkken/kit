# Prepare the npm install path before updating

This entry does not load the existing kit; it migrates only the project's `.npmrc` and lockfile.
It does not change the user's `~/.npmrc`, authentication settings or the installed kit.

## Migration order

An existing project that installs `@joshuafolkken` from GitHub Packages follows these steps in order, before it updates kit: kit no longer publishes new versions to GitHub Packages, so such a project receives no newer kit until it installs from npm.
A new setup needs no migration ([README → Quick start](../README.md#quick-start)).

1. Check before installing: run `pnpm config get "@joshuafolkken:registry"` at the project root.
   The project is in scope when it points at `https://npm.pkg.github.com`. A setting in the user's `~/.npmrc` also shows up in this value.
2. Get the entry ([Distribution and boundaries](#distribution-and-boundaries)) and run it with `--dry-run` to see the files it would change, or the failing name@version and the reason.
3. Once the dry run passes, run it for real with the same version. On failure it changes no files; fix the cause and re-run the same command.
4. Install the target kit from npm and run that kit's sync.

   ```sh
   pnpm add -D @joshuafolkken/kit@<target-version>
   pnpm exec josh sync
   pnpm install
   ```

5. Check without authentication: `pnpm config get "@joshuafolkken:registry"` returns `https://registry.npmjs.org/`, and no `npm.pkg.github.com` remains in `pnpm-lock.yaml`.

In a project that already has a kit containing this entry, `pnpm josh version --upgrade` runs the step 3 entry first and then adds the kit from npm ([package-api.md → Version-command library](./package-api.md#version-command-library-joshuafolkkenkitversion)). Then run step 4's `josh sync` and `pnpm install`.

The global CLI installs from npm without changing `~/.npmrc` ([cli.md](./cli.md#1-install-globally)).

### Work left after the migration

- The project's `.npmrc` gets `@joshuafolkken:registry=https://registry.npmjs.org/`. Commit it; it holds no secrets.
- The user's `~/.npmrc` is not changed. Keep the `@joshuafolkken` GitHub mapping and token line while other projects still install from GitHub Packages; remove them yourself once they are no longer needed.
- A project that installs other scopes from GitHub Packages keeps that scope's mapping and authentication ([authentication.md](./authentication.md)).
- Remove `NODE_AUTH_TOKEN`, `npm_config_//npm.pkg.github.com/:_authToken` and `PNPM_CONFIG_NPMRC_AUTH_FILE` set on builders such as Cloudflare Workers Builds, Vercel, Netlify or Docker unless another dependency still comes from GitHub Packages; keep them if one does ([authentication.md §4](./authentication.md#4-build-platforms-with-no-user-level-npmrc)).
- kit's CI templates install from npm. If your own CI added authentication steps for GitHub Packages, remove or keep them by the same rule.

### Out of scope

- Deleting the versions already in GitHub Packages is not part of this migration: existing installs from GitHub keep working at the last version published there. Publishing new versions there has stopped (#7492); new versions go to npm only.
- The published entry (kit 1.3164.0) was run through isolated copies of real consumers and a fresh project, up to install, check and build ([maintainers/registry-migration-smoke.md](./maintainers/registry-migration-smoke.md), #7447).
- Migrating without the entry is only for projects that meet the conditions in [When the entry stops](#when-the-entry-stops).

## When the entry stops

The entry stops before changing anything in these cases ([Verified conditions](#verified-conditions)).

- pnpm version mismatch: the project pins a pnpm other than 12.23.0 (`ERR_PNPM_BAD_PM_VERSION` and similar).
- Missing version: a locked kit, app-kit or similar is not on npm. The oldest versions on npm are kit 1.872.0 and app-kit 0.98.0.

In these cases, skip the entry: move up to versions that are on npm, and let pnpm write their new lockfile entries (step 4).
The old lockfile's integrity is not carried over. Never disable checksums or rewrite integrity.

This assumes every `@joshuafolkken` package in the lockfile is on npm. A project that depends on a package not on npm (`npm view <name> --registry https://registry.npmjs.org/` returns 404) cannot migrate with these steps either.

1. Edit `packageManager` and `devEngines.packageManager` in `package.json` by hand to the same pnpm 12.23.0 pin as kit's `package.json`. Check that `pnpm --version` returns `12.23.0`.
2. Point the project's `.npmrc` at npm and remove the GitHub Packages token line.

   ```sh
   pnpm config set --location project "@joshuafolkken:registry" https://registry.npmjs.org/
   pnpm config delete --location project "//npm.pkg.github.com/:_authToken"
   ```

3. Remove any project script that calls `fix-gh-packages`. It only repairs GitHub Packages lockfile entries, so an npm-sourced kit does not need it, and `josh sync` leaves a project's own script such as `prepare:gh-packages` in place. If `prepare` calls it, remove that call too.

   ```sh
   pnpm pkg delete 'scripts["prepare:gh-packages"]'
   ```

4. Check the latest version on npm with `pnpm view @joshuafolkken/kit version`, and upgrade the kit and app-kit you depend on directly from npm. `--ignore-scripts` keeps `prepare` from running before the sync.

   Keep `pnpm-lock.yaml`: `pnpm add` replaces the kit and app-kit entries, tarball URL and integrity included, and leaves every other dependency at its locked version.

   ```sh
   pnpm add -D @joshuafolkken/kit@<kit-version> @joshuafolkken/app-kit@<app-kit-version> --ignore-scripts
   pnpm exec josh sync
   pnpm install
   ```

5. Run the same check as step 5 of [Migration order](#migration-order): `pnpm config get "@joshuafolkken:registry"` returns `https://registry.npmjs.org/`, and no `npm.pkg.github.com` remains in `pnpm-lock.yaml`.

If `npm.pkg.github.com` remains in `pnpm-lock.yaml`, find which package it belongs to.
A line for another scope you still install from GitHub Packages is expected and stays.

For an `@joshuafolkken` line, check that the project `.npmrc` maps the scope to npm (step 2) and that the package is on npm.
Then delete `pnpm-lock.yaml` and repeat step 4. Do not edit the lockfile by hand.

```sh
rm pnpm-lock.yaml
```

The rebuilt lockfile also moves other dependencies to the newest versions their ranges allow.
Run the project's own checks afterwards and fix what moved.

[Work left after the migration](#work-left-after-the-migration) is the same on this path.
These steps were confirmed on isolated copies of consumers that locked kit 1.206.0 and 1.340.0 (#7654).

On a kit 1.206.0 copy, keeping the lockfile left no GitHub URL and the checks passed.
Rebuilding it moved svelte to a newer minor, and the type check failed (#8736).

## Distribution and boundaries

`package/dist/registry-migrate.mjs` in the published kit tarball is a standalone entry that bundles its dependencies.
It fetches the tarball named by npm's public metadata directly over HTTPS, checks the download against the metadata's sha512, and then extracts this file.
The metadata is queried at `https://registry.npmjs.org/@joshuafolkken%2fkit/<published-entry-version>`.

The download goes directly through Node's standard fetch or similar, not through an npm/pnpm install command that reads user settings.
To verify a local candidate, extract it from the `pnpm pack` tarball with `tar -xzf <archive> package/dist/registry-migrate.mjs` and run it in a directory without kit.

Because no package manager installs the entry, neither the project's nor the user's scope mapping takes part in getting it.
`pnpm dlx --registry` alone is not treated as able to override the scope mapping.

Fetching the published entry this way is proven in [maintainers/registry-migration-smoke.md](./maintainers/registry-migration-smoke.md).
No finished fetch procedure that names an unpublished version is provided.

Run the fetched and verified entry at the root of the project to migrate.
`<target-version>` is the full version number of the kit to install from npm.

```sh
node /path/to/registry-migrate.mjs <target-version> --dry-run
node /path/to/registry-migrate.mjs <target-version>
```

With no arguments or an unknown flag, it prints usage, changes no files and exits with code 1. `--help` prints only the usage.

After a successful migration, install the target kit from npm with ordinary pnpm commands and run that kit's `josh sync` (step 4 of [Migration order](#migration-order)).

The entry itself does not update kit, run a fresh init or sync.
The existing `josh init` bootstrap and the retired `registry:migrate` are unchanged.
In a project moved to npm, `josh sync` removes `fix-gh-packages` from the `prepare` kit wrote ([sync.md](./sync.md#what-does-not-get-synced)).

## Verified conditions

- Verified with pnpm 12.23.0. Any other version stops before changing files.
- Every same-scope name@version in the lockfile, direct and transitive, is checked against the target kit's npm publication data and the actual artifacts.
- Each artifact's sha512 is checked against both the npm metadata and the old lockfile. An artifact whose bytes differ under the same version is rejected. Compression or content differences are never approved automatically; the real artifacts from both sources need independent verification.
- When investigating a difference, record both tarballs' sha512 and compare, before extraction, the paths, types, modes and link targets and each file's content hash.
- Such an investigation checks the manifest, dependencies and executable code in particular. It is never tied to the entry automatically replacing the old integrity.
- The entry also stops when the old lockfile has no integrity. It never disables checksums or replaces integrity unconditionally.
- It runs `pnpm update --patches --lockfile-only --ignore-scripts --ignore-pnpmfile` in a temporary copy. The old kit's hooks are not run. A project that needs its own hooks stops when the dependency graph changes.
- The actual artifacts are verified again after re-resolution. It also stops when the dependency graph or other scopes' metadata changes, or when a GitHub tarball remains.
- On success it applies the project settings and lockfile. An exception while applying rolls them back. When a concurrent change is detected, nothing is applied. Atomicity across several files is not guaranteed through a forced process kill or power loss.
- The dry run performs the same verification and prints the files it would change, or the failing name@version and the reason.

Re-resolution uses [pnpm update's registry revision update](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/cli/update.md#--patches).
`--force` and `--fix-lockfile` are not treated as resolving integrity problems.
pnpm's lockfile-only update does not download tarballs, so the entry's own check of the actual artifacts is needed.
