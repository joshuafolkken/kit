# Remove kit from a project

## When to use it

You tried kit and it does not fit, or a project that has used it for a while is moving on. Trying kit on a branch keeps the first case cheap: before any commit of your own is mixed in, Git alone takes back every file `josh init` wrote.

## What Git alone reverts

Right after `josh init`, on a branch with nothing else on it, `git restore .` and `git clean -fd` — or deleting the branch — undo every created and merged file. Git does not undo what lives outside the working tree: the git hooks lefthook installed under `.git/hooks`, and the installed packages in `node_modules`. Once your own commits sit on top of kit's files, reverting the setup commit is no longer an option either. [`josh uninstall`](../josh-commands.md#josh-uninstall) covers those cases.

## Steps

1. If kit was upgraded since its files were last written, run [`josh sync`](../sync.md) first. Files are compared with what the **installed** version writes, so a file an older version wrote reads as edited and is kept.
2. Run `pnpm josh uninstall` and read the three lists it prints.
   - **Remove** — distributed files that are still exactly what kit writes, the `@joshuafolkken/kit` dependency and the `josh.profile` record in `package.json`, and, in a `full` project, the git hooks lefthook installed.
   - **Keep** — distributed files that differ from what kit writes: ones you edited, and ones of your own that kit merged entries into (`tsconfig.json`, `.vscode/settings.json`, …).
   - **Review by hand** — entries kit merged into `package.json` (`scripts.josh`, `scripts.preinstall`, `devDependencies.prettier`, …), `sonar-project.properties` / `.aikido` when present, and `.gitignore`. The ignore file is never removed, even when kit created it: deleting it would turn `.env` and `node_modules` into untracked files that the next `git add -A` stages.
3. Answer `y`, or pass `--yes` to skip the question. Without a terminal and without `--yes`, nothing is removed.
4. Go through **Keep** and **Review by hand**: delete the lines and entries that were kit's and keep your own. Delete `.gitignore` last, and only once nothing it ignores is left in the project. kit does not do this for you, because `josh init` kept no record of the values it found — a `prettier` entry may be the one kit added or the one you already had.
5. Run `pnpm install`. It drops the package from `node_modules` and `pnpm-lock.yaml`. If kit was the project's only dependency, delete `node_modules`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and whatever is left of `package.json` instead.

   `pnpm-workspace.yaml` is listed under **Keep** even in a project that had none: pnpm created it when it installed kit, and `josh init` merged its settings into that file, so it is not the file kit writes on its own.

## What it never touches

- Labels, Issues and pull requests that `josh start`, `josh sync` or a workflow run created on GitHub, and the repository settings.
- `node_modules` and `pnpm-lock.yaml` — step 5 is yours, since the command is running from the package it would be deleting.
- Anything kit did not distribute: your source, your commits, and files a kit command generated while you worked.

## Check it worked

- `pnpm ls @joshuafolkken/kit` prints no package after step 5, and `pnpm josh` no longer finds the command — pnpm 12 already drops the package on the next `pnpm` command you run, without waiting for step 5.
- `git status` shows only deletions of kit's files and the `package.json` change, plus your edits from step 4 — no `.env` or `node_modules` shows up as untracked, because `.gitignore` is still there.
- In a `full` project, `.git/hooks` no longer holds lefthook's `pre-commit` and `pre-push`.

## Common failures

- A file you never edited is listed under **Keep**: kit was upgraded after the file was written, or a formatter rewrote it. Run `josh sync` and uninstall again, or delete the file by hand.
- `Refusing to sync …`: the command was run in kit's own repository, where every distributed file is the source.
- A commit fails on a missing lefthook preset after uninstalling: `lefthook.yml` was kept because it holds your own entries. Remove the `extends` line that points into `node_modules/@joshuafolkken/kit`.
