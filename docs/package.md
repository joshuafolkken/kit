# Use the kit as a project package

Add `@joshuafolkken/kit` as a devDependency so a project can consume its ESLint / Prettier / tsconfig configs, prompts, and scripts, and run `josh init` to wire them up.

This is independent of the [global `josh` CLI](./cli.md) — most projects want both, but the package alone is enough to consume configs.

## 1. Authenticate

One-time GitHub Packages setup — see [authentication.md](./authentication.md). For a project dependency, write the `.npmrc` lines to the repo's `./.npmrc` (safe to commit — it holds only a literal placeholder).

## 2. Install

```bash
pnpm add -D @joshuafolkken/kit
```

## 3. Initialize

Run once after installing — auto-detects SvelteKit vs. vanilla and creates or merges all config files:

```bash
pnpm exec josh init
```

See [init.md](./init.md) for the full list of managed files. After upgrading the package, pull in updated AI files, workflow templates, and other managed files with:

```bash
pnpm exec josh sync
```

See [sync.md](./sync.md) for what `sync` overwrites and why. A project-local `josh` is available via `pnpm josh …` after installation, so the CLI works even without the global install.

## 4. Config entry points

The package exposes config presets for direct import:

| Use           | Reference                                                        |
| ------------- | ---------------------------------------------------------------- |
| ESLint config | `@joshuafolkken/kit/eslint/sveltekit`                            |
| Prettier      | `@joshuafolkken/kit/prettier`                                    |
| tsconfig      | `./node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc`     |
| Scripts       | `tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts` |
| Prompts       | `node_modules/@joshuafolkken/kit/prompts/*.md`                   |

Prefer wiring up individual configs without `josh init`? See [manual-config.md](./manual-config.md).

## Next

- Full command reference: [josh-commands.md](./josh-commands.md).
- Want `josh` available everywhere? Install the [global CLI](./cli.md).
- Hitting an error? See [troubleshooting.md](./troubleshooting.md).
