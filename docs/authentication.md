# Authenticate with GitHub Packages

`@joshuafolkken/kit` is published to GitHub Packages, which requires authentication **even for public packages**. Both [cli.md](./cli.md) (the global `josh` CLI) and [package.md](./package.md) (using the kit as a project dependency) link here for this one-time setup.

## 1. Get a token from the `gh` CLI

The token comes from the [gh CLI](https://cli.github.com/). If you haven't already:

```bash
gh auth login --scopes read:packages
```

Persist `NODE_AUTH_TOKEN` so every shell session picks up a fresh token automatically. The following snippet is idempotent — re-running it does not duplicate the line:

```bash
LINE='export NODE_AUTH_TOKEN=$(gh auth token)'
grep -qxF "$LINE" ~/.zshrc 2>/dev/null || echo "$LINE" >> ~/.zshrc
exec $SHELL
```

Single quotes around `$LINE` keep `$(gh auth token)` literal, so the token is re-evaluated on each shell startup and gh's rotation is picked up automatically.

> Using bash instead of zsh? Swap `~/.zshrc` for `~/.bashrc`.

## 2. Put the credential in `~/.npmrc`

On a developer machine the token line belongs in your **user-level** `~/.npmrc`, not the project `.npmrc` — pnpm ignores it there unless the project opts in, which only a builder needs ([§4(d)](#4-build-platforms-with-no-user-level-npmrc)). The snippet is idempotent:

```bash
TOKEN='//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
grep -qxF "$TOKEN" ~/.npmrc 2>/dev/null || echo "$TOKEN" >> ~/.npmrc
```

`${NODE_AUTH_TOKEN}` is intentionally written as a literal placeholder — `pnpm` expands it from the env var at install time (which is why §1 must come first), so a rotated `gh` token is picked up automatically and no secret is ever written to disk.

Prefer to store the token itself instead of the placeholder? `pnpm config set` writes to the same user-level file:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"
```

That value is a real secret and does not refresh on rotation — re-run the command when the token expires.

> **Why not the project `.npmrc`?** Since pnpm 11.6, environment variables are **not** expanded in registry credentials read from a project `.npmrc` **by default**, because that file is committed and the expansion could leak the token to an attacker-controlled registry. A token line there is ignored with an `Ignored project-level auth setting` warning on every command, so `josh init` / `josh sync` do not write it. They do not remove one either: pnpm's `npmrcAuthFile` setting re-enables expansion for a file the project declares trusted, which is a supported arrangement on a builder with no user-level npmrc — see [§4(d)](#4-build-platforms-with-no-user-level-npmrc).

**GitHub Actions needs no extra step**: `actions/setup-node` with `registry-url: 'https://npm.pkg.github.com'` writes the same placeholder line into a user-level npmrc for the job, which pnpm does expand — supply `NODE_AUTH_TOKEN` to the install step and it works. Any other build environment does need a step: see [§4](#4-build-platforms-with-no-user-level-npmrc).

## 3. Configure the project `.npmrc`

A project that consumes the kit as a devDependency also needs the scoped **registry mapping** — a routing rule, not a credential, which pnpm still honors from a project file. `josh init` writes it for you; to add it by hand:

```bash
REGISTRY='@joshuafolkken:registry=https://npm.pkg.github.com'
grep -qxF "$REGISTRY" .npmrc 2>/dev/null || echo "$REGISTRY" >> .npmrc
```

Commit that file — it holds no secret. Without the mapping, `pnpm` tries the public npm registry for `@joshuafolkken/*` and fails. Installing only the global `josh` CLI (per [cli.md](./cli.md))? Put the same line in `~/.npmrc` and skip this section.

## 4. Build platforms with no user-level npmrc

A hosted builder — Cloudflare Workers Builds, Vercel, Netlify, a Docker image — is neither your machine nor a GitHub Actions runner. There is no `~/.npmrc` from §2 and no `actions/setup-node` to write one for the job, so the project `.npmrc` from §3 routes `@joshuafolkken/*` to GitHub Packages with no credential behind it and the install fails with `401`. **A green CI run does not clear this**: every kit workflow job that installs dependencies calls setup-node with `registry-url` first, so Actions always has the credential restored for it — the one environment that can fail is the one no check exercises.

Supply the credential from a source pnpm reads. Any one of the four below is enough — pick the one your platform allows. Each needs the token itself in the platform's secret store, never in a committed file.

**a. An environment variable alone.** pnpm reads `npm_config_`-prefixed variables as config, so this needs no file and no command change:

```
npm_config_//npm.pkg.github.com/:_authToken=<token>
```

Use it wherever variable names are unrestricted (a Dockerfile `ENV`, most CI runners). Some dashboards accept only letters, digits and `_` in a name and reject this one — take (d) there, or (b)/(c) if you control a step that runs before the install.

**b. `pnpm config set` before the install.** This writes to pnpm's global auth store, outside the repository:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" "$NODE_AUTH_TOKEN"
```

It only helps from a step that runs **before** dependency installation — a Dockerfile line, an explicit CI step. A platform that installs dependencies automatically and only then runs your build command runs this too late; use (a) there.

**c. Write the user-level file at build time.** The §2 line, created by the build:

```bash
printf '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n' >> "$HOME/.npmrc"
```

Single quotes keep the placeholder literal, so `NODE_AUTH_TOKEN` is expanded by pnpm at install time. Same ordering constraint as (b).

**d. Declare the project `.npmrc` a trusted auth file.** pnpm's `npmrcAuthFile` setting names one file whose credentials it will still expand environment variables in, and the project `.npmrc` is allowed to be that file. Keep the placeholder line from §2 in the committed project file:

```ini
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

and set both variables in the platform's dashboard:

```
PNPM_CONFIG_NPMRC_AUTH_FILE=.npmrc
NODE_AUTH_TOKEN=<token>
```

Unlike (b) and (c), this needs no build step of your own, so it also works on a platform that installs dependencies before running any command you control — Cloudflare Workers Builds among them. The committed file still holds no secret, only the placeholder; the token stays in the dashboard. `josh sync` leaves the line alone from kit `1.60.0` on. **Earlier versions removed it on every run**, which broke exactly this arrangement — and invisibly, because the pnpm store keeps serving already-resolved versions until the next `@joshuafolkken/*` bump. If you are on an older kit, upgrade before relying on (d).

> **Which of (a)–(d) should I use?** (a) whenever the platform allows arbitrary variable names — it is the least setup. (d) when it does not, since a dashboard that rejects `npm_config_//…` still accepts `PNPM_CONFIG_NPMRC_AUTH_FILE`. (b) and (c) only where you control a step that runs before dependency installation.

> **Why is the plain project `.npmrc` not enough without (d)?** Since pnpm 11.6 the line is ignored there by default (§2). Verified on pnpm 11.20.0: with the user config isolated and `npmrcAuthFile` unset, that line yields `Ignored project-level auth setting` and a `401`, while the same line in a user-level npmrc resolves. Setting `npmrcAuthFile` to the project file is what flips it — that is the whole of (d).

## Next

- Installing the global CLI? Return to [cli.md §2](./cli.md#2-install-globally).
- Adding the kit to an existing project? Return to [package.md §2](./package.md#2-install).
- Hitting `401`/`403` or `ERR_PNPM_FETCH`? See [troubleshooting.md](./troubleshooting.md).
