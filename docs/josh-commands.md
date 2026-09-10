# josh CLI — Command Reference

`josh` is available as `pnpm josh` (or `pnpm exec josh`) after running `josh init`. Run `pnpm josh help` to print a grouped summary in the terminal.

## How a command runs

Most commands are a TypeScript file under `scripts/`; the rest are a shell line the dispatcher spawns. **In kit's own checkout the dispatcher evaluates a script command in its own process** rather than starting a second TypeScript runtime for it ([#1342](https://github.com/joshuafolkken/kit/issues/1342)). Measured on 2026-09-04, medians of five: `pnpm josh port dev` went from **0.55s to 0.38s**, and `pnpm josh format:edited` — the command the edit hook runs 60–90 times in a single run — from **0.55s to 0.39s**. About **0.17s** comes off every script command, which is 15–20 seconds of a run that makes roughly a hundred of them.

Three things decide whether a command takes that route, and none of them is a judgement:

- **The dispatcher has to be running from TypeScript source.** That is kit's own `pnpm josh`. A consumer's `josh` bin is the bundled `dist/josh.js` under plain node, which cannot evaluate `scripts/*.ts` at all, so **every consumer keeps the spawning path exactly as it was**.
- **The command must not need node flags of its own.** `doctor`, `latest:scope`, `followup`, `notify` and `eval:scope` each pass `--env-file`, which has to be in force before the script's first line; those five keep a process of their own. Each runs at most a few times per run, so none of them is where the cost accumulated.
- **A shell command has no script to import** and is spawned as before.

**A new josh script keeps the canonical main guard**, `process.argv[1] === fileURLToPath(import.meta.url)`, or none at all. The dispatcher sets `process.argv` to what the spawned process would have had, so a guard written any other way would import cleanly, run nothing and answer 0 — a `josh gate` that passes without running a check. `scripts/josh/josh-in-process.test.ts` asserts the shape for every command that takes this route.

## Development

These commands replace the corresponding `package.json` scripts. Consumer projects no longer need to add them manually.

### `josh gate`

Run the completion gate's four checks — lint, type check, spell check and unit tests — **concurrently**.

```bash
pnpm josh gate
```

The four are independent and share no mutable state, so nothing is gained by running them one after another. Measured in kit on an Apple M3 Pro with warm caches, the four run back to back take **19.1s** and together **15.1s** — a median of three interleaved runs each ([#1258](https://github.com/joshuafolkken/kit/issues/1258)).

**How many run at once, and how wide the unit suite fans out, are read off the machine rather than fixed at four** ([#1258](https://github.com/joshuafolkken/kit/issues/1258)). The first line of every run says what was decided:

```
plan: 4 of 4 checks at once, test:unit at 7 workers (11 cores)
```

The plan comes from one table in `scripts/gate-plan.ts`, where each check declares the cores it holds for as long as it runs — measured as CPU-seconds ÷ wall-seconds with the check run alone: lint 2.1, type check 1.7, spell check 1.3, unit tests 8.5. Four things follow from those numbers.

- **The unit suite is the only check worth sizing.** It accounts for 107 of the gate's 122 CPU-seconds on its own, because vitest opens one worker per core while the other three are one or two processes each. It is handed `--maxWorkers=<cores − 4>` — the cores the other three do not hold — which keeps the gate's total demand at the size of the machine instead of about 1.3× it. Measured: no change in wall time beyond run-to-run noise, and 5–6% less CPU burned (101s against 107s). The flag needs vitest 2.1 or newer, which every project this package supports is far past.
- **A machine smaller than the one it was measured on is left alone.** The cap applies from 11 cores up and nowhere below, because four reserved cores are half an eight-core machine against a third of the measured one, and one measurement says nothing about whether the reservation still pays there. Extrapolating it downward is what would hurt: the suite takes 11.7s at eight workers and 16.7s at four, so a rule that handed an eight-core machine four workers would pin the longest check at the slow end of a curve nobody measured there. Below the line vitest keeps sizing its own pool — the behavior `josh gate` had before the plan existed — and a four-core CI runner is far below it, so CI runs exactly as it did.
- **Below four cores the checks queue instead of fighting.** The three reserving checks want four cores between them, so a three-core machine runs two checks at a time and a two-core machine one — and, since [#1547](https://github.com/joshuafolkken/kit/issues/1547), so does a gate whose _share_ of a bigger machine has been cut that small by the other gates in flight. **Every check still runs and every failure is still reported in one pass** — narrowing the plan changes the order, never the set.
- **The machine is divided when more than one gate is on it** ([#1515](https://github.com/joshuafolkken/kit/issues/1515), [#1547](https://github.com/joshuafolkken/kit/issues/1547)). The three numbers above describe one gate on an idle machine, and nothing in them asked whether another lane was running. Six lanes each concluding "11 cores, take 7" put 42 workers on 11 cores at a load average of 14.97, and the pre-push hook was worse still — it passed no cap at all, so vitest opened one worker per core in every lane at once. Each run now counts the runs already in flight and takes `⌊cores ÷ runs⌋` of the machine — never fewer than one unit worker, and never fewer than one check at a time. Measured: six concurrent copies of the full suite produced ten `Test timed out in 10000ms` failures across the six; at this share the same six produced **none**, with the load average falling from 209 to 22.

  **Sizing the unit suite alone was not enough.** A gate starts four checks and only the fourth took a number, so six lanes still left eighteen unbounded checks on the machine. Measured there: one gate took **254.1s, with lint alone at 252.9s** against the 5.2s the table above records for it run alone. eslint, `tsc` and cspell accept no worker count between them — eslint's `--concurrency` defaults to `off` and is single-threaded, `tsc` is one process, and cspell's CLI exposes no thread count at all — so how many of them run beside each other is the only quantity the gate controls, and the same `⌊cores ÷ runs⌋` share now decides that too.

  **A run that is alone on the machine is sized exactly as it was** — `⌊cores ÷ 1⌋` is `cores`, the same number by arithmetic rather than by a branch that could later be got wrong — so CI and every quiet checkout behave bit for bit as before, and the line says so only when it is not:

  ```
  plan: 1 of 4 checks at once, test:unit at 1 workers (11 cores, 6 unit runs)
  ```

  The count is a marker per in-flight run in the temp directory, carrying the pid that wrote it **and the time that process started** ([#1245](https://github.com/joshuafolkken/kit/issues/1245)); a run killed outright leaves its file behind and is ignored, because the process rather than the file is what says a run is live. The start time is there because a pid alone is not a process: once the operating system reissues the number, a leaked marker would pass a pid-only liveness probe and hold every later run on the machine at one worker. A marker recording no start time — written by an older version, or on a platform where it cannot be read — still counts as live, which is the direction that costs a narrower share rather than an oversubscribed machine. A number you pass yourself is never divided — `pnpm josh test:unit --maxWorkers=4` is left as typed.

The bigger saving is in round trips. A serial gate stops at the first failure, so a tree with a lint error _and_ a type error costs two full runs to discover. `josh gate` runs every check to completion even when one fails, prints each check as one block in the order above — buffered, never interleaved — and ends with a single summary naming every check that failed:

```
plan: 4 of 4 checks at once, test:unit at 7 workers (11 cores)
✔ lint (pnpm josh lint) 9.0s
✗ check (pnpm josh-app check:ci) 4.6s
…
full output: /var/folders/x1/…/josh-gate-log-3f2a91c07b4d5e68.log
✗ verification gate failed: lint, cspell (23.0s)
```

or, on a green one:

```
full output: /var/folders/x1/…/josh-gate-log-3f2a91c07b4d5e68.log
✔ verification gate passed (4 checks) in 23.0s.
```

Each block's header names the command that ran, not only the check, because the type check's command is resolved per project (below). Re-run a single check while fixing by copying the command from its header; the other three are always `pnpm josh lint`, `pnpm josh cspell:dot` and `pnpm josh test:unit`. The exit code is `1` when any check failed, `0` otherwise.

**Every header ends with how long that check took, and the summary with how long the gate took** ([#1248](https://github.com/joshuafolkken/kit/issues/1248)). The total is wall-clock for the command, not the sum of the four — they run concurrently, so a sum would report about three times what you waited. Read the four against it: 9.0s, 4.6s, 3.1s and 15.4s against a total of 23.0s says the fan-out is working and the unit suite is the long pole; the same four against 80s says the machine was contended rather than any one check being slow. Without those numbers the figure quoted above had to be re-measured by hand every time it was questioned — twice on [#1153](https://github.com/joshuafolkken/kit/issues/1153) alone, which is what put the timing in the output rather than in a stopwatch around it.

**Three of the four checks read a cache, so a second run only looks at what changed** ([#1256](https://github.com/joshuafolkken/kit/issues/1256)). eslint has had one from the start; the spell check now runs `cspell . --dot --cache --cache-strategy content --cache-location .cspellcache`, and the type check — **on a project that falls through to `pnpm josh check`**, which is kit itself and any plain TypeScript project — `tsc --noEmit --incremental --tsBuildInfoFile .tsbuildinfo`. Together those two went from 6.9s and 3.6s of CPU to 1.9s and 0.9s. On a project whose type check resolves to a toolkit command (`josh-app check:ci`, below) that step is app-kit's or game-kit's to cache, so three of the four checks are cached here and two of the four there. **Neither of those two needs an invalidation rule of its own**: `tsc` stores the compiler options in the build-info file and re-checks everything when they differ, and `cspell` stores a content hash of every config and dictionary file it loaded, so editing `tsconfig.json` or `cspell.config.yaml` invalidates what it should — measured at 3.3s and a full 845-file rescan respectively, against 1.0s and 0.8s warm. **eslint's does need one** ([#1347](https://github.com/joshuafolkken/kit/issues/1347)). It decides an entry is still valid from the file's content hash plus a hash of the _serialized_ config, and serializing drops every function — so editing a rule under `eslint/rules/` changed nothing in that hash, every existing entry stayed valid, and `pnpm josh lint` reported the pre-edit verdict for each file the change had not touched. `eslint/config-fingerprint.js` closes it by putting a content fingerprint of those modules into the shared config's `settings`, which _is_ serialized: one value there invalidates the gate's cache, the scoped lint's and the edit hook's together, because all three load their config through `create_base_config`. The value is content-addressed rather than an mtime or a token so that it agrees across machines — CI restores the gate's cache, and a per-checkout value would make every CI lint cold. CI restores only the eslint cache (`Setup ESLint cache` in `.github/workflows/ci.yml`, keyed on the lockfile and the eslint config); the other two start every run cold, which is why neither needs a cache-busting key there. The three cache files — `.eslintcache`, `.tsbuildinfo`, `.cspellcache` — together with the edit hook's own `.eslintcache.edit` ([#1332](https://github.com/joshuafolkken/kit/issues/1332), under [`josh format:edited`](#josh-formatedited)) and the scoped lint's own `.eslintcache.related` ([#1347](https://github.com/joshuafolkken/kit/issues/1347), under [`josh lint:related`](#josh-lintrelated)) are in the `.gitignore` `josh sync` merges into a consumer project, which also keeps them out of `prettier --check .`. **They are named in the distributed `cspell/index.yaml` `ignorePaths` as well**, and not only left to `useGitignore`: the flags that write them arrive with the package, while the `.gitignore` entries arrive on the consumer's next `josh sync`, so a consumer that upgraded and ran `pnpm josh gate` first had `josh cspell:dot` spell-check the build-info file `josh check` had just written — 125 issues, with nothing misspelled in the tree.

**That single re-run is what an implementation loop is meant to use, and the whole gate is not.** A workflow run starts one gate, beside the review ([#1242](https://github.com/joshuafolkken/kit/issues/1242)), and re-runs a check by name until that point — ten whole gates cost 8.2 minutes of a 49.1-minute run, six of them before the review had started and every one of those answered by one check ([#1246](https://github.com/joshuafolkken/kit/issues/1246)). The rule itself is `prompts/review.md` → "The gate runs beside this review, not in front of it"; what this command contributes is the header line that names the one command to repeat. **Two of the checks that loop repeats are scoped**: [`josh lint:related`](#josh-lintrelated) checks only the changed files ([#1298](https://github.com/joshuafolkken/kit/issues/1298)) and [`josh test:related`](#josh-testrelated) runs only the tests related to them ([#1257](https://github.com/joshuafolkken/kit/issues/1257)); the gate itself keeps running `josh lint` and `josh test:unit` over everything.

**Only a check with something to say prints its output.** A green gate prints four header lines and the summary and nothing else — what a passing run has to say is "all four passed", which the summary already says, while the four bodies (vitest's per-file listing among them) run to tens of kilobytes that then sit in the conversation and are re-read on every later turn ([#967](https://github.com/joshuafolkken/kit/issues/967)). The gate runs more than once per Issue, so that is a cost per run rather than per Issue. A failing check keeps its whole output — that is the one time the body is the answer, and one failure does not drag the other three bodies back in. **Two passing cases keep theirs too**: a check that exited 0 _without running_ (`josh test:unit` skips when vitest is absent, and a gate that ran zero tests must not look like one that ran them all — the other empty case, vitest present with no test file, [fails](#josh-testunit) rather than passing since [#1224](https://github.com/joshuafolkken/kit/issues/1224)), and a check that passed with warnings (`josh lint` runs eslint without `--max-warnings 0`, so warnings do not fail — but they are still something to read).

**Every run also writes all four bodies to a file, and prints where it is** ([#1227](https://github.com/joshuafolkken/kit/issues/1227)). The console is not the only copy any more. `BASH_MAX_OUTPUT_LENGTH` caps what one command may carry into an agent's context at 8,000 characters ([#1173](https://github.com/joshuafolkken/kit/issues/1173)), against a measured p99 of 15,989 for a Bash call — and what an elision takes is the **middle**, which is where a failing check says what it was. A red gate can still never read as green, because the verdict is the last line; what was lost was the reason behind it, leaving "re-run one of the four by hand" as a judgement made about output nobody could see.

- **The path is printed immediately above the verdict, not below it.** The verdict stays the gate's last line — `scripts/josh-verdict.ts` builds two readers on that, the rework detector's scan and the `2>&1 | tail -40` in `prompts/collaboration-workflow/output-bounds.md` — so the path survives a `tail` exactly as the verdict does.
- **It is written on a green run too.** Writing only on failure would make the file a judgement about which runs are worth keeping, and the judgement is wrong for the two cases that already print a body on a green gate: a check that passed with warnings, and one that passed without running. The file is overwritten in place, so a green run leaves exactly as many files behind as a red one.
- **It holds every check's whole output, the suppressed passing ones included** — which is what makes it different from the console, where a passing body is dropped as noise (below). `pnpm josh gate --verbose` is no longer the only way to see one.
- **The temp directory, one file per checkout, a deterministic name** — the convention `scripts/josh/stamp-file.ts` already defines for the green-gate record and the in-flight marker. A file inside the repository would need a `.gitignore` entry here and in every consumer `josh sync` reaches, bought for something nobody is meant to keep. Nothing accumulates: the next gate overwrites it.
- **A write that fails never changes the verdict** — the rule the other two records follow. The summary says `full output: could not be written; re-run with \`> gate.log 2>&1\`` and the gate's exit code is whatever the four checks made it.
- **A gate that reused a recorded green result (below) writes nothing**, because it started no check and has no output to keep. The log from the run that record came from is still where it was.

**A tree the gate was already green on is not checked again** ([#1328](https://github.com/joshuafolkken/kit/issues/1328)). Every green run records the digest of each changed file it passed on — the record `josh review:brief` reads to print `Already verified` ([#1241](https://github.com/joshuafolkken/kit/issues/1241)). The gate now reads it back at start-up, and where nothing that record covers has moved it prints the recorded result and exits 0 without starting a process:

```
✔ this tree is already green — lint, the type check, the spell check and the unit tests all passed on it at 2026-09-04T05:31:12.004Z (`pnpm josh gate`).
  Reusing that result; nothing was re-run. `pnpm josh gate --force` runs the four checks anyway.
```

**This is reuse of a result, not a check dropped**: the bytes the skip answers for are the bytes the record was written from, compared one by one. Five things send the gate back to the four checks, and the last two are what the design turns on — **a file map is a diff, so everything it says stays true while the branch it is measured against moves underneath it.**

- **No record** — including after a red gate, and after a green one that had something to print (a check that passed with warnings, or one that passed without running), neither of which writes one. So the re-verification that follows a fix always runs, and a warning is never made invisible by a run that reuses a result instead of printing it.
- **A file either side covers has moved, appeared or gone.** The comparison unions both key sets, so a new untracked file refuses the skip exactly as an edited one does.
- **The base commit moved**, even with the map byte-identical. Fetch an advanced `main` and rebase onto it and the same files still differ by the same digests, over a working tree whose every other file has been replaced by code no check has read. The record pins the commit it was taken against, and both halves have to match. **That commit is the branch's merge base with the default branch, not the default branch's own tip** ([#1527](https://github.com/joshuafolkken/kit/issues/1527)): a rebase moves `HEAD` and so moves the merge base with it, which is the case this condition was written for — while another lane merging into the shared `main` of a linked work tree moves neither, and correctly leaves a record standing that still describes this tree exactly.
- **An empty changed map**, which is never evidence. Straight after `git switch main && git pull` the map is empty, and an empty map compares equal to any other empty map. `epicrun` runs exactly that pair of commands between children. Refusing costs nothing: a tree with no changed file is not where a run spends its gate time.
- **`pnpm josh gate --force`**, for when something outside the tree changed and you know it — a `pnpm install`, a toolchain bump, a cache thrown away.

**Both git hooks read the same record through the same decision**, each adding one condition of its own because the record describes the working tree while a git operation carries something narrower — [`josh pre-push-unit`](#josh-pre-push-unit) for the unit suite, since a push carries `HEAD` ([#1334](https://github.com/joshuafolkken/kit/issues/1334)), and [`josh pre-commit-type-check`](#josh-pre-commit-type-check) for the project-wide type check, since a commit carries the index ([#1381](https://github.com/joshuafolkken/kit/issues/1381)). What the two share is `scripts/hook-gate-reuse.ts`, and the comparison itself is `scripts/gate-skip.ts` in both — so no hook can answer "is this still the recorded tree" differently from the gate printing its answer beside it.

```bash
pnpm josh gate --verbose   # every check's output, passing ones included
pnpm josh gate --force     # run the four checks even on a tree already recorded green
pnpm josh gate --no-unit   # the three static checks; the unit suite is running elsewhere
```

`--verbose`, `--force` and `--no-unit` are the exceptions to the refusal below: the gate consumes them itself rather than forwarding them, so they cannot vanish into a sub-command the way a forwarded flag would. Every other argument is still refused, and the refusal names both the arguments it rejected and the flags it accepts:

```
josh gate takes no extra arguments — pass them to josh lint or josh check or josh cspell:dot or josh test:unit instead
  refused: --workers=1
  accepted here: --verbose --force --no-unit
```

**`--no-unit` has exactly one caller, and it is not a way to run a quicker gate** ([#1226](https://github.com/joshuafolkken/kit/issues/1226)). CI runs the unit suite on a runner of its own, because it is the only check that fans out across every core and a 4-core GitHub runner cannot host it beside the other three without all four losing: the single job took 121 seconds, 106 of them inside the gate step. So `.github/workflows/ci.yml` runs `pnpm josh gate --verbose --no-unit` on one job and `pnpm josh test:unit` on another. The plan line says which set ran:

```
plan: 3 of 3 checks at once, test:unit elsewhere (11 cores)
```

**A partial gate writes none of the records a whole one writes.** The green-gate record above, the in-flight marker `josh review:brief` reads, and the unit-run marker a sibling lane divides its workers by are all claims about the unit suite, and a `--no-unit` run makes none of them. That is what stops the flag from becoming a hole: a partial gate can never let a later full `pnpm josh gate` be skipped on its strength, nor tell a review agent that a suite it did not run has passed. Locally there is no reason to pass it — the completion gate is all four checks, and `pnpm josh gate` is what runs them.

**The type check follows the application layer.** Three of the four checks are always the `josh` sub-command of the same name. The type check is not: a SvelteKit project type-checks with `svelte-check` behind `svelte-kit sync`, and `tsc --noEmit` there both misses every `.svelte` type error and fails on a clean checkout where `./$types` has not been generated. So the step is asked of the project's own toolkit:

1. The toolkit shim is found by walking up from the working directory to a `node_modules/.bin` — the same walk pnpm performs, so a gate typed in a subdirectory resolves the toolkit its sibling checks resolve. It is never found through `pnpm <bin>`, which falls through to a globally installed toolkit and would run a SvelteKit type check on a project that is not one.
2. That binary is run with no subcommand and the usage line it prints is read, the same way the `/verify-ui` skill decides whether a `shot` command exists. A toolkit being installed is not the command existing.
3. The first of `check:ci` (the strict variant a gate wants) then `check` that the usage line names is used; `josh-app` is consulted before `josh-game`.
4. When no installed toolkit names either, the step stays `pnpm josh check`.

A project with no application toolkit — kit itself, a plain TypeScript package — therefore gets `tsc --noEmit`, unchanged. The probe runs concurrently with the other three checks, so it costs no wall-clock of its own.

The refusal message above names the `josh` sub-commands, `josh check` among them; on a project whose type check resolves to a toolkit command, pass that check's arguments to the command its output header names instead.

Like the composite commands below, `gate` forwards nothing to the four sub-commands, so it refuses extra arguments rather than discarding them:

```bash
$ pnpm josh gate --workers=1
josh gate takes no extra arguments — pass them to josh lint or josh check or josh cspell:dot or josh test:unit instead
```

Refactoring still comes **before** the gate, and `/code-review` still comes after it — `josh gate` replaces the four checks between them, not the steps around them.

### `josh lint`

Check code with prettier and eslint.

```bash
pnpm josh lint
pnpm josh lint:prettier   # prettier only
pnpm josh lint:eslint     # eslint only
```

### `josh lint:related`

Check only the files the change touched — the lint check an implementation loop repeats between edits ([#1298](https://github.com/joshuafolkken/kit/issues/1298)).

```bash
pnpm josh lint:related                     # alias: josh lr
pnpm josh lint:related scripts/thing.ts    # narrow by the given files instead
```

**It is added in front of the whole tree, never in place of it.** `josh gate` keeps running `josh lint` over everything before the commit: a formatting or lint rule can be broken by a file the change never named — a shared config, a generated snapshot — and only the whole-tree run sees that. What the narrowing replaces is the repeat calls in between. Measured with `pnpm josh time` across four runs, those cost 47–188 seconds each, and 188 of them were 18% of one 1,043-second implementation phase.

The changed files are the branch diff plus the untracked files beside it — the same reading `josh review:level`, `josh eval:scope`, `josh review:brief` and [`josh test:related`](#josh-testrelated) decide from, so what this narrows by is what those commands call the change. Prettier is given the whole narrowed list with `--ignore-unknown`, so a file it has no parser for is skipped rather than failing the run; eslint is given the same list with `--no-warn-ignored`, so a changed `.md` or an ignored file does not bury the findings in warnings. **Eslint is given a cache file of its own, `.eslintcache.related`** ([#1347](https://github.com/joshuafolkken/kit/issues/1347)). It shared the gate's until then, on the argument that eslint leaves the entries a run did not visit alone and a narrowed run therefore warmed the cache the whole-tree run reads. That holds for pruning and says nothing about two writers: `josh gate` lints the whole tree beside the review while an implementation loop calls this command between edits, and each eslint run rewrites its cache file whole from the copy it loaded at start-up — so on one file, a narrowed run finishing during the gate's rolled the cache back to its pre-gate state, and a whole-tree run finishing second discarded the narrowed one's entries. It is the same judgement [#1332](https://github.com/joshuafolkken/kit/issues/1332) made for the edit hook, applied to the second place it was needed; the warming given up is worth less than the entries no longer lost, since a file of its own is warm from its own second call onwards.

**It prints what it narrowed by before it runs**, so a scoped run is never read as a whole one:

```
josh lint:related: 2 changed file(s) — checking only them.
  - scripts/thing.ts
  - docs/thing.md
```

**Both fallbacks end at the whole tree, and each says which one it was.** A narrowed run that checked nothing would report success, so the two are never silent and never merged into one message:

```
josh lint:related: the changed files could not be read — checking the whole tree instead.
josh lint:related: no changed file is one prettier or eslint reads — checking the whole tree instead.
```

A path given as an argument that this cannot use — one the tree no longer holds, or one neither linter reads — is named on the console rather than dropped, so a typo is visible instead of being answered with a whole-tree run nobody asked for.

**Flags are named rather than forwarded**, which is where this differs from [`josh test:related`](#josh-testrelated): that command has one child to forward to, this one has two that take different flags — `--fix` means something to eslint and nothing to `prettier --check`. A flag is reported as ignored instead of being sent to both or dropped in silence:

```
josh lint:related: ignored — prettier and eslint take different flags: --fix
```

### `josh lines`

Print how many code lines a file already has against the `max-lines` limit, and how many are left.

```bash
pnpm josh lines scripts/format-edited-file.ts scripts/josh/josh-logic.ts  # alias: josh ln
```

```
limit 300 code lines · near from 255
scripts/format-edited-file.ts  230/300 code lines (76%), 70 to spare
scripts/josh/josh-logic.ts  179/300 code lines (59%), 121 to spare
```

**It answers before the writing starts, which is the whole point** ([#1425](https://github.com/joshuafolkken/kit/issues/1425)). `pnpm josh lint` reports the file line limit only once it has been broken — measured by hand on run #1406 (PR #1422, 45.8 minutes), **19.8% of the whole run, 543 seconds, went on reacting to `max-lines` after the implementation was already finished**: five gate runs, four `pnpm josh lint` runs, 115 seconds of tool execution and 353 seconds of model time in between. The splitting was correct work; deciding it after the fact rather than at design time was not. `CLAUDE.md` → Code Change Rules Step 0 is what makes a run consult this, and `prompts/collaboration-workflow/report-format.md` → 「行数予算は編集前に読む」 carries the procedure.

- **The limit is the one your own eslint enforces, resolved per file** ([#1454](https://github.com/joshuafolkken/kit/issues/1454)). It used to be read from kit's `eslint/rules/code-quality.js` while the count was asked of the project's eslint — the same 300 in kit, and two different rules in a consumer whose `eslint.config.js` overrides `max-lines` after `create_base_config`, where the report and the gate then described different limits. The whole rule entry now comes from that project's own eslint, resolved for **each file**, because a flat config block can key an override on a `files` pattern. **The counting options travel with it**: `skipBlankLines` and `skipComments` decide what a code line _is_, so taking them from kit while taking the count from the consumer would be the same defect wearing a different number. Files that resolve to different options are counted in separate eslint runs — one run per distinct option set, which is one run in every project that does not deliberately count two groups of files differently.
- **`near from` is printed with every report.** "Near the limit" starts at 85% of the limit — 255 of 300, so 45 code lines of headroom, a little under two functions at the 25-line function limit. The boundary is printed rather than left implicit so a reader who sees the advice on one file can tell which side the next one is on. **Where the files asked about do not share one limit**, there is no single line count to print, so the header states the boundary as the share instead — `near from 85% of each file's own limit` — and each row carries its own limit beside its own percentage.
- **It never fails on a large file.** The limit is lint's to enforce, and a second command exiting non-zero on the same condition would be a second enforcement point for it — the door to satisfying a limit by counting differently rather than by splitting. A non-zero exit means the argument list was unusable. Nothing here changes the limit.
- **The count is lint's own, not a second counting method.** `max-lines` runs with `skipBlankLines` and `skipComments`, so it is neither `wc -l` nor anything read off the text ([#1070](https://github.com/joshuafolkken/kit/issues/1070)); this command runs **the same eslint `pnpm josh lint` runs**, with `max-lines` lowered to `max: 0` so the rule reports unconditionally, and prints the number the rule itself reported. The eslint **CLI** is used rather than its in-process API because the two disagree: on eslint 10.10.0 with this repository's config, a file beginning with `#!` counts one line lower through `Linter.verify` / `ESLint#lintFiles` than through the CLI — 300 against the gate's 301 — and every `scripts/*.ts` entry point has a hashbang.
- **A path with no number says so, and says which kind.** A path that is not a regular file — a typo, or a directory — prints `not counted: not a regular file`, because it was never sent to eslint and a row quoting eslint's verdict for it would answer a question nobody asked. A path this project enforces no `max-lines` on prints `not counted: no max-lines limit for this path`: the rule is off for it, no configuration covers it with a `max`, or the project's eslint could not be loaded at all — the wording names none of the three, because the row would otherwise assert whichever one it guessed. **There is deliberately no fallback to kit's limit there**, which would restore [#1454](https://github.com/joshuafolkken/kit/issues/1454) silently, in exactly the case nobody can see. Everything that did reach the probe without coming back with a number prints `not counted: no line count for this path`: a path eslint ignores, one it cannot parse, and a probe that could not run at all — which is why that wording does not name eslint either. None of the three prints a blank, which would read as zero. **A file eslint _did_ lint and this rule did not fire on has 0 code lines** — a comments-and-blank-lines module, since the counting skips both — and that is reported as `0/300` rather than as "not counted".
- **Only regular files are read.** A directory is reported rather than expanded: the paths that share a counting method also share one eslint run, and one argument eslint cannot match makes it exit with no JSON at all, which would leave every other path in that run unanswered.
- **Inline configuration is off for the probe** (`--no-inline-config`). A `/* eslint-disable max-lines */` at the top of a file silences the rule, and an inline directive beats the `--rule` override — so without this the probe would see no message and read a 500-line file as 0 code lines with `300 to spare`, which is the most dangerous direction this report can be wrong in.
- The percentage is floored, not rounded, so it can never print `85%` on a file the advice has not warned about.
- The function limit (25 code lines) is not this command's subject; `pnpm josh lint` reports it.

### `josh format`

Format code with prettier and eslint.

```bash
pnpm josh format
pnpm josh format:prettier  # prettier only
pnpm josh format:eslint    # eslint only
```

### `josh format:edited`

Format the single file an agent just edited, and carry the live round-trip density line. It is not run by hand: `.claude/settings.json`, which this package distributes, wires it to Claude Code's `PostToolUse` event for the `Edit`, `Write` and `Bash` tools, and Claude Code pipes the tool call to it as JSON on stdin. The command reads `tool_input.file_path` out of that payload and runs `eslint --fix` and then `prettier --write` on that path alone.

```json
"PostToolUse": [
	{
		"matcher": "Edit|Write|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh format:edited", "timeout": 90 }]
	}
]
```

The matcher is the plain alternation rather than an anchored regex on purpose: Claude Code treats a matcher built only from letters, digits, `_`, `-`, spaces, `,` and `|` as an exact list of tool names, and reads anything else as an unanchored regular expression. `Edit|Write|Bash` therefore names three tools, while `^(Edit|Write|Bash)$` would depend on the regex path being available.

**Adding `Bash` is what makes that choice load-bearing, because `Bash` is a prefix of `BashOutput` and the two forms fail in opposite directions.** Should the plain alternation be read as a regex after all, it is unanchored, so `Bash` also matches `BashOutput`: a few extra spawns while a background command is polled, and nothing worse — that payload names no file either, so the formatting half stays a no-op and the density line stays correct. Should the anchored form be read as an exact list, it matches no tool whose name is literally `^(Edit|Write|Bash)$`, which is none — the hook silently stops running and takes the formatting with it. A bounded overspend beats a silent no-op, so the list form stays.

**`Bash` is named for the density line, not for formatting.** A shell payload names a command rather than a file, so the formatting half is a no-op for it and never guesses which path a `sed` line rewrote. Why the tool is in the matcher at all is under the density line below.

**Why a subcommand rather than a shell one-liner in the settings file.** The settings file is copied verbatim into every consumer, so an inline command would be a second copy of this logic in each of them, un-upgradable and untested. As a subcommand the wiring stays one line and the behavior is single-sourced here.

**eslint first, prettier last.** An `eslint --fix` that removes a now-unused disable directive leaves the whitespace behind it, so a prettier pass before eslint can hand back a file that `prettier --check` then rejects. Prettier having the last word is what keeps the hook's own output passing `pnpm josh lint`. `josh format` keeps the opposite order on purpose: it chains the two with `&&`, and `eslint --fix` exits non-zero whenever a non-autofixable error remains, so eslint first would mean one unused variable anywhere in the tree stops prettier from running at all. Here the two runs are independent, so the ordering is free to be the one that leaves the file correct.

**It never fails.** A `PostToolUse` hook runs after the edit has already landed and cannot undo it, so nothing this command does is worth reporting as a failure: a payload it cannot parse, a path that no longer exists, a file type nothing here formats, and a formatter that exits non-zero on a half-written file all end the run quietly. What eslint could not fix is left for `pnpm josh lint` at the completion gate to report.

**Only files inside the project.** A session can carry additional working directories, and a path in another checkout or a home-directory config file is governed by that tree's rules, not this one's — so anything outside the directory the hook runs in is left alone rather than rewritten to this project's prettier and eslint config. Each spawn is bounded at 15 seconds, and the bound is set against the worst-case run rather than one spawn: an edit to a config input plans eslint, prettier and `eslint_d restart`, and the first and last each have a second route behind the daemon — five spawns, 75 seconds, under the 90 the hook entry declares. That ordering is what keeps the script's bound the one that fires first. Neither number makes a kill safe — `prettier --write` rewrites in place, and any kill can leave the file truncated — but 15 seconds is two orders of magnitude beyond what formatting one file takes, so reaching it means something is already wrong.

Only paths that prettier has an opinion about are touched (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.svelte`, `.json`, `.jsonc`, `.md`, `.yml`, `.yaml`, `.css`, `.html`), eslint runs on the code subset of those, `node_modules` and `.git` are skipped at any depth, and `dist` and `build` are skipped only as top-level directories — nested, they are ordinary source (`src/routes/build/+page.ts` is a route, not build output). That is the trade: a fraction of a second per edit against a whole-project lint run to see what one file's formatter made of it, and against formatting problems arriving in a batch at the end of the work instead of one at a time. The shims under `node_modules/.bin` are spawned directly rather than through `pnpm exec`, which removes two process starts from a chain that already holds `pnpm josh` and tsx.

**The eslint run goes through a warm daemon.** Almost none of what this hook used to cost was the file. Measured on this repository, one cold `eslint --fix` on a single TypeScript file took 1.70s of a 2.50s hook, while a second lint inside the same process took 0.13s — the 1.6s between them is the flat config, its plugins and the type-aware program, rebuilt from nothing on every edit. `eslint_d` keeps one warm eslint behind a socket and forwards the same arguments to it, which brings that step to 0.08s and the whole hook from 2.50s to 0.84s. It runs the **project's own** eslint rather than the copy it bundles — the hook passes `ESLINT_D_MISS=fail`, so a project whose eslint the daemon cannot resolve is a refusal rather than a silent substitution — and the daemon exits after 15 minutes of inactivity (`ESLINT_D_IDLE`). Prettier has no daemon here — at 0.21s it is not what the hook spends its time on, and a second warm process would double what can go stale for very little.

**The eslint run also carries cache flags, and they are there to protect the gate rather than to speed the hook up.** ESLint deletes whatever sits at `--cache-location` whenever it is started _without_ `--cache`, so this hook — which passed neither flag — destroyed `.eslintcache` on every single edit, and a run of 19 edits then paid a cold lint at both of its verification gates: 59.4s and 54.5s, against 3.0s warm ([#1332](https://github.com/joshuafolkken/kit/issues/1332)). It now passes `--cache --cache-strategy content --cache-location .eslintcache.edit`. **That location is the hook's own rather than the gate's on purpose:** the two run at the same time — `josh gate` lints the whole tree beside the review while this hook fires on every edit — and each eslint run rewrites its cache file whole from the copy it loaded at start-up, so two writers on one file silently discard each other's entries. A file of its own makes the hook structurally unable to degrade the cache the fix exists to protect. **Pruning is not the reason, though it reads like one**: `file-entry-cache` defaults `noPrune` to true, and a single-file run against the gate's full cache was measured byte-identical, so a shared file would keep the entries that run never visited. **What that location does _not_ have to solve is a rule-module edit** ([#1347](https://github.com/joshuafolkken/kit/issues/1347)): editing `eslint/rules/*.js` used to leave every entry in this file valid too, and the fix is one fingerprint in the shared config rather than anything per cache file — so this cache and the gate's are invalidated by the same value.

**A config edit restarts the daemon.** ESLint re-reads the config _entry_ file on every request — it appends that file's mtime to the import URL — but the modules the entry imports carry no such query and stay in a long-lived daemon's module registry. Edit `eslint/rules/naming-convention.js` and then any source file, and without a restart the source file would be auto-fixed against the pre-edit rules for as long as the daemon lives, which reads as the rule change not working rather than as a stale process. So an edit to a config input — the root `eslint.config.*`, or anything under `eslint/` — plans one extra step after the formatters: `eslint_d restart`. Ordinary edits never pay for it.

**Three startup routes, fastest first — and resolving the daemon is not the same as it starting.** The daemon is reached through node's own module resolution (`node <resolved eslint_d CLI>`) rather than a `node_modules/.bin` shim, because pnpm writes a shim only for a project's _direct_ dependencies and `eslint_d` is this package's dependency, not the consumer's. Behind it stand the project's own `node_modules/.bin` shim and then `pnpm exec`, so a project without the daemon behaves exactly as it did before one existed — and those routes are still tried when the daemon resolves but fails to run. A blocked loopback bind, a watch-limit refusal, a store it cannot write its own config file into, and the `ESLINT_D_MISS=fail` refusal above all end the same way: a non-zero exit with nothing written to stdout, which is what separates them from eslint's ordinary non-zero exit, where the problems it could not fix are printed. Without that retry the hook would silently stop fixing anything with eslint wherever the daemon cannot run — the "permanent silent no-op rather than a slower one" the shim fallback already existed to prevent, reintroduced one level up. The same package resolution serves `josh`'s tsx runner, which needs it for the other reason a shim fails: pnpm's shim hardcodes the store path of the version present when it was written, and a later bump prunes that path without regenerating the shim.

**It also tells the run how often it is stopping to wait for a tool.** `josh time` has measured a run's round-trip density since [#1304](https://github.com/joshuafolkken/kit/issues/1304), and warns below 1.50 calls per round trip — but only once the run has ended, which is why run #1299 could go on issuing a single call in 159 of its 172 tool-issuing turns with the norm already shipped as prose in `CLAUDE.md`. This hook carries the same number back while there is still a turn left to change ([#1329](https://github.com/joshuafolkken/kit/issues/1329)). It reads the last 256 KB of the transcript Claude Code names in the hook payload, computes the density with the very function `josh time` reports — not a second copy of it — and counts the calls the newest assistant message issued by grouping the transcript lines that share its id, rather than guessing turn boundaries from the gaps between calls.

One line comes back, and only when all four of these hold: the window holds at least ten round trips, the run is under the floor, the turn that just ran issued a single call, and five minutes have passed since the last line. It leaves through `hookSpecificOutput.additionalContext`, because a `PostToolUse` hook's plain stdout never reaches the model — so an ordinary edit still writes nothing at all to stdout. **The measurement rides this hook rather than one of its own**: a matcher covering every tool would put a process start in front of all ~250 calls of a run to say something on a handful of them. Measured on this repository, the reading adds 1.6 ms at the median to a hook that takes about 0.9 s, which is inside its own run-to-run variance.

**Inside a forked agent the line describes that fork, not the session that delegated it** ([#1424](https://github.com/joshuafolkken/kit/issues/1424)). The payload's `transcript_path` names the **parent** session, whichever agent issued the call, so the reading a forked agent got back was the parent's calls per round trip — a number about a run the reader is not in, and one that cannot move while the fork is what is running. The fork is identified by a separate `agent_id`, and its own transcript sits at `<session-id>/subagents/agent-<agent-id>.jsonl`; the hook resolves that path first, and the throttle record follows it, which is what finally makes the per-session budget the record has always claimed a per-**run** one. **A named agent is answered with its own path whether or not that file exists yet, and never with the parent's** — the fork's first call has nothing written under it, and an unreadable transcript already ends as "no line", which is the honest answer for a run with no history. A payload naming no agent is answered with the path it carried, `null` included: the schema accepts that spelling rather than rejecting the whole payload over it, which would take the line off every edit of the main line in silence.

**`Bash` was added to the matcher because the hook was missing the runs the line is for** ([#1337](https://github.com/joshuafolkken/kit/issues/1337)). Riding the edit hook was chosen on run #1299, where `Edit` was the most-called tool at 65 calls — but that run does not represent how these sessions work now. Of the ten most recent in this checkout, **seven called `Edit` and `Write` zero times**: they edit through `sed` and heredocs, and they are the same sessions measured at 1.00–1.31 against the 1.50 floor. The mechanism reached none of them.

The widening was decided on measurement rather than on the obvious repair of naming every tool. One hook run is **0.53 s** here and about 0.4 s in a consumer, and essentially all of it is process startup — a payload naming no transcript costs the same as one that reads 256 KB of it, so bailing out before the read saves nothing measurable. `Bash` accounts for **88–100% of every call** in the seven sessions that were unreachable, so naming it alone reaches every one of them, at 4–67 s per run. Naming every tool on top of that would cost only 0–8 s more across the same ten sessions — the argument against it is not the money but that it buys no reach at all, while putting a process start in front of the read-only calls this hook has nothing to say about. The 256 KB window still holds 23–34 round trips in those sessions, comfortably past the ten the line requires, so it fires rather than merely arriving.

**The matcher decides how often the check runs; the four conditions above decide how often anything is said.** Widening it does not raise the ceiling of one line per five minutes — it moves runs that were emitting none toward the ceiling that was already specified, at roughly 65 tokens a line.

### `josh batch:guard`

Refuse a tool call that would make a third consecutive single-call turn. Like `josh format:edited` it is not run by hand: `.claude/settings.json`, which this package distributes, wires it to Claude Code's `PreToolUse` event, and Claude Code pipes the call it is about to run to it as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh batch:guard", "timeout": 20 }]
	}
]
```

**The matcher names `Bash` alone, and the omission is deliberate.** The guard must never refuse a write: Claude Code denies one call of a turn and runs the rest, so a refused `Edit` leaves its siblings applied and itself not, and the reissued edit may no longer match the file they changed. Wiring it to `Edit` and `Write` would start a process that can only ever answer "allow". `Bash` is 88–100% of the calls in every session measured under the density floor, so the reach is unaffected. The exclusion is enforced in the script as well as in the matcher — a matcher is settings a consumer can widen, and the guarantee has to hold whatever the wiring says. Inside `Bash` the script scans the **whole line**, not its leading word: a chain is labelled by its first segment, so `cat notes.md && sed -i '' s/a/b/ src/x.ts` reads as `cat` and a leading-word test would call it a read. `sed`, `tee` and `dd` anywhere in the line make it a write, as does a `>` anywhere in it. Both over-match — a read-only `sed`, a `->` inside a grep pattern — which allows a call that could have been refused, the direction every rule here leans.

**A forked agent is judged on its own transcript, and until [#1424](https://github.com/joshuafolkken/kit/issues/1424) it was judged on its parent's.** The payload names the parent session, whichever agent issued the call, and a parent's timeline is frozen for as long as a fork runs — the fork's lines go to the fork's file — so its open sequence either never reaches the limit or reaches it once and can never qualify again. Measured across **551 forked review agents** in this checkout the guard refused **zero** calls, while replaying the same transcripts through each fork's own file refuses 1–4 per review round. So the hook now resolves `<session-id>/subagents/agent-<agent-id>.jsonl` from the payload's `agent_id` and keys the refusal record on it, which is what makes "a delegated unit gets a budget of its own" below true rather than intended. **A named agent is answered with its own path whether or not that file exists yet, and never with the parent's.** The fork's first call has nothing written under it, and an unreadable transcript already ends as "no refusal"; falling back to the parent instead would judge the fork on a timeline it never ran _and_ spend the **parent's** refusal record, so the parent's own next third single-call turn would be admitted in silence. A payload naming no agent is answered with the path it carried, `null` included — the schema accepts that spelling rather than rejecting the whole payload over it, which would take the guard off every call of the main line.

**It exists because describing the problem stopped working** ([#1390](https://github.com/joshuafolkken/kit/issues/1390)). [#1304](https://github.com/joshuafolkken/kit/issues/1304) distributed the batching norm as prose in `CLAUDE.md`; [#1329](https://github.com/joshuafolkken/kit/issues/1329) and [#1337](https://github.com/joshuafolkken/kit/issues/1337) put the live density line in front of the run while there were still turns left to change. Three consecutive runs measured afterwards came in at **1.10–1.12 calls per round trip against a 1.50 floor**, with 14–27% of their round trips recoverable ([#1344](https://github.com/joshuafolkken/kit/issues/1344)). Neither mechanism moved the number, so this one intervenes in the decision instead of reporting on it: `PostToolUse` runs after the round trip has been spent, `PreToolUse` can still stop the call.

**Three is the limit, from the measurement rather than from taste.** #1344 found the longest bundleable sequence of each run at 3–5 turns, so refusing at the third catches most sequences while they still have turns left to save; four or more gives most of them back, and two would refuse the ordinary pair nobody calls a defect.

**The judgement is the report's own, not a second one.** Whether a call is bundleable, what it names, and what counts as a run of single-call turns are decided by `time-bundle-call.ts` and `time-bundles.ts` — the modules `josh time` computes its `Bundling:` block from. A guard with an opinion of its own would refuse calls the end-of-run report then says were fine, and that report is how the change is verified.

**What it cannot know is the size of the turn it is interrupting, and no field can be made to say.** Claude Code writes one line per content block and starts the first tool as soon as that block parses — measured on a live session, the later `tool_use` lines of one message arrive **1.4 to 15 seconds afterwards**. `stop_reason` is no help either: every line of a message carries the finished message's value, including the `thinking` line written before any tool ran. So at the instant the first call of a turn is judged, the turn looks single-call whatever it will turn out to be, and the guard decides on closed history alone. Where the interrupted turn was already batching, the refusal is a false positive costing one round trip — the price #1390 named and accepted before this was built, and bounded by the once-per-sequence record below. Reading the count anyway would have been worse than not reading it: it answers `1` for every turn at this point, so a guard written against it would refuse the first call of every batched turn while reporting that it had checked.

Three things have to hold before a call is refused, and each one is a false positive the hook declines to make:

- **Two single-call turns are already closed behind it**, with no batched turn, no human wait and no delegated unit in between. Closed is the operative word: a turn whose first call has already come back is still in flight and contributes nothing, or the verdict would change part-way through a turn — measured live, the first call of a two-call turn was admitted and the second refused.
- **The call is bundleable, and it does not write.** Every mutation is outside the allow-list — `pnpm`, `git`, `node` and the `gh` write flags are all mutation words — so no `pnpm josh` command, no commit and no Issue write is reachable from here; the edit tools and `sed` are excluded on top of that, per the matcher note above. Both questions are asked **before the transcript is read**, so a `pnpm josh` call costs the hook's own start and nothing more.
- **It names nothing the sequence already touched.** The search-then-read pair is a real dependency, and the same target test the report uses keeps the guard off it.

**A refusal cannot repeat on the call in hand, and that is structural rather than likely.** The hook records the instant it last refused, keyed on the transcript so a delegated unit gets a budget of its own, and a sequence qualifies only if it _began_ after that instant. A refused call extends the sequence rather than restarting it and a sequence's start does not move between two calls seconds apart, so the second look at the same call can never qualify — and a turn can have at most one of its calls refused. The run has to batch (or issue a dependent, writing or non-bundleable call) before the guard has anything to say again.

**What that argument does not cover is a sequence outliving the 256 KB window the hook reads.** The start it compares is the first span _in that window_, so an unbroken run of single-call turns longer than it — 23–34 round trips in these transcripts — presents a start that has moved forward and is refused a second time. That is bounded rather than a loop: one extra round trip per window of unbroken single-calling, which is behavior worth having. Closing it exactly would cost the mechanism its life, because the only test that does so — refuse only where the recorded instant is itself inside the window — silences the guard permanently once the window passes the last refusal. **The record is written before the refusal is made**: with nothing on record every sequence looks new, so a hook that could not write one must not refuse, or a temp directory it cannot write to would wedge the run. Every other failure allows the call too — a missing transcript, a payload that is not JSON, a tail caught mid-append.

The refusal leaves through `hookSpecificOutput.permissionDecision`, which is the only shape that stops a call; plain stdout does not. An ordinary call writes nothing at all to stdout. Set `JOSH_BATCH_GUARD` to `off`, `0`, `false` or `no` — in the environment or in `.env` — to switch the guard off without editing the settings file. Unset is **on**, unlike `JOSH_EVAL`, because this is a distributed convention rather than an opt-in measurement. **The `.env` read is `process.loadEnvFile` inside the script rather than the `tsx_arguments` flag every other command uses**: declaring any `tsx_arguments` disqualifies a command from in-process dispatch ([#1342](https://github.com/joshuafolkken/kit/issues/1342)), which would put a second ~0.16 s tsx start in front of every `Bash` call — the exact hot path that change removed it from. It is node's own `--env-file` parser, so a value already in the environment still wins over the file's.

**Verify it the way #1390 asks to be verified**: run `pnpm josh time --issue <N>` afterwards and read the `Bundling:` block. #1329 and #1337 were only known to have changed nothing because that measurement existed, and this mechanism is held to the same fixed point — the target is fewer than ten recoverable round trips per run.

### `josh investigation:guard`

Refuse a file read once the run has read the threshold's worth of files it has not edited **since its last delegated unit** ([#1460](https://github.com/joshuafolkken/kit/issues/1460)). Like `josh batch:guard` it is not run by hand: `.claude/settings.json`, which this package distributes, wires it to Claude Code's `PreToolUse` event and Claude Code pipes the call it is about to run to it as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Read|Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh investigation:guard", "timeout": 20 }]
	}
]
```

**The rule it enforces already existed, and already failed as a rule.** [#1426](https://github.com/joshuafolkken/kit/issues/1426) put the threshold in two documents and in `scripts/delegation/delegation-policy.ts`, and stated that it is a count of reads actually made rather than a forecast. Run #1441 called `pnpm josh delegate investigation` once, at t+4.0 min of a 45.2-minute run, and after the unit returned the main line read **8 more files it did not edit** — over twice the threshold — with the question never asked again. None of the 8 appears in the 11 files that run merged, the stretch from the unit's return to the first `Edit` was 8.2 min (18% of the run), and 4 of the 5 largest tool-less stretches fall inside it. **A count kept in an agent's head is a one-shot judgement**: after a delegation the run remembers the step as done rather than the counter as zero.

**So the counting is done off the transcript.** A delegation clears the pending set, a read adds its files to it, and an **edit takes its file back out** — which is what makes the set mean "read and not edited" without asking the run to declare its intentions in advance, and what keeps [#1426](https://github.com/joshuafolkken/kit/issues/1426)'s rule that a file this run will edit is read in the main line. Nothing has to be remembered, so the second accumulation is indistinguishable from the first and the threshold necessarily fires again.

**The matcher names `Read` and `Bash`, and both halves are load-bearing.** In this repository the reading is split between them: run #1441 issued 5 `Read` calls against 10 `cat`, 16 `sed` and 1 `tail`, so a `Read`-only wiring would miss the idiom that carries most of the text. On the `Bash` side the guard refuses only a line the batching guard would also have been willing to refuse — `is_guarded_call`, which treats `sed`, `tee`, `dd` and a `>` anywhere in the line as writing — because Claude Code denies one call of a turn and runs the rest, so a refused write would leave its siblings applied and itself not. A `sed -n` read is therefore **counted and never refused**; the refusal lands on the next call that is unambiguously a read. What counts as reading is narrower than `time-bundle-call.ts`'s `READ_COMMANDS`: `bat`, `cat`, `head`, `less`, `more`, `nl`, `sed` and `tail` print a file, while `grep`, `ls` and `wc` report _about_ one without putting its text in the prompt.

**The run's own instructions are excluded, and that was found by the guard refusing its own author.** `CLAUDE.md`, anything under `prompts/` and anything under `.claude/skills/` are read to find out what to _do_ rather than how the subject works, nearly every run reads several of them, and no unit can be sent to read them on the main line's behalf — run #1441's own measurement excluded 5 of them by hand for the same reason. A call naming only those is never counted and never refused; `docs/` is not excluded, because product documentation is routinely the subject.

**A shell target and a tool's `file_path` are resolved before they are compared.** Claude Code requires `file_path` to be absolute, while a shell line carries the word as it was typed — so without that resolution a file read with `cat` and then edited with `Edit` would never cancel and would stay pending for the rest of the run, and reading it once each way would count twice. Two more conditions keep the refusal honest: the call must **actually add a file**, so re-reading something already pending — a second `sed -n` window, or a `Read` with a new `offset` — never trips it; and it is the **accumulated** count that has to reach the boundary, never the accumulated count plus the call's own targets, so one bundled multi-file read (`cat a.ts b.ts c.ts`, exactly the batching `CLAUDE.md` mandates) is not refused as the first call of a run. A shell glob is not counted at all — it resolves to a literal path containing `*`, which no edit can ever name.

**One refusal per accumulation, re-armed by a delegation, or by the recorded refusal falling out of the window.** A run that reads on regardless is not refused a second time, so a false positive — three files it was about to edit — costs one round trip rather than wedging the run on the file it needs. **The second arm exists because the first one alone falls silent on a long run**: once the last delegation has scrolled out of the 256 KB tail there is no reset instant left to beat, and one stale stamp would disarm the rest of the session — on exactly the run lengths this was filed about. It is the same bound `josh batch:guard` documents for its own window, one extra refusal per window rather than silence, and it errs toward delegating. **The record is written before the refusal is made**: with nothing on record every later look at the same accumulation qualifies, so a hook that could not write one must not refuse. Every other failure allows the call too — a missing transcript, a payload that is not JSON, a tail caught mid-append. A hook firing inside a delegated unit is handed the _parent's_ transcript path and derives the fork's own file ([#1424](https://github.com/joshuafolkken/kit/issues/1424)), so a unit's reading is counted against the unit and never against the session that briefed it.

The refusal leaves through `hookSpecificOutput.permissionDecision`, the only shape that stops a call, and its `permissionDecisionReason` is the only text that reaches the model — so it names the count, `pnpm josh delegate investigation`, and the return shape a unit owes back. An ordinary call writes nothing at all to stdout. Set `JOSH_INVESTIGATION_GUARD` to `off`, `0`, `false` or `no` — in the environment or in `.env` — to switch it off without editing the settings file; unset is **on**, for the reason `JOSH_BATCH_GUARD` is. The `.env` read is `process.loadEnvFile` inside the script for the same in-process-dispatch reason ([#1342](https://github.com/joshuafolkken/kit/issues/1342)).

**Verify it the way #1390 asks to be verified**: run `pnpm josh time --issue <N>` afterwards and compare the pre-implementation phase — `plan` plus `setup`, or the run start to the first `Edit` where the phase table charges a delegated run to `pre-run` — against run #1441's hand-measured 15.4 min and 34%.

### `josh rule:value`

Report what each trigger-delivered rule's carried text earns **unaided** ([#1525](https://github.com/joshuafolkken/kit/issues/1525)). It reads this checkout's recorded sessions — the same corpus `josh time` and `josh cost` read — and prints one row per rule in `scripts/rules/delivered-rules.ts`:

```
pnpm josh rule:value                       # this checkout
pnpm josh rule:value /path/to/checkout     # a lane has no sessions of its own; name the primary one
```

| Column    | Meaning                                                                                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runs`    | Runs that reached the situation the rule governs — its trigger, or `reaches` where the row declares one. A run that never reaches it says nothing about the rule. A run's delegated units are folded into it, never counted beside it                            |
| `kept`    | Of those, the runs that kept the rule **unaided** — before the trigger fired, or without it firing at all, which is the ordinary case for a row that declares `reaches`. Runs are ordered by timestamp, so a unit's call counts before a later one in the parent |
| `refused` | Of those, the runs in which a refusal was delivered                                                                                                                                                                                                              |
| `unaided` | `kept / runs` — what the carried text earns with no help from the hook, or `-` / `no runs`                                                                                                                                                                       |

**The window before the delivery fires is the rule's absence.** A rule refuses at most once per run, so every session holds a stretch in which the hook has said nothing and only the carried text — the resident copy, where there is one — is asking for compliance. Compliance credited _after_ the trigger is the delivery's contribution, not the text's, and is deliberately not counted.

**`-` means unmeasured, never zero.** Naming the act that counts as keeping a rule is the rule's own business, so it sits on the enumeration beside the trigger as `keeps`; a row that declares none cannot be scored, and reporting `0` would assert "never kept" while `100` would assert the opposite. Every enumerated row declares one since [#1643](https://github.com/joshuafolkken/kit/issues/1643), so no row reads `-` today — the marker stays because the next row added may arrive without one.

**A trigger is not always the situation the rule governs, and the denominator follows the situation** ([#1643](https://github.com/joshuafolkken/kit/issues/1643)). `wip-cap` fires on the filing and `issue-comments` on the body read — acts a run that keeps the rule performs too, so the trigger _is_ the situation and nothing more is needed. The other four fire only on the violation: a run that backgrounded every push never trips `run-tail`, and one that passed every body by path never trips `shell-body`. Taking the trigger as the denominator there would score each rate over the runs that broke the rule at least once, and all four would read near zero by construction — a false retirement candidate, which is the one outcome this measurement exists to avoid. Such a row declares `reaches`, the governed act in **either** spelling, and that is what `runs` counts. A row without it is unchanged, which is why `wip-cap` and `issue-comments` read exactly what they read before.

**`no runs` is the other empty cell, and it is a different fact** ([#1642](https://github.com/joshuafolkken/kit/issues/1642)). A rule that declares `keeps` but whose trigger no recorded run reached has nothing to divide by either — but it is measurable, and one more run may score it. Both cells printed `-` until this was split, so a rule the corpus simply had not exercised read as one nothing can ever score.

**A group of transcripts holding no session of its own is not counted as a run, and the number dropped is printed.** Delegated units live in a `subagents/` directory beside their session's transcript and are folded into it; where the session file has been pruned and that directory survived, the units group under a parent that no longer exists. Scored as runs they would put subagent transcripts back into the denominator — the miscount [#1525](https://github.com/joshuafolkken/kit/issues/1525) closed, reached from the other side — so they are dropped, and `orphaned unit groups skipped: N` appears under `runs read` whenever any were.

**A refusal is identified from the parsed block, not by matching the raw line** ([#1642](https://github.com/joshuafolkken/kit/issues/1642)). The `refused` column counts an errored `tool_result` whose body **opens with** that rule's reason, which is how the hook writes one. The test it replaced looked for the literal `"is_error":true` anywhere in the line and then for the reason anywhere in the same line: one space after the colon in a future serializer would have taken every `refused` column to zero — indistinguishable from a hook that never fired — and a single `cat scripts/rules/delivered-rules.ts && false` scored a refusal against all six rules at once, because that file carries every reason verbatim.

**Use it to decide what leaves when the resident budget binds**, in place of the old order in which the sentence no marker pinned was the one that went ([#951](https://github.com/joshuafolkken/kit/issues/951)). The first reading refused the deletion it was built to justify: over 220 recorded runs the WIP cap, which keeps a resident copy, scored 55%, while the Issue-comments rule, which has none, scored 15% — so the resident text that looked most redundant on a reading of the prose is doing the most work. The retirement route the reading feeds is `.claude/skills/workflow-commands/SKILL.md` → §3.

**The second reading covered the other four and produced no candidate either** ([#1643](https://github.com/joshuafolkken/kit/issues/1643)). Over 225 recorded runs: `shell-body` 81%, `early-heartbeat` 67%, `wip-cap` 57%, `issue-comments` 15%, `piped-verification` 13%, `run-tail` 4%. **The two rules that keep a resident copy are the two at the top** — `shell-body` at 81% and `wip-cap` at 57% — and exactly one rule without a copy sits between them: `early-heartbeat`, at 67% over **18 runs**, the smallest denominator in the table by a factor of five. So nothing was retired, and `.claude/skills/workflow-commands/SKILL.md` → §3 records the reading rather than lowering the bar until a deletion appeared. **The figures move as the corpus grows**, so re-read them rather than quoting these when the question comes up again.

### `josh rule:guard`

Deliver a rule at the tool call that binds it, instead of carrying it resident in `CLAUDE.md` on every turn ([#1524](https://github.com/joshuafolkken/kit/issues/1524)). Like the other two guards it is not run by hand: `.claude/settings.json` wires it to `PreToolUse` and Claude Code pipes the call it is about to run to it as JSON on stdin.

```json
"PreToolUse": [
	{
		"matcher": "Bash",
		"hooks": [{ "type": "command", "command": "pnpm josh rule:guard", "timeout": 20 }]
	}
]
```

**It is a dispatcher, not a third guard.** `scripts/rules/delivered-rules.ts` holds one row per relocated rule — an id, the trigger read from the call, and the text the refusal states — and each row is a `hook_decision.create_transcript_guard` spec, the same shell `josh batch:guard` and `josh investigation:guard` already share. So the next rule that leaves residency costs a row and a test, never a fourth process in front of every call. The enumeration and the criterion that decides what belongs on it are `prompts/collaboration-workflow/rule-delivery.md`.

**The rules it delivers today.** The first is the backlog WIP cap: the trigger is a `Bash` call that files an Issue — `gh issue create`, or a `title`-bearing POST to a path ending in `/issues` (a title passed inside `--input <file>` is not visible to it) — and the refusal states the count, the refusal, both exemptions and the three tests that decide the interrupt one. **A comment endpoint is not a filing**: `…/issues/<N>/comments` is left alone, and so is a listing, because comments outnumber filings by a wide margin and a guard that fired on them would be the hook that fires on the wrong turns.

**The second row is the Issue's comments** ([#1319](https://github.com/joshuafolkken/kit/issues/1319)): the trigger is a `Bash` call that reads an Issue's body **without** them — `gh issue view <N>`, or a `GET` of a path ending `…/issues/<N>` — and the refusal hands over the reissue that carries them (`gh issue view <N> --comments`) together with the rule for a comment that contradicts the body. A read that already carries the comments is left alone: `--comments`, a `comments` field in a `--json` projection, and the comments endpoint anywhere on the line — the last one because batching puts the body read and the comment read on one line, and refusing that would refuse the very shape the rule asks for. **A write to the same path is not a read of it**: an explicit non-`GET` method, or any `-f` / `-F` / `--field` / `--raw-field` / `--input` (which makes `gh api` POST), is left alone — otherwise `kickoff`'s title-normalizing `PATCH` would spend the one delivery this run gets. The short `-c` is deliberately **not** read as "comments included", because `-c` belongs to `wc`, `grep` and `sort` far more often than to `gh`, and treating it that way silenced the rule on every compound line that ended in a pipe; a run that types `-c` pays one round trip instead. **It is the one row whose trigger `josh batch:guard` also considers**, so it stands aside on that guard's turn — recording nothing — and delivers on the reissue. The procedure it points at is `.claude/skills/workflow-commands/SKILL.md` → §2g, which is where the rule lives for a session that runs no hooks at all.

**The third row is the piped verification** ([#1556](https://github.com/joshuafolkken/kit/issues/1556)): the trigger is a `Bash` call in which a josh check whose result means pass or fail — `gate`, `check`, `lint*`, `cspell*`, `test*`, `eval`, `overrides`, `ranges`, in either spelling — stands anywhere but the last segment of a pipeline. A pipeline exits with its last command's status, so `pnpm josh gate 2>&1 | tail -40` reported success on a gate that had printed `✗ verification gate failed`. The refusal states the mechanism, the two ways to bound the output without losing the verdict (redirect to a file and read ranges from it, or prefix `set -o pipefail`) and the boundary. **A read-only listing is untouched**: `git log | head` and `gh issue list | head` are how a listing is properly read, and a rule wide enough to catch them would fire on the commonest shape in the transcript. `prompts/collaboration-workflow/output-bounds.md` is the single source.

**The fourth row is the early heartbeat** ([#1570](https://github.com/joshuafolkken/kit/issues/1570)): the trigger is a `Bash` call whose whole purpose is to wait — every segment is a `sleep`, or an inert `echo` / `:` / `date` beside one — and it is refused when a timer the guard already allowed is still live, or when the report that timer would produce would land before the silence interval is up. The shape is the discriminator because the intent is not visible: a call that sleeps and then does work is waiting _for_ that work, and a loop (`until …; do sleep 30; done`) ends on its condition rather than on a clock, so both are left alone. **The refusal is put in front of the arm rather than in front of the report**, because a report is written in prose and no hook can see it coming. **A live timer is counted from the record this row writes when it allows one**, never from the `sleep` processes on the machine — a process count cannot tell a heartbeat timer from a build step that sleeps. **An explicit ask is exempt by construction**: `pnpm josh run:progress --once` is not a wait timer and never matches — and neither is `pnpm josh run:progress --wait`, which is what a run reports with instead of sleeping ([#1576](https://github.com/joshuafolkken/kit/issues/1576)). It reads the last-report record `josh run:progress` keeps and the interval from `JOSH_PROGRESS_INTERVAL_MINUTES`, or one step below it from `josh.progress_interval_minutes` in `package.json`, through the same functions the watcher uses — **the environment variable is the floor, and `--interval` is the watcher's alone**, since a hook has no command line to read, so the flag can only make the watcher quieter than the floor and never the guard stricter. A work tree with no progress record has no clock, and the row stays silent there — which is what keeps an ordinary conversational session out of a rule written for unattended runs.

**Wired to `Bash` alone**, for the reason `josh batch:guard` documents: Claude Code denies one call of a turn and runs the rest, so a refused `Edit` would leave its siblings applied and itself not. Every rule the enumeration carries is therefore one whose binding moment is a shell call.

**One delivery per run — except for a row whose subject is a recurring act** ([#1570](https://github.com/joshuafolkken/kit/issues/1570)). Once is right where the refusal changes what the run _knows_: read the comments, count the Issues, put the body in a file. It is wrong where the refusal has to stop the same act happening again, because refused once and free afterwards is self-restraint with extra steps — and self-restraint is what failed. A row supplies its own `decide` to opt out, is still put behind the batching stand-aside, and says in its own text that it will fire again. Everything else is recorded by the same stamp the other two guards use, and the refusal text says so. Set `JOSH_RULE_GUARD` to `off`, `0`, `false` or `no` to switch it off; unset is **on**.

### `josh cspell`

Run spell check.

```bash
pnpm josh cspell          # *.{ts,js,md,yaml,yml,json}
pnpm josh cspell:dot      # includes dotfiles
```

### `josh test:unit`

Run unit tests with vitest. Because a freshly-bootstrapped project may have no unit suite yet
(and therefore no `vitest` installed), this command **skips gracefully (exit 0)** when `vitest`
is not installed — so CI and the local gate never block a project that has no unit tests yet.
Once both `vitest` and at least one test file are present, it runs `vitest run` as usual.

**`vitest` installed with no `*.{test,spec}.{ts,js}` file anywhere is a failure, not a skip**
([#1224](https://github.com/joshuafolkken/kit/issues/1224)). Installing vitest is the project
declaring that it runs unit tests, so an empty match there is a mis-scoped glob or a deleted suite
rather than a young project — and `pnpm josh followup` reads only the exit code, so a zero
would hand the merge gate a verification that verified nothing. `josh init` installs no vitest, so a
project that has genuinely not started testing yet takes the skip above and is unaffected.

```bash
pnpm josh test:unit
```

**A unit test that reaches the network fails the run.** In kit's own checkout `vitest.config.ts` arms
a `globalSetup` guard (`scripts/test-network-guard.ts`) that puts a recording `gh` in front of the
real one on `PATH`; if anything spawned it, the run ends with the invocations listed and a non-zero
exit ([#1353](https://github.com/joshuafolkken/kit/issues/1353)). The failure it exists for is
invisible otherwise — a test that calls through still **passes**, just slowly and against whatever
GitHub happens to answer, which is how one such test reached the 10-second test timeout in CI. The
fix is always in the test: mock the read it forgot. An unreadable record is reported as a failure too
rather than as "no violations", because a guard that cannot answer must not claim the run was clean.

**`git` is guarded too, and by subcommand**
([#1515](https://github.com/joshuafolkken/kit/issues/1515)). Guarding `gh` alone left the other way
out of the machine open, and two `followup` suites walked through it: a live `git fetch` inside the
release count they drove, once per test, 4.1s each against a 10-second timeout. Those two files were
half the unit suite's wall clock and failed the pre-push gate non-deterministically — on an idle
machine as readily as under parallel load, 63.7s of wall clock against 14.9 CPU-seconds. Unlike `gh`,
`git` cannot simply be refused: half the suite reads its own repository with `status`, `log`,
`rev-parse` and the worktree commands, and those pass straight through to the real binary. Refused
are `archive`, `clone`, `fetch`, `ls-remote`, `pull`, `push`, `remote`, `send-email` and `submodule` —
the last three whole, because splitting `remote update` from `remote -v` inside a shell `case` fails
open when it gets it wrong. The shim finds the subcommand behind git's own global options, so
`git -C <dir> fetch` is caught rather than read as a subcommand named after the directory.

**A unit test that writes into the repository the suite is running in fails too**
([#1530](https://github.com/joshuafolkken/kit/issues/1530)). Git exports `GIT_DIR` and
`GIT_INDEX_FILE` to every hook it runs and both beat `cwd`, so a test whose fixture helper passes
only `{ cwd }` builds its fixture inside the checkout the pre-push hook is firing in: three commits
titled `base` and `another lane merged` landed on a live lane's branch during `pnpm josh git`, and a
`git config user.email` wrote a fixture identity into a `--local` config that every linked work tree
shares. The same shim now refuses a **writing** subcommand on either of two findings: any git
location variable is still set in its environment, or the command resolves into the repository the
suite belongs to — its shared git directory, so a lane's write into a sibling work tree is caught as
well, and the resolution is asked with the caller's own `-C` / `--git-dir` in front of it rather than
from the shim's working directory. Reads are untouched, since half the suite reads its own repository
and a read cannot move a branch.

Which finding a subcommand faces depends on whether it has a reading spelling this suite uses.
`add`, `commit`, `init`, `reset`, `checkout`, `switch`, `update-ref` and their kind face **both**.
`apply`, `branch`, `config`, `notes`, `stash`, `tag` and `worktree` face the **environment finding
only**: `worktree list`, `branch --show-current` and `config --get` are ordinary reads of the real
checkout, an ambient working directory inside it is exactly how they are spelled, and splitting a
read from a write on its flags inside a shell `case` fails open when it gets it wrong. So a
deliberate `git worktree add` or `git config user.email <value>` run with a clean environment from
inside the checkout is **not** refused — the accident this guard exists for always carries the
inherited environment, which the first finding catches whatever the subcommand is.

The refusal happens at the call, so vitest names the test that made it, and the record read at
teardown is the backstop for a test that swallows the error. The fix is in the test: clear the git
location environment — `git_location_environment.location_free_environment()` in
`scripts/git/git-location-environment.ts` — and carry any identity on `-c` rather than writing it
into a config file.

Extending it found a second offender the same day, and one that only appears inside a hook:
`propagate-git.ts` passed the repository as `cwd`, which **`GIT_DIR` overrides** — and git exports
`GIT_DIR` to every hook it runs. Under `pnpm josh git`'s pre-push hook its probes therefore answered
about the checkout the hook was firing in rather than the path they were handed, so directories the
tests build deliberately as non-repositories resolved to the real one and the tree check fetched from
`origin` for them. That is the intermittent `propagate-guard` failure on
[#1515](https://github.com/joshuafolkken/kit/issues/1515), and why it never reproduced outside a push.
The probes now clear `GIT_DIR` and `GIT_WORK_TREE` for the child, so `cwd` means what it says.

### `josh test:related`

Run only the unit tests related to the files the change touched — the unit check an implementation loop repeats between edits ([#1257](https://github.com/joshuafolkken/kit/issues/1257)).

```bash
pnpm josh test:related                     # alias: josh tr
pnpm josh test:related scripts/thing.ts    # narrow by the given files instead
pnpm josh test:related --silent            # flags are forwarded to vitest
```

**A forwarded flag that takes a value is written `--flag=value`.** Anything not starting with `-` is read as a file to narrow by, so `--reporter verbose` would hand `verbose` to the narrowing — which then reports `verbose` as an argument it could not use and runs the **whole** suite — and a valueless `--reporter` to vitest; `--reporter=verbose` reaches vitest whole. An argument that is not a file this can relate a test to is named on the console rather than dropped, so a typo is visible instead of being answered with "nothing to narrow by".

The changed files are the branch diff plus the untracked files beside it — the same reading `josh review:level`, `josh eval:scope` and `josh review:brief` decide from, so what this narrows by is what those commands call the change. The set is then handed to `vitest related`, which runs every test file whose module graph reaches one of them. Measured warm on kit: 384 files and 6,616 tests in 13.9s (110s of CPU) for the whole suite, against 31 files and 566 tests in 2.4s (7.9s of CPU) for a one-file change — and 110s of CPU is 84% of everything the gate's four checks spend.

**It prints what it narrowed by before it runs**, so a scoped run is never read as a whole one:

```
josh test:related: 2 changed file(s) — running only the tests related to them.
  - scripts/test-related.ts
  - scripts/test-related-scope.ts
```

**It is added in front of the whole suite, never in place of it.** A test that breaks without importing what changed — a marker suite reading a document, a fixture compared against a generated file — is invisible to a module graph. The verification gate therefore still runs `josh test:unit` over everything before the commit, and that full run is what a merge rests on.

**Two things make it fall back to the whole suite rather than run nothing**, and the printed line says which happened:

| What happened                                                                     | What runs                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The changed files could not be read (no repository, a failing git)                | The whole suite — `the changed files could not be read`      |
| Nothing changed, or no changed file is one a test can import (a `.md`, a `.yaml`) | The whole suite — `no changed file is one a test can import` |

The two are separate answers on purpose: an empty list is a change this cannot narrow by, an unreadable one is a change nobody read, and collapsing them would hide the second. A deleted path is dropped from the set for the same reason — it counts towards a narrowed run while contributing no test to it.

A narrowed run can still match no test file — a new module nothing imports yet is the usual case. vitest prints `No test files found` and exits 0, which the gate's full run answers for a few minutes later.

Like `josh test:unit`, it goes through the same guard and says so naming itself: it skips gracefully (exit 0) when `vitest` is not installed, and fails when `vitest` is installed and the project has no test file at all ([#1224](https://github.com/joshuafolkken/kit/issues/1224)).

### `josh test:e2e`

Run E2E tests with Playwright. Because `@playwright/test` is an optional peer dependency
and a fresh project may have no e2e suite yet, this command **skips gracefully (exit 0)**
when `@playwright/test` is not installed or when no `*.e2e.{ts,js}` files exist — so the
`pre-push` hook never blocks a project that has opted out of e2e. Once both the package and
at least one e2e file are present, it runs `playwright test` as usual.

```bash
pnpm josh test:e2e
```

### `josh e2e:retry-check`

Report whether the preview server process died during a failed E2E attempt. Invoked by the `ci.yml` this package distributes, between the two attempts of its E2E job; there is no reason to run it by hand except to see how a captured log would be read.

```bash
pnpm josh e2e:retry-check   # alias: josh er
```

It reads the preview server's debug log — the path `WRANGLER_LOG_PATH` names, `e2e-web-server-logs` by default, a directory or a single file — and looks for wrangler's report of a dead worker: `Error in ProxyController` **and** `Network connection lost.`, both in the same file. An assertion failure produces neither, so a suite that merely failed does not match. The verdict is written to `$GITHUB_OUTPUT` as `crashed`, and announced on the run as a notice.

**It reports a fact; the workflow decides what to do with it.** That split is load-bearing rather than stylistic. The retry step ORs `E2E_RETRY_UNCONDITIONAL` in front of this output, so a push to the default branch retries whatever this command managed to say — its failure withholds a release, and a rule that can stop matching does not belong between a merge and its release ([#783](https://github.com/joshuafolkken/kit/issues/783)). A pull request has no such flag and retries only on the signature, so a genuinely failing suite still reports red on its first attempt ([#872](https://github.com/joshuafolkken/kit/issues/872)). Had the flag been passed down to this command instead, a step that errored — it carries `continue-on-error`, so that it can never be what fails a job — would publish nothing and cost the default branch the retry it must never lose.

**Neither string is a signature on its own, and they must meet inside one file.** `Network connection lost.` sits in the `cause` of every observed crash, but workerd also logs it for any aborted in-flight request, so matching it alone would hand a retry to exactly the failing suite this rule exists to expose. The per-file rule is the same guard one level up: a run that restarted the server leaves one log per attempt, and reading them as one text would let an aborted request in the first meet a proxy error in the second ([#911](https://github.com/joshuafolkken/kit/issues/911)).

**The pair has been read against real logs, not only reasoned about** ([#911](https://github.com/joshuafolkken/kit/issues/911)). It matches all 8 `e2e-web-server-log` artifacts game-kit retains, every one of them a genuine server death; and a run of game-kit's own suite that failed on an assertion with the server healthy throughout produces neither string anywhere in its log. Both logs are committed as fixtures the unit tests read, so a signature that stops describing wrangler's output turns into a red build rather than a silent change of behavior. One marker [#872](https://github.com/joshuafolkken/kit/issues/872) considered is deliberately unused: the bare `✘ [ERROR]` wrangler prints to the console appears in the healthy log too, three times, each an ordinary 404.

**A missing log is deliberately not a crash.** A consumer whose preview script is not wrangler writes nothing there, and reading silence as a crash would retry every failing suite in that project. Both ways of being wrong are cheap, which is what makes a signature acceptable on a pull request at all: a false positive spends one extra E2E run and still reports red, since the second attempt fails too, and a false negative leaves the status quo of a human pressing re-run. Nothing about reading the log is fatal either — a path that is missing, unreadable, or not the shape expected all end at "no crash" rather than at a failed job.

### `josh test`

Run unit tests followed by E2E tests.

```bash
pnpm josh test
```

`josh test` is a **composite command** and takes no extra arguments. Pass runner flags to the stage that understands them — `--workers`, `--grep` and `--headed` are Playwright's, `-u` is Vitest's, and a composite cannot route one vocabulary to both stages:

```bash
pnpm josh test:e2e --workers=1   # ✅ reaches Playwright
pnpm josh test:unit -u           # ✅ reaches Vitest
pnpm josh test --workers=1       # ❌ exits 1, naming test:unit and test:e2e
```

See [Composite commands and extra arguments](#composite-commands-and-extra-arguments).

### `josh check`

Type-check a SvelteKit project. Requires `@sveltejs/kit` in dependencies.

```bash
pnpm josh check        # development mode
pnpm josh check:ci     # strict mode (--threshold error), used in CI
```

### `josh port`

Print the port this project's dev server or preview server runs on, resolved from `PORT_SEED`.

```bash
pnpm josh port dev       # 5173 with no seed set
pnpm josh port preview   # 4173 with no seed set
```

Those two are for reading the number at a terminal. A `package.json` script that substitutes the number into a command line calls the binary without the `pnpm` wrapper — see the scripts below and the paragraph explaining why.

Every kit-distributed SvelteKit project used to land on the same two ports, so a developer working across several of them on one machine could not run two previews at once — the second project's tooling either collided with the first or drifted onto an unpredictable port. `PORT_SEED` is a personal, non-committed integer in `.env` that offsets both ports together:

```bash
PORT_SEED=1   # dev 5174, preview 4174
```

Unset means seed `0` — today's numbers exactly — so CI and un-migrated projects are unaffected without doing anything. A blank `PORT_SEED=`, the shape `.env.example` ships and the natural way to turn a seed back off, means the same. One seed moves both ports, so a project can never end up with a dev port from one project and a preview port from another. An invalid seed (a non-integer, a negative, or one that would push a port past `65535`) is a hard error rather than a silent fall back to the default: a gate that quietly reverts to the shared port is the collision this exists to remove.

This command and `playwright.config.ts` read one definition and one file. The config imports the same module directly (`import { ports } from '@joshuafolkken/kit/ports'`) and calls `ports.load_environment_file()` before resolving the ports, so the E2E suite follows the seed with no configuration — through `pnpm josh test:e2e`, a bare `pnpm exec playwright test` and the VS Code Playwright extension alike. This command calls the same loader, so the two cannot answer a consumer's `preview` script and its `webServer` with different numbers; in kit 1.85.0 they did, producing `4176` here and `4173` there and costing a consumer its whole E2E suite to a `webServer` timeout. A variable already set in the environment still wins over the file, so `PORT_SEED=2 pnpm josh test:e2e` overrides `.env` for one run.

Two settings cross from `.env` into the process, and no others: `PORT_SEED` and `PLAYWRIGHT_REUSE_SERVER` — the ones kit's own Playwright config reads. `CI` is deliberately excluded even though that config reads it too, because it describes the run rather than the project, and a value pinned in a file would make every local run claim to be CI. The file is parsed in full, by the same reader Node's `--env-file` uses, and every other key it carried is then taken back out of `process.env`. Playwright's `webServer` child inherits the test runner's environment wholesale, so keeping the rest would hand a consumer's `.env` secrets to the dev or preview server for the sake of two settings: a `CLOUDFLARE_API_TOKEN` sitting there is preferred by `wrangler` over the OAuth session it would otherwise use, and one short of the needed scopes turns a working preview into a `403`. A server that wants `.env` loads it in its own start script, which is where that choice belongs.

This narrows what kit 1.87.0 did for the one version it shipped: that release loaded the whole file, so a `webServer` command and any E2E spec briefly saw every variable in `.env`. If a project came to rely on that — a spec reading a test account's password, say — load the file where it is needed rather than through the port loader: `process.loadEnvFile()` in a Playwright [global setup](https://playwright.dev/docs/test-global-setup-teardown) puts it back for the test process without also handing it to the server, and a `set -a; . ./.env; set +a` prefix in the start script does the same for a server that needs it.

The file is looked for at the project root — the nearest directory at or above the working directory holding a `package.json` — and only there. That is the directory `pnpm run` hands a script, so it is the file the `webServer` command and this command both read. A `.env` beside the caller is deliberately not preferred over the root's: letting an `e2e/.env` of unrelated fixture data shadow the seed would re-create the timeout above. Resolving against the working directory alone used to do exactly that, leaving `pnpm exec playwright test` run from a subdirectory on seed `0` while its own server came up seeded.

This command exists for the contexts that cannot import the definition — a `package.json` script substitutes its output into a command line:

```json
{
	"scripts": {
		"dev": "DEV_PORT=$(josh port dev) && vite dev --port $DEV_PORT --strictPort",
		"preview": "PREVIEW_PORT=$(josh port preview) && wrangler dev --port $PREVIEW_PORT",
		"preview:stop": "PREVIEW_PORT=$(josh port preview) && kill-port $PREVIEW_PORT"
	}
}
```

Two details in that shape are load-bearing, and dropping either one puts the substitution back where #825 found it.

**`josh`, not `pnpm josh`.** `pnpm run` already puts `node_modules/.bin` on `PATH`, so the bare binary reaches the same command — and reaches it without a wrapper process writing to the stream the substitution reads. When `node_modules` is older than `package.json`, `pnpm` installs before running and puts the install log and every lifecycle script's output on **stdout**; `josh latest` and a branch switch both leave a tree in that state routinely. And in any project whose `package.json` defines a `josh` script — kit's does, and so does a consumer that wires one — `pnpm josh …` resolves to `pnpm run josh …`, which adds `[ELIFECYCLE] Command failed with exit code 1.` to that same stream when the command fails, so `$(pnpm josh port dev)` hands that sentence to `--port` on an invalid seed. Neither output is something this command can suppress from the inside — they belong to a process kit does not own. Calling the binary directly leaves kit in control of the whole stream, which is what turns "success prints the number and nothing else" from a hope into a promise.

**`VAR=$(...) && cmd`, not the substitution inline.** A failed substitution does not stop the command it feeds: the shell supplies nothing and starts the server anyway, on whatever `--port` then parses as. Assigning first makes the resolver's failure the script's own exit status, so an invalid seed stops at kit's message naming the variable to fix instead of at a vite or wrangler argument error. If a teardown script needs to tolerate "nothing was listening", brace that tolerance — `PREVIEW_PORT=$(josh port preview) && { kill-port $PREVIEW_PORT || true; }` — because a trailing `|| true` binds to the whole chain and forgives the unresolved port along with the absent server.

Success prints the number and nothing else; a missing or unknown argument prints usage to stderr and exits `1`. An unrecognized command name answers the same way — `josh` sends the error line **and** the help listing to stderr — so a script naming a command this kit does not have substitutes an empty string rather than the whole toolkit index.

That listing is where #825 was found, and the remedy for the case that found it lives outside this file: the listing used to go to stdout, so a consumer whose installed kit predated `josh port` had the entire toolkit index substituted into `--port`. A kit old enough to lack the command is also old enough to lack the fix, so the guarantee above covers a mistyped or retired command name on a kit that carries it — not an outdated install. Pair the wiring with a `@joshuafolkken/kit` floor recent enough to have `josh port`.

A busy port still **fails loudly** — nothing retries on another port. Incrementing the seed automatically would re-create the vite drift this replaces and would let a verification gate route silently around a stale server. `--strictPort` is what holds vite to that on the `dev` script: a bare `vite dev --port N` moves to the next free port when `N` is taken, and a dev server quietly on `N + 1` is invisible to Playwright, which waits on the seeded port until `webServer` times out. See [Local E2E aborts with "already used"](./troubleshooting.md#local-e2e-aborts-with-httplocalhost5173-is-already-used).

### Composite commands and extra arguments

A few `josh` commands chain several steps behind one name. They are implemented as a fixed shell script (`sh -c '<step> && <step>'`), and a shell script does not expand arguments appended to it — so anything typed after the command name would land in the shell's positional parameters and be discarded without a word.

**The convention: a composite command either forwards extra arguments deliberately, or refuses them. It never ignores them.** Today every composite refuses, exits `1`, and names the sub-commands that do accept arguments:

```bash
$ pnpm josh test --workers=1
josh test takes no extra arguments — pass them to josh test:unit or josh test:e2e instead
```

| Composite | Pass arguments to instead                   |
| --------- | ------------------------------------------- |
| `test`    | `test:unit`, `test:e2e`                     |
| `format`  | `format:prettier`, `format:eslint`          |
| `latest`  | `latest:corepack`, `latest:update`, `audit` |

Every other command — the ones that invoke a single tool or script — forwards extra arguments exactly as before; `pnpm josh test:e2e --workers=1` reaches Playwright unchanged.

The refusal is driven by the **shape** of the command rather than a per-command opt-in, so a composite added later cannot reintroduce the silent discard by forgetting to declare itself. A unit test audits the whole command map on every commit.

The shape rule reads `shell` entries, which leaves one case outside it: a **script** that fans out to several sub-commands and forwards nothing, as [`josh gate`](#josh-gate) does. Such a script refuses for itself, reusing the message above so the two read identically — a `script` entry that runs a single tool still forwards its arguments as before. [`josh main:sync`](#josh-mainsync) and [`josh main:merge`](#josh-mainmerge) refuse the same way for the same reason: both left the table above when they became scripts, not because either started accepting arguments.

---

## Project

Commands for setting up and maintaining a project.

### `josh init`

Initialize config files in a new project.

```bash
pnpm josh init
```

Creates or merges all config files. See [init.md](./init.md) for the full list of files created and merged.

`init` writes nothing and exits non-zero when the project is the distribution package's own repository, for the reason [`josh sync`](#josh-sync) does and through the same check — `init` calls the sync writers directly, and rewrites the project's `package.json` scripts and devDependencies on top of them ([#879](https://github.com/joshuafolkken/kit/issues/879)). See [init.md](./init.md#refused-inside-the-packages-own-repository).

`init` also reports two **repository settings** as its last step, because it writes the two files that depend on them. The **Dependabot security updates** setting backs the npm-disabling `.github/dependabot.yml`, and the **Allow auto-merge** setting backs `.github/workflows/dependabot-auto-merge.yml` — a freshly scaffolded repository has both off by default. Each line is skipped when the project already had its own copy of the corresponding file, since `init` does not overwrite it and kit's change never landed. See [`josh doctor`](#josh-doctor) for the results each report can print and [docs/sync.md](./sync.md) for why the settings matter.

### `josh sync`

Overwrite managed files with the latest versions from the package.

```bash
pnpm josh sync
```

Run after upgrading `@joshuafolkken/kit` to pull in updated AI files, GitHub workflow templates, and other managed files. See [sync.md](./sync.md) for the full list. `sync` also realigns `devEngines.packageManager.version` in `package.json` with the `packageManager` pin so the two never drift apart (a mismatch reintroduces the pnpm `Cannot use both "packageManager" and "devEngines.packageManager"` warning).

`sync` writes nothing and exits non-zero when the project is the distribution package's own repository — inside kit, the copies run backwards and overwrite the source with its own derived templates ([#868](https://github.com/joshuafolkken/kit/issues/868)). See [sync.md](./sync.md#refused-inside-the-distribution-packages-own-repository).

### `josh sync:scope`

Say whether this change touches a file `josh sync` distributes ([#1578](https://github.com/joshuafolkken/kit/issues/1578)).

```bash
pnpm josh sync:scope           # the branch diff; alias: josh sys
pnpm josh sync:scope --staged  # the staged diff instead
pnpm josh sync:scope --json    # {"scope":"managed","reason":"..."}
```

The answer (`managed` or `clean`) goes to stdout and the reason to stderr, so a caller can read one without parsing the other. Exit status is `0` for both answers — this reports, it does not gate — and since [#1592](https://github.com/joshuafolkken/kit/issues/1592) neither does `pnpm josh followup`, which asks the same question and names the claimed paths in its completion report instead of stopping the merge.

**A command rather than an instruction, for the reason `josh review:level` is one.** The answer it gives used to be a paragraph telling the run to compare `git diff main...HEAD` against three arrays in `scripts/init/init-logic.ts` by eye. Measured over one epic's children on 2026-09-08, three pull requests changed a distributed file and **two merged without the comparison being made at all**.

**One of those two could not have succeeded by eye.** `AI_COPY_DIRECTORIES` holds directories, not files, so a distributed path need not appear in any list textually — `.claude/skills/workflow-commands/epicrun.md` matches nothing a reader can scan for, and resolving it means solving a prefix match by hand.

| List                    | What it holds                                                                                                                                                                                                                                                                                | How a path matches                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_COPY_FILES`         | repository-root file paths                                                                                                                                                                                                                                                                   | exact equality                                                                                                                                              |
| `AI_COPY_FILE_MAPPINGS` | `{ src, dest }` pairs                                                                                                                                                                                                                                                                        | equality against **either** end — `src` is this repository's template path, `dest` the consumer's                                                           |
| `AI_COPY_DIRECTORIES`   | directory paths, no trailing slash                                                                                                                                                                                                                                                           | the path is the directory, or sits under it — the separator is appended first, so `…/workflow-commands-extra/a.md` does **not** match `…/workflow-commands` |
| `SYNCED_PATHS`          | the destinations `sync` writes directly — `playwright.config.ts`, `prettier.config.js`, `eslint.config.js`, `tsconfig.json`, `cspell.config.yaml`, `lefthook.yml`, `.npmrc`, `.gitignore`, `.secretlintrc.json`, `.vscode/*`, `.github/workflows/deploy-vps.yml`, `sonar-project.properties` | exact equality                                                                                                                                              |

**The fourth source is not decoration.** `josh sync` distributes more than the three `AI_COPY_*` lists, and a matcher reading only those was **narrower than the instruction it replaced** — whose own worked example was `playwright.config.ts`, a file none of them holds. `scripts/sync/synced-paths.test.ts` reads `scripts/sync/sync.ts` and fails when it writes to a destination the list does not name, so the two cannot drift the way a hand-copied list would. `package.json` is deliberately excluded: `sync` realigns one field of it rather than overwriting it, so listing it would put a line in the report of every dependency change in every repository.

The reason names the list beside each path, because that is the half a reader cannot derive. The changed paths come from the same helper `josh review:level` and `josh eval:scope` read, so all three answer from one definition of what changed.

### `josh propagate`

Carry the release this repository just published into every consumer repository checked out next to it ([#863](https://github.com/joshuafolkken/kit/issues/863)).

```bash
pnpm josh propagate                     # alias: josh pg
pnpm josh propagate --dry-run           # report the targets and the steps without touching anything
pnpm josh propagate --skip-publish-wait # for a release already known to be published
```

Any other argument is refused with the usage line rather than ignored — a misspelled `--dryrun` that fell through would run the real write path against every consumer.

`--dry-run` writes nothing, so it also skips the publish wait and downgrades the supplier-side working tree check to a warning: the flag is reached for while work is still in progress, and refusing there would make it useless in exactly that situation.

Publishing a release and consuming it are two different jobs, and only the first is automated: every merge auto-tags and publishes, and then a person opens app-kit, runs the upgrade, syncs the managed files, verifies, and opens a pull request — then does it again in the next consumer. `propagate` is that loop, run once.

**It waits for the publish first.** A merge is not a publish: the auto-tag and publish workflows run _after_ the merge commit lands, so a consumer told to upgrade the moment the pull request merged resolves the previous release. `propagate` polls the registry until **this repository's own declared version** — the one the merge published — actually appears. The target is that exact version, never "something newer": a consumer several releases behind would otherwise be satisfied by any publish at all, including one that predates the change being carried. The wait has a timeout, because a failed publish workflow never produces the version; on timeout, or on a registry that fails several probes in a row, **no consumer is touched at all**. A _single_ failed probe is not that — a rate limit or a 5xx would otherwise end a ten-minute wait seconds into it — so the wait keeps going until the failures are consecutive.

Then, for each consumer in turn:

| Step               | What runs in the consumer's directory                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| Working tree check | Clean tree, on the default branch, not behind its remote (fetched first)           |
| Upgrade            | `pnpm add -D @joshuafolkken/kit@<version>`, plus kit's lockfile repair             |
| Sync               | `pnpm josh sync`                                                                   |
| Verify             | `pnpm josh lint && pnpm josh check && pnpm josh cspell:dot && pnpm josh test:unit` |
| Open issue         | `POST repos/<consumer>/issues` — the upgrade issue the pull request will close     |
| Pull request       | `pnpm josh git -y "Upgrade @joshuafolkken/kit to <version> #<N>"`                  |
| Return             | `git checkout <default>` and pull                                                  |

**The working tree check comes first because everything after it writes.** The upgrade rewrites the lockfile, the sync overwrites managed files, and `josh git` stages the whole tree — so a consumer with uncommitted work would have that work swept into the upgrade commit and pushed. A consumer that is dirty, parked on a feature branch, or behind its remote is refused before anything touches it. The remote is fetched before that comparison: without it both refs are pre-merge and the check passes in exactly the situation it exists for — the seconds after a pull request merged on GitHub.

**The upgrade pins the exact version that was waited for**, rather than asking for the registry's latest. Asking for latest would defeat the wait: a release published while the run was in flight would be the one every consumer received.

**The issue is opened before the pull request because `josh git` requires one.** It derives the branch name and the `closes #N` line from the issue argument, so an upgrade with no issue could not open a pull request at all. `propagate` therefore **opens a GitHub issue in each consumer repository** — an outward-facing write, and the reason the command is scoped to repositories with the same owner. Merging the pull request closes it. When the upgrade and the sync changed nothing, no issue is opened at all and the consumer is reported as a skip; opening one and then failing on an empty commit is the alternative.

**It is created through REST rather than by running `gh issue create`.** That command goes through GraphQL, which a cloud session is answered 403 for, so propagation could not open the consumer's issue from one at all — while `POST repos/{owner}/{repo}/issues` is served normally (joshuafolkken/kit#1042). The issue body travels over standard input, so its multi-line markdown depends on no shell quoting, and the path names the consumer repository outright rather than relying on the directory the call is spawned in. **That request is bounded in time like every other step**, but by a shorter budget: the other steps go through the step runner and get 30 minutes — enough for a consumer's whole unit suite — while a single REST request gets 60 seconds, and a request that overruns it is reported as a failed step rather than holding the single-threaded runner open forever with no later consumer processed at all ([#1065](https://github.com/joshuafolkken/kit/issues/1065)). **A write that ran out of time is not proof the write did not land** — the request may have reached GitHub before the call was killed. Nothing looks for an issue a previous run may have opened, so a consumer reported as failed at the issue step is checked by hand before the run is repeated, alongside the uncommitted working tree that failure already leaves behind.

**The consumer is returned to its default branch last.** `josh git` leaves the checkout on the feature branch, and the next propagation's working tree check would refuse it for that — the consumer would silently stop receiving releases.

Each step runs the **consumer's own** installed CLI from the consumer's directory, which is why the sync is an ordinary consumer-side sync and [#868](https://github.com/joshuafolkken/kit/issues/868)'s self-sync refusal never fires. Every step inherits its output, so a failure shows what failed rather than only an exit code, and each has a timeout so one hung step cannot hold the whole run open. A consumer stops at its first failing step — a failed verification gate never goes on to open an issue or a pull request — and **one consumer's failure never stops another**: the run continues and reports every consumer at the end, because knowing which consumers took the release is the whole point.

**A failed `josh git` is reported by sub-step, not as one exit code** ([#1417](https://github.com/joshuafolkken/kit/issues/1417)). That one command stages and commits, pushes, and opens the pull request, and a failure in any of the three used to arrive as `exit 1` with the standing "upgrade/sync changes left uncommitted" note appended — which names the **first** of the three. A consumer whose own pre-push gate refused the push had already committed, so the note was false and sent the reader to look at a sync that had worked. The consumer's repository is therefore read after the failure, and the report names what it found:

| What the consumer holds                                            | What the report says                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Still on its default branch, or a branch with no commit of its own | `nothing was committed`                                                          |
| A commit on the feature branch, and origin has no such branch      | `committed <sha> on <branch>, but the consumer's pre-push hook refused the push` |
| The same, but the push would not go through even unhooked          | `committed <sha> on <branch>, but the push did not reach origin`                 |
| The branch is on origin                                            | `the branch reached origin, but the pull request was not opened`                 |

**The hook and the transport are separated by a probe, not by a guess**: `git push --dry-run --no-verify` against that branch. Both failures leave the commit local and origin without the branch, and only that answers which happened. It writes nothing, and `--no-verify` is scoped to the probe — **`propagate` never pushes past a consumer's gate, and a push that gate refused stays refused.** The report then quotes the **last lines `josh git` printed**, which is where a pre-push hook names the check that stopped it; nothing else in the run keeps them. Each stream is tailed separately, because git writes its refusal to stderr while a hook's own progress commonly goes to stdout, and a tail across the two concatenated would drop whichever came first.

**Keeping those lines costs the pull-request step its live output, and only that step.** A synchronous spawn gives one target per file descriptor, so the output cannot be both inherited and captured: it is buffered and printed when `josh git` finishes. Nothing is lost, every other step still prints as it runs — the consumer's own verification gate, the long one, included — and the alternative was to reproduce the message by pushing again with hooks enabled, which runs the consumer's whole gate a second time.

**A consumer whose pnpm pin is older than the patched version fails there every time.** Its own pre-push `audit` step refuses, the report's quoted tail ends on that step, and `propagate` has no route to fix it: the pin lives in `devEngines` / `packageManager`, updating it is [`josh latest`](#josh-latest)'s job, and rewriting it needs explicit approval (`CLAUDE.md` → Tier C). So the run reports the cause and stops there — run `pnpm josh latest` in that consumer, then propagate again.

**Which repositories are consumers is read, not listed.** The candidates come from the [repository map](#the-discovered-repository-map), so the owner restriction is inherited rather than restated — propagation _writes_, and a write aimed at somebody else's repository is worse than a read aimed at one. A candidate becomes a target when its own `package.json` declares a dependency on `@joshuafolkken/kit`, which is a fact about the checkout rather than a roster: a new consumer needs no change here, and a consumer that is not a published package at all (joshuafolkken-com) is covered, which a list of downstream package names could not do. Candidates that are not targets stay in the report as skips — a consumer silently missing from a run is the failure this command exists to remove.

| Reported as    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `✓ propagated` | Checked, upgraded, synced, verified, issue and pull request opened, returned to the default branch. (`would be propagated` in a dry run, which opens nothing.)                                                                                                                                                                                                                                                 |
| `✗ failed`     | A step failed; the step and its reason are named. The other consumers still ran. **What the failure left behind is named too** — the uncommitted changes, the branch, or both — read from the consumer rather than assumed from which step ran ([#1417](https://github.com/joshuafolkken/kit/issues/1417)). Whatever it names has to be cleared before the next run, which will otherwise refuse the consumer. |
| `– skipped`    | Already carries this release, does not depend on the package, had nothing to commit, has no local checkout, or has an unreadable `package.json`.                                                                                                                                                                                                                                                               |

The skips are kept apart because they mean different things. A repository with no `package.json` at all — a Godot or Rust project sharing the parent directory — is simply _not downstream_, not damaged. A `package.json` that exists but cannot be parsed is reported as unreadable. And a mapped path that does not exist (only `JOSH_REPO_PATHS` can name one, since discovery scans directories that do) is reported, **never cloned**: propagation writes into a working tree, and creating one nobody asked for is not a step this command takes on its own. A consumer that is dirty or out of date is reported as a _failure_ rather than a skip — it was eligible and could not be processed.

**`propagate` runs from the supplier's own repository, and only there** — and only when that repository is itself clean, on its default branch, and not behind its remote. Run from a checkout that is behind, the version it would carry is the _previous_ release, which is already published: the wait would pass and every consumer would be sent to a version that does not contain the change.

That boundary is also the answer to who propagates when several sessions are running at once ([#861](https://github.com/joshuafolkken/kit/issues/861)): in the per-repository concurrency model there is one session per checkout, so the session standing in the supplier repository is the one that runs the command and the rest refuse. It is a convention enforced at the boundary, not a lock — two checkouts of the supplier would both pass it — which is why each consumer is _additionally_ refused unless its own working tree is clean.

Because every merge publishes, propagating per pull request would bury the consumers in bump pull requests. Run it **once at the end** of an epic or a queue; it works standalone all the same.

The opposite direction — one consumer catching itself up, from its own checkout — is [`josh adopt`](#josh-adopt). The two share the step sequence, so what a consumer receives is the same either way.

> To make `josh` available system-wide, install the kit globally (`pnpm add -g @joshuafolkken/kit`) instead of running an install subcommand. See [cli.md](./cli.md) for details.

---

### `josh adopt`

Upgrade every `@joshuafolkken/*` toolkit installed in **this** repository to latest, sync each one's managed files, verify, and open the issue and pull request ([#1085](https://github.com/joshuafolkken/kit/issues/1085)).

```bash
pnpm josh adopt           # alias: josh ad
pnpm josh adopt --dry-run # report the steps without touching anything
```

Any other argument is refused with the usage line rather than ignored, for the reason [`josh propagate`](#josh-propagate) refuses one: a misspelled `--dryrun` that fell through would run the real write path.

It is `propagate` seen from the other end. `propagate` stands in the supplier and pushes one released version out to every consumer; `adopt` stands in the consumer and pulls whatever is newest in. Everything else is the same — literally, not by resemblance: both run `propagate`'s step order through the same runner, so the working-tree pre-check, the ordering and the return to the default branch cannot drift apart.

|           | [`josh propagate`](#josh-propagate)           | `josh adopt`                              |
| --------- | --------------------------------------------- | ----------------------------------------- |
| Runs from | the supplier repository                       | the consumer repository (the current one) |
| Targets   | every consumer checked out next to it         | itself, one repository                    |
| Version   | the exact version whose publish it waited for | each installed toolkit's latest           |

The steps, in the consumer's own directory:

| Step                       | What runs                                                                       |
| -------------------------- | ------------------------------------------------------------------------------- |
| `working tree check`       | refuses a tree that is dirty, not on its default branch, or behind its remote   |
| `josh vu`                  | `pnpm add -D <toolkit>@latest`, **once per installed toolkit**, base tier first |
| `josh sync`                | that toolkit's own CLI — `pnpm josh sync`, then `pnpm josh-app sync`, once each |
| `verification gate`        | [`josh gate`](#josh-gate)                                                       |
| `open issue`               | one issue naming every toolkit the run carried                                  |
| `josh git`                 | [`josh git`](#josh-git) against that issue                                      |
| `return to default branch` | back to the default branch, so the next run's pre-check passes                  |

**The upgrade and the sync repeat per toolkit; everything else happens once.** An app-kit project depends on both `@joshuafolkken/kit` and `@joshuafolkken/app-kit`, and each has its own CLI — `josh` and `josh-app` — so a run that synced only `josh` would leave app-kit's managed files behind. One pull request carries both.

**They run base-first, never in name order.** app-kit and game-kit distribute files _derived_ from kit's, so the two tiers can manage the same path and whichever `sync` ran last decides its contents (see [sync.md](./sync.md)). kit syncs first and the toolkits that overlay it follow; alphabetical order would put kit last and have it overwrite the overlay with the original on every run.

**Which toolkits are installed is read, not listed.** The scoped packages in `devDependencies` are the candidates; a candidate is a target only when its CLI shim is actually present in `node_modules/.bin`, and its CLI name comes from the installed package's own `bin` field rather than a table in kit. A fourth toolkit needs no edit here.

**A declared toolkit that cannot be carried refuses the run — it is never dropped from the plan** ([#1540](https://github.com/joshuafolkken/kit/issues/1540)). Both ways one falls out stop the run before anything writes, naming each package and the one command that fixes it:

| What was found                                                                 | What happens                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| A runnable toolkit declared under `dependencies` rather than `devDependencies` | refused — move it with `pnpm add -D <toolkit>`                |
| A declared package that is missing here, or whose CLI shim is not installed    | refused — `pnpm install` (either field)                       |
| A scoped package that is installed and simply ships no CLI                     | **ignored** — it is a library, and nothing about it is broken |

`dependencies` is deliberately not read for the plan: the upgrade installs with `pnpm add -D`, so a toolkit declared there would be _relocated_ into `devDependencies` — a manifest rewrite nobody asked for, riding silently into the pull request.

**The refusal names only what it can prove**, which is why the third row exists. The `@joshuafolkken/` prefix says nothing about whether a package is a toolkit, so a shared config or a types package under that scope must not be told to reinstall — it is already installed — nor to move out of `dependencies`, which would break the build it is there to serve. A package counts as a toolkit only when its own installed `bin` field says so.

**Continuing without one is worse than not running at all**, which is why this refuses rather than warning. The toolkits overlay files _derived_ from kit's (see [sync.md](./sync.md)), so a run that syncs kit without the overlay does not merely do less — it rewrites the overlay's paths back to kit's originals. That diff then arrives in the pull request wearing kit's own face, where a reviewer has nothing to notice. The refusal is also what the `--dry-run` reports, so what the dry run lists stays what the real run does.

**`@joshuafolkken/kit` has to be one of them.** The verification gate and the pull request run through `pnpm josh`, and pnpm writes that shim only for a project's _direct_ dependencies — so a repository declaring only app-kit or game-kit would fail both steps _after_ the upgrade and the sync had written. That is refused up front, before anything writes.

**Nothing to do is a skip, not a failure.** With no `@joshuafolkken/*` toolkit _declared_, or with every toolkit already current and the sync rewriting no file, the run reports the skip and opens neither an issue nor a pull request — exit code 0. A toolkit that is declared but cannot be carried is the refusal above, not this skip: nothing declared and something declared-but-unreachable are different states, and only the first is a no-op. A failed verification gate stops before the issue, so a red gate never produces one either.

**It refuses to run inside kit's own repository**, the same boundary [`josh sync`](#josh-sync) draws ([#868](https://github.com/joshuafolkken/kit/issues/868)) and for the same reason: the sync would overwrite the distribution source with its own derived templates. The refusal comes before anything writes. Only kit is refused — app-kit and game-kit are themselves consumers of kit, which is exactly what this command is for.

**It stops at the open pull request.** Merging is `pnpm josh followup "<title> #N"`'s, under an authorization a CLI does not have.

---

## Workflow

AI-assisted git and notification helpers used in the day-to-day development loop.

### `josh git`

Interactive AI-assisted git commit workflow: stages changes, generates a commit message, and optionally pushes.

```bash
pnpm josh git
pnpm josh git -y          # run non-interactively (skip confirmation prompts)
pnpm josh git -y "title"  # set commit message prefix
```

`-y` / `--yes` runs the workflow unattended — it also works without a TTY (e.g. an AI agent or CI shell). When no issue argument is supplied, the issue number and title are derived from the current branch name (`<N>-<slug>`), so recovery commands such as `pnpm josh pr` and `pnpm josh git -y --skip-commit --skip-push` create the PR without prompting.

**The command returns as soon as the pull request is open; it does not wait for the checks.** It prints the PR URL and a line naming `pnpm josh followup`, which is what waits and merges. Until [#1232](https://github.com/joshuafolkken/kit/issues/1232) it slept five seconds and then watched the rollup on a two-minute budget — measured at 119.8 seconds of one 1555-second run, 7.7% of it — and the answer decided nothing: only whether the watch timed out was read, and only to choose which message to print. `followup`'s own wait asks a stricter question (a `CLEAN` merge state, every required check green, no standing change request) and starts from scratch the moment `josh git` returns, so the same answer was being waited for twice. Nothing the merge requires was dropped; `followup` still blocks on every one of those checks.

**Running it a second time on the same branch makes a follow-up commit, not a second pull request.** The command reuses the branch it is already on when the issue prefix matches, and when a pull request for that branch is already open it reports it rather than creating another. That is the path the second review round takes when it fixes a finding in place: since [#1261](https://github.com/joshuafolkken/kit/issues/1261) the pull request opens _between_ the two rounds so CI overlaps the second, and a fix it produces is committed on top — with no version change on either commit, since [#1486](https://github.com/joshuafolkken/kit/issues/1486) took the bump out of the child flow entirely. **Since [#1326](https://github.com/joshuafolkken/kit/issues/1326) that commit goes out before its gate**: the single check the fix reaches (`pnpm josh lint:related` and friends), then `pnpm josh git -y "<title> #<N>"` again, then `pnpm josh gate` started beside the CI cycle that push begins and joined before `pnpm josh followup`. `pnpm josh followup` waits on the head commit's checks, so the CI re-run that follow-up commit starts is the one the merge rests on — and a further push supersedes an in-flight cycle, which `ci.yml`'s `concurrency: cancel-in-progress: true` cancels rather than running to completion.

**Each push is bounded at 120 seconds and retried once** ([#1251](https://github.com/joshuafolkken/kit/issues/1251)). It used to be the one network call in this package with no budget at all: measured on [#1244](https://github.com/joshuafolkken/kit/pull/1244), the commit took 0.6 seconds and the push then sat silent for 8 minutes 13 seconds before it was found and killed by hand — about 9 minutes 50 seconds of a 72-minute run, with no way while waiting to tell a stalled push from a slow one. A healthy push here costs 22–33 seconds, so 120 leaves room for a large first push while failing a hang in a fraction of the time it used to take. Only a push killed on the budget is retried, and only once: a push the remote rejected answers the same way every time. When the retry times out too, the failure names the exact command to re-run by hand. The budget covers **one** push rather than the whole command — a bare push that has to fall back to `--set-upstream` is a second bounded push — and time spent at a credential prompt counts against it, since an inherited terminal cannot tell waiting on a person from waiting on a remote.

**The SSH keepalive is only added when nothing else decides how ssh is invoked.** With none of `GIT_SSH_COMMAND`, `core.sshCommand` and the legacy `GIT_SSH` set, the push runs under `ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3`, so a connection that dies mid-transfer is noticed in about 45 seconds instead of waiting on the TCP default. Set any of them and yours is used untouched: those options are OpenSSH's, and appending them to `plink` or to a wrapper script with a fixed argument list would fail on a usage error rather than push. Those setups keep the timeout above, and `ServerAliveInterval` belongs in their own ssh config, where it applies to every tool they run.

**Conflict diagnosis moved with it, and got faster.** `josh git` used to read `mergeStateStatus` once the watch reported the checks settled, which is why it could treat `BLOCKED` as a problem — at the point the command now returns, `BLOCKED` is simply what GitHub reports while a required check is queued. A `DIRTY` merge state ends `followup`'s wait instead, on its first poll (about ten seconds, against the two minutes the watch took to reach it), with `PR checks failed (merge conflict).` The one case not carried over is a pull request that is green but still `BLOCKED` — branch protection requiring an approving review, which this package's repositories do not set: that now reaches the timeout rather than a named failure.

### `josh followup`

AI-assisted PR follow-up workflow: waits for CI, checks AI reviewer findings, sends a completion notification, and merges.

**Merging is the default, and `--no-merge` is the only thing that stops it** ([#1204](https://github.com/joshuafolkken/kit/issues/1204)). The command resolves it as "merge unless `--no-merge` was passed", so an invocation carrying no flags at all merges — every example below except the last one does. `--merge` is still accepted as a deprecated no-op for compatibility, but no document writes it beside a `followup` invocation any more, and a marker test enforces that (`scripts/followup-merge-flag-document-rule.test.ts`). Read as the switch that starts a merge, it makes "I left the flag off, so nothing merged" a safe-looking conclusion that is exactly backwards about a Tier C action. The skill still names the flag where it explains the deprecation, which is the one place saying it is useful.

```bash
pnpm josh followup "PR title #N"
pnpm josh followup "PR title #N" --notify-message "Implemented X:\n- change 1\n- change 2"
pnpm josh followup "PR title #N" --notify-message-file completion.md
pnpm josh followup "PR title #N" --ai-review-ignore-reason "false positive"
pnpm josh followup "PR title #N" --no-merge
```

**A change to a file `josh sync` distributes is reported at completion; it does not stop the merge** ([#1592](https://github.com/joshuafolkken/kit/issues/1592)). Before the CI wait, `followup` matches the branch diff against the distribution lists — the same question [`josh sync:scope`](#josh-syncscope) answers — and the claimed paths, each beside the list that claimed it, go into **the completion Telegram body and the completion report posted to the Issue**. A run that distributes nothing gains no such section, and a run passing `--no-merge` is not reported on, because nothing has been distributed yet.

**It stopped the merge from [#1578](https://github.com/joshuafolkken/kit/issues/1578) until [#1592](https://github.com/joshuafolkken/kit/issues/1592), and the measurement is what ended that.** kit is the distribution source, so a change to `CLAUDE.md`, to `prompts/`, to `.claude/skills/` or to the distributed part of `docs/` claims a path by definition — on `epicrun #1413` **two of three children stopped here**, and in both the distributed file was the one that Issue's own acceptance criteria had ordered changed. Unattended execution ended each time until a person retyped one command with a reason. `--managed-config-ignore-reason` is gone with the stop it existed to get past, and **no branch decides whether this repository is the distribution source** — the report reaches a consumer project's reader just as well, and a distribution-source test is a mechanism this package does not have.

**What #1578 fixed is unchanged.** The matching is the command's rather than an instruction to compare the diff against three arrays by eye — an instruction that was skipped in two runs out of three on the day it was measured, one of which could not have succeeded by eye at all, since `AI_COPY_DIRECTORIES` holds directories and the changed path matched no entry textually.

**`--notify-message-file` is the form to reach for whenever the message carries a backtick or a `$`** ([#1198](https://github.com/joshuafolkken/kit/issues/1198)). Inside shell double quotes both are evaluated before this command starts: a completion body naming `` `owner/repo#` `` reached Telegram with the word gone, and on the `gh` side the same substitution ran a comment's own words as git commands. The file path is read as-is — `-` reads stdin — and no escape expansion happens to it, because a file already holds real newlines; the `\n` escape belongs to the inline `--notify-message` form, which still expands it. Passing both is refused rather than ranked, so a caller that meant the file never silently ships the inline string. The rule and the safe spellings for `gh` are in [`prompts/collaboration-workflow/shell-body.md`](https://github.com/joshuafolkken/kit/blob/main/prompts/collaboration-workflow/shell-body.md).

On completion, the count of **unreleased merges on main** is included in the completion Telegram body (`🚚 unreleased merges on main: <n>`), so a release nobody has run stays visible ([#1486](https://github.com/joshuafolkken/kit/issues/1486)). It replaced the project version line, which read the local `package.json`: children no longer bump, so that value names the _previous_ release rather than what the run ships, and reporting it presented an unconfirmed shipping version as a fact. **The count is read from a freshly fetched default branch, never from `HEAD`.** `followup` runs on the feature branch, and `--first-parent` only reads as "main's line" when the walk starts on main — from a branch tip it walks that branch, and any merge main took after the branch was cut is not even an ancestor. So the number would be silently low while the line still said "on main". The Telegram is sent before the merge — the last point at which the run can still fail safely — so it says that this run's own merge is not yet in the count; the same line printed as the final console line after the merge carries no such note, because the fetch there brings the merge in. A count that cannot be read at all contributes no line, rather than a zero nobody measured.

**A merged run also ends the round-1 review snapshot's life** ([#1441](https://github.com/joshuafolkken/kit/issues/1441)). `josh review:brief` records that snapshot once per run and never retakes it, so something has to say when a run is over — otherwise the next run's fix delta would be measured against the previous run's record. This is that point, after everything the run is for has been reported; the removal is swallowed, because the merge has already happened by then and a temp-directory problem must not turn a completed run into a failed one. **Nothing is cleared on `--no-merge`**, the same line `print_next_issues` and the epic auto-close already draw: the pull request is still open, so the run has not ended — and clearing there would let the next round-1 brief record a fresh snapshot against the already-fixed tree, which is the skip #1441 closed. A run that never reaches `followup` leaves the record behind too, which widens the next run's delta rather than narrowing it.

**A merged run also emits its own timing report and appends it to `.time-history.jsonl`** ([#1471](https://github.com/joshuafolkken/kit/issues/1471)). Until then the measurement only ever happened when a person typed `diag`, so a run nobody asked about left no record at all — and comparing this run against the last one depended on somebody having remembered to measure the last one. Every `fullrun`, and every child of an `epicrun` or a `queue`, ends here, so this one seam records all of them. **It measures nothing of its own**: the report is built by `time_run.build_run_report`, the same builder [`josh time`](#josh-time) calls, and a second reader of the transcripts would be the second classification that makes two runs incomparable. What is printed is a short block — elapsed, turns, round trips, the per-round-trip cost, and the same figures against the previous recorded run — while the full tables stay where they were, behind `pnpm josh time --issue <N>` and the `diag` skill that reads them. **`--no-merge` records nothing**, the same line the round-1 clear and the epic auto-close draw: the pull request is still open and its CI wait is not over, so the record would compare part of a run against whole ones. **The record is written against the session's checkout, not the process's** ([#1628](https://github.com/joshuafolkken/kit/issues/1628)): a child running in a lane work tree resolves back to the main checkout first, the same normalization the read side has applied since [#1617](https://github.com/joshuafolkken/kit/issues/1617). Without it a lane looked for its transcripts under a project directory that has never existed, came back unmeasured and appended nothing at all — thirteen consecutive merges were lost that way, and had they been appended they would have gone to a file `pnpm josh lane:close` deletes. **Nothing here can fail a run**: the merge has already happened, so a history that cannot be read or written prints one line naming the reason and the `pnpm josh time --issue <N>` that would take the measurement by hand — **and sends that same fact as a `warning` Telegram (⚠️)**, because the printed line alone let thirteen losses pass unnoticed. That warning is not a `failure`: the run merged and only its measurement did not land, and the message says the run is permanently absent from `--period` rather than offering a recovery — nothing writes a missing line back. `JOSH_TIME_HISTORY=0` turns the whole step off for a checkout that does not want the file, **warning included**: an opted-out feature is an answer, not a gap. **The measurement is not bounded by a timeout, deliberately**: `collect_issue_spans` reads the transcript corpus synchronously, so a timer cannot fire during the walk it would be bounding, and on the one `gh` await it could fire during, the builder keeps running afterwards — a run would print `unavailable`, print its completion banner, and then sit there until the walk it never cancelled finished. Measured here at about 7 seconds against runs of thirty minutes and up; bounding it for real needs cancellation inside the walk or a worker of its own.

**It prints how long each of its own stages took.** Since [#1349](https://github.com/joshuafolkken/kit/issues/1349) the command closes with one `followup stage: <name> <n> s` row per stage — `closes-and-context`, `checks-wait`, `coderabbit-comments`, `ai-review-comments`, `telegram`, `merge`, `completion-and-epic-close` — followed by `followup stages total:`. **Two of those names say `and` because the requests behind them are issued together** ([#1446](https://github.com/joshuafolkken/kit/issues/1446)): `closes-and-context` was `closes-check` plus `context`, four reads — the pull request body, the repository name, the pull request URL and the issue title — that need nothing from one another and were sent one at a time for 5.5 of a measured 45.8 seconds; `completion-and-epic-close` was `completion-comment` plus `epic-close`. A lap records an interval rather than a call, so a batch is one row and its name is what says which stages it holds. The one real dependency is kept — with no issue number on the command line, the title read waits for the body that names it, and only that read waits — and `checks-wait` is untouched, because what was overlapped was never a wait. Until then the 44 seconds a measured `followup` invocation spent on itself could only be guessed at, and a guess made under time pressure falls on whichever stretch is easiest to cut rather than on the one that is long — the notification and the auto-close, which is where the merge gate lives. **The block is printed on a failed run too**, up to and including the stage that threw, which is named `interrupted`: a `followup` that exits non-zero on an AI-review blocker or a red check is the invocation whose wait was longest, so a block withheld there would be blind to exactly those. A short block on such a run is the run having stopped early rather than the printer having broken — the stages after the failure never ran. The `merge` row appears only on a run that merged, and every row is in seconds, `checks-wait` included, because the rows are read against each other. **The total is the sum of the stages rather than the command's whole wall clock** — the next-issue listing and the version line are printed by the workflow script after the stages end, so a `pnpm josh time` reading of the same span is a second or two longer and that gap is the tail. **`josh time` reads the block** since [#1445](https://github.com/joshuafolkken/kit/issues/1445), and prints it as the `Followup stages (in run order):` table below. The line prefix is declared as one constant and the reader imports it rather than retyping it — the property `status-icons.ts` gives its icon, since `josh time`'s only way to see inside a single Bash span is what the command printed into the transcript. Until that reader existed the breakdown was on the screen of whoever happened to be watching the run and nowhere else: two invocations could not be compared stage by stage, and a transcript recorded last week could not be read at all.

**The CI wait is 32 minutes by default.** The command polls the pull request's checks every 10 seconds and prints each poll (`Checking PR status… (n/193)`). The budget is derived from the CI this package distributes rather than picked as a round number: in `templates/workflows/ci.yml` the longest chain is the `e2e` job's 25-minute cap behind the 2-minute `playwright-image` job it needs, so 27 minutes is the longest run that workflow permits, and five minutes of runner-queue headroom goes on top. A unit test walks the `needs` graph of the workflows this package distributes and fails if any declared budget outgrows the wait, so the two cannot drift apart. A job that declares no `timeout-minutes` — `notify-auto-tag`, and the SonarQube job whose check the wait blocks on — is outside that derivation: GitHub's implicit 6-hour limit is longer than any wait worth having, so an uncapped job is a gap the budget cannot promise to cover rather than a reason to inflate it. A wait shorter than what the workflow itself permits gives up on a run that is still legitimately progressing — which is what the previous 180-second default did in every consumer whose suite includes E2E, making `JOSH_CI_TIMEOUT_SECONDS` something to remember on every invocation and, when it was forgotten, producing a red exit beside a CI that was still running (joshuafolkken/kit#851). A longer budget costs nothing when the checks are fast: polling returns as soon as they settle. **A failing check ends the wait as soon as it fails**, whether or not it is on the required list, and the command exits naming what fell over — `PR checks failed (failed checks: E2E).` A run whose `Checks`, `E2E` or `Security Audit` job goes red therefore reports in the time that job took, not in 32 minutes: previously only a required-list check (`SonarQube` by default, `JOSH_REQUIRED_CHECKS` to change it) ended the wait, because any other failure leaves GitHub reporting the pull request as `UNSTABLE` while the rollup still reads as pending, so the command ran its whole budget out and ended in `Timed out while waiting for PR checks to complete.` without naming a cause (joshuafolkken/kit#990). **This makes the gate report sooner, never looser** — no failing check gains a path to a merge, and the poll loop keeps CodeRabbit exempt under the temporary kit#753 policy, so a red or slow CodeRabbit review does not end the wait unless it has been put back on the required list. (The two-minute look-ahead that runs before the polling fails on any failed check, CodeRabbit's included — but that no longer ends the command: the look-ahead is exactly that, not a gate, so its failure is logged and the run falls through to the polling, where the one evaluator decides. Until joshuafolkken/kit#999 it escaped instead, which killed `followup` before the CodeRabbit exemption could apply at all — visible only on a repository whose checks all finish inside that window, since a slower suite times the look-ahead out first. **One exception keeps its old speed**: a branch with no checks at all fails just as a failed one does, and falling through there would trade a failure reported quickly for the whole budget spent waiting on a required check that is missing rather than pending — so when the pull request's own rollup is definitely empty the failure is rethrown. Definitely is the operative word: an answer that could not be read is not an empty rollup, and falls through like any other. Since joshuafolkken/kit#1028 the look-ahead is the same poll loop with a two-minute budget rather than a `gh pr checks --watch` subprocess — `gh pr checks` goes through GraphQL, which a cloud session is answered 403 for. It asks a deliberately weaker question than the merge gate does — have the checks settled, rather than is the pull request mergeable — and the live per-check table `gh` drew is replaced by the same `Checking PR status…` lines. An empty rollup counts as still waiting _during_ those two minutes, so a pull request whose checks have not registered yet is given time, and is asked once more at the end. **The look-ahead does not wait for CodeRabbit either**, which is what made it cost two minutes on every run rather than only on a slow one: CodeRabbit posts its `Review queued` commit status within seconds of the pull request opening and leaves it pending for the whole review — thirteen minutes on PR #1211 — so a look-ahead that counted it as pending always ran its budget out and printed the timeout note, before the polling applied the kit#753 exemption and merged anyway (joshuafolkken/kit#1217). Only the _pending_ reading is dropped: a CodeRabbit check that has already failed still ends the look-ahead exactly as before, and what happens to that answer is unchanged — it is logged and the run falls through. A rollup holding nothing _but_ CodeRabbit falls back to the whole rollup rather than being emptied by the skip, so such a pull request answers exactly what it answered before the exemption existed — still waiting while the review is queued, settled once it passes, failed once it fails. The skip is keyed on `CODERABBIT_CHECK_NAME`, the single constant the merge gate's own exemption is written in terms of, and `JOSH_REQUIRED_CHECKS` takes it back: a project that has put CodeRabbit on the required list is waited for again, so the look-ahead never settles on something the merge gate would still block.) **Three things still run the budget out**, because none of them is a failed check: a required check that never appears at all (`SonarQube` on a repository with no Sonar integration) is missing rather than failed, and nothing distinguishes it from one that has yet to start; and a merge state that never reaches `CLEAN` for a reason other than a conflict — a branch protection requiring the branch to be up to date, or an approving review — leaves every check green with nothing to name. **A conflict is the exception, and ends the wait on the first poll**: `DIRTY` is the one merge state no amount of waiting resolves, so since [#1232](https://github.com/joshuafolkken/kit/issues/1232) it is a failure named `merge conflict` rather than a 32-minute timeout — which is also where the conflict check `josh git` used to run after its own watch now lives. and a **standing change request on a pull request whose checks never settle** is now reported at the timeout rather than on the first poll — since joshuafolkken/kit#1043 the review listing is read only on a poll that would otherwise conclude the wait, which is what took the merge gate from four REST requests per poll to three (about 760 down to about 570 across a full 32-minute wait); the run is red either way, so the trade only ever moves a red result later, never a green one earlier. A job skipped by its own `if:` condition counts as passing, so conditional jobs never end the wait either. **What does end it is any non-success conclusion**, `cancelled` and `timed_out` included — the same rule the required list has always followed — so re-running a job you cancelled is no longer picked up by a wait already in progress: run `followup` again once it is green. Before the polling starts, `followup` also runs a two-minute look-ahead, so the worst case end to end is about 34 minutes.

**A merge that went ahead without CodeRabbit says so on the console.** Whenever the merge gate opens with a CodeRabbit check that is not passing, `followup` prints one `⏭ CodeRabbit check skipped (kit#753): <name> was <status> at merge time` line per such check and carries the same note into the completion Telegram body. The skip covers waiting only: CodeRabbit findings that have already been posted go through the unchanged AI-review scan below, and unresolved line comments are still recorded (joshuafolkken/kit#1217).

Set `JOSH_CI_TIMEOUT_SECONDS` to a positive number of seconds to override it in either direction; anything else falls back to the default. `followup` runs with `--env-file-if-exists=.env`, so the variable is read from the project's `.env` when there is one, as well as from the shell — **a leftover `JOSH_CI_TIMEOUT_SECONDS` left in `.env` as a workaround for the old default keeps overriding the new one**, so remove it after upgrading.

An AI agent driving this command should give the tool call the longest timeout it allows and let the command finish: the wait can outlast a single tool call, and shell backgrounding (`&`) does not survive the call returning.

While inspecting those children it also reports when the epic body declares a dependency chain (`#101 -> #102` under `Dependencies`) but **none** of the children carries a `blocked-by` relation, meaning the batch order was never recorded natively. The declaration is what triggers the check: an epic is created for every split, ordered or not, so its mere existence says nothing about ordering and warning on that alone would fire on every unordered batch. The check is deliberately weak — it never judges the shape of the chain, only its total absence — and it runs on every child's merge rather than at epic close, so the omission surfaces while it can still be corrected. What counts as a declaration is read from the same place `epic:next` reads its links: a line that is _nothing but_ a chain. An arrow inside a rationale paragraph is a recommendation, and reading one as a declaration made an epic that says `None — the children are independent` report this warning on every child's merge ([#1155](https://github.com/joshuafolkken/kit/issues/1155)).

After the merge, `followup` also closes any completed epic. It looks for open issues labelled `epic` whose markdown task list references the issue this PR closed; when every other child in that list is already closed, the epic is closed with a comment naming its children. The just-closed issue is treated as closed without being queried, because GitHub applies the `closes #N` side effect asynchronously. An epic with a still-open child is left alone, and any failure in this step is reported as a warning rather than failing the run — the PR has already merged by then. A run whose comment landed but whose close was refused does not post a second copy: the announcement ends with an HTML comment marker naming the children it was posted for, and a later run that finds that marker closes without commenting again. The marker renders as nothing, so quoting the announcement in an ordinary issue comment no longer suppresses the next one, and an epic that was reopened and gained a child announces the enlarged batch on its own terms. Two cases are skipped on purpose: an epic whose task list tracks a child in **another repository** is never closed automatically (resolving that child's state would need a different repo, and ignoring it could close the epic while the child is open), and nothing runs at all on a `--no-merge` run, where the linked issue is still open.

After a merged run (never on `--no-merge`, where the linked issue is still the current task), right before the final version line, up to five open issues are listed as next-run candidates (`🗒 Next issues (newest first):`), so the next task can be picked straight from the completion output. The newest 20 open issues are fetched and shown newest-first — a newer issue usually encodes the most current understanding of the backlog — excluding the just-completed issue (its `closes #N` close lands asynchronously), `epic`-labeled tracking issues (their children are the runnable work), and `in-progress`-labeled issues already claimed by a workflow. The display is purely informational: when `gh` is unavailable or returns something unexpected, it is skipped silently rather than failing a workflow whose merge already succeeded.

### `josh notify`

Send a Telegram notification. Used for planning, confirmation, failure, and kickoff-retry alerts.

```bash
pnpm josh notify --task-type planning --issue-url "https://..." --body="- bullet 1\n- bullet 2"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body="Waiting for approval"
pnpm josh notify --task-type failure --issue-url "https://..." --body="Build failed"
pnpm josh notify --task-type confirmation --issue-url "https://..." --body-file reason.md
```

**`--body-file` reads the body from a file (`-` reads stdin), and it is the form to use whenever the body carries a backtick or a `$`** ([#1198](https://github.com/joshuafolkken/kit/issues/1198)) — inside shell double quotes the shell evaluates both before this command runs. `--body=$'…'` is safe for the same reason and is unchanged, so the short bodies above stay as they are; the file route is what a report full of command names needs. `--body` and `--body-file` together are refused rather than ranked. The reader is shared with `josh followup --notify-message-file` and `josh epic --rationale-file` rather than copied per command.

Task types: `planning` 📋 · `completion` ✅ · `failure` ❌ · `warning` ⚠️ · `kickoff_retry` 🔄 · `confirmation` ⏸️

**The repository in the header follows the URL the notification carries.** It is resolved in this order: an explicit `--repo-name`, then the repository the `--issue-url` names, then the repository the `--pr-url` names, then the repository the command is run in. The issue title is read from the `--issue-url`'s repository, so one URL is enough to describe an issue anywhere; a `--pr-url` names no issue, so it answers the repository only and no title is read from it (joshuafolkken/kit#994). Only a notification with no usable URL of either kind falls back to the working directory, which is what it always did. This matters wherever a workflow files an issue elsewhere and notifies about it — the upstream-interrupt rule opens the issue with `gh api repos/<owner>/<repo>/issues` and sends a `confirmation` right after, and the header used to name the repository the session happened to be running in while the link pointed upstream (joshuafolkken/kit#903).

Note: do not use `--task-type completion` manually — always use `josh followup` instead, which automatically includes the PR URL. The same holds for `--task-type warning` (⚠️ _Completed with a warning_): it names a run that merged alongside something that did not work, and `josh followup` sends it itself when the finished run could not be recorded in `.time-history.jsonl` ([#1628](https://github.com/joshuafolkken/kit/issues/1628)). It exists because `failure` there would say the merge broke, which is false.

**A send that reached nobody exits non-zero** ([#1564](https://github.com/joshuafolkken/kit/issues/1564)). Missing credentials and a refused request are the same answer: the command _is_ the notification, so it has nothing left to report if the message did not go out, and a warning followed by exit 0 made a lost notification indistinguishable from a delivered one — measured as three `504 Gateway Time-out` sends that all exited 0. The message names the missing variables or the HTTP status, and never the value of `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID`. A notification sent from _inside_ `josh followup` behaves differently on purpose: it reports the failure under `❗` and the run carries on to the merge, because a reviewed, green pull request must not be held back by a Telegram gateway.

`.env` is read with `--env-file-if-exists`, so the command runs on a machine that has none as long as both variables are in the environment.

### `josh main:sync`

Checkout the default branch and pull the latest changes.

```bash
pnpm josh main:sync
```

**It refuses inside a linked work tree — a lane — and exits non-zero.** The default branch is a branch, and git allows one branch in one work tree at a time, so checking it out from a lane takes it away from wherever it belongs. Measured on 2026-09-07 with five lanes open, one `josh ms` run inside a lane did two things nobody asked for: the lane dropped out of [`josh lane:list`](#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune) because that listing matches on the branch name — leaving `lane:close` unable to reach it and its port seat never reclaimed — and every other lane's `josh ms` then failed with `fatal: 'main' is already used by worktree at …`.

A lane's terminal step is `pnpm josh lane:close <issue-number>`; run `pnpm josh main:sync` in the primary checkout instead. Nothing about the main work tree's behavior changed.

**The pull is `git pull --ff-only`, and the strategy is named by the command rather than read out of your git configuration** (joshuafolkken/kit#1683). This is the same defect [`josh main:merge`](#josh-mainmerge) was fixed for in joshuafolkken/kit#1659, at the `git pull` that issue deliberately left alone: with neither `pull.rebase` nor `pull.ff` set, a bare `git pull` aborts with `fatal: Need to specify how to reconcile divergent branches` the moment the local default branch and `origin/<default>` have each moved. It surfaces less often here than it did there — this command checks the default branch out first, and nothing in the workflow advances that branch locally — but the situation it does surface in is the one you typed the command to clean up: a commit that landed on the default branch by mistake, or a rewritten remote branch.

**`--ff-only` rather than a merge is the deliberate opposite of `josh main:merge`'s choice.** That command exists to absorb divergence; this one is an instruction to bring the default branch up to date, so a default branch that has diverged fails loudly here instead of quietly growing a merge commit. The same flag now covers every caller of this pull: [`josh git`](#josh-git) and `josh pr` when they are started from the default branch and have to bring it up to date before cutting the issue branch, and [`josh release`](#josh-release), which reads the history on the default branch before it plans and returns to it after the release pull request merges. All of them sit on the default branch for the same reason, and none of them is asking to absorb divergence.

Note that [`josh lane:open`](#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune) no longer depends on the local default branch being current — it cuts each lane from `refs/remotes/origin/<default>` — so there is no longer a reason to reach for `josh ms` inside a lane in the first place (joshuafolkken/kit#1535).

### `josh main:merge`

Bring the repository's default branch into the branch this checkout is on.

```bash
pnpm josh main:merge
```

It fetches `origin/<default>` and merges it into the current branch. **The merge strategy is named by the command rather than read out of your git configuration**, which is the whole of joshuafolkken/kit#1659: it used to run `git pull origin <default>`, and `git pull` with neither `pull.rebase` nor `pull.ff` set — the state of a checkout nobody has configured — aborts the moment the two sides have each moved:

```
fatal: Need to specify how to reconcile divergent branches
```

Divergence is not an edge case for this command; it is the reason to type it. A lane whose branch has fallen behind `origin/<default>` has commits of its own on it by definition, so **the one state the command exists for was the one state it could not run in**.

Merging rather than rebasing follows joshuafolkken/kit#1446 and is not a fresh decision: a rebase rewrites commits that are already pushed, so it needs a force push, which the distributed `.claude/settings.json` denies. A conflicting merge leaves git's own report on screen and exits non-zero; resolve it as you would any merge.

---

## Versioning

### `josh bump`

Bump the package version in `package.json`.

```bash
pnpm josh bump major
pnpm josh bump minor
pnpm josh bump patch
```

After bumping, update `docs/` to reflect any behavior changes before committing.

**It is not part of the child flow any more** ([#1486](https://github.com/joshuafolkken/kit/issues/1486)). A `fullrun` / `queue` / `epicrun` child commits no version change at all; [`josh release`](#josh-release) is what raises the version, and it is the caller this command now has.

### `josh release`

Release everything main has taken since the version last changed — one command, run by a person ([#1169](https://github.com/joshuafolkken/kit/issues/1169)).

**When it is typed is `josh release:scope`'s answer, not a judgement** ([#1582](https://github.com/joshuafolkken/kit/issues/1582)). A run asks that command once, after the last merge its invocation authorized, and reports the release rather than cutting one; the rule is `.claude/skills/workflow-commands/followup.md` → "When `pnpm josh release` runs", its single source.

```bash
pnpm josh release
pnpm josh release --dry-run   # count and report, write nothing
```

**A version is a property of main's history, not of a branch.** `josh bump` reads the local `package.json` and increments it, so two branches cut from the same version both claim the same next number — and git's three-way merge does not report two branches writing the same line to the same value as a conflict. What surfaces instead is one version carrying two issues, with the other version never existing. No smarter `bump` can fix that: two branches cannot both know they are next.

So the decision moves off the branch entirely. There is one place that decides, it runs when a person types this, and it looks only at main as it stands at that moment — which is why **no lock, no reserved number, no serial queue and no conflict detection is needed**.

What one invocation does:

1. **Counts `pending`** — the merge commits main has taken since the commit that last changed the version, **along main's own first-parent line**. Every pull request this repository merges lands as one merge commit there, so this is the count of merged pull requests, dependency updates included: a dependency update is a change worth shipping. The first-parent restriction is what keeps merges made _inside_ a pull request branch — GitHub's "Update branch" button, or a local `git merge main` — from each inflating the release by a minor.
2. **Reports and stops when `pending` is zero.** Nothing is written, nothing is opened, and the exit code is 0.
3. **Otherwise raises the version by `pending` minors**, commits it on `release/v<version>`, opens a pull request and merges it through the same gate every other pull request goes through — `wait_for_pr_success`, the one `josh followup` waits on.
4. **Watches for the tag, and reports its absence as a failure.**

The merge is what starts the distribution chain that already exists: `ci.yml`'s `notify-auto-tag` dispatches, `auto-tag.yml` creates `v<version>`, and `publish.yml` / `production.yml` run off that tag.

#### The tag watch is the point of step 4

**A merged release pull request is not a released version.** Every link after the merge can fail silently, and one of them is known to: a later push to main cancels the release commit's CI run ([#1481](https://github.com/joshuafolkken/kit/issues/1481)), so nothing dispatches and nothing is tagged. An automatic release would have been picked up by the next cycle. **A release a person types has no next cycle**, so without the watch the person walks away believing something shipped when nothing did.

The command therefore polls for `v<version>` and exits non-zero when it never appears, naming what did not happen rather than guessing which link broke. The budget is 30 minutes, overridable with `JOSH_RELEASE_TAG_TIMEOUT_SECONDS`.

#### Numbers are skipped, and the accounting still holds

Release after three merges and `1.339.0` becomes `1.342.0` with **one** tag, `v1.342.0`; `v1.340.0` and `v1.341.0` never exist. What is preserved is "minors raised == issues shipped"; what is given up is "one issue, one tag". Which issue went into which release is recovered from the merge commits between two tags, which `.github/release.yml` already classifies. `scripts/version/publishable-range-check.ts`, the `prepack` gate, checks that published ranges still resolve and does not look at version distance at all, so a multi-minor jump passes it unchanged.

#### It refuses to guess

- The working tree must be clean and the checkout on the default branch — the count is only meaningful there, and the release commit is made on top of it. Both are checked before anything is read. A real run then pulls; **`--dry-run` does not**, because a pull is a write.
- It searches back through the last 30 commits that touched `package.json` for the one that moved the version, and **a revision whose `package.json` cannot be read stops it declaring a base there** rather than being compared against a version several commits older. Finding no base at all, it says so and exits non-zero rather than picking one.
- A `release/v<version>` branch that already exists is reported as a previous attempt that got as far as opening one — the wait for CI can throw and leave the branch and its pull request behind — rather than failing as git's `a branch named … already exists`.

### `josh release:scope`

Say whether a release is owed, so the moment one is cut stops being a judgement ([#1582](https://github.com/joshuafolkken/kit/issues/1582)).

```bash
pnpm josh release:scope          # → required | skip | unknown ; alias: josh res
pnpm josh release:scope --json   # {"scope":"…","reason":"…"} on one line
```

| It answers | When                                                             |
| ---------- | ---------------------------------------------------------------- |
| `required` | main has taken at least one merge since the version last changed |
| `skip`     | the count is zero                                                |
| `unknown`  | the count could not be read                                      |

**The verdict alone goes to stdout, the reason to stderr**, so `$(pnpm josh release:scope)` reads the word and a person still sees why. The exit code is 0 for every verdict and 1 only for an unknown flag; `unknown` is a verdict rather than a failure, and it is **never** read as `skip` — an unreadable version, a fetch that could not run or a base the search cannot resolve is not "nothing is waiting to ship".

**`josh release --dry-run` cannot answer this question.** It refuses off the default branch and on a dirty working tree and counts against `HEAD`, while every position a run asks from is a feature branch or a lane. So this command was added rather than the existing flag reused — and it **counts nothing of its own**: it reads `git_followup_pending.read_pending`, the same fetch-then-count that already supplies `🚚 unreleased merges on main: <n>` in the completion Telegram and in the console line `josh followup` prints after the merge, so the three cannot disagree.

**53 merges reached main unreleased before this existed** — [#1169](https://github.com/joshuafolkken/kit/issues/1169) moved the version off the branch and nothing said when to type the replacement, so nobody did and nothing reported a failure. The count was already on every completion notification; a number nobody is told to act on is a number nobody acts on, which is why the answer is a verdict a procedure branches on rather than one more line to read.

### `josh version`

Show the global install version, the current project version, and the latest published version — all in one report, regardless of how `josh` was invoked.

```bash
pnpm josh version   # alias: josh v
```

`version` (and `version:upgrade`) always inspect **both targets**:

- **Global**: queried via `pnpm ls -g @joshuafolkken/kit`.
- **Project**: read from `node_modules/@joshuafolkken/kit/package.json` in the current directory.

In addition, `version` reports the **running binary** — the version and package directory of the install that actually executed, resolved from `import.meta.url`. The running binary is the single source of truth: the `Running:` line tells you which `josh` produced this very report, independent of the global/project query. This restores the guarantee that a stale or shadowing binary self-reports rather than hiding behind the `pnpm ls -g` number.

A target that is not installed is reported as `not installed`. A stale target gets a `Run:` hint with the exact upgrade command (`pnpm add -g` for global, `pnpm add -D … && fix-gh-packages` for the project). `josh v` and `pnpm josh v` produce the same report.

#### Release-age holds

An upstream's **effective** install can be behind `Latest:` for a reason no upgrade clears. The repository-managed `.npmrc` sets `minimum-release-age`, which withholds a release from **unpinned** resolution until it has aged past that window. Measured on pnpm 11.22.0 with `minimum-release-age=1440`, against a release published 3.5 h earlier:

```text
pnpm add @joshuafolkken/kit@1.80.0   ->  1.80.0   (pnpm records a minimumReleaseAgeExclude entry)
pnpm add @joshuafolkken/kit          ->  1.78.0
```

So a pinned `Run:` hint always installs and is **never** suppressed. What the window actually holds back is peer resolution — the mechanism behind an upstream's effective install ([#698](https://github.com/joshuafolkken/kit/issues/698)) — which is why the explanation appears there and nowhere else:

```text
@joshuafolkken/app-kit
  Global:  1.78.0      ⚠ → 1.80.0
  Held: 1.80.0 is inside the 24 h minimum-release-age window; an unpinned resolve lands on 1.78.0
  Project:  1.80.0      ✓
  Latest:  1.80.0
```

Since kit publishes several releases a day, a residual `⚠` right after a **successful** `version:upgrade` is the normal case rather than a failure — the `Held:` line says so instead of leaving the marker unexplained. An effective install below what an unpinned resolve reaches is genuinely stale and gets no such line.

The publish timestamps come from the same GitHub Packages endpoint that resolves `Latest:`, fetched only when the effective install is behind `Latest:` and only when a window is actually configured; when they cannot be read the report renders exactly as it did before. `version:upgrade` is unchanged. See [#808](https://github.com/joshuafolkken/kit/issues/808).

#### PATH shadowing warning

When the `josh` first on `PATH` is **not** the pnpm-global install — for example a stale `~/.local/bin/josh` shim left behind by a project pinned below `v0.200.0` (see [the design note below](#design-per-project-installs-must-not-touch-the-global-path)) — `version` appends a warning naming both paths and the recovery command:

```text
⚠ PATH shadowing: the 'josh' first on PATH is not the pnpm-global install.
  On PATH:     /Users/you/.local/bin/josh
  pnpm global: /Users/you/Library/pnpm/bin/josh
  Recover:     josh doctor --fix
```

Run [`josh doctor --fix`](#josh-doctor) to reclaim the global CLI. The warning is silent when there is no shadowing.

### `josh version:upgrade`

Upgrade `@joshuafolkken/kit` to the latest published version for **both** the global install and the current project.

```bash
pnpm josh version:upgrade   # alias: josh vu
```

Both `josh vu` and `pnpm josh vu` behave the same: the global install is upgraded with `pnpm add -g`, and the project devDependency with `pnpm add -D` followed by a re-run of `fix-gh-packages`. A target that is not installed or already up to date is skipped. Inside the kit repo itself there is no `node_modules/@joshuafolkken/kit`, so the project target is naturally skipped — no accidental self-install.

---

### `josh ranges`

Check that every dependency range this package **publishes** still resolves for a consumer.

```bash
pnpm josh ranges   # alias: josh r
```

```
✔ 18 published dependency range(s) resolve against the registry.
```

**Why this is not obvious.** `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` governs **pnpm's** `minimum-release-age` and nothing else. The `preinstall` hook installs `@aikidosec/safe-chain`, which applies its **own** age policy and has no knowledge of that list — a package excluded there is still hidden by safe-chain until it ages in. So a dependency floor can be pinned to a release that consumers cannot see, and the install fails naming a version that demonstrably exists and is still tagged `latest`:

```
[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for tsx@4.23.5
The latest release of tsx is "4.23.4".
ℹ Safe-chain: Some package versions were suppressed due to minimum age requirement.
```

An existing lockfile hides this completely — `pnpm install --frozen-lockfile` succeeds because the resolution is already recorded. It only surfaces when a consumer **re-resolves**: `pnpm patch`, adding or removing a dependency, `--no-frozen-lockfile`, or a fresh clone whose lockfile no longer matches configuration.

**How the check works.** For each entry in `dependencies` it runs `pnpm view <name>@<range> version`. Where safe-chain's shims are on `PATH`, that query returns the same **filtered** view a consumer installs under — the policy is observed rather than modelled, so there is no threshold to guess and keep in sync. `devDependencies` are excluded (a consumer never installs them) and so are peer ranges (satisfied from the consumer's own tree).

Dependencies that resolve **outside** the registry — `workspace:*`, `catalog:`, `file:`, `link:`, git URLs — are set aside rather than probed: the registry has no answer for them, and this command also runs in consumer repos where those protocols are ordinary. They are printed, never dropped in silence, because a guard that quietly narrows its own coverage reports success for exactly the dependencies it never looked at:

```
⏭ Not checked — resolved outside the registry: @local/shared@workspace:*
```

A range counts as resolved only when the output contains a version `semver` can parse. "Output is non-empty" is not enough: safe-chain appends its own `ℹ Safe-chain: Some package versions were suppressed…` notice to stdout, so a query that answered nothing still comes back with text. The check **fails closed** otherwise — a probe that cannot answer at all (network error, auth failure) is reported as unresolvable, because a false stop costs one re-run and a false pass publishes a package nobody can install.

**Where it runs, and how strong it is in each place.**

| Trigger                              | safe-chain shims active?                              | Catches                                             |
| ------------------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `josh latest`, after `latest:update` | yes, on a developer machine                           | age suppression **and** a floor that does not exist |
| `prepack` (`pnpm publish`)           | no — the publish job installs with `--ignore-scripts` | a floor that does not exist                         |

The `josh latest` run is the primary detector: it fires immediately after the ranges are rewritten, on the machine whose registry view matches a consumer's. The `prepack` run is a backstop — it still blocks a publish, but without the shims it sees the unfiltered registry and cannot tell that a floor is merely being withheld. Run `josh ranges` by hand any time a floor is raised outside those two paths.

Probing a `@joshuafolkken/*` dependency needs `NODE_AUTH_TOKEN` for GitHub Packages. `josh latest` exports it before chaining here (the same prelude `latest:update` relies on), so the composite always has it; a bare `josh ranges` in a project with scoped dependencies needs `export NODE_AUTH_TOKEN=$(gh auth token)` first, or those entries fail closed and are reported as unresolvable.

The probes are one registry request per runtime dependency, run in sequence — a few seconds for a package with a couple of dozen `dependencies`, which is the cost `josh latest` now carries.

**Fixing a violation.** Lower the floor to a release already outside the age window — `^4.23.4` instead of `^4.23.5`. Nothing is given up: the caret still admits the newer version once it ages in, and because `package.json` is the only file that changes, `pnpm install` keeps the already-resolved newer version in the lockfile. Raising the floor further is the intuitive move and the wrong one.

---

## Maintenance

### `josh doctor`

Diagnose — and optionally repair — PATH shadowing of the global `josh`.

```bash
pnpm josh doctor          # alias: josh dr — diagnose only
pnpm josh doctor --fix    # reclaim the global josh by removing a stale kit shim
```

`doctor` reports the running binary, the `josh` first on `PATH` (`which josh`), and the pnpm-global install (`pnpm bin -g`). When the PATH `josh` differs from the pnpm-global one, it prints the same shadowing warning as `josh version` plus the recovery command.

`doctor` also reports the repository's **Dependabot security updates** setting, the prerequisite the distributed `.github/dependabot.yml` depends on once npm version updates are disabled ([#803](https://github.com/joshuafolkken/kit/issues/803)). `josh sync` prints the same line unconditionally, and `josh init` prints it when it actually wrote the config — see [docs/sync.md](./sync.md) for why it runs there too. Unlike those two, `doctor` reports only where the prerequisite exists: it skips the line outside a git work tree, and skips it in a repository that has no distributed `.github/dependabot.yml`. `doctor` diagnoses the global install and is routinely run from a home directory or from a clone of an unrelated project, where a Dependabot warning — and an enabling command aimed at someone else's repository — would be noise. Past that gate it always reports, including when the lookup fails, since a broken or unauthenticated `gh` must surface as `could not be read` rather than as silence. One of four results is printed:

| Result              | Meaning                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | Security advisories can open npm pull requests.                                                                                                               |
| `paused`            | The setting is on but paused, so no advisory PR is opened. Resume it from the repository's Security → Dependabot page; the enable API does not clear a pause. |
| `disabled`          | Off — npm advisories open no pull request. The enabling command is printed, addressed at the resolved repository.                                             |
| `could not be read` | The setting could not be queried (a 404, or a token without the scope). Reported as unchecked, **not** as off.                                                |

The check never fails the command: an unreadable setting is GitHub-side state kit cannot verify, not a broken install. `doctor` does not enable the setting either — changing a repository setting is the maintainer's call.

`doctor` reports the repository's **Allow auto-merge** setting on the same terms, as the prerequisite of the distributed `.github/workflows/dependabot-auto-merge.yml` ([#834](https://github.com/joshuafolkken/kit/issues/834)). Without it `gh pr merge --auto` fails with `Auto-merge is not allowed for this repository`, and every github-actions bump the workflow would have merged sits green and unmerged. The gate here is a workflow containing `gh pr merge --auto`, matched rather than the filename: a consumer's own auto-merge workflow needs the same setting, and a same-named workflow that never calls the command creates no prerequisite at all. `josh sync` prints the line unconditionally, and `josh init` prints it when the workflow is present. One of three results is printed:

| Result              | Meaning                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`           | The auto-merge workflow can enable auto-merge on a Dependabot pull request.                                                                                        |
| `disabled`          | Off — the workflow fails and Dependabot pull requests stay open. The enabling command is printed, addressed at the resolved repository.                            |
| `could not be read` | The setting could not be queried (no admin access, or a failed request). Reported as unchecked, **not** as off — a token without the scope simply omits the field. |

The two reports are independent: a consumer synced before #834 has the Dependabot config and no auto-merge workflow, and a repository that only ever added its own auto-merge workflow has the second prerequisite without the first. When at least one applies, the repository name is resolved once and shared by both. `--fix` does not enable this setting either, for the same reason it does not enable Dependabot security updates.

#### The discovered repository map

`doctor` prints the **repository map** — every checkout on this machine that belongs to the same GitHub owner as the repository the command is standing in, with its local path ([#869](https://github.com/joshuafolkken/kit/issues/869)). Other commands need to know where a sibling repository lives before they can carry a release into it or dispatch a run to it; `doctor` is where a wrong map becomes visible, because the alternative is finding out when a write lands in the wrong checkout.

```text
Repositories (same owner, discovered next to this one):
  joshuafolkken/app-kit   /Users/example/Development/app-kit
  joshuafolkken/kit       /Users/example/Development/kit
```

Discovery is automatic, not registered: `doctor` scans the parent directory of the current repository **one level deep**, reads each work tree's `origin` remote, and keys the map by what that remote says. Four remote spellings all normalize to the same `owner/repo` — `git@github.com:owner/repo.git`, an SSH host alias (`git@github-work:owner/repo.git`), HTTPS with credentials and a trailing slash (`https://user@github.com/owner/repo.git/`), and plain HTTPS. **The directory name is never used as the repository name** — a checkout in a directory called `kit-experiment` whose `origin` points at `game-kit` is mapped as `game-kit`.

**The owner restriction is unconditional and cannot be overridden.** Only repositories whose owner equals the current repository's owner enter the map — the same first-party test the AI documents define. A parent directory routinely holds work belonging to other accounts and organizations, and a map that included them would let tooling file issues against, or push to, a repository that is not yours. Remotes on any host other than GitHub are excluded before the owner is even compared, as are directories with no remote at all.

`JOSH_REPO_PATHS` is the escape hatch for the exceptions — a repository that is not a sibling, or one checked out twice — set in the personal, non-committed `.env`:

```bash
JOSH_REPO_PATHS=joshuafolkken/game-kit=/Users/example/elsewhere/game-kit,joshuafolkken/kit=/Users/example/kit-review
```

Entries are `owner/repo=/absolute/path`, comma-separated, and an override wins over the discovered path for the same repository. It is a way in, never a way around: an override naming a different owner is dropped exactly like a discovered sibling would be, and a malformed entry is dropped rather than failing the command — the printed map is what shows you it did not take effect. Outside a git work tree no map is printed at all, since there is no current owner to anchor it against.

`--fix` is your go-ahead to repair: it reads the shadowing binary and, **only if it is a kit shim** (its body references `@joshuafolkken/kit` or the removed `install-bin` script), removes it so the pnpm-global `josh` reclaims `PATH` precedence. Any other shadowing binary is left untouched and reported for manual review — `doctor` never deletes a file it cannot positively identify as a stale kit shim.

#### Design: per-project installs must not touch the global PATH

A per-project dependency's lifecycle hook (`postinstall` / `prepare`) must **never** write to a shared, user-level `PATH` location. Versions prior to `v0.200.0` shipped an `install-bin.ts` `postinstall` that wrote `~/.local/bin/josh` via `os.homedir()`; a single `pnpm install` in any such old project would silently clobber the global `josh` and point it at that project's stale kit. That shim write was removed in [#446](https://github.com/joshuafolkken/kit/pull/446) and must not return — the current kit installs its global CLI only via `pnpm add -g` (bin under `pnpm bin -g`), and a regression test (`scripts/no-global-shim-write.test.ts`) fails if any lifecycle hook or source file reintroduces a shared-PATH write.

**Migration / cleanup.** Projects pinned `< v0.200.0` still carry the old `install-bin.ts` and will re-create the shim whenever they are reinstalled. Upgrade those projects to `>= v0.200.0` (`pnpm add -D @joshuafolkken/kit@latest`). For one-shot recovery when an old project has re-created the shim, run `josh doctor --fix`.

### `josh overrides`

Check that the dependency overrides have not drifted after a dependency update.

```bash
pnpm josh overrides
```

Run after `pnpm update` or `josh latest` to confirm no override was silently removed.

**Both locations are read.** pnpm 11 declares overrides in the `overrides:` block of `pnpm-workspace.yaml`; `pnpm.overrides` in `package.json` is the legacy location. The check merges the two (a workspace entry wins a key collision, matching pnpm's own precedence) and prints where they came from — `✔ overrides unchanged (2 from pnpm-workspace.yaml)`, or `no overrides found in pnpm-workspace.yaml or package.json` when there genuinely are none. Reading only `package.json` is what let a project whose overrides live in the YAML report a false all-clear ([#740](https://github.com/joshuafolkken/kit/issues/740)), so an empty `pnpm.overrides` is never treated as "no overrides".

`--save` writes the current merged overrides to `.overrides-snapshot.json` (gitignored); later runs compare against it and exit non-zero on any add, removal, or change.

### `josh audit`

Run a security audit against the lockfile.

```bash
pnpm josh audit
```

The scanner is looked up on `PATH` first, and only then in the directory `josh audit:provision` writes
to (`node_modules/.cache/josh-tools/`). A machine that installed `osv-scanner` itself therefore keeps
running exactly the binary it installed. With neither present the audit exits non-zero and prints how
to get one — the check is never skipped or weakened.

### `josh audit:provision`

Install the pinned `osv-scanner` when `josh audit` cannot find one. Wired to the `SessionStart` hook of
the distributed `.claude/settings.json`, so a machine or a cloud container that has never installed the
scanner has one before the first `git push` reaches the pre-push audit.

```bash
pnpm josh audit:provision
```

- **No-op when a scanner is already there.** `PATH` first, then the managed directory; neither is
  re-fetched, and nothing on an existing machine changes.
- **The version is pinned and the download is verified.** The prebuilt release binary is fetched over
  HTTPS and its SHA256 compared against the digest published for that tag; a mismatch installs nothing
  and prints both digests. `go install` was rejected as the route because it presumes a Go toolchain
  and takes about a minute.
- **The download bound depends on how the command was reached.** The asset is about 55 MB, and a
  session-start hook is waited on — so the automatic attempt gives up after a minute and prints the
  command to run, while `pnpm josh audit:provision --force` allows ten. `--force` also ignores the
  backoff record below, so it is the one command to type after fixing a network problem.
- **A failure never stops the session, and is not repeated at every session start.** An unreachable
  network, a non-OK response, a mismatched checksum and a host with no published build are each
  reported and exit zero — the pre-push audit still fails on the missing binary, which is where a
  missing scanner belongs. A failure is recorded, and the automatic attempt is skipped for six hours
  afterwards rather than paying the timeout again on every startup, resume, clear and compact. A
  provision that succeeds clears the record.
- **The audit's own arguments are unchanged.** No offline vulnerability database is used: that would
  weaken every consumer's answer to "what was known when the database was downloaded".

### `josh reconcile-templates`

Keep the distributed templates in sync with the root files they come from. There are two kinds of pair:

- **Copy pairs** — the template is a byte-for-byte copy of its root source. `.gitignore` → `templates/gitignore` is a copy pair: edit root `.gitignore`, and the template is regenerated automatically. (The dotless `templates/gitignore` exists because npm strips a literal `.gitignore` from the published package; it is renamed back to `.gitignore` when copied into a consumer.)
- **Tripwire pairs** — the template intentionally diverges from its root source. `sonar-project.properties` → `templates/sonar-project.properties` is a tripwire pair: a source edit is recorded as a hash and only forces a conscious review, never automatic propagation.

```bash
pnpm josh reconcile-templates           # regenerate copy templates + record tripwire hashes
pnpm josh reconcile-templates --check    # verify templates are in sync; non-zero on drift
```

Tripwire hashes live in `.template-source-manifest.json` at the repo root (kit-internal; not distributed). A pre-commit hook runs `--check` whenever a tracked source or copy template is staged: a copy pair that is out of date, or a tripwire source that changed without being reconciled, blocks the commit. Run `pnpm josh reconcile-templates` (reviewing any tripwire template first), then commit the regenerated copies and updated manifest alongside the source.

### `josh sync-workflow-pins`

Keep the action SHA pins in `templates/workflows/*` in sync with `.github/workflows/*`. The runtime workflows are the single source of truth for pins; the distributed templates intentionally diverge in structure (steps, commands, comment language), so only the `uses:` SHA pins are propagated.

```bash
pnpm josh sync-workflow-pins           # rewrite template pins to match the runtime workflows
pnpm josh sync-workflow-pins --check    # verify pins are in sync; non-zero on drift
```

Dependabot bumps the runtime workflows under `.github/workflows/` only — its `github-actions` ecosystem cannot scan `templates/` — so an action bump always leaves the templates behind. **This is no longer something you have to fix.** Consumer workflows have their pins resolved from `.github/workflows/*` at the moment `josh init` / `josh sync` writes them, so a stale template ref never reaches a consumer and never fails CI. The command remains available for keeping the committed templates tidy; running it is optional housekeeping, not a step in any workflow. The command errors if a single action is pinned to conflicting SHAs across the runtime workflows.

What _is_ still enforced is that every action used by `templates/workflows/*` also appears in `.github/workflows/*` — an action with no runtime counterpart has no canonical pin to resolve from, so its template ref would ship verbatim. See joshuafolkken/kit#747.

### `josh sync-dependabot-pins`

Automate the template-pin refresh over one or more Dependabot action-bump PRs. For each PR number it checks out the PR branch, runs the same sync as `sync-workflow-pins`, and — when pins drifted — commits the template update and pushes it back to the PR branch, then restores the branch you started on.

> **No longer required to unblock a Dependabot PR.** This command existed because template drift used to fail the kit's own CI, making every action bump a manual fix-up. Pins are now resolved when a consumer workflow is written, so a Dependabot PR that touches only `.github/workflows/**` is green on its own. Use this command when you want the committed templates to read as current — not because a PR is stuck. See joshuafolkken/kit#747.

```bash
pnpm josh sdp 578 641              # sync + push template pins for each Dependabot PR
pnpm josh sync-dependabot-pins 578
pnpm josh sdp --dry-run 578 641    # print the plan per PR; no checkout, commit or push
```

`--dry-run` performs no git side effects (no checkout, commit or push), so it is safe to run against an uncommitted working tree — for example while verifying the command itself before committing. Only template pins under `templates/workflows/` are staged, so unrelated working-tree changes are never committed to a Dependabot PR. As a safety guard the command only commits when the checked-out branch is a `dependabot/…` branch; a mistyped or non-Dependabot PR number is skipped without any commit.

### `josh latest`

Update pnpm via corepack, update all dependencies to latest, and run a security audit.

```bash
pnpm josh latest            # full update (corepack + update + audit)
pnpm josh latest:corepack   # update pnpm only
pnpm josh latest:update     # update dependencies only
pnpm josh latest:scope      # → required | skip — does this run have to update?  (alias: ls)
```

**`josh latest:scope` says whether a run has to update at all**, and the workflow commands ask it instead of updating unconditionally ([#1215](https://github.com/joshuafolkken/kit/issues/1215)). It prints `required` or `skip` on stdout and the reason on stderr, exactly as `josh review:level` and `josh eval:scope` do, so `$(pnpm josh latest:scope)` reads the answer and a person reads the reason. The input is **when `josh latest` last finished in this checkout** and nothing else — a judgement made under time pressure resolves toward "probably still fresh" exactly when a stale dependency matters most, which is why the answer is a command rather than a paragraph. **No record answers `required`**: a fresh checkout, a cleared temp directory, or a chain that fell over halfway all land there, and none of them is evidence that anything is current. The record is written by the `josh latest` chain itself as its last step, so only a chain that completed counts. The window is **12 hours**, moved in either direction by `JOSH_LATEST_MAX_AGE_HOURS` — a value that is not a positive number falls back to the default rather than disabling the update. The record lives in the temp directory keyed to the checkout, so each work tree answers for itself and an epic spanning repositories updates each one on its own schedule. `--record` is the write half used by the chain; it prints nothing on stdout, so a caller capturing the command is never handed a scope by the invocation that only meant to note a run down. **The vulnerability net does not move with the frequency**: `pnpm audit` runs inside `josh latest`, but the `Security Audit` CI job runs on every pull request and is one of the required checks `josh followup` waits on, so nothing merges without a fresh audit whatever this command answered locally.

**`josh latest` never lowers a version.** A supply-chain guard that withholds releases younger than a minimum age (this repo runs `@aikidosec/safe-chain` from `preinstall`) makes the registry report an _older_ release as the newest available. `pnpm update --latest` would then write that older version into `package.json` and `pnpm-lock.yaml` — a silent downgrade attributed to whatever task happened to run the update.

`latest:update` therefore compares the direct-dependency versions before and after the update. If any of them moved down, it restores both files to exactly what it found and says so:

```
⏮ Keeping tsx@^4.23.5 (newest allowed is ^4.23.1) — the newest allowed version is older than the installed one.
   The update was rolled back and no dependency changed: while a pin sits above the newest
   allowed version, the whole tree cannot be resolved. Re-run once the newer release is
   no longer withheld.
```

Three details worth knowing:

- **The whole update is rolled back, not just the offending package.** Excluding it from the update targets would not exclude it from resolution: while an installed version sits above the newest allowed one, that version is unresolvable and `pnpm` fails the entire tree with `ERR_PNPM_NO_MATCHING_VERSION`. The real choice is between a downgrade and no update, and no update is the safer one.
- **The command still exits `0`.** The tree is left byte-identical to what it found, nothing is broken, and every workflow that runs `josh latest` in its preamble would otherwise stop for a condition that resolves itself.
- **The condition is transient.** The newer release is normally still published and still tagged `latest`; only the age gate is hiding it. A later run picks the upgrade up with no intervention.

Note what the rollback deliberately does **not** do: the floor that is above the newest allowed version stays in `package.json`, because restoring the tree is the whole point. That pin is fine for this repo — the lockfile still resolves it — but it is unusable for anyone re-resolving against the published package. Catching that is [`josh ranges`](#josh-ranges)' job, not this one.

`latest:update` skips **held-back** and **overridden** packages instead of blindly bumping everything. `typescript` is currently held back at `6.x`: its `7.x` release is the native (Go) port that exposes no `SyntaxKind`, which crashes the type-aware ESLint stack (`typescript-eslint`, `eslint-plugin-sonarjs`, `ts-api-utils`) at rule-load time. The hold-back is removed to fix forward once that stack supports the native API. **Every** package named by an override is also skipped — whether the key carries a version selector (`"some-pkg@>=5": "^4"`) or not (`svelte: ^5.55.7`) — read from **both** the `overrides:` block in `pnpm-workspace.yaml` and `pnpm.overrides` in `package.json`, so an override declared in either place is honoured. Skipped packages are printed as `⏭ Skipping held-back / overridden packages: …`.

An override declares the resolution the project has chosen, so updating that package is never useful and is actively harmful in two ways: past a lower-bound cap the tree stops resolving, and for a bare key `pnpm update --latest` rewrites the `package.json` range and leaves that **raw** range in the lockfile importer instead of the override-applied one. The resolved version is unchanged, but `pnpm install --frozen-lockfile` then rejects the lockfile with `ERR_PNPM_OUTDATED_LOCKFILE` (kit [#744](https://github.com/joshuafolkken/kit/issues/744)).

`latest:update` also reports the overrides verdict itself, so it does not depend on anyone remembering which file to open afterwards: `✔ overrides unchanged (<n> from <file>)` when nothing moved, or `⚠ overrides changed (…)` followed by the added / removed / changed entries.

That verdict covers the overrides **file**; a second check covers the **lockfile**. `latest:update` compares every importer specifier against the overrides that apply unconditionally, and fails the run when one no longer matches:

```
✖ pnpm-lock.yaml no longer honours the overrides — CI cannot install it:
  svelte (importer .): lockfile ^5.56.8, override ^5.55.7

  Restore it with: git checkout HEAD -- pnpm-lock.yaml && pnpm install
```

This exists because no other local gate covers the case. The distributed `pnpm-workspace.yaml` sets `trustLockfile: true`, which makes `pnpm install --frozen-lockfile` pass locally on the very lockfile CI refuses — so lint, `tsc`, cspell, unit and E2E all go green on a tree that cannot be installed. Overrides whose key carries a version selector are not compared: such a key rewrites only the dependents whose declared range matches it, which the lockfile alone does not record.

`latest:corepack` pins pnpm to the newest release on the project's **current major** (derived from `packageManager`), so on the normal path it stays within `devEngines`. The target version is resolved from the registry (`pnpm view pnpm@<major> version`, through safe-chain's age-filtered view) rather than a dist-tag, because pnpm publishes its per-major tag `latest-<major>` only for superseded majors — while the pinned major is the current one, no such tag exists and a tag-based pin would skip on every run. It falls back to `pnpm@latest` only if the major can't be parsed. Because `corepack use` validates the resolved version against `devEngines` **before** writing `packageManager`, an exact `devEngines.packageManager.version` pin (kept exact to avoid the pnpm dual-declaration warning) would otherwise reject any newer patch and block every bump. To avoid that, `latest:corepack` temporarily widens the pin to the bare major before invoking corepack. Since the query runs through the same age-filtered registry view a consumer installs under, a release still inside the minimum-release-age window simply resolves to the previous release; if the registry cannot answer at all, the pnpm bump is skipped with a notice instead of failing — nothing is widened, the pin is left where it is, and `latest:update` and `audit` still run. The same non-fatal skip (with rollback of the temporary widening) applies when corepack itself fails. Whatever the outcome, the run ends by realigning `devEngines.packageManager.version` with the `packageManager` pin so the two stay in exact match (avoiding the pnpm dual-declaration warning). That alignment is **not** conditional on a bump: an up-to-date repository skips the bump on every run, so a manifest that arrived with the two fields out of step would otherwise keep the warning forever (kit#773). It rewrites nothing when they already match, so a run that changes no version still leaves `package.json` untouched. "Exact" means byte-identical, **`+sha512…` Corepack integrity suffix included** — pnpm compares the two fields as raw strings, so a bare `11.18.0` alongside `pnpm@11.18.0+sha512…` still warns. The suffix is semver build metadata, which range checks ignore, so corepack and pnpm both keep resolving the pin as the plain version.

---

## Git hooks

### `josh prevent-main-commit`

Blocks direct commits to `main`. Installed as a pre-commit hook by `josh init`.

### `josh check-commit-message`

Validates commit message format. Installed as a commit-msg hook by `josh init`.

### `josh secretlint-scan`

Runs [secretlint](https://github.com/secretlint/secretlint) over the paths passed as arguments. Wired into the pre-commit hook by `lefthook/base.yml` as `pnpm josh secretlint-scan {staged_files}`.

It exists because secretlint resolves from the **consumer** project — `josh init` / `josh sync` add it to the consumer devDependencies, since pnpm's isolated `node_modules` never exposes a kit dependency's bin to the consumer's `pnpm exec`. Upgrading kit therefore activates the hook one `josh sync` + `pnpm install` ahead of the binary. A bare `pnpm exec secretlint` turns that window into a hard failure on every commit; this wrapper prints an actionable notice and exits `0` instead:

```text
⚠️  secretlint is not installed — skipping the staged-file secret scan.
   The kit pre-commit hook ships ahead of the dependency it needs.
   Run `pnpm josh sync && pnpm install` to provision it.
```

When secretlint **is** installed the scan runs as normal and its exit code is forwarded, so a detected secret still blocks the commit. Skipping is safe as a fallback because the scan is defense in depth ahead of GitHub push protection and PR-time scanners, not the only gate.

The wrapper owns the CLI flags: `--no-glob` is always passed, because lefthook substitutes literal paths and a SvelteKit route directory such as `(app)` or `[id]` would otherwise reach secretlint's glob engine as a pattern. Secret masking and the `.gitignore` cascade are both on by default in secretlint v13, so no flag is needed for either.

### `josh pre-push-unit`

Run the unit suite for the pre-push hook, reusing the result when [`josh gate`](#josh-gate) already recorded that exact tree green ([#1334](https://github.com/joshuafolkken/kit/issues/1334)). Wired in by `lefthook/base.yml` as the pre-push `test-unit` command; it replaces the bare `pnpm exec vitest run` that hook used to carry.

```bash
pnpm josh pre-push-unit                    # alias: josh ppu
JOSH_PRE_PUSH_FORCE=1 git push             # run the suite even on a tree recorded green
```

Measured on [#1326](https://github.com/joshuafolkken/kit/issues/1326): `pnpm josh git -y` took 40 seconds, 15.9 of them this suite — started 40 seconds after `pnpm josh gate` had printed all four checks green on the same tree, with nothing edited in between. The record existed; the hook was the one reader that never looked at it.

**Which pushes that saving reaches is decided by where the last gate ran.** A run whose gate finished before its last edit leaves a record that does not cover the pushed tree, and this hook then runs the whole suite exactly as it did — the safe direction, and not a regression. The saving lands where a gate ran after the last edit, which in the workflow's own order (`gate` → join → `josh git -y`) is the common case: since [#1486](https://github.com/joshuafolkken/kit/issues/1486) nothing edits the tree between the join and the commit, because the child no longer bumps the version.

**The decision is [#1328](https://github.com/joshuafolkken/kit/issues/1328)'s, imported rather than restated.** All three of its conditions apply here unchanged — the file map matches, the base commit that map is a diff against matches, and the map is non-empty — so a moved file, a moved base commit, an empty map, a missing record and a red gate (which writes none) each run the whole suite exactly as before. A hook that answered that question differently from the gate beside it would be two commands disagreeing about one tree.

**One condition is added on top, and it only ever narrows.** A commit changes nothing outside the checkout; a push puts code where CI and other people read it, so an unverified commit reaching the remote is the failure this must not have. The gate's record describes the **working tree**, and a push carries **HEAD** — the same thing only while nothing is uncommitted. So the reuse also requires `git status --porcelain` to be empty, untracked files included: commit half of a green tree and the map still matches while the commit being pushed is a tree no check has read. `josh git` commits before it pushes, which is exactly the state that satisfies this; anything else, including a status that could not be read at all, runs the suite.

The output claims the result rather than the omission, because a line reading "unit tests skipped" is indistinguishable from "not verified" while the push it precedes goes on to the remote:

```
✔ this tree is already green — the unit tests passed on it at 2026-09-04T06:32:02.592Z (`pnpm josh gate`), and this push carries that same tree.
  Reusing that result; nothing was re-run. `JOSH_PRE_PUSH_FORCE=1 git push` runs them anyway.
```

The escape hatch is an environment variable rather than the gate's `--force` flag because the hook's command line belongs to `lefthook/base.yml` — nobody types this invocation, so a flag would be unreachable at the moment it is wanted. `pnpm josh audit`, the hook's other command, is untouched: the gate does not run it, so it is not a duplicate of anything.

When the suite does run it goes through the same guard [`josh test:unit`](#josh-testunit) uses, so a project with no vitest prints a skip notice instead of failing the push — and a project that has vitest with no test file at all fails it, exactly as the gate would ([#1224](https://github.com/joshuafolkken/kit/issues/1224)).

### `josh pre-commit-type-check`

Type-check the whole project for the pre-commit hook, reusing the result when [`josh gate`](#josh-gate) already recorded that exact tree green ([#1381](https://github.com/joshuafolkken/kit/issues/1381)). Wired in by `lefthook/base.yml` as the pre-commit `type-check` command; it replaces the bare `pnpm exec tsc --noEmit` that hook used to carry.

```bash
pnpm josh pre-commit-type-check             # alias: josh ptc
JOSH_PRE_COMMIT_FORCE=1 git commit          # type-check even on a tree recorded green
```

Measured in kit: `pnpm exec tsc --noEmit` over the whole project takes 3.8–4.4s warm, and every commit paid it seconds after the gate had printed the same project-wide type check green on the same tree — twice per `fullrun`, which commits twice.

**It is the one project-wide check the pre-commit hook had left.** The hook runs its commands in parallel, so its wall time is the longest of them: the staged-file `cspell`, `prettier` and `eslint` commands cost 0.3–1.0s each and are a **narrower scope** than the gate's project-wide run, so they are untouched — skipping them would buy about half a second in exchange for trading a narrow reading for a recorded wide one. `prevent-main-commit` and `secretlint` are untouched for a different reason: the gate does not run either, so neither is a duplicate of anything.

**The decision is [#1328](https://github.com/joshuafolkken/kit/issues/1328)'s, imported rather than restated.** All three of its conditions apply unchanged — the file map matches, the base commit that map is a diff against matches, and the map is non-empty — so a moved file, a moved base commit, an empty map, a missing record and a red gate (which writes none) each run the whole project type check exactly as before.

**Two conditions are added on top, and both only ever narrow.**

- **The commit has to carry the recorded tree.** The record describes the **working tree**; a commit carries the **index**. Stage half of a green tree and the map still matches while the commit being made is a tree no check has read. So the reuse also requires every `git status --porcelain` entry to be staged in full — an unstaged edit (` M`), a partially staged file (`MM`) and an untracked file (`??`) each send the hook back to the full check, as does a status that could not be read at all. `pnpm josh git` stages before it commits, which is exactly the state that satisfies this.
- **The gate's type check has to be this type check.** The record says the four checks were green; it does not say _which_ type check ran, and [that step is resolved per project](#josh-gate) ([#934](https://github.com/joshuafolkken/kit/issues/934)) — a project carrying a `josh-app` or `josh-game` shim has the toolkit's `check:ci` as its gate step, where this hook's is `tsc --noEmit`. Reusing across that difference would skip `tsc --noEmit` on the strength of a different check, so on such a project the hook runs the whole type check exactly as it always did. The saving therefore lands on kit and on plain TypeScript projects, whose gate step _is_ `pnpm josh check`.

**The set of checks is unchanged.** When it runs, it runs the same `pnpm exec tsc --noEmit` the hook always ran; what changes is only whether an already-passed check is executed again on an unchanged tree. **Nothing is forwarded to `tsc`**, and an argument other than `--force` is refused rather than dropped: `tsc --noEmit <file>` ignores `tsconfig.json`, so forwarding a path would silently narrow the very check this command exists to run in full.

The output claims the result rather than the omission, because a line reading "type check skipped" is indistinguishable from "not verified" while the commit it precedes goes ahead on the strength of it:

```
✔ this tree is already green — the type check passed on it at 2026-09-06T02:41:17.104Z (`pnpm josh gate`), and this commit carries that same tree.
  Reusing that result; nothing was re-run. `JOSH_PRE_COMMIT_FORCE=1 git commit` runs it anyway.
```

That sentence is built in one place for all three readers — the gate's own skip, this hook and [`josh pre-push-unit`](#josh-pre-push-unit) — so a claim this load-bearing cannot drift into three different claims.

### `josh hook:install`

Install git hooks via lefthook.

```bash
pnpm josh hook:install
```

### `josh hook:uninstall`

Uninstall git hooks.

```bash
pnpm josh hook:uninstall
```

### `josh hook:commit` / `josh hook:push`

Run pre-commit or pre-push hooks manually (useful for debugging).

```bash
pnpm josh hook:commit
pnpm josh hook:push
```

---

## AI tools

Helpers for AI-assisted development workflows.

### `josh prep`

Pre-implementation preparation: reads context and primes the AI for a task.

```bash
pnpm josh prep
```

### `josh issue`

Fetch GitHub issue details for use in an AI-assisted workflow.

```bash
pnpm josh issue 42
```

### `josh issue:read`

Print each issue's title, state, body and every comment on it — the whole of what `.claude/skills/workflow-commands/SKILL.md` → §2g calls "the Issue", in one call ([#1715](https://github.com/joshuafolkken/kit/issues/1715)).

```bash
pnpm josh issue:read 1715                    # alias: josh ird
pnpm josh issue:read 1715 1567 1605
```

```
issue: 1715
title: Measure where a backlogrun parent's requests go
state: open

The body.

comment by someone at 2026-09-10T00:00:00Z
The comment.
```

It replaces the two `gh api` reads the workflow documents prescribed per issue — `repos/{owner}/{repo}/issues/<N>` and `repos/{owner}/{repo}/issues/<N>/comments`. The two need nothing from one another, so typed by hand they are two calls, and a parent reading several issues in a row pays a turn for each. Measured over four recorded `backlogrun` parents, `issue bookkeeping` was the single largest contributor to the parent's turn count — 110 of 414 turns, 26.6% — and one issue read at a time was its dominant shape. A parent's cost grows as n²/2 in its own request count ([#1567](https://github.com/joshuafolkken/kit/issues/1567)), so a turn removed there is worth more than a turn removed inside a child.

- **A comment listing that could not be read is said to be unreadable, never shown as no comments.** The two are opposite answers, and §2g's rule is that of a body and a comment that disagree the later text is in force — so a block showing no comment where the read failed hands the reader a body a comment may already have overturned.
- **No `--repo`.** The comment listing reads the repository it runs in, so a cross-repository read stays the two `gh api` calls it always was. Naming a flag and ignoring it would print a confident block for a _different_ repository's issue of the same number.
- Several numbers are read concurrently, under the same bound `issue:state` and `epic:bundle` use, and each block names the number it belongs to — attribute a block by its `issue:` line, never by position, since a number that produced nothing prints no block.
- **A token that is not a bare number refuses the whole call**, printing the usage; a number repeated in one call is read once.
- **A non-zero exit is never an issue.** A number that resolves to nothing prints `does not resolve`; a read that failed prints `could not read`. One such number never costs the others their answer.

### `josh issue:state`

Print each issue's state, labels, and whether it is one a run must stop on — in the spelling the workflow documents compare against.

```bash
pnpm josh issue:state 42
pnpm josh issue:state 42 43 44
pnpm josh issue:state 42 43 --repo joshuafolkken/app-kit
```

```
state: CLOSED
labels: in-progress
human_review: no
```

Several numbers are read in one process, concurrently and under the same bound `epic:bundle`'s reference lookup uses, and each block names the number it belongs to ([#1302](https://github.com/joshuafolkken/kit/issues/1302)):

```
issue: 42
state: CLOSED
labels: in-progress
human_review: no

issue: 43
state: OPEN
labels: (none)
human_review: no
```

It replaces the two reads the workflow documents used to prescribe — `gh issue view <N> --json state --jq .state` and `gh issue view <N> --json state,labels --jq …` — with one call that answers both. Those go through GraphQL, which a cloud session is answered 403 for, and that read is `epic-child`'s verifier: the whole reason a child of an epic may be delegated is that the parent re-reads the child's state from GitHub rather than trusting the unit's summary ([#1054](https://github.com/joshuafolkken/kit/issues/1054)).

The state is printed as `OPEN` / `CLOSED` / `MERGED`, not as REST's lower-case `open` / `closed`. That mapping is [#1024](https://github.com/joshuafolkken/kit/issues/1024)'s, single-sourced in `scripts/git/git-gh-rest-state.ts` — which is the reason this is a command rather than a `gh api` line written into the documents, where the casing rule would have had to be restated.

- **`human_review:` answers whether the issue carries [`needs-human-review`](#needs-human-review--the-opposite-label)** ([#1132](https://github.com/joshuafolkken/kit/issues/1132)) — a run reads that line rather than matching the label string itself. GitHub keeps the spelling a label was created with, so an issue whose label reads `Needs-Human-Review` is the same label and an eye comparing against the lowercase string misses it; the run then does not stop and the artifact ships, which is the one thing that label exists to prevent. The line is decided through `has_any_label`, the case-insensitive comparison every other workflow label already reaches its decision through. **A run asks once, before implementing** — `epic:next` prints a bare issue number and `fullrun` / `queue` are handed one, so nothing has read the labels by the time work would start, and the check is a call of its own made the moment the number is in hand. The confirmation an `epicrun` makes _after_ a delegated child returns reads the same line for free, but that is too late to decide whether to degrade.
- `--repo <owner/repo>` reads a child in another repository, which a cross-repository epic needs. Its state is a GitHub fact, so no checkout there is required. It applies to every number of the call.
- **A single number's report is unchanged, deliberately.** `.claude/skills/workflow-commands/SKILL.md` §2z and `.claude/skills/diag/SKILL.md` read those three lines verbatim, and §2z's `needs-human-review` stop is decided from them — so the `issue:` heading appears only when several numbers were passed ([#1302](https://github.com/joshuafolkken/kit/issues/1302)).
- **Attribute a block by its `issue:` line, never by position.** A number that produced no state prints no block, so counting blocks off against the numbers passed misreads every one after the gap — and a `diag` table mixes closed issues with numbers quoted from prose that resolve to nothing.
- **A token that is not a bare number refuses the whole call**, printing the usage. `#1262` copied out of a table is that token, and dropping it would answer fewer numbers than were asked for and still exit zero — with one number left, in the single-number shape, so nothing in the output would say a number went unanswered. A number repeated in one call is read once.
- **An unrecognized flag refuses the call too, rather than being dropped for looking like one** ([#1355](https://github.com/joshuafolkken/kit/issues/1355)). `--rep=owner/repo` used to be discarded before the check above ever saw it, so the call fell back to the session's repository and printed a confident state for a _different_ repository's issue of that number — the same misread a `--repo` with nothing after it is refused for. Only the positions `--repo` itself occupied are consumed, so a second flag or a repeated value is a token nobody read, and it is refused rather than removed.
- **A non-zero exit is never a state.** A number that resolves to nothing prints `does not resolve`; a read that failed — a rate limit, expired auth, a dropped connection — prints `could not read` and says explicitly that this is not "the issue is open". `gh issue view` exited non-zero with an empty stdout for both, and a loop reading that as "not CLOSED" reports a child as failed because nobody could reach GitHub. **One such number never costs the others their answer**: the states that were read are still printed, each failure names its own number on stderr, and the exit is non-zero because at least one number went unanswered.

### `josh issue:scout`

Before an issue is filed, answer the two questions every filing asks first: has this already been filed, and which epic does it belong to ([#1252](https://github.com/joshuafolkken/kit/issues/1252)). Since [#1679](https://github.com/joshuafolkken/kit/issues/1679) the workflow runs it in front of **every** `gh api … issues` call rather than only the `new` entry points, and the duplicate half reads what closed recently as well as what is open.

```bash
pnpm josh issue:scout "Stop the gate re-running after every edit"                      # alias: josh isc
pnpm josh issue:scout "<title>" --body "follows on from #1246"
```

```
Duplicates: 1 candidate(s) — read these before filing.
  #1249  0.71  Report a distributed document's remaining resident budget at edit time, not at the gate (epic #1153)
Epic: Add it to the epic that already tracks a related issue (Tier A — do it).
  Target epic: #1153
  Related: #1246
```

Both answers were assembled by hand before this existed, and differently every time. A measured `fullrun new` spent **7 minutes 32 seconds — 22% of the run** listing open epics, fetching each one's children, reading a body and running six duplicate searches before implementation began; the session that measured it then filed work two open issues already covered, one of them filed **three minutes earlier by another session**. The same two answers now take about four seconds.

- **The duplicate half compares titles**, as a token overlap: the words each title uses, without the ones every title carries. Two issues about one job are written weeks apart by different sessions and share vocabulary rather than word order — which is what rules out whole-string edit distance and the maintained packages built on it. Bodies are not compared: they are written in the session language, and a token overlap over Japanese prose measures nothing.
- **The whole open listing is scored, with no prefix and no early exit.** The issue this search exists to catch is the one another session filed minutes ago, and where that one sits in the listing is the single thing nobody controls.
- **What closed recently is scored beside it, and marked `(closed)`** ([#1679](https://github.com/joshuafolkken/kit/issues/1679)). The work most likely to be filed twice is the work that just finished: [#1656](https://github.com/joshuafolkken/kit/issues/1656) was filed about five hours after [#1623](https://github.com/joshuafolkken/kit/issues/1623) closed having already done it, and an open-only scan could not see any of it. The newest hundred closed issues are read, ordered by their last update — GitHub has no `sort=closed`, and an update is what a close is. The two rank together, because which listing a row came out of says nothing about how well it matches; the `(closed)` marker is there because the reader does two different things with the two answers, an open candidate meaning the work is tracked elsewhere and a closed one meaning it may already be done. A closed listing that could not be read is a warning beside the report rather than a failure of it — the open half ran.
- **Closed rows reach the duplicate half only.** `epic:bundle` places a draft among issues still being worked on, and a closed one can neither gain a sibling nor be recommended as an epic, so the epic half's pool is unchanged. The closed listing therefore asks for `labels` where the open one asks for `body`: the epic exclusion above is applied to an open row from the open epic listing, which by construction holds no closed epic, so the closed half reads the label itself.
- **A weak match is not reported.** A candidate has to share at least two significant words _and_ clear a similarity of `0.35`; below that the answer is `none`, because a list nobody trusts is read once and skipped afterwards — the failure this command exists to end rather than reproduce. At most five are shown, and the headline says `N of M` when more cleared the bar than fit — a cap that reported the shown count as the found count would state a truncation as a complete answer.
- **An epic is never a duplicate candidate**, and the epic tracking one _is_ printed beside it. A container reported as "already filed as #E" sends the caller to run an epic that has no implementation of its own; the epic beside a candidate is the other thing being asked — where similar work already lives.
- **The epic half needs a number to work from, and says so when it has none.** Its signals are prose references and recorded dependencies, so a title-only draft gives it nothing to decide from and it prints `Epic: not asked` rather than "file it standalone" — a scan reported as empty where none was possible is the confident wrong answer every other gap line here exists to prevent. Pass `--body "…#<N>…"` when the work follows an existing issue; otherwise the epic printed beside a duplicate is the placement answer.
- **A summary that names an epic outright is answered with that epic.** `epic:bundle` excludes an epic from its candidate pool — a container is not a sibling — so `--body "part of epic #1153"` reaches `none` on its own and would be told to file standalone with the epic it named never mentioned. A person naming the epic is the strongest signal there is, the same thing `into <target>` means, so it is reported ahead of whatever the candidate search concluded.
- **The epic half is [`josh epic:bundle`](#josh-epicbundle)'s decision, called rather than restated** — the same strong signals, and the same branches — all of which are Tier A since [#1339](https://github.com/joshuafolkken/kit/issues/1339). Only two things differ, and both follow from the subject not existing yet: `none` prints "file it standalone" rather than "an epic already tracks it", which a draft cannot be, and the `blocked-by` relations are not read at all. A draft has no number, so no recorded dependency can name it and it declares none of its own — the reads cannot change either half of the answer, and skipping them takes one request per open issue off the command a run makes before every filing.
- **A reference the open listing cannot show is still read**, exactly as `epic:bundle` reads it ([#947](https://github.com/joshuafolkken/kit/issues/947)): a draft's summary naming a parent that merged minutes ago is the ordinary case, not the exception.
- **It does not replace `epic:bundle`, which still runs after the filing.** This one answers about an issue that does not exist yet, from a title; that one answers about an issue that does, from its number and its recorded relations. A run makes both calls.
- The listing's own cuts are reported the same way, so `none` is never quietly an assertion about data that never arrived.

### `josh epic`

Create the epic issue that tracks a batch of child issues from one split, from the child issue numbers.

```bash
pnpm josh epic "Epic: split the parser work" 101 102 103
pnpm josh epic "Epic: staged rollout" 101 102 --ordered
pnpm josh epic "Epic: ..." 101 102 --rationale-file rationale.md
git log -1 --format=%B | pnpm josh epic "Epic: ..." 101 102 --rationale-file -
```

An epic has four mechanical requirements, three of which fail **silently** when they are got wrong — the epic simply never auto-closes, or an unrecorded batch order is never reported. This command satisfies all four by construction:

| Requirement           | How the command satisfies it                                                        |
| --------------------- | ----------------------------------------------------------------------------------- |
| `epic` label          | ensures the label exists, then creates the issue with it                            |
| task-list child rows  | renders children as `- [ ] #N`, the only syntax the auto-close reads                |
| `Dependencies` form   | the arrow chain with `--ordered`, otherwise the literal `None — the children are …` |
| children-only `queue` | prints the `queue` command from the children; the epic is never included            |

- `--ordered` declares that **the argument order is the dependency order**. The command then writes the arrow chain _and_ records the matching `blocked-by` relation down the same chain, so the declared order and the native relations come from one input and cannot disagree. The relation goes through the REST dependencies endpoint (`gh api`), so it does not depend on the `gh` CLI's version ([#1026](https://github.com/joshuafolkken/kit/issues/1026)). That endpoint names the blocker by its **database id** rather than its issue number, and does not check that the id belongs to this repository — so the command resolves the id from the number before writing, and a resolution that fails is a failed relation rather than a relation pointing somewhere else. It is applied **after** the issues exist rather than as part of creating them, which is what keeps a failure costing only the relation: the count is reported and the run still succeeds, because the epic and its task list are already correct.
- **`--ordered` also records that it declared the order** ([#1712](https://github.com/joshuafolkken/kit/issues/1712)). The body gains a `## Decisions` section with a `### Declared order` entry naming the chain — inside backticks, so it is not read as a second declaration — and pointing at `## Split rationale` for the reasoning. [`josh epic:audit`](#josh-epicaudit) reports a declared order whose reason is recorded nowhere, and `--ordered` is a person stating one deliberately; without the entry every ordered epic failed that check as soon as it was created, and `epicrun` stopped at step one. It does not make the check vacuous: the entry names the chain the _creation_ declared, so a link typed into the body by hand afterwards is still reported. An unordered batch declares no order and gets no such section.
- `--rationale-file <path>` supplies the split rationale prose; `-` reads stdin, matching the `--input -` the REST writes use. Omitting it leaves a visible placeholder rather than a blank section.
- `--origin <owner/repo#N>` adds the backlink used when the split itself originated in another repository. It is written as prose — a checkbox row referencing another repository disables the auto-close by design.

The manual `gh` procedure remains documented in `prompts/collaboration-workflow/issue-template.md` as the fallback for environments where `josh` is unavailable.

#### `josh epic --promote` — turn an existing issue into an epic

```bash
pnpm josh epic --promote 858 101 102 103 [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]
```

The discussion that concludes "this is really three issues" almost always happens _inside_ an existing issue, and that discussion is usually the split rationale itself. Creating a separate epic leaves two issues tracking one topic, so `--promote` **appends** the epic's sections to the issue instead of replacing its body ([#865](https://github.com/joshuafolkken/kit/issues/865)).

Everything else matches `josh epic`: the `epic` label is ensured and applied, the children are rendered as task-list rows, `Dependencies` is written in the machine-readable form, and `--ordered` records the whole `blocked-by` chain. A promoted issue therefore passes `pnpm josh epic:check <N>` exactly as a created one does. `--rationale-file` and `--origin` mean the same thing they do on a creation.

**Re-running it is refused, not repeated.** A second append would leave two task lists in one body, and the auto-close would read whichever it matched first. The check is on the body rather than the label alone, since a label can be applied by hand without the sections.

Promote when the issue is a request, a discussion or a container. When the issue is itself one of the deliverables — a bug report that turns out to need three separate fixes — keep it as a child and create a new epic instead; promoting the report would leave the report with nowhere to live.

**The `Execution` section now prints `epicrun #<E>`**, for both creation and promotion. `epicrun` takes the epic rather than a list of children: it re-reads the state from GitHub each round, so an interrupted run resumes without anyone retyping the remaining numbers, and a child that needs a decision is parked rather than ending the run ([#861](https://github.com/joshuafolkken/kit/issues/861)). Epics created before this change still say `queue …` in that section and are unaffected — nothing reads it, the auto-close reads the task list and `epic:check` never looks at it.

#### `josh epic --add` — insert children into an existing epic

```bash
pnpm josh epic --add 893 894                  # track #894, declaring no order for it
pnpm josh epic --add 893 894 --before 891     # #894 must finish before #891
pnpm josh epic --add 893 894 --after 890      # #894 starts once #890 is done
pnpm josh epic --add 893 894 --decision-file why.md   # …and record why, in one call
pnpm josh epic --add 893 892 --after 891      # #892 is already a child — this moves it
```

Discovering mid-run that something else has to happen first used to have no tool behind it. The procedure said "add it to the epic's task list and record the dependency", but an epic's dependencies live in **three places at once** — and editing the body by hand updates one of them:

| Where it lives                          | What reads it                                     |
| --------------------------------------- | ------------------------------------------------- |
| the `- [ ] #N` task list                | the epic auto-close                               |
| the `## Dependencies` arrow declaration | [`josh epic:next`](#josh-epicnext)                |
| the native `blocked-by` relations       | `epic:next` again, as the authority for execution |

A body edited on its own leaves the declaration and the relations disagreeing, `epic:next` reports `declaration_mismatch`, and its verdict is `error` — which is `epicrun`'s stopping condition 3. So the one command that was supposed to keep an unattended run going stopped it instead ([#890](https://github.com/joshuafolkken/kit/issues/890)). `--add` writes all three from one input.

- **`--before <M>` re-points what `#M` was waiting on.** Inserting `#894` before `#891` in `#890 -> #891 -> #892` drops `#890 -> #891` and records `#890 -> #894` and `#894 -> #891`, so the chain is never left broken. The relations come from diffing the declaration before against the declaration after, which is why the re-pointing needs no special case.
- **No position declares no order at all.** The child is added to the task list, and every chain in `## Dependencies` is left exactly as it stood — no chain is extended, no chain is created, and no `blocked-by` is recorded for the new child. That holds whether the epic declares no chain, one, or several. Until [#1253](https://github.com/joshuafolkken/kit/issues/1253) the additions were appended to the **last declared chain**, which read out of "appends to the end" as readily as the task list did: an unrelated child added to an epic that mixes ordered and unordered children — the normal state, per [#949](https://github.com/joshuafolkken/kit/issues/949) — came out blocked by whatever issue happened to sit at that chain's tail, so `epic:next` withheld it as blocked with neither a park nor a `needs-decision` label to show that it was stuck. An order is recorded **only** where `--before` or `--after` names one. Giving a position to an unordered epic starts a chain naming just those two issues; the other children stay unordered, which is what the absence of a chain has always meant.
- **`--after <M>` branches rather than splices when `#M` already has a successor.** Adding `#1100` after `#1107` to `#1107 -> #1099` leaves that chain alone and declares a second line, `#1107 -> #1100`, so the only relation recorded is the one the position asked for. Until [#1080](https://github.com/joshuafolkken/kit/issues/1080) the addition was spliced between the two — the result was `#1107 -> #1100 -> #1099`, which declares that `#1100` blocks `#1099`, an order nobody stated. A fan-out (`#A -> #B` beside `#A -> #C`) is a legitimate declaration and `## Dependencies` already reads one line per chain, so the branch needs no new syntax. **Appending after the tail is not a branch**: with no successor to displace, `--after` extends the chain, which is what asking for a tail append means. **A second branch at the same point is allowed**, because a branch identifies no one chain to write into: where every chain naming `#M` already has a successor, `--after <M>` is the same new line whichever a reader picks, so a fan-out does not leave its own target impossible to position against. It stays ambiguous only when one of those chains ends on `#M` and another does not — then one would be extended and the other branched, and which is meant is the declaration author's to say. `--before <M>` itself is unchanged — the re-pointing above is what keeps that chain unbroken, and it invents nothing — but a branch does put `#M` in two chain lines, so a later `--before <M>` meets the ambiguity refusal below rather than re-pointing. That refuses without writing, and it is the same answer a hand-authored fan-out has always given; widening `--before` to a fan-out is out of scope here.
- **"Left exactly as it stood" is the section's text, not just its links.** A declaration the insertion computes unchanged is not re-rendered at all, because the rewrite collects every chain line at the first one's index — which would file each chain's rationale line under whichever chain ended up above it, in exchange for a body that was going to be identical. A positioned insertion still re-renders, since it has a new order to write.
- **A position given for a child the epic already tracks moves it** ([#1701](https://github.com/joshuafolkken/kit/issues/1701)). `--add 893 892 --after 891` reads as "reorder", not as "nothing to add": the task-list row moves beside `#891`'s, the `## Dependencies` chain is rewritten, and the `blocked-by` relations follow — the three places that must agree, written from one input as every other insertion is. It is implemented as a removal followed by the ordinary insertion, so `#892` is first spliced out of every chain that named it — `#890 -> #892 -> #895` closes to `#890 -> #895` — and then placed by the same code path an addition takes. That is why `--before` still re-points and `--after` still branches past a target that has a successor. **The hub refusal is decided on the declaration as it stands, before that removal** — otherwise a move could _collapse_ the ambiguity rather than resolve it: with `#890 -> #891` beside `#892 -> #891`, `--before 891` moving `#892` would leave one chain naming `#891` and splice there, recording `#890 -> #892`, an order nobody asked for. **That applies to `--before` alone**, because only a `before` puts its child in front of the target and so inherits whatever that target was waiting on; an `--after` either branches or extends a tail, so the only relation it records is the one asked for — `--add 893 892 --after 891` on that same pair correctly flips it to `#890 -> #891 -> #892`. **Without a position the refusal stands**: `Every issue given is already tracked by this epic; nothing to add.`, now naming `--before` / `--after` as the way to make it a move. Until this, no verb could write an order between two tracked children at all, so the only route left was the hand edit this command exists to prevent — and `epic:next` presents children in task-list order ([#1583](https://github.com/joshuafolkken/kit/issues/1583)), so the same gap blocked expressing a priority. The reordered rows are round-tripped like the declaration: a body that would not put them where the position asked is reported instead of written.
- **A position places an addition's row too, not only a moved one** ([#1704](https://github.com/joshuafolkken/kit/issues/1704)). `--add 893 894 --before 891` puts the `#894` row directly before the `#891` row — where the declaration puts `#894`. Until then a positioned addition's row was appended to the end of the task list while the chain named the position, so the order a reader saw was not the order the epic declared. Mixing the two showed it plainly: `--add 893 894 892 --before 891` declared `#890 -> #894 -> #892 -> #891` and listed `#890 / #892 / #891 / #894`, the moved row at the position and the added one still last. Additions and moves now enter the list together, in the order they were typed, and the round trip that refuses a body whose rows did not land where the position asked covers the added rows as well. **Nothing changes without a position**: the row is appended, because with no order declared, where it sits says nothing.
- **A relocated child is not an addition, and the report says which happened.** `📋 Added …` names the children that gained a task-list row and `📋 Moved … within epic #N.` the ones whose row moved; a call that only moves prints the second line alone. `--decision-file` comments on both, since a move is a placement decision as much as an insertion is.
- **An issue the declaration names while no task-list row tracks it is not a child, so it is not moved either.** That disagreement is what [#890](https://github.com/joshuafolkken/kit/issues/890)'s cycle came out of; re-rendering the missing row would repair by guesswork a body somebody has to reconcile, so it keeps the refusal it already had.
- **A position naming one of the issues being placed is refused** — `--add 893 892 --after 892` asks for an order against itself, which is neither an addition nor a move.
- **`#M` does not have to be in the declared order.** An epic that mixes ordered and unordered children leaves a child out of every chain legitimately, and a position against such a child adds a **new** chain line beside the existing ones rather than being refused ([#949](https://github.com/joshuafolkken/kit/issues/949)). The chains already declared are left exactly as they were. Before this, the refusal left a prerequisite discovered against an unordered child with nowhere to be recorded, and the documented next step — hand-editing the body — is the one thing this command exists to avoid.
- **`#M` must be a child of the epic**, or nothing is written and the command exits non-zero — and `#M` may not itself be one of the issues being placed. Those two are the only reasons a position is refused.
- **Nothing is written unless all three places will agree.** The rewritten body is parsed back before it is sent, and a round trip that does not reproduce the computed order is reported instead of written. The same holds when the epic **already** records a relation its body never declares: that is reconciled by a person, not guessed at.
- **A declaration the command cannot position within is refused, not rewritten.** `#M` named by two separate chain lines does not identify one place — except for the `--after` fan-out named above, where every one of them has a successor and the answer is the same either way — and a declaration naming the same issue twice is already claiming that issue blocks itself.
- **A declared link that was never recorded is repaired rather than refused.** A body can legitimately run ahead of the relations — an epic written before `josh` recorded them, or one whose recording failed — so `--add` records the missing ones along with its own. A failure is reported as a count while the body stays correct — the same treatment `--ordered` gives it.
- **The relation report names each pair, not just how many.** `🔗 2 blocked-by relation(s) recorded: #1228 -> #1248, #1248 -> #1249.` A bare count cannot be checked — an insertion that recorded an order nobody declared printed the same line as a correct one, which is how [#1080](https://github.com/joshuafolkken/kit/issues/1080)'s invented chains went unnoticed across several runs. The pairs are written in the `#blocker -> #blocked` form the declaration itself uses, so the reader compares like with like. The failure line stays a count: `apply_relations` reports how many writes failed and not which, so naming the whole set there would assert more than is known.
- **A positioned insertion says which `blocked-by` relation it replaced** ([#1711](https://github.com/joshuafolkken/kit/issues/1711)). Re-pointing is what `--before` and a relocation do by design, and the only trace of what had been discarded used to be filtered down to the relations GitHub had recorded natively — so a declared-but-unrecorded order could be re-pointed without a word, and nothing that outlives the console said anything at all. Every link the declaration dropped is now printed as ``↪ Replaced blocked-by: `#890 -> #891`.``, and the same sentence goes into a `--decision-file` record. **The policy is to report, not to refuse**: an insertion carrying no `--decision-file` still re-points, because refusing one would close the route [#1701](https://github.com/joshuafolkken/kit/issues/1701) deliberately opened, while naming what was dropped costs the caller nothing. An insertion that replaced nothing prints no such line and adds nothing to its record. The case this was written after is [#1703](https://github.com/joshuafolkken/kit/issues/1703), where two positioned adds four minutes apart replaced a `blocked-by` whose reasoning was written down — turning a satisfied dependency into an unsatisfied one, and leaving the body's declaration, the native relations and the recorded decision disagreeing with one another.

**`--decision-file <path|->` records why the child was placed here, in the same call** ([#1350](https://github.com/joshuafolkken/kit/issues/1350)). An auto-decided placement has to be written in **two** places — the epic's `## Decisions` and a comment on each child — and until now no command wrote the epic half, so a run read the body, edited it and `PATCH`ed it back: the hand edit this command exists to avoid. Measured on runs #1333 and #1349, that detour is where the post-merge bookkeeping spent its round trips, and the two most recent placements skipped the epic half entirely rather than pay for it.

- **The epic half costs no round trip.** The record is folded into the body edit the insertion already makes, so a `--decision-file` insertion is the same one request. The child half is one comment per addition, applied concurrently and **counted rather than thrown**: the insertion has landed by then, so a refused comment is reported as `⚠️ N of M child comment(s) could not be posted` while `📝 Decision recorded on the epic and N child issue(s).` is the clean answer.
- **The record's text is the caller's**, exactly as `--rationale-file`'s is: which epic was taken, which was rejected, why and the date is a judgement. What the command contributes is the placement — appended at the **end** of the `## Decisions` section, which is a log read downwards — and the section is created at the end of the body when the epic has none.
- **The section ends at the next heading of the same or a higher level**, not at any heading: `## Decisions` is written as one `###` entry per decision, so a `##` section that stopped at the first `###` would place every later record outside it. **The same rule now scopes the `Dependencies` rewrite**, which used to stop at a heading of any level — so a declaration line beneath a `###` subheading inside `## Dependencies` is read as part of that section rather than as a stray line outside it. That is the reading a person already gives the body; nothing else about the rewrite changed.
- **Three inputs are refused before anything is written**: a record that says nothing, a record carrying a line that is _nothing but_ a dependency chain, and the flag given without a usable path (last on the line, followed by another flag, or repeated). The chain refusal is the load-bearing one — a bare `#890 -> #894` line is read as part of the declaration wherever it sits in the body, so such a record would add a dependency nobody declared; quote the order inside backticks, or fence it, and the same sentence is accepted. **It names the line number rather than quoting the line**: the record is a file the caller handed over, and echoing a line of it into stderr would put arbitrary file content in the console. The missing-path refusal matters because the flag is passed precisely when the record has to exist: read as "none was asked for", a shell that ate the path would land the insertion, write no record and exit 0 — success reported for half the job.
- **It records a decision about a child being placed** — inserted or moved. A decision about an already-tracked child reaches it through a position: `--add 893 892 --after 891 --decision-file why.md` moves `#892` and comments on it, which is `epic:plan` phase 2's usual case ([#1701](https://github.com/joshuafolkken/kit/issues/1701)). Without a position there is still nothing to place, and the insertion is refused before any record is written.
- **The record carries what the placement replaced.** Where the insertion drops a `blocked-by` relation, ``Replaced blocked-by: `#890 -> #891`.`` is appended to the caller's text — reaching the epic's `## Decisions` entry and every child comment alike, since both are written from one string rather than composed twice ([#1711](https://github.com/joshuafolkken/kit/issues/1711)). The chain is backticked for the reason the refusal above asks for backticks: a bare `#890 -> #891` line is read as part of the declaration wherever it sits in a body. An insertion that replaced nothing gains no such line, and one carrying no record gains none either — this appends to a record, it does not create one.
- **A cross-repository refusal names the flag rather than relaying it.** The suggested command runs in another checkout, where a relative path does not exist and `-` cannot be re-read from a consumed stdin, so the refusal asks for `--decision-file` again with a path that checkout can read.
- **Leaving the flag off writes no record and posts no comment.** The insertion itself is what it always was.

**`--remove <E> <M> <N> [<N2> …]` deletes a declared order from the body and from the relations in one input** ([#1712](https://github.com/joshuafolkken/kit/issues/1712)). It is `--add`'s missing counterpart: writing the two halves separately is what leaves them disagreeing, and so is deleting them separately — `epic:next` answers `declaration_mismatch` either way, which stops an unattended run.

```bash
pnpm josh epic --remove 900 101 102                       # delete the order #101 -> #102
pnpm josh epic --remove 900 101 102 103                   # delete #101 -> #102 and #102 -> #103
pnpm josh epic --remove 900 101 102 --decision-file why.md
```

Until it existed, the only route was the hand edit `CLAUDE.md` forbids — edit `## Dependencies`, then `gh api -X DELETE …/dependencies/blocked_by/<id>` — and doing either half alone stops the epic. Epic [#1262](https://github.com/joshuafolkken/kit/issues/1262) records **twenty-nine** such removals, and [#1637](https://github.com/joshuafolkken/kit/issues/1637) records one that wrote the relation half alone and stopped a running epic.

- **The arguments are a path, and each consecutive pair is one order.** That is how a chain is written in the body, so deleting a whole chain is one invocation rather than one per link. The list is **not** deduplicated and an unparsable member refuses the whole call: a path is a sequence, so dropping a repeat or skipping a member would delete a different set of orders than the one typed.
- **The ends are never reconnected.** `#A -> #B -> #C` minus `#B -> #C` leaves `#A -> #B`; removing a middle child's two links leaves `#A` and `#C` with **no** order rather than `#A -> #C`. Reconnecting would declare an order nobody stated — exactly what [`josh epic:audit`](#josh-epicaudit)'s unjustified-order check reports — and a command whose purpose is to delete a declaration must not write one. (This is the one point [#1712](https://github.com/joshuafolkken/kit/issues/1712) asked to be decided and recorded.)
- **Deleting the last declared link writes the unordered sentence**, not an empty section. An emptied `Dependencies` section carries no machine-readable declaration at all, which [`josh epic:check`](#josh-epiccheck) refuses and `epic:next` reads as an error.
- **The task list is untouched.** A removal deletes an order, never a child; the rows stay exactly where they are.
- **An order the declaration does not name is refused**, not treated as a no-op: the caller believes an order exists, and answering "done" to a removal that removed nothing is how a false order survives the one command written to delete it.
- **Only relations that are actually recorded are dropped.** Asking `gh` to remove a link that was never there would be reported as a failure nobody can act on.
- **`--decision-file` works exactly as it does for `--add`**, and posts the record on **both** ends of every deleted order — whoever later asks why `#B` is no longer waiting on `#A` may be reading either issue.

**A target that is not an epic is refused with both ways out named.** The message reads `#N does not carry the epic label, so it is not an epic.`, followed by the two remedies: promote it with `josh epic --promote <N> <N...>` when it is a request, a discussion or a container, or create a new epic over both when it is itself one of the deliverables. The command never promotes on its own — promotion rewrites the target into a container, and which arm applies depends on what the target is. Naming both is what keeps the refusal one command away from actionable, which is what the `into <target>` suffix needs of it ([#985](https://github.com/joshuafolkken/kit/issues/985)).

**A cross-repository target is refused with the command to run instead**, not with the usage line. `pnpm josh epic --add joshuafolkken/kit#909 985 --after 970` in the wrong checkout answers with `pnpm josh epic --add 909 985 --after 970` and points at `pnpm josh doctor` for where that checkout is — the children and the positioning flag are carried over from the parsed invocation, so nothing the person typed is silently dropped. `owner/repo#N` is a legal thing to type after `into`, and the answer is a different checkout rather than a different spelling; the usage line would have read as "that form does not exist". **An invocation that is also wrong in some other way still gets the usage line**: the suggestion is only offered when replacing the target with its bare number would parse, so a mistyped positioning flag falls through to the usage line rather than being folded into a suggested command as an extra child. A reference that names **this** repository is not a refusal at all — it is the same insertion written longer, and the command performs it.

**The prose execution block in an epic body is out of scope.** Some epics carry a hand-written list of `epicrun` lines for a person to type in order — a _fourth_ place the order appears, and the only one `--add` does not touch. It has no defined syntax to parse, and [#900](https://github.com/joshuafolkken/kit/issues/900) removes the need for such a block entirely by making a meta epic runnable, at which point `epicrun #<E>` on one line replaces it. Until then, an epic that carries one needs that block updated by hand after an insertion: the declaration and the relations will agree, so `epic:next` reports nothing, and a person typing the old list is the only thing that notices.

### `josh epic:next`

List an epic's runnable children, bundled per repository ([#860](https://github.com/joshuafolkken/kit/issues/860)).

```bash
pnpm josh epic:next 858                            # alias: josh en
pnpm josh epic:next 858 --repo joshuafolkken/kit   # just the next child for one repository
pnpm josh epic:next 858 --repo joshuafolkken/kit --lanes   # one child per free lane there
pnpm josh epic:next 858 909 --repo joshuafolkken/kit --lanes   # both epics into one lane pool
```

**Several epics answer as one** ([#1493](https://github.com/joshuafolkken/kit/issues/1493)). Every leading argument is an epic reference — the split is on the first flag, so `epic:next 858 909 --repo X --lanes` reads two epics and `epic:next 858 --repo X` still reads one — and their runnable children merge into a single candidate pool per repository. Without it a repository with six free lanes could only ever fill them from whichever epic was named first, which is the whole point of having six.

- **The priority order is the order the epics were named.** Dependency depth was the alternative and it does not compare across graphs: depth is measured inside one epic, so a depth-2 child of a five-deep epic and a depth-2 child of a two-deep one make the same claim about entirely different amounts of remaining work, with no relation between the two epics to normalize against. Argument order is the one ranking a person typed and can change. **Inside one epic the order is that epic's own task list** ([#1583](https://github.com/joshuafolkken/kit/issues/1583)) — its declared chain still decides which children are _runnable_, and among those the task-list order decides which is offered first; this argument order only decides whose candidate takes a free lane when two epics both have one.

- **An epic orders its runnable children by moving their task-list rows** ([#1583](https://github.com/joshuafolkken/kit/issues/1583)). It was the lowest issue number until then, on the premise that number order is split order — which holds only for an epic whose children were all filed in one split, and is _filing_ order for any epic that gains children as work is found. On such an epic the priority a person recorded was simply ignored. **Priority is not dependency**: a child listed first that is waiting on a person never becomes runnable, so it is skipped rather than holding back the ones below it — which is exactly what declaring the order as a `blocked-by` chain does instead, and why an order should not be recorded that way. An epic whose rows nobody has reordered is unaffected: `epic --add` appends where no position is named, so new children still come last, and an epic filed in one split still lists its children in number order.
- **A child two epics both track enters once.** Keyed by `owner/repo#number`, because a bare number names a different issue in another repository. The epic named **earlier** keeps it, and that also settles the case where the earlier epic _withholds_ it: it stays withheld, since a `blocked-by` relation belongs to the issue rather than to the epic that lists it.
- **One unusable graph refuses the whole answer**, whichever epic it belongs to. Handing out another epic's child in the same breath would let an unattended run walk past a graph a person has to look at.
- **One reference that does not parse fails the read** rather than being dropped — a run told about five epics and answered from four has silently reduced its own scope, and unattended there is nobody to notice. So does one naming another owner's tracker, and it is refused before that repository is asked anything.
- **A childless epic is skipped, not refused** — the one case that does _not_ stop the read. An `epic:plan` epic whose task list has not been filled in yet is a valid, readable epic of ours, and refusing the whole command for it would stop every other named epic's children being offered on every polling round. It is named on standard error; where no named epic survives, those notices _are_ the refusal, which is exactly the line a single childless epic printed before.
- **The same epic named twice is read once.** `858` and `joshuafolkken/kit#858` in one command are recognized as one epic, so an unattended run does not pay the duplicate fetch every polling round.
- **Without `--repo` each epic gets its own block**, headed by the reference as it was typed. A single epic prints exactly what it printed before. **That aggregate form is also where per-epic completion is read**: the `--repo` token answers about the pool, so it says `complete` only once every named epic is.
- **`pnpm josh latest` is unaffected.** Its once-per-repository hoist is keyed to the session and the checkout, never to an epic, so naming five epics still runs one dependency update — see [`epicrun`](https://github.com/joshuafolkken/kit/blob/main/.claude/skills/workflow-commands/epicrun.md).

Running an epic's children today means handing `queue` a list a person ordered by hand. When a run is interrupted, "where did we get to" is answered by a person reading the issue list again — which is why it cannot be the base of an unattended run. `epic:next` answers it mechanically, and **all of the state lives on GitHub**: there is no local state file, so asking again after any interruption gives the same answer.

**Every runnable child is returned, not one.** The children are bundled by repository so a caller can run one per repository at the same time. Returning a single candidate would close off cross-repository parallelism in the design itself, making the command slower than the person opening several editors it is meant to replace.

```text
Runnable children (each takes a free lane in its repository):
  joshuafolkken/kit
    #861
    #870
  Waiting on time:
    #862
```

Each bundle names the local checkout a runner would work in, from the [repository map](#the-discovered-repository-map). A repository with no checkout here is reported as `(no local checkout)` rather than cloned.

Every open child appears exactly once in the report, so nothing is silently dropped. A child that could not be read is **not** dropped either — it stops the command. Dropping it is wrong in both directions: an epic whose children all failed to read would look like an epic with no open children, and one missing child leaves whatever it blocks looking unblocked.

**An epic in another repository is referenced as `owner/repo#N`** — `pnpm josh epic:next joshuafolkken/kit#858 --repo joshuafolkken/app-kit`. A bare `#N` resolves to _this_ repository's issue of that number, a different issue entirely, so the qualification is required rather than optional ([#864](https://github.com/joshuafolkken/kit/issues/864)). Children in other repositories are written in the epic's task list as `owner/repo#N` or a full issue URL, and their state is read against that repository through `gh api` — no clone is needed to learn it.

**A `blocked-by` relation that crosses a repository is read as one** ([#1126](https://github.com/joshuafolkken/kit/issues/1126)). REST records and returns such a relation, but the read used to keep only the issue number — and a number alone cannot say which repository it names, since issue numbers are unique per repository. Every blocker was therefore resolved against the **blocked child's own** repository, where it named a different issue or none at all; the graph then dropped it, and the child ran as though nothing blocked it. It also made the publish check below unreachable: every blocker arrived carrying the blocked child's repository, so "same repository" always held and the closed blocker was called resolved without the registry ever being consulted. Relations now carry the repository REST names in `repository_url`, and a relation with none falls back to the repository the issue itself was read in — which is what an unqualified relation has always meant.

`epic:audit` asks a pair of children in two different repositories the same order question as any other pair, which it could not do before ([#1128](https://github.com/joshuafolkken/kit/issues/1128) lifted the exemption that stood while such an order could not be recorded at all). **The finding is a warning rather than an error**: an error fails the audit `epicrun` runs before its first child, so every epic written before this capability existed would stop at step one — [#1010](https://github.com/joshuafolkken/kit/issues/1010) is what that looks like. A pair inside one repository is unchanged and still an error.

**A warning does not make that pair safe, and it is worth being plain about this.** The finding fires exactly when nothing orders the two, so there is no relation for `epic:next` to read and the child is still offered as runnable — it can start before the work it cites. What the change buys is that this used to be silent and is now said. Making it safe would mean stopping, which is what the decision declined for epics that predate the capability. Clearing a warning means recording the relation, and [`josh epic --add`](#josh-epic) cannot write a cross-repository one yet ([#1138](https://github.com/joshuafolkken/kit/issues/1138)) — until it can, that is a `dependencies/blocked_by` request by hand.

**A dependency that crosses a repository is not satisfied when the blocking issue closes.** Merging kit's issue does not publish kit: the merge, the auto-tag and the publish run one after another. A consumer child told it may start at that moment installs the previous release, or fails outright — which surfaces as "it breaks sometimes", the hardest kind to diagnose. Such a dependency resolves only when the blocker is closed **and** the version its default branch declares has appeared in the registry, and the evaluation is an AND **in that order**: while the blocker is still open the registry is never consulted, so a run never sits waiting on a publish from the moment it starts. The target is that exact version, never "something newer" — a consumer several releases behind would otherwise be satisfied by a publish that predates the change. The publish check is [`josh propagate`](#josh-propagate)'s own, shared rather than restated.

**A repository that publishes no package is not something to wait for** ([#1129](https://github.com/joshuafolkken/kit/issues/1129)). The publish check above answers "not yet" forever for a package that will never appear, so a closed blocker in a website repository — anything that ships no npm package — waited until the run's own eight-hour timeout with nothing an operator could edit to clear it. That state only became reachable with [#1126](https://github.com/joshuafolkken/kit/issues/1126).

The answer is read from the **blocker repository's own manifest**, not from the registry: no `package.json` on its default branch, or one declaring `private` that is not a workspace root, means it ships nothing and a closed blocker there is resolved. **A private workspace root is excluded** ([#1134](https://github.com/joshuafolkken/kit/issues/1134)) — such a root is private by convention while the packages under it publish, so reading one as shipping nothing would start a dependent before its blocker's release existed. Only whether the repository _is_ a workspace is asked; the members are not enumerated, so a workspace whose members are all private waits when it need not. **A workspace is what declares members**, not what has a `pnpm-workspace.yaml` — `josh sync` distributes that file to every consumer whatever its layout, carrying `overrides` and the like, so its presence alone would read every private project as a workspace. A workspace file nobody could read leaves the layout unknown and the dependency waiting. That is the safe direction, because waiting ends at the run's own timeout and resolving early does not end at all. Deliberately not the registry, which answers 404 both for a package that was never published _and_ for one this token may not see — a renamed repository, a private package, a missing `read:packages` scope — so resolving on a registry 404 would start a consumer child before its blocker's release existed. A manifest 404 carries no such ambiguity: the repository's issues are already being read, so access is established and what is missing is the file. A read that merely failed is told apart by HTTP status rather than by `gh`'s error text, and keeps the dependency waiting.

With `--repo`, standard output carries exactly one token — the issue number when there is a child to run, otherwise the verdict (`wait`, `stop` or `complete`) — so `answer=$(josh epic:next 858 --repo joshuafolkken/kit)` captures something a loop can branch on. Every explanation goes to standard error. `run` never appears there: it would mean another repository has work, which for this session is something to wait on, so it is reported as `wait`.

**`--lanes` is what asks for more than one**, and it prints one issue number per line, up to the number of free lanes ([#1491](https://github.com/joshuafolkken/kit/issues/1491)). Without it the answer is a single token, so a caller written against the one-child contract reads exactly what it always read. `--lanes` without `--repo` is refused rather than ignored: the lane count is a property of one repository, and a flag that silently does nothing is a caller believing it asked for something.

**An `in-progress` issue occupies a lane, not the repository.** Before `--repo` hands back anything, the repository is asked **how many** of its lanes are running something: every open issue there carrying `in-progress` and not parked counts for one, whichever epic it belongs to ([#925](https://github.com/joshuafolkken/kit/issues/925), counted rather than excluded since [#1491](https://github.com/joshuafolkken/kit/issues/1491)). What is left of the limit is what gets offered; at zero the answer is `wait` and the holders are named on standard error. A parked issue counts for nothing because `needs-decision` outranks `in-progress` in the classification too, and a run that had just set a child aside would otherwise be held back by it — while a child stopped by `needs-human-review` goes on holding its lane, because its uncommitted work is still sitting in that checkout.

**The limit is a ceiling, not a prediction.** `JOSH_LANE_LIMIT` sets it and **the default is 6**; six lanes does not say six children will run at once, it says a seventh will not start. What actually runs is bounded by what is runnable, by the port seats [`josh lane:open`](#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune) can allocate — nine — and by the machine. An invalid value is a hard error rather than a silent fall back to 6, the rule [`PORT_SEED`](#josh-port) already holds to: a typo that quietly becomes the default is a limit nobody chose.

**The occupancy is counted from GitHub, never from the session.** Two `epicrun`s counting to six in their own memory give twelve lanes, and the label on an open issue is the one record both of them read — the same reason nothing else in this command keeps local state. Until [#1490](https://github.com/joshuafolkken/kit/issues/1490) the repository-wide exclusion was what stopped a second session starting at all; turning `in-progress` into lane occupancy removes that brake, so the count has to hold per repository rather than per session.

The check is made **only when there is a candidate to offer**: consulted on `stop` or `complete` as well, an unrelated `in-progress` issue would turn a finished epic into a permanent `wait`.

It is advisory rather than atomic. The label is applied by whoever implements the child, _after_ this read, so two sessions starting in the same instant can still take one seat twice; what the check closes is the window that actually occurs, where a session already running a child holds the label for minutes. An abandoned label therefore holds a lane until somebody removes it — which is why the holders are named on standard error, and why [`epicrun`](../.claude/skills/workflow-commands/epicrun.md)'s stale rule applies to any open issue in the repository rather than to the epic's children alone.

A listing that could not be read is **not** an idle repository — the answer is `wait` rather than the child, since reading a failed read as "nothing is running" is the one direction a guard like this may not fail in. It is not an exit either: the listing swallows a passing rate limit into the same failure, so exiting would end an unattended run over a blip, while a persistent failure is already caught by the unreadable-child anomaly before this read happens.

A listing that was **cut short** lands on the same side ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). Since the paging applies a page ceiling to every listing, a well-formed but incomplete answer with no visible holder is a third thing — and "no holder in the rows I was given" is not "no holder". It answers `wait` too, with its own message: the cause is a listing the paging could not read to the end, so `gh auth status` is green and clearing a stale label would not change it.

**The candidate is confirmed against its own relations listing before it is handed over** ([#1121](https://github.com/joshuafolkken/kit/issues/1121)). A child's blockers are normally read from the issue's `issue_dependencies_summary`, and the listing request is skipped entirely when that summary counts zero — which is what keeps a pass over the whole backlog to one request per issue. The summary is GitHub's own count and it can be wrong: measured on [#1111](https://github.com/joshuafolkken/kit/issues/1111), it read `total_blocked_by: 0` while the listing returned a real, unremovable relation. [#1113](https://github.com/joshuafolkken/kit/issues/1113) re-reads such a child when the epic body _declared_ the missing link, which closes the direction that makes this command exit 1 on a graph with nothing to fix. A relation that was recorded but never declared leaves no trace in the body, so nothing marks the child as a suspect — and there the mistake runs the other way: the child is offered, and an unattended run implements it before its prerequisite.

So the one candidate `--repo` is about to return is asked for its relations directly. When the listing agrees with the summary the child is offered, as before. When it disagrees, that child's blockers are replaced and the whole classification is run again — re-running the classifier rather than testing the listing for emptiness is what makes a blocker that is already closed, or one in another repository whose release has published, come out right without a second copy of those rules. If the child is no longer runnable it is **withheld**, and the next candidate in the same repository is confirmed in its place; a healthy sibling is not made to wait for one child whose counter is stale, because nobody repairs that counter and the wait would never clear. When every candidate is withheld, the verdict is read off the corrected graph.

The cost is one request per candidate confirmed — one in the ordinary case, where the first candidate is offered, and at most the size of the repository's bundle when every one of them is withheld. It is spent only where it can change an answer: **after** the exclusion above, since a busy repository is handed nothing, and not at all when the repository has no candidate. A listing that could not be read withholds the candidate rather than confirming it — "could not tell" is not "nothing blocks it", and this is the one direction the guard may not fail in, because that answer _starts_ work.

**The remaining children are sorted by whether waiting helps — never by which label they carry.**

| Bucket              | What is in it                                                                           | What the caller does |
| ------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| Runnable            | Open, not parked, not already being worked on, and every dependency resolved            | Run it               |
| Waiting on time     | Being worked on elsewhere, waiting on a release, or blocked by something in this bucket | Wait and ask again   |
| Waiting on a person | Carries `needs-decision` or `epic`, or is blocked by something in this bucket           | Stop and report      |

**A child that is itself an epic is never runnable** ([#1476](https://github.com/joshuafolkken/kit/issues/1476)). An epic is not a unit of work, so a run handed one has nothing to implement — and before this the row fell through to the dependency reading, which makes anything unblocked runnable, so `epicrun` passed the epic to `fullrun` as an ordinary issue. It waits on a person rather than on time because no amount of waiting turns an epic into work. **The test is the child's `epic` label, never how its task-list row is written**: a row naming `owner/repo#N` is a different property and a legitimate one, so a cross-repository child that is not an epic stays runnable and one that is an epic is withheld exactly like a local one. The reason is printed on standard error, because the report itself shows only a bare `#N`; [`josh epic:audit`](#josh-epicaudit) reports the same row as a finding.

Reading the labels instead would fail in a specific, ordinary state. The moment kit's child closes and app-kit's child is waiting for the release to publish, there is no runnable child, nothing carries `in-progress` (kit's child is closed) and nothing carries `needs-decision` (nothing was parked). A label-based reading sees "nothing running, nothing parked" and stops — in the one situation where it should wait.

**Blocking is followed transitively.** A child behind a release-waiting child is waiting on time; a child behind a parked one is waiting on a person, however long the chain. Where both apply, the person wins: waiting would not release a parked blocker whatever the other one does.

The verdict follows from the buckets, and waiting is checked before stopping — a run that stopped while something was still resolving on its own would abandon an epic that was going to finish.

| Verdict  | When                                                              | Exit code |
| -------- | ----------------------------------------------------------------- | --------- |
| run      | At least one child is runnable                                    | 0         |
| wait     | Nothing runnable, but something resolves on its own               | 0         |
| stop     | Nothing resolves on its own; the remaining children need a person | 0         |
| complete | No open child is left                                             | 0         |
| error    | The dependency graph is unusable                                  | 1         |

`--repo` answers `wait` for three things that are not verdicts of the epic at all: every lane in the repository is already in use, the `in-progress` listing for it could not be read, and that listing was cut short before it ended. All three are reported on standard error, and none of them changes the exit code — the aggregate form, which does not consult the lane count, says so there too. A `JOSH_LANE_LIMIT` that is not a positive integer is the one setting that exits 1 instead.

**Whether a dependency is resolved is a replaceable rule.** By default a dependency is resolved once the blocking child is closed. That is not enough across repositories — kit's issue closes before the package is published — so [#864](https://github.com/joshuafolkken/kit/issues/864) replaces the rule with one that also waits for the publish. The extension point is what keeps that condition in one place rather than duplicated per caller.

**Two things stop the command instead of being worked around.**

- **A circular dependency.** Hand-added `--add-blocked-by` edges can make `#1` wait for `#2` while `#2` waits for `#1`, and every session would then wait forever. The children that can never start are named — including the ones stuck _behind_ the cycle, since those never become runnable either.
- **A disagreement between the epic body and the relations.** The body's `Dependencies` section is the human-readable record; the `blocked-by` relations are the authority for execution. When they disagree — an epic written before `josh` recorded the relations, a recording that failed, or a relation hand-added since — the command reports both directions and refuses to pick a winner, because silently following either implements in an order nobody agreed to.

  Only a line that is _nothing but_ a chain counts as a declaration. An epic whose Dependencies section is followed by prose recommending an execution order (`推奨実行順: #869 -> #863 -> …`) is stating a suggestion, not a dependency, and reading those arrows as declarations reported four disagreements against relations that were correct. **Every reader of the body answers from that one definition** — the link reading here, `epic:check`'s "is an order declared at all", and `josh epic --add`'s rewrite, which protects an arrow outside the `Dependencies` section as prose. Until [#1155](https://github.com/joshuafolkken/kit/issues/1155) the existence reading used a pattern of its own that matched anywhere in the body, so two readers of one epic answered the same question differently.

The body is parsed through the same module the epic auto-close uses, so "what the auto-close tracks" and "what this command reads" cannot drift apart.

### `josh epic:bundle`

Say whether a newly filed issue belongs with ones already in the backlog ([#873](https://github.com/joshuafolkken/kit/issues/873)).

```bash
pnpm josh epic:bundle 874   # alias: josh eb
```

"Two or more always means an epic" already holds when one request is split on the spot. It does not reach the other way in: two issues filed days apart that turn out to be the front and back of one job are executed separately, in whatever order, with the reasoning recorded nowhere.

Run it right after an issue is filed — by `kickoff`, `fullrun` or `halfrun`, or by any Tier A filing during implementation, including inside an `epicrun`. **The command finds candidates and recommends; it writes nothing.** The machine's job is to surface what it found, not to decide.

**Only two things count as a signal**: the two issues referring to each other in prose, or a `blocked-by` already recorded between them. **A similar title never counts on its own** — "related" expands without limit, and a threshold is what keeps an unrelated issue out of the bundle. The candidate search is [`josh epic:audit`](#josh-epicaudit)'s implicit-dependency analysis, shared rather than repeated: one reads inside an epic and the other across the backlog, but what they read is the same prose references.

An issue is kept in at most one epic — a convention rather than something a task list enforces, since nothing stops two epics writing the same row (joshuafolkken/kit#1694) — so there is a branch:

| Candidates                                         | What to do                                                                                      | Tier |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---- |
| **The new issue itself already has an epic**       | Nothing — an issue belongs to at most one, and moving it between epics is not what this is for  | —    |
| Already a child of an epic                         | **Add to that epic**; do not create a second one                                                | A    |
| Spread across an epic and its **own parent**       | **Add to the inner epic** — the parent already contains it                                      | A    |
| Spread across **different** epics                  | **Choose the one you recommend, add to it, and record why**                                     | A    |
| In no epic, and two or more counting the new issue | **Create an epic** for them                                                                     | A    |
| No strong signal                                   | Nothing                                                                                         | —    |
| **The epic listing was cut short**                 | **Nothing** — every placing row above is withheld, because the membership was never established | —    |

Bundling is reversible — an epic is editable and a child can be removed — so it needs no confirmation, and **that includes the spread row**: one `epic --add` moves an issue to a different epic, so choosing between two candidate epics is Tier A. Record what was taken, what was rejected and why, on both the issue and the epic ([#1339](https://github.com/joshuafolkken/kit/issues/1339)). **The spread row is not a proposal to merge epics**, and since [#1079](https://github.com/joshuafolkken/kit/issues/1079) **an epic and its own parent no longer reach it**: the parent already contains the child, so the pair is narrowed to the inner epic and the issue is added there. The narrowing drops parents, never peers — an unrelated epic beside a nested chain still asks, and so does a cyclic parent declaration, where no inner epic can be picked.

**When the relation carries an order, record it** in `blocked-by` and in the epic's `Dependencies`, on an addition as much as on a new epic: without it the batch survives and the reason it is a batch does not. An order **nobody declared is not invented** — only relations already recorded are carried over.

**Every row that _places_ the issue asserts a negative, so a cut epic listing withholds all of them** ([#1697](https://github.com/joshuafolkken/kit/issues/1697)). "No epic already tracks this issue" — which `create_epic` asserts about the candidates too — is only as good as the listing it was read from: an epic past the cut tracks its children invisibly, so each of them reads as tracked by nothing. **`add_to_epic` rests on it just as much as `create_epic` does**: adding the issue to the epic a _candidate_ sits in, while an unseen epic already tracks the issue itself, is the same duplicate by another route. The cut was already reported — `⚠ The epic listing …` on standard error — but standard output went on saying `Create an epic for these (Tier A — do it).`, and a warning is not what a run acts on: the rule that reads one as "could not answer" is written for a warning above `Nothing to bundle.` and does not reach this verdict. Acted on as Tier A, the result is a **second epic over an already-tracked issue** — the state the auto-close and `epic:next` cannot both be right about ([#943](https://github.com/joshuafolkken/kit/issues/943)). So the verdict itself changes:

```text
Could not confirm which epic already tracks these — do not place this issue in one.
  the epics were not read in full, so an epic already tracking one of these may never have been seen
  Related: #1662
```

**The children and the declared order are deliberately absent**: they are the recipe for the placement this line says not to make, and printing them beside the refusal hands a run the very command it must not run. The exit code stays `0` — this is a "do nothing" answer like `Nothing to bundle.`, while a non-zero exit already means the listing could not be read at all. **What survives the cut is a membership that _was_ found**: `Already in an epic — add to that one, do not create a second.` names the epic it read tracking the issue, and epics past the cut cannot unseat it, so that answer stands unchanged.

**A cut is the whole condition.** An epic whose body did not arrive would hide its children the same way, but it cannot arrive: the REST listing mapping coerces a `null` body to an empty string before the epic index parses one, so a gate arm for it would be code no input can reach.

**A reference the open backlog cannot show is read directly.** The candidate search scans open issues, which left a window of minutes in which the command could answer correctly: a follow-up issue names its parent, and the parent's pull request merges right after — on [#943](https://github.com/joshuafolkken/kit/issues/943) the gap between filing and the parent closing was about three minutes. Past it, `Nothing to bundle.` was printed with exit 0, asserting there was no relation rather than that the command had stopped being able to see one. Every issue number the subject's body names is now read on its own, whatever its state ([#947](https://github.com/joshuafolkken/kit/issues/947)):

- **A closed reference counts only when an open epic already tracks it** — the answer worth recovering is "add it to that epic". Creating an epic over a closed issue would build one whose other child is already finished: nothing for a run to execute.
- **An open reference counts either way** — missing from the listing means the listing was capped, not that the issue is unrelated.
- The lookup is one request per reference, capped per issue and batched like the relation reads. **A read that fails, and a reference the cap never reached, are both reported as gaps** rather than folded into "no relation found" — a guard that truncated in silence would put the command back to asserting there was no relation when it had merely stopped looking.
- **The backlog and epic listings report their own cuts too** ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). Each can stop either because it filled the command's 200-row cap or because the paging reached its 500-row page ceiling, and the `⚠` line names which — the first is a number this command sets, the second is not, so a reader who wants the answer widened is sent to the one that would move. The two listings stay separately reported: what an unseen backlog issue hides is a bundle candidate, and what an unseen epic hides is the epic that already tracks one.
- **A number that turns out to be a pull request is not a candidate.** The issue read answers for one as readily as for an issue, and a merged PR reports a state that is not `CLOSED` — so without the check, "the fix landed in #952" would put a pull request among a proposed epic's children.
- **A number that does not exist is not a gap either** ([#957](https://github.com/joshuafolkken/kit/issues/957)). A typo, or a number belonging to another repository quoted in prose, is dropped in silence — it is neither a candidate nor something the command reports it could not read. Reported as a gap it printed `⚠ Could not read #N.` above the verdict, and [#950](https://github.com/joshuafolkken/kit/issues/950)'s rule — a warning above `Nothing to bundle.` is not an answer, stop and report — then stopped an unattended run for a reference that never existed. **The two are told apart by HTTP status, not by `gh`'s wording**: 404 is nothing at that number, while 403 and 429 are a rate limit and 5xx is the server. GitHub answers 404 rather than 403 for an issue the token may not see, so as not to leak its existence — the two cannot be separated by any reading of the status, and they do not have to be here: the command probes the repository whose open issues it has just listed, so a number it cannot see there is a number that is not there. The read itself does not carry the status — it surfaces a failure as `gh`'s stderr text — so the classification is one extra REST request, spent **only** after a read has already failed and only by the caller that needs the distinction. That last part is why it is opt-in: the backlog's own relation reads cover up to two hundred issues, and a rate limit that failed all of them would spend two hundred more probes finding out why; the classified path is capped at twenty references, so the worst case is twenty.
- Only the subject's own prose is followed. The reverse — a closed issue naming the subject — would mean scanning every closed issue, and is not needed: a follow-up issue naming its parent is what the filing procedure requires.

The whole open backlog is scanned every time. It was thirteen issues when this was written, so there is no index and no cache; add one when the number makes it necessary, not before.

### `josh epic:plan`

Print every child of an epic as one JSON document, so the epic's decisions can be made in one batch ([#862](https://github.com/joshuafolkken/kit/issues/862)).

```bash
pnpm josh epic:plan 858   # alias: josh el
```

Most of the stops an implementation makes could have been answered _before_ it started. Arriving scattered through the run is what forces a person to wait through it, asking per child asks the same question several times, and the answers end up only in a conversation nobody can read back. The output carries each child's number, title, body, labels, `blockedBy` and state.

| Phase      | What happens                                                         |
| ---------- | -------------------------------------------------------------------- |
| 0 — audit  | [`josh epic:audit`](#josh-epicaudit); fix what it finds (Tier A)     |
| 1 — triage | Read the plan; sort each decision into `auto`, `ask` or `defer`      |
| 2 — decide | Put every `ask` to the person **as one question for the whole epic** |
| 3 — run    | `epicrun` runs to the end                                            |

**Phase 0 is not optional.** A batch decision made on a plan that contradicts itself has to be made again once the contradiction surfaces.

Answers are recorded in **both** the epic's `## Decisions` section and a comment on each child they apply to. One without the other leaves either the child's reader without the reasoning or the epic without the decision. **Recording a decision removes that child's `needs-decision` label** — without that, a child stays parked after the answer arrived.

**An epic whose task list tracks nothing is an empty plan, not a failure** — a checked row is still a tracked row, so a finished epic yields closed children rather than an empty list, and an epic that genuinely tracks nothing is a real answer. An epic whose **body could not be read at all** — a bad number, a failed lookup — is a failure, because an empty plan there is indistinguishable from a finished one.

**A child that could not be read makes the command exit non-zero**, not merely warn. It is named on standard error and left out of the plan, and a consumer capturing standard output would otherwise act on a plan missing a child — a decision made without knowing about it.

### `josh epic:audit`

Read an epic's children against each other and report what contradicts what ([#870](https://github.com/joshuafolkken/kit/issues/870)).

```bash
pnpm josh epic:audit 858   # alias: josh ea
```

`epic:check` verifies **one epic's format**. Nothing verified that the children agree — and a hand audit of a real epic found two contradictions that would have stalled the implementation while `epic:check` reported all four of its requirements as passing throughout. Work that only surfaces when a person thinks to go looking for it cannot be the basis of an unattended run.

The graph's own properties — a cycle, and a body declaring one order while the `blocked-by` relations record another — are taken from [`josh epic:next`](#josh-epicnext)'s detection rather than re-derived here. What this command adds is reading _inside_ the children:

| Check                | Level     | What it means                                                                                                                                                                           |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implicit dependency  | warning   | A child's body names another child of the same epic, and nothing orders the two.                                                                                                        |
| Order contradiction  | **error** | A child's **acceptance criteria** name another child, and nothing orders the two — it can run first. A warning instead once either child is closed, and for a pair in two repositories. |
| Unresolved reference | warning   | A body cites an issue that does not exist, or one already closed.                                                                                                                       |
| Nested epic          | warning   | A task-list row points at another epic. [`josh epic:next`](#josh-epicnext) withholds it, and this epic never auto-closes.                                                               |
| Orphan child         | warning   | An issue names this epic as its parent but the epic's task list does not track it.                                                                                                      |
| Orphan search        | **error** | The search for those issues could not read the open backlog — a rate limit, expired auth.                                                                                               |
| Orphan search        | warning   | That search stopped before the end of the backlog: its 500-issue page cap, or its 50-match cap.                                                                                         |
| Unjustified order    | **error** | The body **declares** an order between two open children and nothing anywhere records why.                                                                                              |

**Only errors change the exit code.** The implicit-dependency check sees only that one child mentioned another, which is as true of a real missing dependency as of a design note about what comes next. Failing on both would make those notes unwritable, so the machine's job is to stop an omission going unnoticed, not to decide.

**A forward reference the other child already depends on is not reported.** When `#860`'s criteria say `#864` will extend a hook it provides, and `#864` is declared to depend on `#860`, the criteria are satisfiable exactly as written. Verified against a real epic: without that suppression, four of five errors were forward references of that shape.

What remains an error is a name in the acceptance criteria with **nothing ordering the two at all** — the criteria are where a child states what it must deliver, so a deliverable named there that nothing guarantees will exist first is the contradiction. A child citing another purely as an example still trips it; that is the residual cost of a check the machine cannot make semantically, and rewording or declaring the dependency clears it.

**Unless the pair is in two repositories, in which case it is a warning** ([#1128](https://github.com/joshuafolkken/kit/issues/1128)) — such an order only became recordable with [#1126](https://github.com/joshuafolkken/kit/issues/1126), so an error would stop every epic written before it at step one. That warning does not make the pair safe: the child is still offered as runnable, and what changed is that the risk used to be silent. Recording the relation clears it, and [`josh epic --add`](#josh-epic) cannot write a cross-repository one yet ([#1138](https://github.com/joshuafolkken/kit/issues/1138)).

**And unless either child is closed, in which case it is also a warning** ([#1010](https://github.com/joshuafolkken/kit/issues/1010), widened by [#1597](https://github.com/joshuafolkken/kit/issues/1597)). The whole force of the error is that the criteria's child _can run first_, and one end closing is enough to make that false: a closed naming child has already run, and a closed named child has already delivered what the criteria ask for. Left as an error it is permanent — every epic that ever forgot to declare an order fails its audit from then on, and `epicrun` runs the audit before its first child, so the epic stops at step one for a contradiction nothing can trip over. It was confirmed on a real epic: the audit was red while `epic:next` handed back a runnable child perfectly happily.

**The both-closed condition was stricter than the sentence it encoded**, which is what [#1597](https://github.com/joshuafolkken/kit/issues/1597) corrected. It bit on the ordinary way an epic's children cite each other — a closed child's criteria naming an open sibling as **evidence** — and once the naming child has closed there is no way out of it: the alternatives are editing a closed body to remove the numbers, or declaring an order nobody decided. Epic [#1262](https://github.com/joshuafolkken/kit/issues/1262) sat red on exactly that shape, blocking `epicrun` at step one, while nothing in it could run out of order. **The message names the end that closed** — `#1583 is closed`, or `both are closed` where they are — because the reader goes and looks at whichever issue the sentence points at.

**Demoted rather than dropped, and the choice was made on the output.** The acceptance criteria are part of the body, so the same pair also matches the implicit-dependency check, which stays quiet only while this one reports the pair. Drop the finding and the pair reappears one line lower as `implicit dependency` — the report is not one line shorter, and the message has lost the one thing worth reading in it, that the name is in the **acceptance criteria**. Since the brevity a drop would buy does not exist, the history stays visible at the level matching what is left to go wrong. Closed is asserted rather than inferred: a state the audit cannot confirm as `CLOSED` (a `MERGED` pull request among them) keeps the error.

**A row pointing at another epic is reported, and the test is the child's `epic` label** ([#1476](https://github.com/joshuafolkken/kit/issues/1476)). The hierarchy is writable — nothing stops `- [ ] #<another epic>` being typed into a body — and until this check nothing read it either: `epic:next` classified the row like any other child and offered it as runnable, so an unattended run picked an epic up and had nothing to implement. It is **not** the cross-repository row, which is a different property and a legitimate one: a row naming `owner/repo#N` disables the epic auto-close by design, which is why a cross-repository backlink is written as prose rather than as a row. The two are independent — a cross-repository child that is not an epic is not reported, and one that is an epic is reported exactly like a local one.

**A parent epic over another epic never auto-closes, and the finding says so.** The auto-close fires once per pull-request merge and evaluates only the epics whose own task list holds the issue that merge just closed; a grandparent's task list holds the _child epic's_ number, not the leaf issue's, so it is skipped — and closing the child epic through the API is not a merge, so nothing re-enters the evaluation afterwards. There is no depth at which that changes, which is why this is stated rather than fixed: flattening the row is meta-epic support, and that is [#894](https://github.com/joshuafolkken/kit/issues/894)'s frozen scope.

**A warning rather than an error**, for the reason the demotions above give: an error fails the audit `epicrun` runs before its first child, so it would stop the whole batch — and the batch is already safe without that, because `epic:next` withholds the row instead of offering it. The child is reported under `Waiting on a person`, with the reason on standard error, since a bare `#N` there reads the same for a parked issue and for an epic while the two need entirely different things done to them.

**The two `orphan search` findings are about the search, not about the children** ([#1033](https://github.com/joshuafolkken/kit/issues/1033)). The orphan check lists the open issues and matches their bodies client-side; a listing that could not be read used to arrive as an empty result, so a rate limit produced a clean audit that had looked at nothing. It is an error now, and the response is to **re-run the audit** — there is no contradiction to fix and no design choice to park, so neither the Tier A rule below nor a `needs-decision` park applies. If it keeps failing, check `gh auth status` and the rate limit. The warning form means the scan stopped early — at its 500-issue page cap, or once 50 open bodies mentioned the epic — so it covered the newest part of the backlog only; the audit still passes, and an orphan expected further down has to be looked for by hand.

**Every other check looks for a dependency the epic _omitted_; this one looks at the declaration itself** ([#1712](https://github.com/joshuafolkken/kit/issues/1712)). Nothing read the declared side, so a chain somebody typed by hand passed the audit exactly as a justified one did: on 2026-09-10 the chain `#1690 -> #1694 -> #1703 -> #1679 -> #1675 -> #1676` serialized five otherwise independent children through `epicrun`, and the audit reported **0 errors** both while it stood and after it was deleted — the two runs were indistinguishable. It was found because a person asked why the backlog had gone single-file, which is not a mechanism.

**Where a reason lives was already settled, so the check invents no new place to look.** [`josh epic --add --decision-file`](#josh-epic) writes the record to the epic's `## Decisions` **and** as a comment on each child, `--remove` does the same for a deletion, and a creation records its reasoning — the order `--ordered` declares included — under `## Split rationale`. Those are the whole search:

- **The two epic body sections**, `## Decisions` and `## Split rationale`, are matched whole and count when either names both issues anywhere in it. They hold many records with no delimiter a reader can rely on, so asking a stricter question would mean guessing where one record ends. `## Split rationale` is read as well as `## Decisions` because a creation's reasoning goes there; on its own it is not enough, since that prose need not name a single issue number — which is why **[`josh epic … --ordered`](#josh-epic) now writes a `### Declared order` entry under `## Decisions`** naming the chain it declared. Without that entry every ordered epic failed this check the moment it was created, and `epicrun` stopped at step one on an epic made exactly as documented.
- **A comment** counts when it names the **other** end — the issue it sits on is named by where it is, so a record posted on `#102` reads "placed after #101" and never repeats its own number.
- **A `--decision-file` record has to name both issues to clear the finding.** That is what the check reads, and the error message says so; a record that explains a placement without mentioning the issue on the other side of the arrow is not evidence a machine can match.
- Both readings are deliberately generous. Generous is the right side for a finding that stops a run: it errs toward silence rather than toward accusing an author who did write the record.

**A pair with a closed end is out of scope entirely**, not demoted to a warning — a settled order can no longer stall anything, which is the same ground the order-contradiction demotions stand on. **A pair with an end in another repository is out of scope too**, because the comment listing reads the repository the command runs in and takes no `--repo`: such a record cannot be read at all, so every cross-repository order would be reported however carefully its author wrote it.

**A pair whose comment listing could not be read is not reported either.** An unread listing and a listing that holds nothing are different facts, and treating the first as the second would turn a rate limit into an error that stops the epic over an order whose reason _was_ written down. The audit says nothing about that pair rather than something false; re-run it once the listing reads.

**An error rather than a warning, and the reasoning is the part to keep.** A warning would not be read — one real epic carries 447 of them, and the whole reason this check exists is that a false order was invisible. The counter-argument is the doctrine the demotions above rest on, that the machine warns where it cannot tell whether something is wrong; it does not reach here, because what is asserted is not "this order is wrong" but "this order's reason is not recorded", which is a fact about the repository's own rule that a placement decision is written down. What makes the level affordable is that both remedies are now one command: `josh epic --remove` deletes the order, and `--decision-file` on either command records the reason. Before [#1712](https://github.com/joshuafolkken/kit/issues/1712) the first of those did not exist, and an error would have sent the reader to the hand edit `CLAUDE.md` forbids.

**Run it without being asked** — at the start of an `epicrun`, as [`josh epic:plan`](#josh-epicplan)'s phase 0, and right after a child is added or a dependency changed. **Fixing what it finds is Tier A**: re-pointing a dependency or correcting prose is reversible and will otherwise stall the work, so do it without asking and record the reasoning on the Issue. Park with `needs-decision` only when the contradiction is a design choice nobody has made.

**One thing it cannot check** belongs to the planning step instead. A child introducing a new label, command, state or artifact leaves existing code referencing that concept; three such gaps were found by hand on one epic. List those references and confirm some child owns updating them — label names are single-sourced in `scripts/git/issue-labels.ts`, so consumers can be traced from there.

### `josh epic:check`

Check an existing epic against the same four requirements and report each as pass or fail.

```bash
pnpm josh epic:check 700
```

Exits `0` when every requirement is satisfied and `1` otherwise, so it works as a gate. Use it on epics created by hand, on epics that predate `josh epic`, and after editing an epic body. The checks reuse the very parser the auto-close runs on (`scripts/git/git-epic-parse.ts`), so "what the auto-close can read" and "what this command accepts" are one definition rather than two that can drift.

```
✔ epic label — the `epic` label is applied
✔ child task list — 2 child issue(s) tracked: #101, #102
✖ dependencies section — neither a line that is only `#N -> #M` nor the `None — ...` literal found; an arrow sharing its line with anything else is prose, and prose order is not machine-readable
✔ auto-close eligibility — every tracked child is in this repository

❌ Epic #700 does not satisfy every requirement.
```

The dependencies check wants **exactly one** of the two machine-readable forms. Neither present is the ambiguous middle it was written for — "there is no order" and "the order was never written down" then read alike. Both present is a contradiction, and it used to pass while the report named only the half that contradicted the other ([#1155](https://github.com/joshuafolkken/kit/issues/1155)):

```
✖ dependencies section — a chain (`#N -> #M`) and the `None — ...` literal are both declared; they contradict each other
```

An epic written before [#1155](https://github.com/joshuafolkken/kit/issues/1155) can start failing this check without its body changing, and the verdict is the accurate one: a chain sharing its line with a rationale (`#101 -> #102 (#102 needs the API from #101)`) or buried in a prose bullet was never read by `epic:next`, so the check used to call machine-readable a body from which the run read no order at all. Fix such an epic by putting the chain on a line of its own and moving the rationale to the next line; `josh epic --add` and `josh epic --promote` refuse the epic until then, and their refusals name this command.

### `josh auto-ok:next`

Print the next opted-in issue an unattended run may pick up outside an epic ([#906](https://github.com/joshuafolkken/kit/issues/906)).

```bash
pnpm josh auto-ok:next                 # alias: josh ao
pnpm josh auto-ok:next --exclude 906   # skip the issue just merged
pnpm josh auto-ok:next --exclude 906,912 --exclude 918   # skip several
```

An epic's task list is not the whole backlog. An issue small enough to need no human judgment sits there forever unless somebody puts it in an epic, so the `auto-ok` label opts one in: [`epicrun`](../.claude/skills/workflow-commands/epicrun.md) picks up opted-in issues once the epic's own children are done.

**Only a person applies `auto-ok`.** Typing `epicrun #<E>` approves the merges inside `#<E>` and nothing outside it, and this label is the only way a person extends that approval past the epic's edge — a label an agent could apply to itself would let an unattended run widen its own authorization, which is not a guard at all. An agent typing the command on an explicit instruction in the same turn is executing the person's decision, not making one.

`--exclude <N>` drops issues from the answer. GitHub applies the `closes #N` side effect asynchronously, so for a few seconds after a merge the issue that just shipped is still listed as open — a pickup loop names it here so it cannot be handed back and re-implemented. It takes a comma-separated list and may be repeated, so a loop past its second pickup can name **every** issue it has already run: `closes #N` can fail to fire at all — a reference dropped from a PR body — and the `in-progress` label is not a guard the procedure itself trusts (joshuafolkken/kit#996).

**The `🗒 Next issues` display is not filtered the same way, on purpose.** It is read by a person, who
can see a blocked issue, judge that the blocker is nearly done or does not really block it, and start
anyway; the pickup feeds an unattended run, which has none of that judgement. So the display can name
an issue `auto-ok:next` refuses — the same row is information to one reader and an instruction to the
other (joshuafolkken/kit#1005).

**An issue whose prerequisite is still open is not offered.** The pickup reads the same native `blockedBy` relation `epic:next` builds its graph from, and skips any candidate declaring a blocker that has not closed. `auto-ok` says the issue needs no decision; it says nothing about ordering, so without this an unattended run could start an issue before the work it depends on (joshuafolkken/kit#996).

Standard output carries exactly one token — the issue number, or `none` — so `answer=$(pnpm josh auto-ok:next)` captures something a loop can branch on. Every explanation goes to standard error.

| Answer      | Meaning                                                    | Exit code |
| ----------- | ---------------------------------------------------------- | --------- |
| `<number>`  | Run that issue as a `fullrun`, then ask again              | 0         |
| `none`      | No open issue carries the label                            | 0         |
| _(nothing)_ | The listing could not be read — **not** the same as `none` | 1         |

The command is read-only and never applies or removes the label. It ranks candidates with the same function the `🗒 Next issues (newest first)` display uses at the end of every workflow — newest first, skipping `epic`, `in-progress` and `needs-decision` — so the pickup starts exactly what that list has just named as next. A second ordering would contradict it.

**An issue an opted-in epic tracks is never a standalone candidate** (joshuafolkken/kit#1633, narrowed by joshuafolkken/kit#1668). `auto-ok` says the issue needs no decision; it says nothing about ordering, and an epic carrying `auto-ok` is going to hand its children over in the order its own `blocked-by` graph declares. So a child of such an epic is excluded here and runs through `epicrun #<E>` like every other child, whatever labels it carries of its own. **The exclusion is decided by whether an epic's task list names the issue, not by the issue's own labels** — a child carries none of the three labels above, which is exactly why the label comparison never caught one. That costs one extra listing, of the open epics, and it is asked only when something is opted in; a listing that could not be read is reported rather than read as "no epic tracks anything", because that reading turns every tracked child back into a standalone candidate. The open epics are still found by the `epic` label, exactly as `epic:bundle` finds them, so an epic that never received that label is invisible to both and its children read as tracked by nothing — one reason for `josh epic:audit`.

**A child of an epic that has not opted in is a standalone candidate when it carries `auto-ok` itself** (joshuafolkken/kit#1668). That epic offers nothing — the epic half never reads an epic without the label — so withholding the child too left it unreachable from every path while the person who labelled it was told the listing cap was the reason. Its ordering survives the standalone route: `josh epic --ordered` records an epic's declared order as native `blocked-by` relations on the children, and this path already refuses a candidate whose prerequisite is still open. **Opting in still says nothing about order** — that half of joshuafolkken/kit#1633 is unchanged, and it is what the blocker check enforces. **The question is asked of every epic tracking the child, not of one of them** (joshuafolkken/kit#1694): two epics can write the same task-list row, and one opted-in tracker is enough to withhold the child here — read from a single winner instead, an opted-in epic that merely came earlier in the listing disappears, and the child is offered standalone while that epic hands it over too.

**Opting in is the default absence.** Nothing creates the label, and a repository that does not have it is not an error: `gh` answers an empty listing, the command answers `none`, and an `epicrun` finishes exactly as it did before the label existed. Create it once where it is wanted:

```bash
gh api repos/{owner}/{repo}/labels -f name=auto-ok -f color=0e8a16 -f description="Opted in to unattended execution outside an epic"
```

The listing is capped at 200 issues, and the paging behind it stops after 500 rows whatever the cap says ([#1067](https://github.com/joshuafolkken/kit/issues/1067)). The listing is newest first, so either cut drops the oldest opted-in issues — reported as a `⚠` on standard error rather than ranked silently, because the answer is still an opted-in issue but may not be the one the order promises. The warning names which cut stopped it: a reader who wants the answer widened reaches for the command's own cap in one case and for the paging's ceiling in the other.

### `josh backlog:next`

Order the whole opted-in backlog in one command ([#1630](https://github.com/joshuafolkken/kit/issues/1630)).

```bash
pnpm josh backlog:next                 # alias: josh bl
pnpm josh backlog:next --exclude 1630  # skip the issue just merged
pnpm josh backlog:next --exclude 1630,1631 --exclude 1632   # skip several
```

**The answer used to be split in two, and neither half could give it.** `epic:next` has the dependency graph and the execution wave, but its input is one epic's task list. `auto-ok:next` sees the whole backlog, but it orders by the newest-first display ranking and reads no dependency at all — and it returns one issue. So there was no route that asked the backlog itself what may start, and what may start beside it.

Two sources feed one pool:

| Candidate          | Condition                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A standalone issue | It carries `auto-ok`, and no **opted-in** epic tracks it                                                                                                                 |
| An epic's child    | **The epic's root carries `auto-ok`.** The child needs no `auto-ok` of its own, and — while that root is opted in — carrying one does not make it a standalone candidate |

**An epic root's `auto-ok` stands for every child.** That is the same meaning `epicrun #<E>` already has — typing it once approves every merge inside that epic — so a per-child label is not asked for. Requiring one would (1) turn a forgotten label into a hole in the dependency graph, leaving whatever depends on that child waiting for good, (2) make bulk application the habit and the gate a rubber stamp, and (3) stack a thinner approval on top of work that has already been through `epic:plan` and `epic:audit`. A child that needs a decision or a person's eye is handled by `needs-decision` and `needs-human-review`, which are the exits; `auto-ok` is the entrance, and they are different questions.

**Nothing here re-implements the graph or the wave.** Each `auto-ok` epic is read and classified by `epic:next`'s own pipeline, unchanged, and the verdict comes from the same `decide_verdict` — so a word this command prints cannot drift from what `epic:next` means by it. The standalone half is `auto-ok:next`'s own listing and runnability rules, ranked with the same `prioritize` the `🗒 Next issues` display uses, so there is no second ordering here either.

Standard output carries one token per line — the runnable issues, in the order they may be started, or a single verdict word. Every explanation goes to standard error, so `answers=$(pnpm josh backlog:next)` captures something a loop can branch on. **The tokens are scoped to the repository the command runs in**, which is `epic:next --repo`'s shape exactly. An epic may track a child elsewhere, and a bare number would name _this_ repository's issue of that number — a different issue entirely. Qualifying it as `owner/repo#N` instead was tried and is worse: `--exclude` parses bare integers, so a loop feeding a qualified token back would get a usage error rather than an exclusion. So a runnable child elsewhere stays out of the tokens and the answer is `wait` when this repository has none of its own — the mapping `epic:next` already makes for its per-repository form, and for the same reason: the work is real, it is simply not work this checkout can start. It is still reported on standard error, under its own repository and checkout.

| Answer      | Meaning                                                                 | Exit code |
| ----------- | ----------------------------------------------------------------------- | --------- |
| `<number>…` | Each line is an issue a run may start; they may start beside each other | 0         |
| `wait`      | Nothing is runnable yet, but something resolves on its own              | 0         |
| `stop`      | Nothing will resolve on its own — something needs a person              | 0         |
| `retry`     | GitHub could not be reached; the graph itself may be fine               | 0         |
| `error`     | A dependency graph is unusable; nothing is offered                      | 0         |
| `none`      | The backlog holds nothing opted in, or nothing left to hand back        | 0         |
| _(nothing)_ | A listing could not be read — **not** the same as `none`                | 1         |

`none` is `epic:next`'s `complete` under `auto-ok:next`'s spelling: a backlog is never finished the way one epic is, and a loop reading either command branches on the same word.

**`retry` is the one word `epic:next` has no counterpart for, and it exists because `error` was answering two different questions** (joshuafolkken/kit#1663). A child the command could not read produced `error` whether the graph was genuinely unresolvable or the connection had simply dropped, and an unattended run may never re-ask on `error` — so one `getaddrinfo ENOTFOUND` ended a run with thirteen runnable issues still in the backlog. No HTTP status reached at all, a 429 or a 5xx makes the answer `retry`, and anything GitHub actually answered with leaves it `error`. **403 is deliberately on the `error` side**: GitHub spells some secondary rate limits that way, but a SAML-SSO-unauthorized token, an IP allowlist and an org policy answer 403 too, and reporting one of those as a connection problem is this Issue's own misdirection pointed the other way. The decision is the status code rather than gh's wording, for the same reason the 404 classification is — a message is prose that can be reworded between releases.

**The status comes from the read that failed, not from a request made after it** (joshuafolkken/kit#1690). Until then the command asked GitHub once, on the failure path, whether it was answering at all — and a connection that dropped for a few hundred milliseconds failed the read and then answered that probe `reachable`, so the run kept the verdict the probe gave it rather than the one the read had. Judging one request from a different one cannot be made reliable, so each failed read now carries its own nature: `gh api` writes the response body to stdout, GitHub's error document names its own status there, and a request that never arrived wrote no body at all. Nothing extra is spent on the failure path either, since the answer was already in hand.

**An epic whose own body could not be read answers `retry` rather than `none`** (joshuafolkken/kit#1690). Its task list is what names the children, so a body that never arrived parses to zero children — indistinguishable from an epic that tracks none, which is skipped as an ordinary unpopulated epic. With every epic skipped that way the verdict fell through to `complete`, printed here as `none`, and `backlogrun` read that as an exhausted backlog and ended. The failed body read is now its own anomaly, so it reaches the verdict like any other unreadable read.

`--exclude <N>` drops issues from the answer, and it drops them from **every** bucket rather than only from the offer. GitHub applies the `closes #N` side effect asynchronously, so for a few seconds after a merge the issue that just shipped is still listed as open — left in the waiting bucket, it would answer `wait` for a backlog with nothing left to wait for. It takes a comma-separated list and may be repeated.

**The standalone half is capped at the same five rows the `🗒 Next issues` display shows.** It is ranked with `prioritize`, cap included, rather than with a second ordering of this command's own — so a sixth runnable standalone issue is reported as waiting rather than offered, and the next ask offers it once one of the five above it merges. Nothing is lost; the backlog drains a round later. An epic's children are not capped that way: they come through the epic's own graph.

**The epics are found by the `epic` label, exactly as `epic:bundle` and `auto-ok:next` find them.** An epic that never received that label is invisible here too: its children are not offered through it, and they still read as untracked to the standalone half. That is one of the things `josh epic:audit` is for. **An epic that has the label but not `auto-ok` is a different case**: it is seen, it offers none of its children, and each child carrying `auto-ok` of its own is offered by the standalone half instead (joshuafolkken/kit#1668). **That is decided over every epic tracking the child, not one of them** (joshuafolkken/kit#1694): two epics can write the same task-list row, and a child one opted-in epic tracks is withheld from the standalone half however many epics that are not opted in also name it — otherwise the child would be offered through the opted-in epic and standalone at the same time. **Which side wins when an epic's declared order and a child's own opt-in disagree is decided in one place** — `epic_index.withheld_children` in `scripts/epic/epic-index.ts` — and the answer is that the epic wins wherever the epic is actually going to offer the child, and only there. Both listings are capped, and a cut is reported as a `⚠` on standard error rather than answered from silently.

The command is read-only and never applies or removes a label.

**The entry point that consumes this answer is `backlogrun`** ([#1631](https://github.com/joshuafolkken/kit/issues/1631)) — the shorthand keyword that runs the opted-in backlog without naming an epic, defined in `.claude/skills/workflow-commands/backlogrun.md`. It is a separate keyword rather than an argument to `epicrun` because the two declare different authorizations: `epicrun #E` approves one epic's children, and `backlogrun` approves everything a person has opted in with `auto-ok`. Its loop is written against the contract above — the tokens are bare numbers scoped to this repository, `error` is told apart by reading the token rather than the exit status, and every merged issue is fed back through `--exclude`. Which issues carry the label stays a person's decision; the order and the parallelism are the run's. **An issue the run itself files joins the pool once `epic:bundle` places it under an opted-in epic** — admitted and bounded by `backlogrun.md` → "What one invocation approves" ([#1675](https://github.com/joshuafolkken/kit/issues/1675)), rather than denied.

### `josh backlog:plan`

The whole backlog as a plan a person reads before a run starts ([#1652](https://github.com/joshuafolkken/kit/issues/1652)).

```bash
pnpm josh backlog:plan                       # alias: josh blp
pnpm josh backlog:plan --exclude 1630        # after #1630 merged
```

`backlog:next` answers the **next** question — which numbers may start now — and its output is a contract a loop branches on. This answers the **whole** one, for a person: four sections in one ask, on standard output.

| Section             | What it holds                                              |
| ------------------- | ---------------------------------------------------------- |
| Ready now           | The runnable children, grouped by repository               |
| Waiting             | Every withheld child, each naming what it is waiting on    |
| Waiting on a person | The `needs-decision` children                              |
| Out of scope        | Every open issue the backlog will not run, with the reason |

**The plan cannot promise an order the run does not take.** The classification is `backlog:next`'s own — the same two functions, `context_of` and `resolve` — so this command renders that answer rather than deriving a second one. It is a separate command rather than a flag because `backlog:next`'s standard output is one bare token per line, and a plan printed there would break every loop reading it.

**The grouping is the parallelism, not a presentational choice.** A lane is per repository, so the per-repository bundles are exactly how wide the run can go.

**"Waiting" names the blocker.** The dependency edges were always read — they decide the classification — and were never shown; a row now carries the issue numbers it waits on, or says that a run already has it, or that it is ready but past the offer this ask could make.

**"Out of scope" is a subtraction, never a second membership rule.** Every open issue the pool did not classify is listed with the reason read off its labels: not opted in, an epic root without `auto-ok`, an opted-in epic root (a container, whose children are planned instead of it), or opted in but past the listing cap. Before this, that exclusion was silent — nothing distinguished "not opted in" from "not reached yet".

**A failed read of the open listing is reported, not rendered around.** An empty out-of-scope section built on a listing that could not be read is a confident absence; the command exits 1 and says so instead.

**The entry point that consumes this is `backlogrun`**, which reports the plan before its first child starts and then resolves what the plan can resolve — `.claude/skills/workflow-commands/backlogrun.md` → "The plan, before the first child starts".

### `josh backlog:budget`

Say whether a `backlogrun` may start more work, keep watching, or finish ([#1632](https://github.com/joshuafolkken/kit/issues/1632)).

```bash
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active"   # alias: josh bb
pnpm josh backlog:budget --answer exhausted --started "$started" --active "$active" --idle 60
pnpm josh backlog:budget --answer exhausted --started "$started" --idle 0
pnpm josh backlog:budget --answer candidates --started "$started" --active "$active" --merged 3 --running 2 --max 5
pnpm josh backlog:budget --answer blocked --started "$started" --active "$active" --json
```

**`backlog:next` says what may start; it says nothing about when the run itself should end.** Before this existed a `backlogrun` had exactly two endings and neither could be declared in advance: it finished the moment the backlog read empty, so an issue a person opted in three minutes later needed a whole new session, or it ran to the 8-hour whole-run bound, which is a limit on waiting rather than a statement of scale.

**The idle watch is on by default and the maximum is not** ([#1676](https://github.com/joshuafolkken/kit/issues/1676)). With neither flag given the run watches an empty backlog for 30 minutes before finishing, and takes as many issues as the backlog holds.

| Budget         | Flag               | Default        | Meaning                                                                                                         |
| -------------- | ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Idle watch     | `--idle <minutes>` | **30 minutes** | After the candidates run out, keep polling this long for a new one. A candidate that appears restarts the watch |
| Maximum issues | `--max <count>`    | unlimited      | How many issues one invocation may take. On reaching it the run reports and finishes                            |

The default is 30 minutes because a watch has to outlast a person noticing the run has gone quiet, filing an issue and applying `auto-ok`; because at the 5-minute idle poll that is six asks rather than thirty; and because it is about the length of one child (12 to 28 minutes, [#1477](https://github.com/joshuafolkken/kit/issues/1477)). `DEFAULT_IDLE_MINUTES` in `scripts/backlog/backlog-budget.ts` is the single source of the figure.

Standard output carries the single verdict word and standard error the reason, so `verdict=$(pnpm josh backlog:budget …)` captures something a loop can branch on. `--json` collapses both into `{"budget": "<verdict>", "reason": "…"}`.

| Answer      | Meaning                                                                                                                                                          | Exit code |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `run`       | Start what `backlog:next` offered. The reason names how many more the maximum still allows                                                                       | 0         |
| `watch`     | Sleep the polling interval and ask both commands again                                                                                                           | 0         |
| `stop`      | Report and finish. The reason is the termination reason the completion report carries                                                                            | 0         |
| _(nothing)_ | The invocation could not be read — a missing or unrecognized `--answer`, an unparseable timestamp, a non-numeric count. Usage is printed and nothing is answered | 1         |

`--answer` is `backlog:next`'s own answer in the words this decision needs, and the mapping is mechanical: issue numbers are `candidates`; `wait` is `blocked` while this run has children in flight and `exhausted` when it has none; `none` is `exhausted`; `stop` is `parked`; `retry` is `blocked` while this run still has consecutive retries left and `unreadable` once they are spent; `error` or a failed listing is `unreadable`. `--started` is when the invocation began and `--active` when it last had work — the most recent ask that was not `exhausted`. Refreshing `--active` is what restarts the idle watch, so a candidate picked up mid-watch gets the whole budget again rather than the remainder; on the first ask it is the run's start. **`--idle` without `--active` is refused rather than measured from `--started`**: a run already working longer than the budget would stop on its first empty backlog and print that the backlog stayed empty for the whole watch — an emptiness it never saw.

`--merged` and `--running` are both counted against `--max`, because children run in lanes: a maximum measured on merges alone would let a second wave start before the first had merged and take the run past the number the person declared. **No ending abandons a lane**: whatever would have ended the run — the maximum, a parked backlog, an unreadable listing, an expired watch, the whole-run bound — answers `watch` while `--running` is above zero, so the lanes drain and their merges reach the report. The reason names the ending it is draining towards.

**`--idle 0` is how the watch is turned off, and omitting the flag takes the default** ([#1676](https://github.com/joshuafolkken/kit/issues/1676)) — the inverse of what shipped first. The old refusal rested on "the flag is optional, so 0 is not needed", and turning the default on is what removes that footing: an omitted flag now means the default watch, so the number line has to reach a value meaning none, and "watch for zero minutes" says it in the flag's own units. A run that wants the old ending writes `--idle 0` and finishes at its first empty backlog.

**`--active` is required unless the watch is off.** It used to be the companion of an optional flag; with the watch on by default it is what every ask needs, and an invocation whose watch is on and that carries no `--active` is refused. Answering `stop` instead — "the watch could not be measured" — is the same failure one layer up: `stop` is the word the loop acts on and it cannot tell that from a run that ended properly, so the run would report an emptiness nobody watched.

**A watch is polled every 5 minutes, not at the loop's 60-second polling interval**, and the reason string names the figure so the loop reads it rather than remembering it. `epicrun.md` → "Waiting, and never waiting forever" holds the row. **The hand-off check (`josh cost --over`) is not asked during a watch** — it is asked at a child's merge and a watch has no merges, so a watch does not count towards the session cut; `backlogrun.md` → "The hand-off check is not asked during a watch" is that decision's single source.

**The whole-run bound is decided here too, rather than by an agent reading a clock.** `epicrun.md` carried the 8 hours as prose, and prose is what joshuafolkken/kit#1460 measured a run walking past. It outranks both budgets, so a run at the bound stops with candidates in hand and an idle watch still open. **What outranks the bound in turn is a `parked` or `unreadable` answer**: the reason printed here is quoted verbatim into the completion report, so a budget reason in front of one of those would report a tidy ending for a run whose backlog actually broke.

**A flag that was given but could not be read makes the whole invocation unreadable.** A mistyped `--idle` is never defaulted to "no idle watch" — that would end the run at the first empty backlog, answering a question nobody asked. This is `path_decision.has_unknown_flag`'s contract, and the printer is the one every mechanically-decided command in this repository shares.

**The entry point that consumes this answer is `backlogrun`**, defined in `.claude/skills/workflow-commands/backlogrun.md` → "The two budgets". The command is read-only, holds no state of its own, and never applies or removes a label.

### `needs-human-review` — the opposite label

`auto-ok` widens unattended execution past an epic's edge; **`needs-human-review` withholds its last step** ([#1125](https://github.com/joshuafolkken/kit/issues/1125)). An issue carrying it is implemented and taken through the verification gate as usual, and then nothing is committed, pushed, opened as a pull request or merged: the working tree is left uncommitted and unstashed, a `confirmation` notification goes out carrying the resume command, and the run stops there rather than starting the next issue.

It exists for work whose quality no test can judge — a published article, or a choice among generated candidates. Writing "run this with `halfrun`" in the issue body has no force, and pre-applying `needs-decision` is worse than useless: that label stops the issue being **started**, so the artifact a person is meant to look at is never produced.

The two labels sit on opposite sides of a run, and the code says so. `needs-decision` is in `NOT_DIRECTLY_RUNNABLE_LABELS` and in the busy check's parked set; `needs-human-review` is in neither. Excluded from the first it would never be offered; treated as parked in the second, the repository would be handed to the next child while the stopped one's uncommitted work is still in the checkout.

**Only a person applies or removes it**, at the same strength as `auto-ok` — a mark a run can clear for itself is not a mark. Create it once where it is wanted:

```bash
gh api repos/{owner}/{repo}/labels -f name=needs-human-review -f color=d93f0b -f description="Implement and verify, but stop before committing so a person can look"
```

The behavior it triggers belongs to the workflow commands rather than to any `josh` subcommand: [`.claude/skills/workflow-commands/SKILL.md`](../.claude/skills/workflow-commands/SKILL.md) → §2z is the single source of the definition.

### `already-done` — the exit for work that is already merged

A run that verifies its issue's work is **already in `main`** has nothing to implement and cannot act on that conclusion either: closing an issue is Tier C ([#1679](https://github.com/joshuafolkken/kit/issues/1679)). Before this label there was no exit that was not, and [#1656](https://github.com/joshuafolkken/kit/issues/1656) is what that cost — a child verified line by line that [#1623](https://github.com/joshuafolkken/kit/issues/1623) had already done the work, and then closed the issue itself.

**It is not `needs-decision`.** A parked issue is waiting for an answer nobody has given; this one has its answer, and only the close is outstanding. Parked, a person clearing the label puts the issue straight back into the offer and the next run repeats the same investigation.

The label is in `NOT_DIRECTLY_RUNNABLE_LABELS`, classifies a child as `human` in `epic:next`, and joins the busy check's parked set — the run that applied it committed nothing, so the checkout it ran in is clean and holds no lane. **A run applies it; only a person removes it, by closing the issue** — taking it off asserts the work is _not_ done, which is the same Tier C claim in reverse.

```bash
gh api repos/{owner}/{repo}/labels -f name=already-done -f color=6f42c1 -f description="Verified already merged — a person closes it"
```

The procedure — the evidence the run records before applying it, and what each entry point does afterwards — is [`.claude/skills/workflow-commands/SKILL.md`](../.claude/skills/workflow-commands/SKILL.md) → §2g, "When the work turns out to be already merged", which is the single source.

### `josh review:brief`

Print the whole `/code-review` invocation — the level, what `josh gate` has already proved, and the target ([#1241](https://github.com/joshuafolkken/kit/issues/1241)).

```bash
pnpm josh review:brief            # round 1; alias: josh rb
pnpm josh review:brief --round 2  # the verification pass, scoped to the fix delta
```

Pass the whole output to `/code-review`. The level is on the first line, so `$(pnpm josh review:brief)` still starts with the answer `josh review:level` gives.

**It exists because `/code-review` runs in a forked process that reads none of this repository's documents.** Only the invocation argument reaches it, so a rule written in `prompts/review.md` — "do not re-run what the gate proved", "the second round reads the fix delta" — has nothing to bind to. Measured on [#1240](https://github.com/joshuafolkken/kit/pull/1240): both rounds re-ran the unit suite `josh gate` had just passed, both fumbled the runner (`npx vitest`, then a retry), and round 2 re-read the whole diff — 439 seconds on a seven-file change, with the second round taking 90% of the first.

What the brief carries:

| Part                  | Where it comes from                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The level             | `josh review:level`, reused rather than decided again                                                                                                                                                            |
| "Already verified"    | The record `josh gate` writes when all four checks pass, **and only if its digests still match this tree**                                                                                                       |
| "Running now"         | The marker `josh gate` keeps for as long as its checks run, **and only if its digests still match this tree**                                                                                                    |
| The unit-test command | Named outright, because both measured rounds reached for `npx vitest` first                                                                                                                                      |
| The target            | The whole change on round 1; on `--round 2`, only the files the first round's fixes changed — reconciled against the change, and widened back to the whole of it when the record's change base no longer matches |
| The checkout          | `git rev-parse` in the tree the run is implementing in — the absolute root, the branch and the HEAD commit                                                                                                       |
| The attestation nonce | Written to a record before it is printed, and checked by `josh review:attest`                                                                                                                                    |

**`--round 2` is taken after the commit, and its target is round 1's fixes and nothing else.** Since [#1261](https://github.com/joshuafolkken/kit/issues/1261) the pull request opens between the rounds, and since [#1486](https://github.com/joshuafolkken/kit/issues/1486) nothing edits the tree in between: the version bump that used to sit there put `package.json` into the target every time. So the record the gate wrote still matches the tree and this brief answers `Already verified`, instead of sending the review agent back to the unit suite the gate had just passed.

**Only one half is mechanical.** The round-2 target _is_ the scope handed over, so a narrowed round stays narrowed whatever the agent decides. The "already verified" block is an instruction to an agent that has a shell, so whether it obeys is measured rather than assumed.

**It refuses to compose a brief at all when the scoped checks have never been green on this tree** ([#1511](https://github.com/joshuafolkken/kit/issues/1511)). `josh lint:related` and `josh test:related` each write down the digests they were green on, in the same record shape and against the same change base the green-gate record uses; this command compares them the way [`josh gate`](#josh-gate) compares its own, and when either is missing or no longer describes the tree it puts a refusal on stderr and exits non-zero instead of printing a brief. `fullrun #1503` is what that costs otherwise: the gate and round 1 were started on a tree neither check had ever read, and the run then spent 282 seconds — 31% of it — picking up one lint rule and one failing test at a time, across three round trips with fourteen edits between them.

- **The way out is one call**: `pnpm josh lint:related && pnpm josh test:related`, measured at 13.8 seconds on that same run, then reissue this command.
- **It fixes when the checks run, never whether they run.** A green record skips nothing, narrows nothing and is never reused in place of a check — which is why it does not revive [#1420](https://github.com/joshuafolkken/kit/issues/1420), closed as not needed.
- **A record is written only by a run that answered for the whole changed set**, and four things withhold it: a non-zero exit; **any** argument at all, since `--shard`, `--project`, `--testNamePattern` and `--exclude` narrow as hard as a path does and cannot be told from `--reporter` without a per-runner judgement; a tree that moved while the checks were in flight, compared before and after exactly as [`josh gate`](#josh-gate)'s own record is; and a vitest the unit guard **skipped** rather than ran, which exits zero having executed nothing.
- **Three states allow rather than refuse**, because a guard that wedges a run on a reading it could not make is worse than no guard: an empty file map, a change base git could not resolve, and `JOSH_SCOPED_GREEN` set to `off` / `0` / `false` / `no`.
- **The refusal is on this command rather than on `josh gate`, because CI runs the gate.** `.github/workflows/ci.yml` runs `pnpm josh gate --verbose --no-unit` with no scoped check in front of it. This command is run by no CI job and no lefthook hook — and it is where the attestation nonce is minted, so there is no countable review round that does not pass through it.

**It names the checkout, because the forked agent does not inherit one** ([#1522](https://github.com/joshuafolkken/kit/issues/1522)). `/code-review` is forked by the harness into the **session's** working directory, so a run implementing in a lane (`josh lane:open`) is reviewed from a tree that holds the previous child's already-merged code. Nothing there is wrong, so the review returns no findings — and **the failure arrives as approval**. Measured across the seven children `epicrun #1474` merged: twelve of the fifteen review rounds named the lane's absolute path in the invocation and cited files that were actually in their own diff; the one round whose invocation named no path is the one that reviewed a different pull request. So the path is now generated from `git rev-parse --show-toplevel` rather than left to whoever writes the hand-off, every target the brief prints carries `git -C <root>`, and the round-2 file list is absolute. Whether the review then honors it is checked by [`josh review:attest`](#josh-reviewattest).

**It never claims a gate it cannot prove.** The gate's record holds a digest per changed path; if any of them has moved since — or there is no record at all — the brief prints `Not verified` and asserts nothing about lint, the type check, the spell check or the unit tests. Re-run `pnpm josh gate` after applying fixes and the record catches up.

**A gate still running is its own answer** ([#1242](https://github.com/joshuafolkken/kit/issues/1242)). The workflow starts `josh gate` alongside the review rather than in front of it — the two read the same tree and neither writes to it — so at the moment the brief is composed the checks have usually not finished. `josh gate` keeps a marker for as long as it runs and clears it on the way out, green or red, and the brief prints `Running now`: **no result is claimed**, the review agent is told not to run the unit suite the gate is running beside it, and the run joins the gate's own result before committing. Without this state a running gate is indistinguishable from one that never ran, and the review re-runs everything — the cost [#1241](https://github.com/joshuafolkken/kit/issues/1241) had just removed.

**The round-1 snapshot is what makes `--round 2` mechanical.** The implementation and the review's fixes are uncommitted in the same tree, so `git diff` cannot say which side of the review a change fell on. Round 1 records a digest per changed path; round 2 compares and names exactly the paths that moved. With no snapshot it falls back to the whole change: a missing record must widen a review, never narrow it.

**The record carries the commit its map was measured against, and a moved base widens the round rather than narrowing it** ([#1537](https://github.com/joshuafolkken/kit/issues/1537)). Both maps are a diff against [`josh`'s change base](#josh-reviewlevel) — the branch's merge base with the default branch — and that base is resolved afresh on every invocation. Merge the default branch between the two rounds, which is what resuming an interrupted run does, and the two maps stop covering the same set of paths: their difference is then a set difference, not a fix delta. Measured across four resumed runs (#1080 / #1085 / #1147 / #1197) it named up to five files the branch had never touched, and — the dangerous direction — **omitted files the branch had**, while the round reported no findings. Round 1 now records the base beside the digests; round 2 compares it, and where it differs, or where the record predates the field, the target is the whole change again.

**Where the target and `git diff` still disagree, the brief says so rather than continuing.** The delta is intersected with the change, so a path the change does not contain is never a target: any such path is listed under `Not in this change`, and the count of files the change touches that round 1 already read is printed with the `git diff --name-only` command — plus the untracked files beside it — to check it against. A round-2 target that silently disagrees with the branch is the failure [#1537](https://github.com/joshuafolkken/kit/issues/1537) was filed on, and it is not fixed by making the disagreement smaller.

**It is recorded once per run and never retaken** ([#1441](https://github.com/joshuafolkken/kit/issues/1441)). A second round-1 invocation — a bare `pnpm josh review:brief` re-run after round 1's fixes are in — keeps the record it finds and says so on stderr, naming when that record was taken. Retaking it used to be one command away from a wrong answer: the record would describe the **fixed** tree, the fix delta would read empty, and `josh review:round2 --round-1-closed` would skip the second round over fix code nobody had read. The record's lifetime is one run, and `josh followup` removes it at the end of a run that **merged** so the next run takes its own; a run that stops earlier — or one invoked with `--no-merge`, where the pull request is still open — leaves it behind, and the next run's delta is then measured from further back: wider, which costs a round 2 rather than skipping one.

### `josh review:level`

Print the `/code-review` level this change is reviewed at ([#966](https://github.com/joshuafolkken/kit/issues/966)).

```bash
pnpm josh review:level            # the branch diff; alias: josh rl
pnpm josh review:level --staged   # the staged diff
pnpm josh review:level --json     # the level and the reason, machine-readable
```

The level goes to stdout and the reason to stderr, so `$(pnpm josh review:level)` reads the level and a person still sees why.

**The decision takes no judgement.** "This one is small" is a judgement made under cost pressure, and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped. So the input is the list of changed paths and nothing else, and the rule is a command rather than a paragraph — a rule an agent applies from memory is one it can talk itself out of.

| Every changed path is…                                                                   | Level    | Rounds  |
| ---------------------------------------------------------------------------------------- | -------- | ------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1       |
| anything else                                                                            | `medium` | up to 2 |

**One non-inert path decides the whole change** — a review reads the change, not a subset of it. An empty diff also takes `medium`: answering `low` to "nothing changed" would hand a reduced level to a caller that failed to read the diff. The branch form counts untracked files too, since `git diff` never lists them and a change that adds a whole new module would otherwise look empty.

**Three things that look inert are not**: `.vscode/**`, `.gitattributes` and `.prettierignore` are all in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`, so a defect in one reaches a consumer. **Documentation is not inert either** — `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` stay at `medium`. The "Non-runtime updates" exception exempts them from _testing_, which asks whether an automated test could have caught the defect; this asks whether a human reading the diff is the only thing that can. Measured on [#963](https://github.com/joshuafolkken/kit/issues/963) and [#965](https://github.com/joshuafolkken/kit/issues/965), both documentation-only by that classification: a `medium` review found ten real defects in each — pointers into removed sections, citations naming the wrong file — in artifacts distributed to every consumer.

### `josh review:round2`

Say whether the second `/code-review` round is due, or may be skipped entirely ([#1433](https://github.com/joshuafolkken/kit/issues/1433)).

```bash
pnpm josh review:round2                     # → required ; alias: josh r2
pnpm josh review:round2 --round-1-closed    # → required | skip
pnpm josh review:round2 --json              # the verdict and the reason, machine-readable
```

The verdict goes to stdout and the reason to stderr, so `$(pnpm josh review:round2 --round-1-closed)` reads the verdict and a person still sees why. Run it once round 1's fixes are in and **before** `/code-review` is invoked a second time.

**Every measure before this one narrowed round 2; this one asks whether it is due.** [#1219](https://github.com/joshuafolkken/kit/issues/1219) redefined its question, [#1241](https://github.com/joshuafolkken/kit/issues/1241) carried that question into the forked agent, and the wall clock did not move — because a round's span follows its **turn count** (`r = +0.80`) rather than the size of what it reads (`r = -0.15` for round 2 against how much of round 1 it repeats; round 1 against churn was re-measured at a larger sample and its coefficient retired, so read it from `prompts/review.md` → "Round 1's cost does track the change size, and splitting is still not how to cut it" rather than from a number here). The saving is in not forking an agent at all, which is what a skip buys and a lighter round does not.

| Answer     | When                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skip`     | **Arm A** — the fix delta is empty: round 1's findings closed without an edit, so there is no unreviewed fix code                                                                    |
| `skip`     | **Arm B** — every path in the fix delta is inert by [`josh review:level`](#josh-reviewlevel)'s classification                                                                        |
| `required` | anything else, including a missing `--round-1-closed`, a missing round-1 snapshot, a round-1 snapshot taken against a different change base, and one non-inert path among inert ones |

**`--round-1-closed` is the one input no command can read for itself**, so the caller states it: every round-1 High/Medium finding closed, by a fix in this working tree or as a verified false positive, and none was filed or deferred. It is a report of a fact round 1 already wrote down, not a judgement — and its absence is the safe answer, so a run that forgets it pays a round rather than skipping one. Every other uncertainty resolves the same way.

The fix delta is the same comparison [`josh review:brief --round 2`](#josh-reviewbrief) makes — the same round-1 snapshot, the same digest comparison over the same reading of "changed", and since [#1537](https://github.com/joshuafolkken/kit/issues/1537) the same refusal when the record's change base has moved. Each computes it when asked; what is shared is the record and the code, not one command's result.

**One thing does differ, and it differs in one direction only.** The brief intersects its delta with the change before printing a target, because a path the change no longer contains is not something to send a reviewer to read; this decision does not, so a delta the brief has narrowed to nothing can still answer `required` here. That asymmetry is deliberate: narrowing a _target_ costs a reviewer a file, narrowing a _verdict_ costs the round itself, and only one of those is recoverable.

**Sharing the comparison means sharing its guard** ([#1537](https://github.com/joshuafolkken/kit/issues/1537)). A record taken against a different change base describes a different set of paths, so an empty or inert-looking delta is then no evidence at all about what round 1 fixed — and here that evidence buys a `skip`, which leaves the fixes unread rather than merely mistargeted. The base is compared before the digests are, and a mismatch — or a record written before the field existed — answers `required`.

**Ask it once round 1's fixes are in, and before the commit.** The delta it reads is then exactly those fixes. Nothing writes to the tree in between since [#1486](https://github.com/joshuafolkken/kit/issues/1486) took the version bump out of the child flow — it rewrote `package.json`, which is not inert, so a delta taken after it answered `required` whatever round 1 did and the condition never fired in the flow it was built for.

**A prompt fix and a test fix both answer `required`, deliberately.** The condition the issue arrived with exempted anything that is not a runtime code path; that is rejected on the measurement recorded under `josh review:level` — two documentation-only diffs, ten real defects found in each by a `medium` review, none of them covered by a test. A test file is the verification that guards a runtime path, and an assertion a fix weakened still passes. The full reasoning, how a skip is recorded on the Issue, and when the condition is withdrawn are in `prompts/review.md` → "When round 2 is skipped entirely, and when it is not".

### `josh review:attest`

Record, or verify, which checkout a `/code-review` actually read ([#1522](https://github.com/joshuafolkken/kit/issues/1522)).

```bash
pnpm josh review:attest <nonce>   # run by the review, from the checkout it read
pnpm josh review:attest --check   # run by the run, before it acts on the review; alias: josh ra
```

**The root cause is not this repository's to fix.** `/code-review` is forked by the harness and inherits the session's working directory; nothing here decides that. What is decidable is the direction the error falls in. A review that read the wrong tree reads already-merged, already-reviewed code, finds nothing, and reports that silence as approval — so the run commits and merges a diff nobody read. **Detection is therefore the deliverable**: a review that cannot show which tree it read is treated as no review at all.

`josh review:brief` records the checkout it is describing and prints a nonce. `josh review:attest <nonce>` reads the checkout it is **itself** run in — `git rev-parse` answers about the process's own working directory, so values handed in on the command line would only ever agree with themselves — and exits non-zero when that is not the briefed one. `--check` is the other end: the run asks it before acting on the review's verdict, and `josh followup` asks it again before merging.

| Answer         | What it means                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ok`           | The review attested the checkout it was briefed on                                                                |
| `missing`      | A brief was recorded and nothing attested it — **a refusal, not a pass**                                          |
| `mismatch`     | The review attested a different root, branch or HEAD. Its findings, "no findings" included, describe another tree |
| `not-required` | No brief was recorded in this checkout inside a run's lifetime, so there is nothing to attest                     |

**Absence is a refusal.** The defect produced no signal at all, so a check that read silence as success would answer `ok` in exactly the state it exists to catch. A wrongly refused merge costs one re-run of the review; a wrongly allowed one ships a diff nobody read.

**All three fields, not the root alone.** A second work tree of the same repository has a different root, which the root test catches on its own; a `git switch` inside the right tree does not, and a lane's branch is what its commit lands on.

**Scoped to a checkout that briefed a review, and expiring after eight hours.** A project or a flow that never runs `josh review:brief` merges exactly as it did before, and a run that crashed before `josh followup` does not hold the next one hostage — the same expiry `josh run:hold` uses, and read only in the direction that drops the requirement, so it can never turn a real mismatch into a pass. `josh followup` clears the record at the end of a run that merged, beside the round-1 snapshot.

### `josh delegate`

Say whether a step of a run may go to a cheaper execution tier ([#969](https://github.com/joshuafolkken/kit/issues/969)).

```bash
pnpm josh delegate gate-fix   # → delegate ; alias: josh dg
pnpm josh delegate review     # → keep
pnpm josh delegate --list     # the enumeration, and what was rejected and why
```

The verdict goes to stdout and the reason to stderr, so `$(pnpm josh delegate <step>)` reads the verdict and a person still sees why.

**The list is the whole of the rule: anything not on the list is `keep`.** A step nobody classified must not be delegated because nobody said it could not be. The direction matters — a missed entry costs money, while a wrong `delegate` costs correctness and does so quietly.

**A step earns its place by naming how a wrong result is caught**, by something that runs in the parent tier and costs less than redoing the step. "Unlikely to be wrong" does not qualify, and most candidates fail here: a notification body, a decision-log comment and a status read all ship their mistakes with nothing left to disagree with them. `--list` shows those as rejected with the reason rather than omitting them, so the next person to propose one finds the answer instead of re-deriving it.

| Step            | Delegatable because                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gate-fix`      | `pnpm josh gate` is re-run; a wrong fix fails it again and the failure names the file                                                                                                |
| `epic-child`    | the parent reads the child's state from GitHub rather than from the summary, so a child reported done but not merged is still open — the failure shows instead of the loop moving on |
| `survey`        | the reported locations are checked directly; a fabricated or missed one does not survive one `grep` of what it claimed                                                               |
| `investigation` | the parent opens the cited lines; a conclusion those lines do not support fails there, and reading a handful of cited regions costs far less than redoing the reading                |

**These were considered and kept**, so the next person to propose one finds the reason instead of re-deriving it. `pnpm josh delegate <step>` answers `kept deliberately` for these, distinguishing them from a step that is merely unlisted:

| Step               | Kept because                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| `notify-body`      | no verifier; a wrong body is sent and read as though it were right                      |
| `issue-comment`    | no verifier; a decision log or completion comment _is_ the record, so nothing checks it |
| `status-read`      | a misread routes the run to the wrong child and no later step disagrees                 |
| `diagnosis`        | a wrong root cause produces a fix that passes the gate and leaves the defect            |
| `design`           | the cost of a wrong design is paid by every step after it                               |
| `split-assessment` | a missed split widens one Issue into a batch nobody authorized                          |
| `review`           | the review is the last thing between a defect and a merge; a cheaper one finds less     |

**`investigation` is the only row that carries a threshold, and the threshold is 3 files, and it is a count, not a forecast** ([#1426](https://github.com/joshuafolkken/kit/issues/1426)). The read that takes the count of files the run will not edit up to it is where the pre-implementation reading goes to a unit of its own; the ones below it stay in the main line and the unit is not sent back over them, because delegating costs two extra main-line turns — about 18 seconds at the 8.8 s of model wait per turn measured on run #1406 — while one subject file of that run's average size is re-sent on every remaining turn and the turns following its large reads ran 43–72 s against that same 8.8 s average. What comes back is the conclusion plus the `file:line` citations that support it, never the file text; a throwaway probe script is written, run and deleted inside the unit. **It is not `survey`, and it is not `diagnosis`**: `survey` reports where something appears and is checked by one `grep`, while a root cause stays with the main line. `pnpm josh delegate --list` is what prints the count: the verdict command prints the verifier. **A delegation resets the counter rather than spending it** ([#1460](https://github.com/joshuafolkken/kit/issues/1460)) — run #1441 asked the question once and then read 8 more unedited files without asking again, so the counting moved out of the agent's head and into `josh investigation:guard` below. The rule is `.claude/skills/workflow-commands/SKILL.md` → "2b. Delegating a step to a cheaper tier".

**The mechanism is not the unit.** How a thing is delegated is separate from what is delegated — one step of a run, or one whole child of a batch ([#984](https://github.com/joshuafolkken/kit/issues/984)). Both are rows of the one enumeration above rather than two mechanisms, which is why `epic-child` is answered by this same command. **One row covers both batch entry points**: an epic's child under `epicrun` and one issue of a `queue` are the same unit — same brief, same summary, same `pnpm josh issue:state` verifier — so the queue was wired to this row rather than given one of its own ([#1149](https://github.com/joshuafolkken/kit/issues/1149)).

### `josh run:hold` / `josh run:release`

Say whether another run already holds this working tree, and claim it when it does not ([#1091](https://github.com/joshuafolkken/kit/issues/1091)).

```bash
pnpm josh run:hold 1091                            # alias: josh rh
pnpm josh run:hold                                 # a `new` entry point, before the issue exists
pnpm josh run:release                              # alias: josh rr
```

**The unit is the working tree, not the repository.** `epicrun` already asks `epic-busy.ts` whether a _repository_ has a child in flight, and that read must not be reused here: what these entry points contend for is one branch, one index and one uncommitted diff, and a linked work tree has its own three — so a repository-scoped answer would stop a second work tree's legitimate run, which is exactly the parallelism a later epic is meant to buy. The record is keyed to `git rev-parse --absolute-git-dir`, which is `.git` in the main work tree and `.git/worktrees/<name>` in a linked one, so two work trees of one repository key differently and two commands in the same work tree key alike.

**It exists because the guard `epicrun` has never covered the entry points a person types.** On 2026-08-30 one session held #1071 in this checkout while another `fullrun new` filed #1090 and implemented nine files in the same tree; a person noticed one command before `pnpm josh git -y` would have committed those nine files onto the other run's branch. **A guard that depends on someone watching is not a guard**, and unattended execution is the whole premise.

| Answer     | Meaning                                                                  | Exit code |
| ---------- | ------------------------------------------------------------------------ | --------- |
| `hold`     | The tree was free (or the record had expired) and this run now holds it  | 0         |
| `busy`     | Another run holds it — **stop before filing anything**                   | 0         |
| `unknown`  | The work tree's git directory could not be read; nothing was established | 1         |
| `released` | `run:release` cleared a record that was there                            | 0         |
| `none`     | `run:release` found nothing to clear                                     | 0         |

Standard output carries exactly one token, so `answer=$(pnpm josh run:hold 1091)` captures something a loop can branch on. Every explanation goes to standard error, and it names the holder, the time the record was written, the pid that wrote it, and `pnpm josh run:release` as the way to clear a stale one.

**An unreadable record answers `busy`, never `hold`.** A present record that cannot be parsed is the state a guard must not fall open on, because the run that wrote it is the one whose uncommitted work would be trampled — the same reason `epic-busy.ts` refuses to report an unreadable listing as an idle repository.

**A claim never overwrites a record that is already there.** Overwriting is the thing being prevented; the person who knows the other run has ended clears it with `pnpm josh run:release`.

**Two claims racing for one tree cannot both win.** The claim on a tree that read as free is an exclusive create rather than a write, so of two sessions typing an entry point in the same second exactly one is told `hold` and the other is told `busy` — a plain write would tell both of them they won, which is the incident reproduced by the guard meant to stop it.

**The record does not outlive the run in either direction.** A normally finished run releases it inside `pnpm josh followup` on the merge — the one seam every `fullrun`, and every child of an `epicrun` or a `queue`, passes through, so nothing has to remember to type the release. An abnormally ended one is covered by age: a record older than **8 hours** is replaced rather than honoured, which is longer than any measured run and short enough to be gone by the next working day. **The pid is recorded for the person reading the stop, never as the liveness test** — the process that claims the tree is a short-lived `josh run:hold`, so it has exited before anything reads the record back. A `taken_at` that is not a date is read as expired rather than as current, because a record nothing could ever expire is the one state the expiry exists to make impossible.

**Age alone never frees a tree, because some holds are held across a person's latency.** `halfrun`'s stop before commit and a `needs-human-review` stop both leave uncommitted work in the tree deliberately, and no age can be chosen that covers a person going home for the night. **An expired record over a tree that still has uncommitted changes answers `busy`** and says to commit, stash, or release once the work is done; only an expired record over a clean tree is replaced. A tree state that could not be read counts as dirty, for the reason every other unreadable state here blocks.

**Claim it in the checkout the run will edit.** The record is keyed to the work tree the command runs in, so a cross-repository entry point resolves the target repository's checkout from `pnpm josh doctor` before claiming; claiming in the session's own tree would guard the one tree that run never touches.

The entry points that ask it, and where in each procedure, are `.claude/skills/workflow-commands/SKILL.md` → "2f. The working-tree hold — one run per tree".

### `josh run:carry`

Carry one invocation's budget across its own session cuts, so a resumed `backlogrun` continues the run a person authorized instead of starting a second one over it ([#1714](https://github.com/joshuafolkken/kit/issues/1714)).

```bash
pnpm josh run:carry --begin "backlogrun --max 5" --owner "$PPID"   # alias: josh rc
pnpm josh run:carry --json                                        # read the record back in a resumed session
pnpm josh run:carry --merged 1                                    # a child merged
pnpm josh run:carry --filed 1                                     # an issue was filed
pnpm josh run:carry --cut                                         # a cut is coming: hand the record off
pnpm josh run:carry --resume "backlogrun --max 5" --owner "$PPID"  # adopt a record no cut handed off
pnpm josh run:carry --end                                         # the invocation is over
```

**A session cut is an execution detail of the same authorization, and the budget is what carries it.** Typing `backlogrun` once approves the declared budget — `--max`, `--idle` and the 8-hour whole-run bound — and the cut is internal to spending it, the way opening a lane or delegating a child is. What the explicit-invocation rule forbids is **inferring** a workflow from the shape of a request; it has never required the keystroke to land in every session's own transcript, which is the reading `.claude/skills/workflow-commands/epicrun.md` → "Each child runs in a delegated unit" already applies to a delegated child.

**The unit is the repository, not the working tree.** `josh run:hold` keys on the work tree's own git directory because what it guards is one branch, one index and one uncommitted diff. What this record carries is one invocation's budget, and that invocation opens lanes — each a work tree of its own — so the key is the common git directory every lane of one repository shares.

| Answer       | Meaning                                                                                                       | Exit code |
| ------------ | ------------------------------------------------------------------------------------------------------------- | --------- |
| `began`      | Nothing was carried, so this invocation starts one                                                            | 0         |
| `resumed`    | **This session is continuing a run that was cut** — a `--cut` handed the record off, or `--resume` adopted it | 0         |
| `busy`       | The record's **owner process is still running**; this budget is being spent by something else                 | 1         |
| `standing`   | A record is here that **no cut handed off** — carry it with `--resume`, or discard it with `--end`            | 1         |
| `mismatch`   | A record is here for a **different** invocation; nothing was established                                      | 1         |
| `carried`    | A read: the record is live, and `--json` puts it on standard output                                           | 0         |
| `counted`    | A merge, a filing or a cut was added to the record                                                            | 0         |
| `expired`    | The 8-hour whole-run bound is spent; the run ends whatever the counters say                                   | 0         |
| `ended`      | The record was cleared                                                                                        | 0         |
| `none`       | Nothing is carried — a count and a `--resume` exit 1, a read and an end exit 0                                | 0 or 1    |
| `unreadable` | A record is here and could not be parsed; nothing was established                                             | 1         |
| `unknown`    | The repository's git directory could not be read                                                              | 1         |

Standard output carries exactly one token, so `answer=$(pnpm josh run:carry --begin "backlogrun")` captures something a loop can branch on. `--json` is the one exception and is still one line — the whole record has to reach the resumed session, and prose on standard error cannot be read back.

**A live record is never replaced, and never resumed into by something else.** Whose record it is is decided by **ownership**, never by the invocation text ([#1722](https://github.com/joshuafolkken/kit/issues/1722)). Comparing the string was the first answer and it walked straight through the case that happens most: a run dies, a person retypes the same command, the string matches, and the fresh session inherits the dead run's counters and a `started_at` hours old. Two things replace it.

**The record names the process spending the budget, and a second parent is refused against it.** `--owner <pid>` is that declaration: `--begin` records the pid together with the start time that tells a reissued pid apart, and any later `--begin` or `--resume` while that process is still running answers `busy` and exits 1 — **whatever either command line says**. Pass the parent loop's own long-lived process, which under a `backlogrun` is `--owner "$PPID"`. Without it the record simply declares no owner, and every standing record then reads as not provably live, which refuses rather than resumes. It is not `josh run:hold`'s pid, which is recorded for the reader and deliberately never read back: the process that claims a work tree is the short-lived `josh run:hold` itself, while the owner here is the session that outlives every command it issues.

**A session cut declares itself, so only a cut the run took is carried without anyone deciding.** `--cut` marks the record as handed off and a crash never reaches it, so the next `--begin` naming the same invocation answers `resumed` — the record's counters and `started_at` intact, the ownership moved to this session, and the hand-off spent. Every other standing record answers `standing` and exits 1, which is the explicit carry-or-discard: `--resume "<invocation>" --owner "$PPID"` adopts that budget, `--end` discards it and `--begin` then starts a fresh one. `--begin` naming a **different** invocation still answers `mismatch`. An **expired** record is replaced whatever it names, because that run has spent the whole-run bound and a person typing the keyword again is starting a new run — with two exceptions, both of which answer without replacing. **Its owner is still running**: the answer is `busy`, since the bound ends _that_ run and replacing a record a live parent is still counting into would delete its budget and report `began`, the same two-parents defect one branch over. **A `--cut` handed it off**: the answer is `expired`, because a hand-off says the resumption _is_ that run — replaced there, the record would come back with `started_at` set to now, and `josh backlog:budget --started` reads that field, so the bound would restart at every cut and never end the run. A `--resume` over a spent record answers `expired` too, and adopts nothing.

**The record is claimed exclusively, the way `josh run:hold` claims a work tree.** `--begin` creates the file with `wx` rather than writing it, so two sessions that both read "nothing carried" in the same instant cannot both be told they began a run — the loser answers `busy`. That single-writer claim is also what makes the counters safe: `--merged` and `--filed` trust the claim rather than re-checking it, and with one owner there is never a second writer for an increment to be lost to.

**The whole-run bound is `josh backlog:budget`'s, imported rather than restated.** Two copies of the figure would drift, and the drift is silent in the direction that matters: raised there and not here, this record answers `expired`, `--begin` replaces it, and the budget restarts at zero — the defect the command exists to prevent.

**Every counter is an increment, never a total.** A run that sent a total would be sending arithmetic it had done in its head — the one-shot judgement [#1460](https://github.com/joshuafolkken/kit/issues/1460) measured a run walking straight past — so `--merged`, `--filed` and `--cut` add to what is there and the command owns the sum.

**A count with nothing to count into answers `none` and exits 1.** The loop believed it was carrying a budget and it was not; a silent zero would let the run keep its own tally instead of the record's. **A counting flag is what makes a count, never the sum of one** — `--merged 0` is a wave reporting that nothing merged, so it takes this path rather than being reclassified as a bare read, which would answer `none` with exit 0 and tell the loop its budget was fine.

**The 8-hour whole-run bound is the record's own age.** Held that way it survives the cut too, and a `started_at` that is not a date reads as spent rather than as current — a record nothing can ever expire is the one state the bound exists to make impossible.

**What may be run is untouched.** This command carries a budget and nothing else: `auto-ok` is still applied only by a person, so a resumed session is offered by exactly the rules the first one was — a pool that grew across the seam is `backlogrun.md` → "What one invocation approves", never this command's doing.

Where a `backlogrun` asks it, and what it does with each answer, is `.claude/skills/workflow-commands/backlogrun.md` → "The session cut is inside the invocation".

### `josh run:wake`

Continue a cut `backlogrun` by waking the next session from outside the conversation, so one keystroke spends the whole declared budget instead of the first 50 minutes of it ([#1719](https://github.com/joshuafolkken/kit/issues/1719)).

```bash
pnpm josh run:wake --start          # alias: josh rw
pnpm josh run:wake --list           # which supervisor is running, and what it has done
pnpm josh run:wake --stop           # stop it
pnpm josh run:wake --loop           # the body itself, in the foreground, to watch what it does
pnpm josh run:wake --loop --interval 30
```

`josh run:carry` made the budget survive the cut and left the keystroke in place: a cut still ended with a `confirmation` Telegram and a resume line, and a run measured to cut about every 50 minutes did nothing at all until a person came back to it. This is the thing that starts the next session.

**Whether to wake is the carry record's answer, never a judgement.** The supervisor wakes on one state — `carried`, and handed off by `josh run:carry --cut`. `none`, `expired` and `unreadable` each stop it. A record no cut handed off is a session still spending the budget, so it is waited on rather than woken over.

**The 8-hour whole-run bound therefore needs no check of its own.** It _is_ the carry record's expiry, so a run past it reads `expired` and the supervisor stops. A bound re-derived here would drift, and it would drift in the direction that matters — waking past a budget the record already calls spent.

**The supervisor never declares itself the record's owner.** The owner is meant to be the process _spending_ the budget, and that is the session it wakes, not itself. Named as owner, this long-lived process would still be alive when the woken session ran `--begin`, which is answered `busy` — and the run would never resume. So it reads the carry record and never claims it, while the woken session claims it with `--owner "$PPID"` exactly as before.

**What may be run is untouched.** The waker adds nothing to the argument vector but an invocation rebuilt to say exactly what the record said, and writes no label: `auto-ok` is still a person's to apply, so a woken session is offered by exactly the rules the first one was — a pool that grew across the seam is `backlogrun.md` → "What one invocation approves", never the waker's doing.

**What it launches is a constant, not configuration.** It runs `claude -p` with the recorded invocation as the prompt, resolved through `PATH` exactly as the `josh eval` harness resolves the same binary. It was an environment variable first, and that put the choice of _which binary runs unattended, overnight, with the person's own credentials_ in reach of anything that can set an environment; shape-checking the name does not address that, and removing the choice does. Supporting a second agent is its own decision with its own security thinking, and belongs in an Issue of its own.

**And the invocation it wakes with is rebuilt rather than carried across.** A `backlogrun` is the one thing this supervisor exists to continue, so everything that may reach the operating system is enumerable — the command word, `--max`, `--idle`, and an integer for each — and the recorded text is read as tokens and thrown away: the string handed to the agent CLI is composed from those constants and the integers that passed, using the same `josh backlog:budget` check that will read the numbers at the other end. **An unknown flag is refused, never dropped**, because a silently dropped flag wakes a session running to a budget the person did not declare — and so is a record the rebuild would rewrite at all, such as odd spacing or a `--max` written `05`, since the woken session hands its prompt straight back to `run:carry --begin`, where it is compared to the record character for character. Without any of this the supervisor would launch a session with whatever text the carry record happened to hold, which is the record's integrity standing in for a check nobody performs — but inspecting that text and passing it on is not enough either, and three rounds of stricter inspection are what established it: composing the argument out of constants is the only shape in which the record's own text never reaches the call (joshuafolkken/kit#1719).

**It deliberately does not carry `--dangerously-skip-permissions`**, which the `josh eval` harness does pass — that suite runs in a throwaway checkout with its credentials taken away, while this wakes a session in the person's own repository with their own credentials.

**It waits out the session it is replacing.** A `--cut` is the cutting session's last _write_, not the moment its process is gone, and `josh run:carry` tests whether the record's owner is still live **before** it tests the hand-off — so a wake issued too early has the new session answered `busy`, which tells it to stop without claiming anything. The supervisor therefore holds off while the recorded owner is still running. **That wait is bounded**, because an interactive session's process often outlives its own cut: waited on without a bound the supervisor would hold for the record's whole life, wake nothing, and end on `expired` without a warning — a silent overnight failure, which is worse than the `busy` race the wait avoids. After the same ten-minute window it wakes anyway, and a `busy` there merely costs one of the retries below. **That window is the ceiling on the wait, never its length**: the owner's liveness is read on every pass, so an owner that exits two seconds after the hold is waited two seconds — the wait is marked on a field of its own rather than on the wake mark, because sharing the wake mark made the first pass the last one that could notice the owner had gone.

**A launch that fails does not disappear, and is retried before it is called a failure.** The detector is the carry record not being claimed within ten minutes of a wake, which catches a missing binary, a session that dies during boot, and one that runs without ever picking the run up — three failures an exit-code check would have missed. The window has to cover the agent CLI's cold start and everything it reads before its first `run:carry --begin`, and a merely slow start booked as a failure would end the run for the night; so a lost wake is retried up to three times, and only then does the supervisor stop and send a `warning` Telegram. **The last process it launched is named in that warning rather than killed** — a slow session is still doing the run's work, and a supervisor that destroyed what it could not account for would destroy exactly what it exists to keep going.

**Every stop that leaves a carried run with nobody watching it sends that warning, not only a spent retry** (joshuafolkken/kit#1746). `expired` and `unreadable` end the supervisor while the carry record is still sitting there handed off, and both were silent — so a run left asleep by either reached nobody at all, which is the opposite of what `backlogrun.md` → "A failure is visible rather than silent" promises. `ended` and `stopped` stay silent, because in those two nothing went wrong: the run finished, or a person stopped the supervisor themselves. **The exit codes are unchanged** — the table above is a contract callers branch on, and what those two reasons were missing is the notification rather than a different code.

**`woke` counts carry records actually claimed, not sessions launched** (joshuafolkken/kit#1746). Counted at the spawn, the number asserted the very thing the supervisor had not yet checked: on 2026-09-10 three sessions were started for one cut, none of them ever claimed the record, and `--list` went on reporting `woke 1 session(s) across 1 cut(s)` for forty minutes — the published invariant reading as held throughout the failure it exists to expose. Counted at the claim, the same forty minutes show `woke 0` against one cut, and `--list` says how many launches are still outstanding beside it, so a stalled backlog is visible while it is stalling rather than only once the retries are spent. **The count is observed at a poll, so it lags a claim by up to one polling interval** — a minute by default — and the outstanding line is what tells the two apart: a cut still being retried has launches outstanding, and one already claimed has none.

**What the woken sessions print is kept rather than discarded** (joshuafolkken/kit#1746). `detached` is what puts a session outside the conversation; `stdio: 'ignore'` rode along with it and threw away the one record that could say why a session exited without claiming anything. Everything this supervisor starts — the woken sessions and the supervisor's own console output alike — is appended to one log file per repository, keyed exactly as the wake and carry records are, and `--list` and every warning name its path. A temp directory that cannot be written to loses the diagnosis and never the launch: the session still starts.

**A person can always find it and stop it.** `--list` names the invocation, the process, whether it is still running, and how many sessions it has woken beside the run's own cut count — the two being equal is the invariant worth being able to check, and a restart carries the count forward rather than resetting it. `--stop` removes the record, which is what ends the loop, and signals the process only to shorten the wait; a supervisor whose process cannot be signalled still stops at its next pass, because the loop refuses to write back a record that is no longer there.

**And what it writes back, or removes, is decided by whether the record is its own — not by whether a record is there** ([#1727](https://github.com/joshuafolkken/kit/issues/1727)). The two come apart exactly when it matters. A `--stop` that removes the record but never reaches the process — `EPERM`, or a liveness read that calls a running process dead — followed by a person's `--start` leaves the old loop awake beside a new supervisor's record. Asked only whether _a_ record is there, the old loop wrote its own process and counters into the new one, and two supervisors then woke two sessions into one carry budget: the state the exclusive create prevents, arrived at after the create rather than through it — and whichever finished first removed the survivor's record, leaving the run watched by nobody. So the loop reads its own record at the top of every pass and ends quietly the moment it is not there, **before** it decides anything rather than merely before it writes; and its tidy-up on the way out removes only a record it still owns. `--stop` and the dead-marker sweep are unchanged, because removing someone else's record is what each of them is for. The precedent is `josh run:carry` alone, which already compares a record's recorded owner against the owner a caller declares before letting it touch anything; the difference here is only who the owner is, since this record's writer is its owner. `josh run:hold` is **not** a precedent — it records a pid for the person reading its stop message and never reads it back.

| Answer        | Meaning                                                                                                           | Exit code                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `started`     | A supervisor is now running detached                                                                              | 0                                          |
| `running`     | One was already running here; nothing was started                                                                 | 0                                          |
| `supervising` | `--list` found one and its process is running                                                                     | 0                                          |
| `stale`       | A record is here but its process is gone — a crash or a reboot; `--stop` clears it                                | 0                                          |
| `stopped`     | The record was removed and the process signalled                                                                  | 0                                          |
| `none`        | Nothing to supervise, list or stop                                                                                | 0 for `--list` / `--stop`, 1 for `--start` |
| `ended`       | The run finished and the supervisor stopped                                                                       | 0                                          |
| `expired`     | The 8-hour whole-run bound is spent; nothing was woken; a `warning` Telegram was sent                             | 0                                          |
| `unreadable`  | The carry record could not be read, so the supervisor stopped rather than guessing; a `warning` Telegram was sent | 0                                          |
| `failed`      | A wake could not be launched, or was never claimed; a `warning` Telegram was sent                                 | 1                                          |
| `unknown`     | The repository could not be resolved, so nothing was established                                                  | 1                                          |

Standard output carries exactly one token on every path; the reason and the advice go to standard error. Where a `backlogrun` starts and ends it is `.claude/skills/workflow-commands/backlogrun.md` → "The session cut is inside the invocation".

### `josh run:preflight`

Say what an interrupted run left in this working tree, and what the rule says to do about it before the next child starts ([#926](https://github.com/joshuafolkken/kit/issues/926)).

```bash
pnpm josh run:preflight 926   # alias: josh rp
```

Standard output carries exactly one token, so `answer=$(pnpm josh run:preflight 926)` captures something a loop can branch on. Every explanation goes to standard error: what was found, and the exact commands that recover it.

| Answer    | What it found                                                                   | What the caller does                                                            |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `clean`   | Clean tree, HEAD on the default branch, no branch or pull request for the issue | Start the child                                                                 |
| `reclaim` | Uncommitted changes, or HEAD off the default branch                             | Stash with `-u`, switch back, record the stash on the issue, then **ask again** |
| `resume`  | A branch for the issue, or an open pull request, is still there                 | Reuse it and run the whole verification gate from the start                     |
| `park`    | The pull request for the issue is merged or closed                              | Park the child with `needs-decision` and a comment                              |
| `unknown` | The tree could not be read — exits non-zero                                     | Stop. It is not "the tree is clean"                                             |

**The precedence between those states is fixed, and the first row is why it has to be.** A `resume` or a `park` decided over a dirty tree would hand the next child a checkout it cannot switch, so the tree is reclaimed first and the question asked again on the clean tree — rather than two answers being merged into one. The child is not read at all once the tree already answers `reclaim`: the verdict would be `reclaim` whatever it said, so the `gh` round trip is not spent.

**It is re-askable, which `josh run:hold` deliberately is not.** A claim asked twice answers `busy`, because the second ask is a second run. This command reads state and writes nothing, so "reclaim, then ask again" is a procedure rather than a contradiction. The two guard different things and neither replaces the other: `run:hold` asks whether another **live** run owns this tree, this asks what a **dead** one left in it.

**A branch is found by pattern, not by name.** `pnpm josh git` builds `<N>-<slug>`, and the slug is not derivable from an issue number, so the read is `git branch --list '<N>-*'` — which matches whatever the title was and never matches `<N><digit>-…`. **Remote-tracking branches are searched too**, with the remote name stripped back off: a run interrupted on another machine, or in a checkout since re-cloned, leaves the branch on the remote with no local counterpart, and a local-only search would answer `clean` over an open pull request. The same listing answers `git_command.branch_exists`, so there is one reading rather than two.

**The pull request is reached through its head branch, which is the limit of what this command sees.** A branch that exists in neither place — deleted after a merge, say — takes its pull request out of view with it, and the answer is `clean`. Where more than one branch matches, a **decided** pull request on any of them outranks an open one on another, so a retry branch cannot hide a merged pull request behind itself. **An unreadable `gh` is never read as an absent pull request**: existence is asked through `pr_exists`, which throws on a lookup it could not complete ([#1048](https://github.com/joshuafolkken/kit/issues/1048)), and that reaches the caller as `unknown` rather than as `resume` over work somebody already merged.

**The stash this command prescribes is the one sanctioned stash that is never popped.** What it moves aside belongs to a run that has ended, not to the run doing the stashing, so the Issue comment naming it is the only thing that can ever bring it back. The enumeration of flows that may stash automatically is `prompts/collaboration-workflow/operating-rules.md`.

The loop that asks it, and what each answer does there, is `.claude/skills/workflow-commands/epicrun.md` → "Preflight — reclaim what an interrupted run left, before the next child starts".

### `josh run:liveness`

Say whether the delegated unit running a child is still working, or stopped without reporting ([#1485](https://github.com/joshuafolkken/kit/issues/1485)).

```bash
pnpm josh run:liveness 1169 --output ~/.claude/projects/<project>/<session>.jsonl --process none   # alias: josh rv
pnpm josh run:liveness 1169 --output <path> --process alive --window 45 --gap 2 --repo joshuafolkken/app-kit
```

Standard output carries exactly one token, so `answer=$(pnpm josh run:liveness 1169 --output "$out" --process none)` captures something a loop can branch on. Every explanation goes to standard error: what each trace said, and what to do about it.

| Answer         | What it found                                                                          | What the caller does                                                    | Exit code |
| -------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| `alive`        | The output moved, or a process of the child is running                                 | Keep polling; touch nothing                                             | 0         |
| `stopped`      | The output has been frozen past the silent window and no process of the child is alive | Stash if the answer says so, remove `in-progress`, park the child       | 0         |
| `settled`      | The child closed, or the unit parked it with `needs-decision`                          | Re-read it with `pnpm josh issue:state <N>` and take that branch        | 0         |
| `undetermined` | A trace could not be read                                                              | Read the trace that failed and ask again. It is not "the unit is alive" | 1         |

**Two traces decide it, and neither depends on whether implementation started.** The detection this replaces required a **dirty** checkout, on the reasoning that a unit which died mid-implementation leaves exactly that — so a unit that stopped seven minutes in, while still reading the skill and the issue, left a clean tree and the test could never become true. The checkout is still read, for one thing only: whether there is work to stash before the child is parked. "Nothing was ever opened for the child" is dropped outright, because it is equally the normal state of a unit that has not reached its commit yet, and `josh run:preflight` already owns that question.

**Which way an error falls is the design.** A live unit booked as stopped has its working work killed; a stopped one booked as alive costs waiting. So a trace that could not be read answers `undetermined` rather than `stopped`, and a `--process` nobody gave is an unasked question rather than an answer of "no process".

**Output that moved answers `alive` on its own; a live process does not.** Growth in the transcript needs nothing else to mean what it says, so it is read first. The process trace is read _after_ the unreadable check instead, because a `pgrep` scoped a shade too wide answers `alive` on a machine running several kit projects at once — and read ahead of an output path that resolves to nothing, it would answer `alive` on every poll forever, with no `undetermined` for the two-in-a-row rule below to count. A live process decides between a long check and a stop once every trace has answered, and never papers over one that did not.

**The output read follows the symlink, and compares the size as well as the timestamp.** A unit's transcript path is a symlink, and a link's own modification time never changes after it is created — so the shell's `stat`, which does not follow a link by default on macOS, reports that creation time whether the unit is alive or dead. `--window` (30 minutes by default) is the window the file must have been silent for, and `--gap` (5 seconds) is how far apart the two samples are taken; growth between them is what says the unit is writing.

**`--output` must be absolute, and under the home or temp directory.** A relative path would resolve against whatever directory the caller happened to run from, and this command is routinely asked about a different checkout from the one it runs in — so a relative path is refused rather than resolved. The roots are where a unit's transcript actually lives: the agent harness writes into the user's own data directory or the OS temp directory, and a test into the temp directory. The argument is composed by an agent rather than typed by a person, so a `stat` that could be pointed anywhere would be an existence oracle for the whole file system. Anything refused answers `undetermined` rather than a stop invented from a file that was never read.

**The temp directory means more than `os.tmpdir()`, and every root is matched in both of its spellings** ([#1501](https://github.com/joshuafolkken/kit/issues/1501)). `os.tmpdir()` honors `TMPDIR`, which on macOS names a per-user `/var/folders/…/T` — so a harness writing under `/tmp` lands somewhere it never names, and `/tmp` is listed beside it **on POSIX only**. Windows contributes `os.tmpdir()` again instead, because a rooted `/tmp` there resolves against the current drive and would admit everything under `C:\tmp` — a root nobody declared, on the one platform where `os.tmpdir()` already is the whole answer. Each root is then also matched through its resolved path, because `/tmp` is a symbolic link to `/private/tmp` on macOS and `/var` one to `/private/var`, while the containment test resolves no link: without it a transcript at `/private/tmp/…` is refused, every poll answers `undetermined`, and the parent cannot detect a stopped unit at all — the unbounded stall this command exists to remove, reappearing inside its own path check. The candidate path is normalized rather than resolved, because in the "resolves to nothing" case there is nothing to resolve and that case has to stay unreadable.

**The process trace is the one input the command does not read for itself.** A scan matching too little books a live unit as stopped; one matching too much never detects anything. So the caller runs `pgrep -laf` against the checkout it handed the unit and passes `--process alive` or `--process none`.

**An open child that is not parked is not `settled`, even without `in-progress`.** That label is applied by the unit itself once it has read the issue, so a unit that stopped before applying it would otherwise be reported as a child needing nothing — and the stop would go undetected exactly as it did before. Only a closed child, or one carrying `needs-decision`, is settled.

**Two `undetermined` answers in a row is a fault in the check rather than a slow unit.** The output path can be wrong, rotated, or never created, and read that way every poll answers `undetermined` forever. The caller stops polling on the second one and reports it; it is never escalated to a `stopped`, because nothing was read. Both durations are whole and positive for the same reason — `--window 0 --gap 0` would call any unit that is not writing at that instant frozen.

The loop that asks it, and what each answer does there, is `.claude/skills/workflow-commands/epicrun.md` → "A delegated unit that stopped without reporting".

### `josh run:progress`

Report an unattended run's progress once it has gone quiet for an interval ([#1520](https://github.com/joshuafolkken/kit/issues/1520)).

```bash
pnpm josh run:progress --output ~/.claude/projects/<project>/<session>.jsonl   # alias: josh rg
pnpm josh run:progress --mark                       # a real report just happened; restart the clock
pnpm josh run:progress --once                       # one line now, whatever the clock says
pnpm josh run:progress --wait                       # wait out one interval, print one line, exit
pnpm josh run:progress --interval 20 --repo joshuafolkken/app-kit --hours 4
```

**This is the one josh command meant to be started and left running.** Every other one answers once and the caller's own loop drives it. That shape was rejected here deliberately: a parent that waits and reports spends one of its own turns per heartbeat — 36 of them in a three-hour run, taken at the point its context is largest and most expensive. The loop lives inside the command, an agent starts it in the background, and all the agent does with what appears is put a label in front of each field and close with the next report time — the presentation rule in `.claude/skills/workflow-commands/epicrun.md` → "Progress while the run is quiet", which changes no value the command printed.

**`--wait` is that loop with an exit at the end, and it exists because relaying "what appears" is not always possible** ([#1576](https://github.com/joshuafolkken/kit/issues/1576)). A harness that delivers a background command's standard output only **when that command exits** — Claude Code is one — relays nothing at all from a process built never to exit, and `epicrun #1474` was measured at 2h36m of silence with children in flight. So `--wait` waits the same clock out, prints one line and returns, and the caller starts the next one when it does. **The clock is still this command's**: the record `--mark` writes is re-read on every tick, so a real report elsewhere pushes the next line out, and two of these cannot double-report because the first to print records it. `--hours` bounds it the same way — a wait that outlives the bound reports nothing and exits 0. **A tick that finds nothing in flight does not end it either**: the caller is told to restart it the moment it exits, so returning on a quiet repository would turn the pair into a poll rather than a heartbeat.

**The trigger is silence, not a clock.** The interval is measured from the last report of _any_ kind, so a line never lands immediately behind a real one. `--mark` is how a run tells the clock that a real report happened; it is a single cheap call at the points a run already reports, and it is honoured even while reporting is switched off, so the clock stays true either way. A tick that printed nothing does not move the clock, so the first child to appear is reported at once instead of waiting out an interval the repository spent idle.

**Standard output carries the progress line and nothing else**, the way `run:liveness` keeps its verdict there — a relaying agent should never have to tell a report apart from an explanation. Notices go to standard error.

**It cannot send a Telegram, and that is structural rather than a promise.** Nothing the command is built from imports `scripts/git/telegram-notify.ts`, which is the only egress there is. A heartbeat every twenty minutes on a phone is notification fatigue, and it would cheapen the `confirmation` and `completion` messages that do need to interrupt someone.

**The line reports no verification result, because it reads none.** No gate conclusion, no CI conclusion, no check rollup. What it says about a pull request is that one exists and what state GitHub calls it, which is a read it performs — printing a result nobody read is the failure this repository keeps relearning.

The fields, in order:

| Field                                                 | What it says                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at <YYYY-MM-DD HH:MM±HH:MM> / <YYYY-MM-DDTHH:MM>Z`   | When the observation was taken, with its date, on the local clock and in UTC. It leads the line because it is the field that says whether anything after it is still about now, and it is **beside** the elapsed figures rather than instead of them: a relative figure means something only while the reports keep coming, and a session suspended overnight read its own `quiet 11m` as if no time had passed ([#1560](https://github.com/joshuafolkken/kit/issues/1560)). The date is carried because that happened across a day boundary. **The local half leads and UTC is printed beside it, with the offset that places both** — UTC alone made every stamp a number a reader on another zone had to convert first, while dropping UTC would cost what it was pinned for: the line is relayed to other machines and read in cloud sessions, and [#1245](https://github.com/joshuafolkken/kit/issues/1245) already paid for a timestamp rendered in the reader's zone making one process look like a stranger                                                                                                         |
| `quiet <m>`                                           | How long since the last report of any kind — the silence this line is breaking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `#<N> <labels> PR:<state>`                            | One per child in flight, from the same `in-progress` listing `epicrun` sizes its lanes from, with `none` / `open` / `merged` / `closed` for its pull request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lanes <N>:<state>`                                   | The open lanes, or `none`; `open` / `stranded` / `unreadable` as `lane:list` reports them. **These are this checkout's lanes, and `--repo` does not move them** — a work tree is local to the machine, so pointing the children at another repository leaves the lanes, the load average and the transcript sample reading the one you are sitting in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `load <n>`                                            | The one-minute load average, which is what actually bites when several lanes run at once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `record +<m>`                                         | How long since the newest `--output` transcript last grew — the field that says a run may be stuck rather than merely slow. `unread` when no path was given or none could be sampled, never a guess                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `unchanged <m>`                                       | How long the children and lanes have been identical. The load average and the record age are deliberately excluded from that comparison: both move on every tick, and including either would make `unchanged` impossible to reach                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `next <YYYY-MM-DD HH:MM±HH:MM> / <YYYY-MM-DDTHH:MM>Z` | When the next line is due if the silence holds — one interval after the observation, written the way the `at` stamp is written ([#1726](https://github.com/joshuafolkken/kit/issues/1726)). **It is a schedule, not an observation**: it holds only while nothing else reports, and a real report arriving first restarts the clock through `--mark` and supersedes it. **The interval it is built from is the resolved one** — `--interval`, then `JOSH_PROGRESS_INTERVAL_MINUTES`, then `josh.progress_interval_minutes`, then twenty — read through `resolve_interval_ms` rather than counted again here, so the printed schedule and the clock the watcher consults cannot be two different numbers. It closes the line because it is the one field about a moment that has not happened yet, and it is printed on both forms: `--wait` and `--once` share the emitter. **It exists so that no run has to derive it.** The rule used to ask the presenting agent for the `at` stamp plus the interval; one report reached a person as `20:1x`, placeholder digits and all, while both inputs were already the command's |

**Why twenty minutes.** Five was measured in live use on 2026-09-07 and 6 of 15 reports carried no changed number at all — the same information as silence, and the "still running" line this command exists not to print. Ten was the next default and was still short of a stage change on a child that measures 20–46 minutes, so the default is twenty ([#1570](https://github.com/joshuafolkken/kit/issues/1570)): one to two reports per child, each of which has a stage change in it — implementation, commit, pull request, review, merge — rather than a run of lines saying what the last one said.

| Setting                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_PROGRESS_INTERVAL_MINUTES` | The silence interval in minutes. Default 20. Anything that is not a positive number falls back to the default rather than throwing — this runs unattended, and dying on a typo in an optional setting removes the reporting the setting was there to tune. `--interval` outranks it                                                                                                                                          |
| `josh.progress_interval_minutes` | The same interval, in `package.json` and so committed with the repository — read one step below the environment variable, which still outranks it. It is what makes a cadence reach another machine or a cloud session at all: `.env` is never committed, so a setting kept only there is the default everywhere else ([#1576](https://github.com/joshuafolkken/kit/issues/1576)). Unusable values fall through the same way |
| `JOSH_PROGRESS=0`                | Reports nothing at all. `--mark` still records, so switching reporting back on does not inherit a stale clock                                                                                                                                                                                                                                                                                                                |
| `--hours`                        | How long the watcher lives before it exits on its own. Default 8, the same expiry `run:hold` uses: longer than any run, short enough that one abandoned by a crashed session is gone by the next working day                                                                                                                                                                                                                 |

**A repository with nothing in flight is told apart from one whose listing could not be read.** Under `--once`, no child carrying `in-progress` prints nothing and exits 0 — that is an answer — while a listing that could not be read prints nothing and exits 1, the same fail-closed reading `run:hold` and `run:liveness` give an unreadable record. **The watcher has nowhere to exit to, so it says the reason on standard error instead**, once per streak rather than once per attempt: a condition lasting an afternoon costs one line, and a watcher that swallowed it would look exactly like an idle repository.

**A tick that reads nothing does not end the watcher, and does not spin either.** Every reading it makes spawns a process or touches the temp directory, so one `git worktree list` that cannot fork under load — the load this command exists to report — would otherwise take the reporting down for the rest of the run, with nothing waiting on it to notice. The failure is reported on standard error and the loop continues. A declined tick leaves the report clock alone, so the first child to appear is still reported at once, but it does set a **two-minute read cooldown**: without one, an idle or failing repository would be re-read every 30 seconds for eight hours, which is enough calls to start causing the unreadable listings it is handling.

**The interval is enforced against the run's own reports too, not only against this command's lines** ([#1570](https://github.com/joshuafolkken/kit/issues/1570)). `is_due` keeps the watcher's own heartbeat off the heels of a real report, and it said nothing at all about a parent that armed a wait timer and then wrote a report in prose — which is how a fifteen-minute setting produced reports 3–5 minutes apart, two timers running at once after one was armed on the turn a timer fired and again on the turn a child's completion woke the run. The `early-heartbeat` row of `josh rule:guard` refuses the `Bash` call that arms such a timer, reading this command's own last-report record and the same `JOSH_PROGRESS_INTERVAL_MINUTES` this command reads. `--once` is untouched: an explicit ask is not a heartbeat.

Who starts it, and when, is `.claude/skills/workflow-commands/epicrun.md` → "Progress while the run is quiet".

### `josh lane:open` / `josh lane:close` / `josh lane:list` / `josh lane:prune`

Open and close a lane: one linked git work tree with its own branch and its own port seed ([#1490](https://github.com/joshuafolkken/kit/issues/1490)).

```bash
pnpm josh lane:open 1490    # prints the lane directory on standard output; alias: josh lno
pnpm josh lane:close 1490   # alias: josh lnc
pnpm josh lane:close --all
pnpm josh lane:list         # alias: josh lnl
pnpm josh lane:prune        # alias: josh lnp
```

**`lane:open` prints the directory and nothing else**, so `dir=$(pnpm josh lane:open 1490)` is what a caller needs, and a refusal is an empty capture beside a non-zero exit. Every explanation goes to standard error, the contract [`josh run:hold`](#josh-runhold--josh-runrelease) and [`josh epic:next`](#josh-epicnext) already set.

**A lane is cut from `refs/remotes/origin/<default>`, never from the local default branch** ([#1535](https://github.com/joshuafolkken/kit/issues/1535)). The bare name would resolve to `refs/heads/<default>`, and nothing in this workflow advances that ref: merges happen on GitHub through [`josh followup`](#josh-followup), and a repository whose default branch is checked out in no work tree never receives the fast-forward — so the local branch falls one commit further behind on every merge and a lane opened from it starts without the work that was just merged. The remote-tracking ref is fetched first and read after; where the fetch fails, the lane still opens from that ref as it stands, and where there is no remote-tracking ref at all — a fresh `git init`, a clone with no `origin` — the local branch is the answer. The branch is created with `--no-track`, so the lane's own `git push` cannot inherit an upstream aimed at the default branch.

**A branch of the lane's name that already exists is attached to, never cut afresh** ([#1627](https://github.com/joshuafolkken/kit/issues/1627)). `<N>-lane` outlives its lane whenever a child was parked after pushing, and `lane:close` deletes the local branch while the remote one and the pull request stay — so `lane:open <N>` is the resume path, and it decides between three answers with no judgement in it. A **local** `<N>-lane` gets the work tree attached to it, with neither `-b` nor `--no-track` passed, so the branch keeps the commits and the upstream it already had. With **no local branch**, the remote itself is asked — `git ls-remote --heads origin refs/heads/<N>-lane`, never the remote-tracking refs, which nothing in the lane lifecycle prunes: `lane:close` deletes the local branch, GitHub deletes the remote one at the merge, and `refs/remotes/origin/<N>-lane` outlives both (this repository carried sixteen such refs). **The pattern is the full ref path rather than the bare name** ([#1709](https://github.com/joshuafolkken/kit/issues/1709)): `ls-remote` matches a pattern against the tail of a ref at a slash boundary — and `--heads` limits which refs are considered, not where inside one a match may fall — so `<N>-lane` answered for `refs/heads/wip/<N>-lane` too, and the lane was told origin had a branch it then could not fetch. Where the remote still has the branch, it is fetched and the local branch created from it, so the lane starts at the tip rather than at whatever the checkout last saw; where the remote has deleted it, the stale ref is refused and the lane is cut from the default branch. **A remote that cannot be reached is a third answer, not the second**: the ref is used as it stands and standard error says it could not be refreshed, because cutting a fresh branch over pushed work while offline is the very failure this replaced. With **neither branch anywhere**, the lane is cut from the default branch exactly as before. **The reuse is printed on standard error**, naming the branch and where it came from, because a lane starting on somebody's pushed commits is not the lane a fresh open produces. **Nothing deletes a branch to simplify the call**: the two failure modes this replaced were `fatal: a branch named '<N>-lane' already exists`, which at least stopped, and — once `lane:close` had run `git branch -D` — a silent fresh branch of the same name that orphaned the pushed commits and the open pull request with no error anywhere.

**Port separation is the reason this command exists, not a detail of it.** `PORT_SEED` is read from the project root's uncommitted `.env`, and `ports/index.js` resolves that root as the nearest ancestor holding a `package.json` — which, inside a linked work tree, is the lane's own directory. So a lane with no `.env` runs on seed 0 and a lane handed a verbatim copy runs on the root's seed; either way every lane lands on one pair of ports, and a busy port **fails on the spot rather than retrying on another**, which is the behavior `playwright.config.ts` documents and which nothing here weakens. `lane:open` therefore copies the root `.env` — `TELEGRAM_*`, `JOSH_SESSION_LANG` and everything else carried across verbatim — with the `PORT_SEED` line replaced by the lane's own.

**The main work tree is always seat 0.** Lanes are numbered from the project's base seed **upward**, so a checkout that never opens one keeps exactly the ports it has today, and CI — one work tree, no `.env` — stays on 5173 / 4173.

**Every seed stays under 1000, and that is structural.** dev is `5173 + seed` and preview is `4173 + seed`, so the two bases are exactly 1000 apart and one project's preview port equals another project's dev port as soon as their seeds differ by 1000. The band is **base+1..base+9** — nine seats against a default of six lanes — and the way to spend the space is one base seed per project on a multiple of ten, which leaves room for a hundred projects inside the limit. **A base whose band would reach 1000 fails with an error naming what to set**, and a band with every seat taken fails too: the numbers are never wrapped, because wrapping is that same collision under a friendlier name.

**The free seat is read from the live lanes' own `.env`, never from a counter.** A monotonic counter, or a number derived from how many lanes have ever been opened, hands a closed-and-reopened lane the seat a running lane is still using. `lane:open` reads `git worktree list --porcelain`, reads the `PORT_SEED` of each lane it finds and takes the lowest unused seed in the band — so **the state lives only in each lane's `.env`**, and `git worktree remove` erases the record of a seat along with the tree that held it. There is no ledger file, and nothing that can go stale.

**A live lane whose `.env` cannot be read stops the allocation** rather than being passed over. Read as free, its seat would be handed to the next lane while the ports it holds are still bound — a collision nothing reports until an E2E run fails in a different work tree. The refusal names the lane and its directory; `lane:list` shows it as `unreadable`.

| Setting               | What it does                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JOSH_LANE_ROOT`      | Where the lanes go. Unset or blank means `.<repository-name>-lanes`, a hidden **sibling** of the repository root — a lane is a second full checkout, so nesting it inside would hand the lint run, the unit suite, the spell check and `git status` a duplicate of the tree they are walking        |
| `JOSH_LANE_SEED_BASE` | The seed lanes are numbered from. Unset or blank means this project's own `PORT_SEED`. Set it, to a free multiple of ten no higher than 990, only when the nine seeds just above this project's are already taken by another project                                                                |
| `JOSH_LANE_LIMIT`     | How many lanes one repository may run at once. Unset or blank means **6**; an invalid value is a hard error rather than a silent 6. It is a ceiling rather than a prediction, and [`josh epic:next`](#josh-epicnext) is what applies it ([#1491](https://github.com/joshuafolkken/kit/issues/1491)) |

**Closing is written for the states a lane is actually closed in.** A park, a failure or an interruption leaves uncommitted and untracked work in the tree, so `worktree remove` is forced and the branch is deleted with `-D`; a lane git never registered is still closed, because the issue number implies both paths. `lane:close --all` closes every one of them, and **`lane:prune` closes the lanes an interruption left registered without a work tree** — the route out of a directory someone deleted by hand.

`lane:list` prints one line per lane: the issue, its seed and the dev and preview ports that seed resolves to, its branch, its state (`open`, `stranded` or `unreadable`), its directory, and the output path the lane records (`output -` where it records none). The ports are computed through `ports/index.js` rather than added up separately, so they are the numbers [`josh port`](#josh-port) and `playwright.config.ts` will resolve inside the lane.

**This command installs the lane's dependencies, because a lane without them is not a lane yet** ([#1554](https://github.com/joshuafolkken/kit/issues/1554)). A linked work tree starts as a checkout and nothing else, and the lane root is a hidden _sibling_ of the repository, so nothing above it resolves either — until this ran, the first `pnpm josh …` typed inside a fresh lane failed with `tsx: command not found`, every lane, every time. Filling it used to belong to whoever opened it, which made it a step nothing enforced. It is `pnpm install --frozen-lockfile` in the new work tree: the lane is cut from `refs/remotes/origin/<default>` and has to build exactly the lock committed there, so a lock the install would rather rewrite is a finding rather than something to absorb silently into six parallel lanes.

**An install that fails fails the whole command**, rather than warning and handing the directory over anyway. A lane reported as opened is a lane the caller captures and types the first `pnpm josh …` into, so a warning would buy nothing but a success line printed above the same failure. The work tree is left where it is, because both ways out need it there and the message names them: run `pnpm --dir "$dir" install --frozen-lockfile` against it, or take it away with `lane:close`.

**The verdict is the exit code and only the exit code.** `pnpm install` runs `prepare`, and with it the lefthook installer, which in a linked work tree warns that the hooks belong to the primary repository — expected and correct there ([#1503](https://github.com/joshuafolkken/kit/issues/1503), [#1507](https://github.com/joshuafolkken/kit/issues/1507)), and never read here as a failure. The child's output is captured rather than inherited, so standard output still carries the directory and nothing else, and it is printed — on standard error — only when the install failed. **The run is bounded at ten minutes**: about 3.5 s of it is a warm pnpm store hard-linking, but a first run or one after a dependency change goes to the network, and a registry that never answers has to end `lane:open` instead of holding a parallel run open with nothing printed.

**What this command does not decide** is how many lanes may be open at once — that is `JOSH_LANE_LIMIT`, applied by [`josh epic:next`](#josh-epicnext) ([#1491](https://github.com/joshuafolkken/kit/issues/1491)) — or how `epicrun` drives them, which is [`epicrun.md`](../.claude/skills/workflow-commands/epicrun.md) → "Lanes — running more than one child at a time" ([#1492](https://github.com/joshuafolkken/kit/issues/1492)). **The limit and the nine seats are separate bounds**: the seats are structural and the limit is the one a person tunes, so a limit raised past nine fails at `lane:open` rather than here.

#### `josh lane:output`

Record — or read back — where the delegated unit running this lane's child writes ([#1713](https://github.com/joshuafolkken/kit/issues/1713)). Alias: `josh lnv`.

```bash
pnpm josh lane:output 1713 /abs/path/to/agent-7.jsonl   # record it; prints the path back
pnpm josh lane:output 1713                              # read it; prints the path, or `none`
unit_output=$(pnpm josh lane:output 1713) &&
  pnpm josh run:liveness 1713 --output "$unit_output" --process none
```

**This is the one fact about an in-flight lane that only the dispatching session held.** Claude Code names a unit's output file after that session's own id and the unit's, and neither is written anywhere on disk — so a session that did not open the lane could not poll its child, and [`josh epicrun`](#josh-epicnext)'s hand-off had to **drain** the pool first: no new lane opened until every in-flight one had finished, six seats decaying to zero over as long as the longest child still running. Recorded here, the next session polls a lane it never opened and the drain is gone.

**The record lives in the lane's own `.env`, beside its `PORT_SEED`.** That is the store [`josh lane:list`](#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune) already reads, it is gitignored in kit and in every consumer `josh sync` reaches, and `git worktree remove` erases it along with the lane it described — so there is no ledger to keep in step and nothing that can outlive what it describes. The value is written quoted, because a path may hold a space or a `#` and every dotenv reader cuts an unquoted value at the latter.

**A path that could not be polled is refused rather than recorded, by [`josh run:liveness`](#josh-runliveness)'s own containment test rather than a second copy of it.** That command reads only an absolute, normalized path under the home or temp directory and answers `undetermined` — "could not read" — for anything else, so a lane recorded with one would poll as indeterminate for ever instead of saying the record was wrong. A lane whose `.env` cannot be read is refused too, and deliberately not replaced: the same file carries the lane's port seat, and a fresh one holding only this record would put the lane back onto the main work tree's own ports.

**`none` prints on standard output and exits non-zero**, unlike the `none` of `lane:list` and `lane:close`. The lane is open and its child simply has not been handed over yet — but the reader here is a command substitution, and `--output none` is a relative path `run:liveness` answers `undetermined` for, so a lane polled that way says "could not read" for ever instead of the missing record being reported. The non-zero exit is what stops the `&&` above before it gets there. `epicrun` reads that state exactly as it reads an `unreadable` lane — nothing to poll, so the session is not cut — and never as an idle lane.

### `josh cost`

Report what a run actually spent, read from Claude Code's own session transcripts ([#962](https://github.com/joshuafolkken/kit/issues/962)).

```bash
pnpm josh cost                  # the newest session — the run that just finished; alias: josh co
pnpm josh cost --session <id>   # one named session
pnpm josh cost --issue 962      # one issue, across every session that touched it
pnpm josh cost --all            # every issue in this project, plus a grand total
pnpm josh cost --json           # the same figures, machine-readable
```

[`josh epicrun`](#josh-epicnext)'s budget guard needs a number it can cite, and until this command there was no way to produce one — nothing read the `usage` Claude Code records for every request, so "did that change make a run cheaper?" had no answer at all.

**A cost is not tokens times one rate.** The four kinds of input are priced differently, and this is not a rounding difference:

| Kind                      | Price         | Why it is kept apart                                                                          |
| ------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| Uncached input            | base          | The rate the others are multiples of.                                                         |
| Cache write, 5-minute TTL | 1.25x base    | The default TTL.                                                                              |
| Cache write, 1-hour TTL   | **2x base**   | What this project's sessions use — folding it into the 5-minute rate under-reports every run. |
| Cache read                | **0.1x base** | Where nearly all of a long session's input lands.                                             |
| Output                    | 5x base       | Priced from the model's own output rate.                                                      |

Measured on one real request: `cache_read_input_tokens` 97,190 against `input_tokens` 2. An estimate that picked any single rate would be wrong by more than an order of magnitude.

**One API response is written to the transcript as several lines** — one per content block, all carrying the _same_ `usage` object. Measured: 20 assistant lines for 8 requests. The unit of aggregation is therefore `requestId`, never the line; summing lines over-reports a real session by roughly 3x.

**A delegated unit's transcript is read too, and it is not beside the session's** ([#1285](https://github.com/joshuafolkken/kit/issues/1285)). `epicrun` and `queue` run every child in a delegated unit, and `gate-fix` / `survey` delegate one step of a run; each unit writes to `~/.claude/projects/<slug>/<session-id>/subagents/agent-<agentId>.jsonl`, a subdirectory of the session that delegated it rather than a file beside it. Listing only the session files therefore reported a whole batch as the parent's wait: epic #1272's four merged children each printed as "CI wait only", and `--all` under-counted the same corpus by 13,953 requests / $2,549 against 32,254 / $4,131. The discovery is **one walk** — `cost-transcript.ts`'s, shared with [`josh time`](#josh-time) — so neither command has a second idea of where a transcript lives. A unit is named `<session-id>/agent-<agentId>` and `--session` accepts that form; **the no-argument scope still means the session**, because a unit is part of a run rather than a run of its own and it writes the newer file whenever a session delegates.

**Billed input is split into resident and history.** The resident baseline is the first request's whole input — system prompt, tool schemas, `CLAUDE.md`, the skills index — because that is what was in context before any work happened, and every later request re-reads it. What the run paid for the resident half is that baseline times the request count; the conversation is the remainder. It is an estimate and says so, but the two shares reconstruct the billed input exactly, so a reader can check it.

**The resident block is decomposed, and the history with it** ([#1151](https://github.com/joshuafolkken/kit/issues/1151)). Measuring the resident block is not decomposing it: 51,782 tokens per request was a known figure for months while nobody could say how much of it was `CLAUDE.md`, so "where would trimming help" was a guess rather than a reading. Two tables answer that, printed on the whole-session scope only — both are read from one transcript's own lines, and an issue's slice or a `--all` corpus has no single session to read them from. `--json` carries the same figures under `measurement`, so another run consumes them instead of writing a script.

```
Resident breakdown (baseline 51,735 tok, measured; rows estimated):
  CLAUDE.md                                                57,841 B     19,287   37.3%
  skills index (frontmatter)                                2,148 B        716    1.4%
  UserPromptSubmit hooks                                    1,019 B        340    0.7%
  harness: system prompt, tool schemas, MCP instructions                31,392   60.7%
  MCP servers declared (svelte) load their tool schemas and instructions
  on every request; both are served by the server, so they sit inside the harness row.

Context composition (blocks written to this session's transcript; estimated except thinking):
  tool_result                           116       67,245   42.9%
  Bash command bodies                   109       28,673   18.3%
  thinking                                        42,438   27.1%  (measured)
  text                                   11       13,477    8.6%
  tool_use inputs (excl. Bash bodies)   116        4,781    3.1%
  total                                          156,614
```

**The transcript cannot decompose the resident block, and the report does not pretend otherwise.** Claude Code writes no system prompt and no tool schemas into the transcript, so the only honest decomposition is from the other side: size the parts the repository itself controls, and report the difference from the measured baseline as **one named remainder** rather than distributing it over the rows that could be measured. The baseline is the only measured figure in that table, and the remainder absorbs the estimator's error instead of hiding it. The skills index is sized from each `SKILL.md`'s frontmatter and not its body — Claude Code lists a skill by name and description, and counting the body would price an on-demand file as resident and report the whole skill split as having achieved nothing.

**Tokens are estimated with two terms, not one bytes-per-token ratio.** A single ratio is wrong by a factor of three across this project's own content: English markdown runs about 3 characters per token while Japanese runs about one token per character at 3 bytes each. Both constants were calibrated against this repository's transcripts, at the one place where a real count sits beside real text — an assistant response whose content is only `text` blocks and whose `thinking_tokens` is 0, where `output_tokens` is the count of exactly that text. A least-squares fit over 238 such responses put the wide-character coefficient at 0.991 tokens. The ASCII term is taken from the one clean reading in that set — the responses that are almost entirely ASCII, at 2.97 characters per token. The other two readings are denser (2.12 from subtracting the wide term across the whole set, 1.8–2.6 from how the baseline moved as `CLAUDE.md` grew) and each is denser for a reason that does not apply to a document like `CLAUDE.md`: the first measures markdown scaffolding embedded in Japanese, which tokenizes far denser than prose, and the second attributes to `CLAUDE.md`'s bytes the tokens of every other resident surface that grew in the same commits. **The residual error therefore runs one way**: if 3 is too generous, the rows sized from repository files under-count and the difference falls into the harness remainder, which is an upper bound on what cannot be decomposed and the sized rows a lower bound on what can. **Thinking is the one row that is not estimated**: its text is never written to the transcript, so the count comes from the API's own `thinking_tokens`.

**The sized rows are read from the working tree, not from the session.** `CLAUDE.md`, the skills index and the hook commands are measured as they are on disk now, while the baseline belongs to whichever session is being reported. On the newest session — the default — the two agree; on an older `--session <id>` they can differ by however much those files have changed since, and the harness remainder silently absorbs the drift.

**The resident budget is now held in tokens as well as bytes.** `scripts/workflow-skills.test.ts` caps each AI document at `RESIDENT_CEILING_BYTES` with `RESIDENT_HEADROOM_BYTES` to spare; the token pair is **derived** from those two rather than chosen beside them, so for pure ASCII — one byte, one character — the two are the same limit rather than two limits to reconcile. That is what "does not contradict the byte ceiling" has to mean, and it is a second _unit_ rather than a second, tighter guard. The two differ only where a byte buys a different number of tokens: every non-ASCII character costs one token, so a two-byte one costs a token per two bytes against ASCII's three and the token ceiling binds first, while a four-byte one costs a token per four and the byte ceiling does. Japanese, at three bytes per character, lands exactly on the conversion, and there the two ceilings coincide.

**Resident this project does not use is recorded rather than removed.** `.mcp.json` declares the `svelte` MCP server, whose tool schemas and server instructions load on every request although kit is a tooling package with no Svelte source. The report names the declared servers and places them inside the harness remainder, which is the granularity the data supports — the schemas are served by the server, so nothing in the repository can size them. **The file is deliberately not forked into "kit's own" and "what consumers get":** `josh init` copies `.mcp.json` into consumers, the consumers of `@joshuafolkken/app-kit` and `@joshuafolkken/game-kit` are SvelteKit apps for which the server is correct, and kit is the source of what it distributes — a local copy that differed from the distributed one is the drift `josh sync` exists to prevent, and it would stop kit's own runs from exercising the file consumers receive. The lever that actually removes the cost for one project is Claude Code's own per-project MCP enablement, which is personal and uncommitted, so it can be switched off here without changing what ships. The two `UserPromptSubmit` hooks are the other per-request surface the repository controls, and they are used: they inject 1,019 bytes into every user turn and appear as their own row.

**Attribution to an issue reads the branch.** `josh git` names a branch `<N>-<slug>`, so the branch carries the issue number — but a child is implemented on the default branch, because `josh git` only creates the branch at commit time. A request made on the default branch is therefore attributed to the nearest issue branch that appears **later** in the same session, falling back to the nearest earlier one for the tail after a merge. Attribution is per session: concatenating sessions first would let one session's trailing branch claim the next session's opening requests.

**The project's transcript directory is its working directory as a slug** — every character that is not a letter, digit or hyphen becomes a hyphen, so `~/Development/my_project` reads from `-Users-…-Development-my-project`. Verified against a real probe: a directory named `slug_probe.dir` produced `slug-probe-dir`.

**`--over <tokens-per-request>` answers a hand-off question instead of printing a table.** It prints `over` or `under` on stdout and the measured figure on stderr, comparing the session's billed input divided by its request count against the limit. Per request rather than in total, because the total only says the session was long — the ratio says what the _next_ turn will cost, which is what a hand-off decision turns on. `epicrun` uses it after a merged child ([#968](https://github.com/joshuafolkken/kit/issues/968)); measured across one run of six children in one context, the figure went from 222k during the first child to 645k during the sixth. [#1212](https://github.com/joshuafolkken/kit/issues/1212) narrowed it to a child that ran in the parent's own context, on the ground that delegated children add only 4,000–5,000 each; **[#1567](https://github.com/joshuafolkken/kit/issues/1567) removed that narrowing**, having measured a parent that delegated every child and still billed $0.241 a request against its children's $0.080, on 361,833 cache-read tokens a request across 732 requests. The child summaries were the smallest of the five things accumulating in that parent — the executing side's own prose was 27.9%, tool results 25.2%, thinking 21.6% — so a gate conditioned on them alone never fired. **It is now asked after every merged child, and `over` stops the session and asks the person to cut it** — the lanes still in flight are handed over rather than waited on, because each one records where its unit writes ([`josh lane:output`](#josh-laneoutput), [#1713](https://github.com/joshuafolkken/kit/issues/1713)) and the next session polls them from [`josh lane:list`](#josh-laneopen--josh-laneclose--josh-lanelist--josh-laneprune). The one reading that does not stop is a lane nobody could poll — `unreadable`, or `open` with no recorded path — in which case the run records the reading and asks again at the next merge. The resume command is printed at the stop. **[#1605](https://github.com/joshuafolkken/kit/issues/1605) moved the threshold to 150,000 and widened where it is asked**: `fullrun` and `halfrun` had never asked it at all, and 400,000 was drawn against one `epicrun`'s band rather than theirs — measured over 223 recorded sessions with the definition this flag uses, only 4 of them (2%) ever exceeded 400,000, while the first request of a session, carrying the resident preamble alone, has a median of 54,974. 150,000 is the lowest candidate at which none of the measured sessions is cut before its first run has finished, and it leaves the median session five runs before the cut against 400,000's six. It is now also asked at the **entry** of a `fullrun` or a `halfrun`, beside `josh run:hold`, where `over` stops the run before it has filed, branched or edited anything. The threshold itself lives in [`epicrun.md`](https://github.com/joshuafolkken/kit/blob/main/.claude/skills/workflow-commands/epicrun.md) → "The hand-off", which is the single source of when it is asked and what is done with the answer.

**Nothing is ever silently zero.** An absent transcript exits non-zero and says where it looked — for every scope, `--all` and `--issue` included; a scope with no requests attributed says so in words rather than printing a table of zeroes; a model the price table does not know is reported as unpriced and the total is labelled a floor; and lines that could not be read are counted and printed. Locally generated `<synthetic>` assistant messages are skipped — they were never sent to the API, so counting them would inflate the request count.

### `josh time`

Report where a run's wall clock went, read from the same transcripts `josh cost` prices ([#1267](https://github.com/joshuafolkken/kit/issues/1267)) and, for the part no transcript records, from GitHub ([#1268](https://github.com/joshuafolkken/kit/issues/1268)).

```bash
pnpm josh time                  # the most recently merged run — the fullrun that just finished; alias: josh tm
pnpm josh time --issue <number> # one issue's whole run, from the fullrun invocation to the merge
pnpm josh time --session <id>   # one named session on its own
pnpm josh time --epic <number>  # a whole epicrun, child by child, with the per-turn trend across them
pnpm josh time --last <runs>    # the last <runs> merged runs as a distribution — min, median and max per phase and per check
pnpm josh time --period <days>  # the backlog over the last <days> days — lanes, idle, serialization and throughput
pnpm josh time --top <rows>     # cap the per-tool, per-josh-command, segment and per-invocation tables at <rows> each
pnpm josh time --session <id> --instructions  # what the session's loaded rules and procedures weigh, and the model wait they bound
pnpm josh time --json           # the same figures, machine-readable
```

**`--top <rows>` caps the two tables a reader ranks off, and says what it withheld** ([#1301](https://github.com/joshuafolkken/kit/issues/1301)). `--json` carries every row of `by_tool` and `by_josh_command` by default, and an epic pays for both once per child — which is what `diag` reads whole every time it measures a batch. The cap is applied to the record both renderings are made from, so it means the same thing with and without `--json`, and a cut table adds a note — `by_tool: showing the top 5 of 34 rows — 29 withheld by --top` — because a table that silently stops at five reads as though the rest were zero. **Without the flag the output is unchanged, byte for byte**: `josh time` is used for hand investigation as well as by `diag`, and a call that wants the tail must not have been narrowed underneath it. It narrows the row tables only — the four shares, the phases, the round trips and the per-CI-check table are whatever they were — and a non-positive or unparsable value is refused rather than read as "carry every row". `by_check` is left uncapped on purpose: its rows are one per CI job, so cutting them would hide a check rather than a tail. Since [#1311](https://github.com/joshuafolkken/kit/issues/1311) the `segments` and `by_invocation` tables are cut by the same flag and noted the same way — both grow with the length of the run rather than with the number of distinct commands, which is the unbounded growth the cap exists for — and a capped `segments` no longer sums to the elapsed time, which is exactly what its note says. Since [#1387](https://github.com/joshuafolkken/kit/issues/1387) `rework.files` is cut too, for the same reason: it grows with the number of files a run edited, which reaches sixty in one session here. It is ordered dropped-first, so the cut keeps the findings, and the two counts beside it remain totals over what was measured.

**Every merged run now records itself, so the sample accumulates without anyone asking for it** ([#1471](https://github.com/joshuafolkken/kit/issues/1471)). [`josh followup`](#josh-followup) calls the same builder this command uses and appends the run's headline figures — elapsed, turns, tool calls, round trips and the two per-round-trip costs — as one JSON line in `.time-history.jsonl` at the repository root, keeping the newest 200 runs and dropping the oldest. The file is gitignored, so it is per checkout, and a line that does not parse is skipped rather than taking the earlier records with it. It is deliberately **not** a copy of the report: it carries the figures two runs are compared on and nothing else, because the tables are reproducible from `pnpm josh time --issue <N>` and a file that held them would grow without making any comparison possible that these numbers do not already support.

**`--period <days>` reports the backlog rather than one run** ([#1470](https://github.com/joshuafolkken/kit/issues/1470)). Every other scope answers where one run's wall clock went; what actually wants shortening is the time until the backlog is empty, and with several runs in flight that time is not readable from any one of them. It reads `.time-history.jsonl` — the accumulation the paragraph above describes, and the only source, so nothing here measures a second time — and reports, in one table per question: **issues finished per day**, **per-lane busy and idle time** with the effective throughput against the lane count, **the stretches the work serialized on**, each named by the run that held the only busy lane, and **the wall clock another run was hiding** told apart from the wall clock that was exposed with nothing else running.

**Lanes are derived from the wall clock, not read from a field.** Parallel lanes are the subject of [#1473](https://github.com/joshuafolkken/kit/issues/1473) and do not exist yet, so a `lane` column on the run record would be written by nobody; instead the runs are packed, in start order, into the lowest-numbered lane that was free when each began, which makes the lane count exactly the peak number of runs in flight at once. **With nothing overlapping the answer is one lane**, said out loud in the report's notes — the honest reading of a backlog that has only ever been worked serially, rather than a table of empty lanes. Idle is measured against the window the runs themselves cover, first start to last end, because measuring it against the calendar period would price the nights nobody was working as lane idle time. A record written before [#1470](https://github.com/joshuafolkken/kit/issues/1470) added `started_at` / `ended_at` carries no window; it is excluded from the lane table and counted in the notes, never placed at the epoch.

**`--instructions` sizes the rules and procedures a session carried, and bounds the model wait they account for** ([#1477](https://github.com/joshuafolkken/kit/issues/1477)). Twenty-two proposals to trim resident text were frozen by [#1469](https://github.com/joshuafolkken/kit/issues/1469) because nobody could say what trimming would return; this is the reading that answers it. The block lists every instruction document the session read — the set `investigation-reads.ts` already defines, so the two cannot come to disagree about what a rule is — sized from disk, beside the measured resident preamble, and reports what all of it came to as a share of the session's billed input and of its model wait.

**The requests each document rode are counted, not assumed.** A document is charged to the assistant turns that followed the read, so a procedure opened at the halfway mark rides half the run; only a transcript with no message ids to count turns by falls back to charging every request after the first. That distinction is load-bearing rather than tidy: the fallback alone put one `epicrun` parent at **80.7%** of its billed input, which is not a ceiling anyone can decide from. Measured, the same three sessions read **38.6%, 58.2% and 63.8%**, on a resident preamble that is stable near 55,200 tokens and instruction documents totalling 47,000–86,000. The largest single item in all three is `.claude/skills/workflow-commands/epicrun.md` at about 43,600 tokens — on its own more than half of everything one of those runs read.

**The share of model wait is an upper bound, and it is labelled as one.** It carries the token share across unchanged, which assumes latency grows with the prompt in proportion; it does not — output tokens dominate it and a cached prefix is re-read far more cheaply than it is first written — so the true figure is below what is printed. An upper bound is what a decision needs: a small one settles the question without anyone having to agree about the attribution model. These are not small (**690.6 s of 1082.9 s**, **418.8 s of 719.1 s**, **650.2 s of 1685.3 s**), which is the signal to measure the relationship properly before deleting anything. Token counts other than the baseline are estimates, on the same estimator `josh cost` uses for the resident breakdown.

**It reports on one transcript, so it is refused rather than ignored without `--session`.** The share divides one transcript's carried instruction text by that same transcript's billed input; the run scopes assemble spans from several transcripts and never read the usage lines to divide by, so a flag silently dropped there would print a report reading as "this run carries no instruction text" — the one answer that is never true. A delegated unit carries its own context and is measured on its own for the same reason. Off by default, because it re-reads the transcript and sizes every instruction document from disk, which the wall-clock tables need none of.

Every issue filed to make `fullrun` faster has come out of a **hand measurement**: the session record restored by eye, a throwaway script written for that one run, and a classification that differed from the last one. `josh cost` reads what a run was billed and there was nothing on the other axis, so "did that change make a run shorter?" had no answer anyone could compare across two runs.

**The sample below is one run end to end** — `pnpm josh time --issue 1379`, the run that shipped [#1379](https://github.com/joshuafolkken/kit/issues/1379) — so each block can be read against the ones around it: the price the `Bundling:` rows multiply out is the one the `Round trips:` block above them prints, and both divide by the same round-trip count. Blocks pasted from different runs read as one report and cannot be checked at all ([#1395](https://github.com/joshuafolkken/kit/issues/1395)). The segment and per-invocation tables the same invocation also prints are shown further down, on a different run that is named where they appear, and so is the three-window block that now opens every run report.

```
issue #1379 — 27.2 min elapsed
  2 transcript(s)
  PR #1380 merged
  1.2 min of the merge command was waiting on CI — the phase table charges it to `ci`

Where the wall clock went:
  model wait               14.1 min   52.0%
  tool execution           13.1 min   48.0%
  human wait                0.0 min   0.0%
  CI wait                   0.0 min   0.0%

By phase (in run order):
  plan                                not detected
  setup                     0.5 min   1.7%
  implement                 3.6 min   13.4%
  gate                      0.6 min   2.4%
  rework                    5.8 min   21.2%
  review                    6.9 min   25.3%
  pr                        0.9 min   3.3%
  wrapup                    1.3 min   4.6%
  ci                        1.2 min   4.3%
  merge                     0.8 min   2.8%
  wait                      0.0 min   0.0%
  wait-outside              0.0 min   0.0%
  pre-run                   4.8 min   17.6%
  post-run                  0.9 min   3.3%
  other                     0.0 min   0.0%

Round trips:
  tool calls                    108   over 156 turn(s)
  round trips                   101   1.07 calls per round trip
  batched turns                   7   94 single-call turn(s)
  cost per round trip        15.9 s   model wait 8.1 s
  ⚠ independent calls are going out one per turn (floor 1.50 calls per round trip)

Model gap per round trip:
  model gap                   3.8 s   min 0.0 s · p90 14.8 s · max 189.5 s

Longest model gaps (descending):
  01:30:49 → 01:33:59       189.5 s   pre-run · 11.6% of elapsed
  01:42:57 → 01:43:42        44.3 s   rework · 2.7% of elapsed
  …

Bundling:
  bundleable sequences           15   longest 8 turn(s)
  recoverable round trips        25   24.8% of 101 round trip(s)
  recoverable wait          3.4 min   at 8.1 s model time per round trip
  recoverable by tool             3   25 of 25 attributed
    Edit                         13   in 7 sequence(s)
    Bash: grep                    9   in 6 sequence(s)
    Read                          3   in 2 sequence(s)

Single checks:
  single checks                   8   6 in the rework phase · 45.9 s of tool time
  repeat calls                    3   same command and arguments
  answered nothing new            0   0.0 s · no edit between the two calls
  recoverable check time    0.0 min   at 8.1 s model time per round trip

Turns by contributor:
  implementation                 38   9.2% of the turns that issued a call
  child dispatch                 33   8.0% of the turns that issued a call
  progress polling               25   6.0% of the turns that issued a call
  child confirmation             62   15.0% of the turns that issued a call
  loop asks                      50   12.1% of the turns that issued a call
  issue bookkeeping             110   26.6% of the turns that issued a call
  investigation                  84   20.3% of the turns that issued a call
  other                          12   2.9% of the turns that issued a call

Followup stages (in run order):
  read from the rows followup printed into the transcript
  closes-and-context          1.2 s   1 invocation(s)
  checks-wait               181.4 s   1 invocation(s)
  coderabbit-comments         2.0 s   1 invocation(s)
  ai-review-comments          1.8 s   1 invocation(s)
  telegram                    0.7 s   1 invocation(s)
  merge                       3.1 s   1 invocation(s)
  completion-and-epic-close   1.4 s   1 invocation(s)
  interrupted                           not measured

Failure re-runs:
  failed calls                    2   of 108 call(s), 59 outcome unreadable
  re-run after failure      0.0 min   0.3% of tool execution

Change size:
  files changed                   6   in the merged diff
  lines added                   254   of 263 changed line(s)
  lines deleted                   9   of 263 changed line(s)
  edited, never landed            1   of 6 file(s) edited
  edited outside the tree         1   could not have reached any diff

Edited files (never landed first, then by edit count):
  scripts/verification-gate.ts        2   never reached the merged diff
  scripts/josh-verdict.test.ts       10   in the merged diff
  …

By tool (descending):
  Skill                     6.9 min   2 call(s) · 2 round trip(s) · 2 alone
  Bash: pnpm                5.0 min   25 call(s) · 21 round trip(s) · 16 alone
  Edit                      0.7 min   39 call(s) · 39 round trip(s) · 39 alone
  …

By josh command (descending):
  josh followup             1.9 min   1 call(s)
  josh git                  0.9 min   2 call(s)
  …
```

**The partition is by gap, not by pair.** Every span is the interval between two consecutive dated lines, classified by the **later** one: a span ending at an assistant line is model wait, one ending at a tool result is that tool's execution, one ending at a typed prompt is human wait. So the three shares reconstruct the elapsed time **exactly**, and a reader can check them instead of trusting them. Pairing each `tool_use` with its own `tool_result` instead would double-count parallel calls and leave the shares summing to more than the run took — which is the property that makes two runs comparable.

**A command taken into the background is measured from its launch to the point its result is read** ([#1662](https://github.com/joshuafolkken/kit/issues/1662)). The partition above names a span by the event that closes it, and a `pnpm josh gate` issued with `run_in_background` closes at its own launch call two or three seconds later — so `gate` and `pr` counted the launch and the minutes the command actually ran belonged to whichever window they fell in. Three parts of the transcript place it, and all three are read at parse time because a span keeps neither an input nor a body: the id in the launch's result (`Command running in background with ID: <id>`), the `…/tasks/<id>.output` path the call that later reads it names — or the shell id `BashOutput` carries in a field — and the task-notification line the harness writes when the command ends, which names that same id in `<task-id>`. The launch's `own_duration_ms` — the field a per-invocation row is asked for — then holds the length of the command, while `duration_ms` stays the interval the span really occupied, so the shares still reconstruct the elapsed time exactly. **What the phase collects is the window minus whatever else was measured in it**: a span inside the window carrying no phase of its own is charged to that command, and one that carries a phase keeps it — so a gate genuinely overlapped by a review reports a small `gate` and one joined immediately reports the whole wait, which is the overlap reading the launch-call span could not express. **A launch nobody read back is reported rather than counted**: the row keeps its real minutes and says `background runtime not measured`, because the seconds the launch call took are not how long the command ran and nothing in the transcript says what that was.

**The window closes at a reading that saw the command end, never at a progress poll** ([#1696](https://github.com/joshuafolkken/kit/issues/1696)). Closing at the first reading of any kind was right while the only way to read an output was to `tail` it after the fact, and wrong the moment [#1662](https://github.com/joshuafolkken/kit/issues/1662) made a `BashOutput` join detectable — because `BashOutput` is the tool a run polls progress with. A look thirty seconds into an eight-minute gate then reported the gate at thirty seconds **and reported it as measured**, so the `background runtime not measured` note that had covered the case before was not emitted: a confidently wrong number in place of an honest gap. The task-notification line is what tells the two apart, and only a reading that **returned** at or after it closes the window. **Returned, not began** — the blocking wait this repository recommends (`until grep -q … <output>`, or a `Monitor` until-loop, since foreground `sleep` is refused) is issued before the command finishes and returns after it, so judging by where the reading began would discard the one join shape a run is told to use. A thirty-second poll of an eight-minute gate both begins and ends long before the notice, which is what keeps it rejected. **Three consequences follow, and all three are the point rather than side effects**: a poll made while the command was still running is ignored; a run whose _only_ reading was such a poll is reported as not measured, exactly like a launch nobody read at all; and, since it is still the **first** qualifying reading that closes the window, the `grep`s a run makes of a result already in hand do not extend it. **A launch no notice named is reported as not measured too** — nothing then says when the command ended, so no reading can be known to have seen it, and the direction of that error is deliberate: a missed reading is reported as a gap, while a wrong instant would be reported as a measurement.

**The same phases are also read in dollars, not only in minutes** ([#1606](https://github.com/joshuafolkken/kit/issues/1606)). `josh time` knew the phases and `josh cost` knew the money, and nothing put the two together — so a proposal to cut work out of `review` could be ranked by what `review` took and never by what it cost. Each billed request carries the instant it was sent, and the block places that instant inside the phase window containing it; the phase itself is decided by the same classifier the table above uses, never re-derived, so the two tables cannot come to disagree about where a stage began. **A request inside no window goes to an `unattributed` row and is never prorated into the phases** — spreading it would put money into stages that were demonstrably not running — and a phase with minutes but no row of its own had no billed request inside it, which is a real answer rather than a gap. **`usd per round trip` divides by `round_trip_count`, the denominator `cost per round trip` above already uses**, so one recoverable-trip figure multiplies both; what differs is the numerator's unit of work, which is why the total row prints the request count and the round-trip count side by side. **Only `--issue` and the no-argument latest-run scope read the cost corpus**, because pricing walks the whole transcript directory and `--epic` / `--last` would pay that walk once per child; the other scopes print `the cost corpus was not read for this scope` rather than a total of zero. On the run above, re-measured after this block was added:

```
What it cost, by phase:
  setup                       $0.08   0.7% · 1 request(s)
  implement                   $2.07   18.6% · 22 request(s)
  rework                      $4.49   40.4% · 40 request(s)
  review                      $1.00   9.0% · 17 request(s)
  wrapup                      $1.19   10.7% · 10 request(s)
  pre-run                     $1.82   16.3% · 17 request(s)
  post-run                    $0.48   4.3% · 4 request(s)
  priced total               $11.14   111 request(s) · over 99 round trip(s)
  usd per round trip         $0.112   same denominator as ms per round trip
```

**The `Followup stages (in run order):` block is what `followup` printed about itself, kept past the run that printed it** ([#1445](https://github.com/joshuafolkken/kit/issues/1445)). [#1349](https://github.com/joshuafolkken/kit/issues/1349) made the command time its own laps; this reads those rows back out of the Bash span's output, which is the only way anything can see inside one tool call. **The rows are in the order a run passes them, not by descending duration** — every other table here ranks, because its rows are an open set and the question is which is largest, while these are a closed set of named laps and the question is which stage of _this_ run was slower than the same stage of _that_ one, which is read down one column. **A stage no invocation reported says `not measured`, never `0.0 s`**: `merge` is absent from a run that did not merge and every lap after `interrupted` is absent from a run that threw, and a zero would assert a lap that ran and took no time. Two invocations in one window are summed, which is what the `invocation(s)` column says; a body the harness truncated leaves an invocation counted in the run total and reported as unread under the heading. **The whole block is withheld where the window held no `followup` call at all** — a heading over a column of `not measured` rows would assert the question was asked of something.

**The `Turns by contributor:` block says what the run's turns were _for_, which no duration can** ([#1715](https://github.com/joshuafolkken/kit/issues/1715)). `Round trips:` says how often a run stopped and `Bundling:` how many of those stops were avoidable; this says what the stops were spent on — the question a `backlogrun` **parent** raises, because a parent barely implements anything: it polls, it confirms children, it asks its loop what to do next, and it reads issues. **The turn is `time-round-trips.ts`'s and the key is `time-command-key.ts`'s**, so nothing here defines either a second time. **A turn is attributed to exactly one contributor**, by the precedence the rows are printed in — a turn that edited and also read is implementation, because the edit is what it was for — which is what keeps the eight rows reconstructing the turn count instead of summing past it. The figures above are the four recorded `backlogrun` parents of [#1715](https://github.com/joshuafolkken/kit/issues/1715), 414 turns: `issue bookkeeping` is the largest at 26.6%, and one issue read at a time was its dominant shape — which is what [`josh issue:read`](#josh-issueread) exists to collapse. **A contributor being large is a reason to look, never a finding**: whether those turns were avoidable is `Bundling:`'s question, and this block deliberately does not answer it.

**The `Single checks:` block is about the probing in front of that gate, not the gate itself** ([#1383](https://github.com/joshuafolkken/kit/issues/1383)). `CLAUDE.md` has said **one gate per run, not one per edit** since [#1246](https://github.com/joshuafolkken/kit/issues/1246), and the single checks — `josh lint:related`, `josh test:related`, `josh cspell:dot` and the type check — are where that rule sends an implementation loop instead. Nothing measured whether the loop then repeated _them_. **Two calls are the same call only if they named the same files**, so the signature is the subcommand plus its arguments, sorted and with shell redirections dropped — read while the tool input is still in hand, since a span keeps none. `answered nothing new` is the narrow figure the rule in `prompts/review.md` → "A single check answers once per tree" is about: a repeat that only a model turn sat between, whose answer was therefore known before it was asked. **It under-reports on purpose** — a repeat separated by a plain `Read` is not counted, because nothing here can prove that call changed no file — and a consumer project's type check is `josh-app check:ci`, which is not a `pnpm josh <cmd>` call at all and so is invisible. The zero above is the honest reading of that run rather than an empty block: all three of its repeats followed an edit.

**The `ci` phase is also read one cycle at a time, so a cycle that cost nothing is told apart from one the run sat through** ([#1465](https://github.com/joshuafolkken/kit/issues/1465)). A pull request runs CI once per commit, and the phase folds every cycle into a single number that cannot say which of them landed on the wall clock. Run #1441 is the demonstration: two cycles of almost the same length, the first entirely behind the second review round and costing **nothing**, the second with no other work running at all. **`naked` is the part of a cycle that nothing but the merge command overlapped**, which is what the run actually waited; `behind …` names the phase that overlapped the rest of it and the busiest command inside it, which is the evidence that the hiding place was real. **It is not the `ci` phase minus the `CI wait` share.** That difference is the part of a cycle the merge spans cover _and nothing else does_, so it silently drops every minute of a cycle nothing covered — `followup` not yet issued, or between attempts — and on run #1441 it read 56.5 s where the run had waited 103. **The block is withheld entirely where the scope has no pull request, and reads `not measured` where the check-runs could not be read or no transcript was found**: with no span to weigh a cycle against, every cycle would otherwise come back naked in full, which is the largest possible answer stated with a measured one's confidence. On the run of [#1441](https://github.com/joshuafolkken/kit/issues/1441) rather than on the run above:

```
CI cycles (in run order):
  00:37:09 → 00:38:58       1.8 min   naked 0.0 s · behind review · Skill
  00:44:43 → 00:46:26       1.7 min   naked 103.0 s
```

**The same elapsed time is also read along the run, not only as totals** ([#1311](https://github.com/joshuafolkken/kit/issues/1311)). A phase row says the gate cost 0.6 minutes and cannot say whether its four runs sat together or were spread across the hour, and `josh gate 4 call(s)` is the same row whether the four were even or whether the last took three times the first — which is what the hand-built reports these tables replace did say. **A segment is a maximal stretch of the run in one phase**, named by the phase that spent the most of it and by the busiest command inside it; a phase change lasting under half a minute is absorbed rather than given a row of its own, because a real run alternates — a gate call, the turn that read it, another gate call — and a strict reading yields dozens of rows nobody can read. **The absorbed time is still counted**: every span lands in exactly one segment, so the segments reconstruct the same total the phases do, less the CI share no span covers. **The per-invocation table lists each call's own duration in run order**, for commands called more than once only — one duration is what the per-command table already printed — and only the first fragment of a call that bracketed a delegated unit is counted, the rest being marked continuations and skipped rather than listed as calls of their own. **The duration a row prints is what the call itself took, not its share of the run** ([#1591](https://github.com/joshuafolkken/kit/issues/1591)): the subtraction that keeps the four category shares reconstructing the elapsed time removes from a bracketing span every minute a delegated unit covered, and a `Skill` call that ran for five minutes came out of it as 65 ms — correct as a share, and a misreport as an answer to "how long did this call take". So the three per-call tables — this one, `By tool` and `By josh command` — read the duration as it stood before that subtraction, while the categories, the phases and the segments go on reading the one left after it; in a run that delegated nothing the two are the same number and every table reads as it always did. **The two bases do not add up together**, which is why this table carries a line saying so: a call that delegated is priced whole in these three, and the unit's own calls have rows of their own, so adding the per-call rows up against the four category shares finds more minutes than the run took. The two blocks, on the run of [#1309](https://github.com/joshuafolkken/kit/issues/1309) rather than on the run above:

```
Segments (in run order):
  18:05:18 → 18:12:09       6.9 min   pre-run · Bash: python3
  18:12:09 → 18:13:05       0.9 min   setup · Bash: pnpm
  18:13:05 → 18:18:50       5.8 min   implement · Edit
  18:18:50 → 18:23:38       4.8 min   review · Skill
  18:23:38 → 18:28:43       5.1 min   rework · Bash: pnpm
  18:28:43 → 18:29:26       0.7 min   pr · Bash: pnpm
  …

Per invocation (repeated commands):
  each call’s own duration, as in By tool — a delegated call is priced whole here
  Skill                     8.8 min   2 call(s): 276.6 s, 248.8 s
  josh git                  1.0 min   3 call(s): 23.2 s, 7.5 s, 28.1 s
  josh gate                 0.6 min   4 call(s): 1.7 s, 17.1 s, 16.6 s, 2.2 s
  …
```

**`josh gate` is four short calls there because the gate is started in the background** and the span measures the call that launched it, not the checks it ran — the same reason that run's `gate` phase is 1.6% of it. **A row here is not the same total as the row of the same name in `By tool`**, and deliberately: a `pnpm josh <cmd>` call is keyed by its subcommand, exactly as in the per-`josh <cmd>` table. On that same run of #1309, `By tool` prints `Bash: pnpm 5.1 min` and this table prints `Bash: pnpm 0.2 min` — what is left of it once the `josh` calls have rows of their own.

**The round-trip block counts what a duration cannot see** ([#1304](https://github.com/joshuafolkken/kit/issues/1304)). Once the verification commands were cut, a run's wall clock stopped being set by how long the tools ran and started being set by **how many times it stopped to wait for one**: on `fullrun #1295` the read-only `Bash` calls and the `Edit` calls together executed for about 54 seconds while the turns they sat in cost 600–850. So the report prints the calls, the **round trips** they were issued in — one per group of calls a single turn issued together — and the density between them. A run that batches nothing has as many round trips as calls, and below **1.50 calls per round trip** the block says so in a line rather than leaving the reader to divide. The four runs it was set from measured 1.13, 1.04, 1.03 and 1.00. Cutting the count is [`turn-batching.md`](https://github.com/joshuafolkken/kit/blob/main/prompts/collaboration-workflow/turn-batching.md); this only reports it.

**It also says which tool the round trips belong to** ([#1385](https://github.com/joshuafolkken/kit/issues/1385)). A density is one number for the whole run, and one number cannot name what to batch: run #1379 — the run the sample above is taken from — reported `108 calls / 101 round trips / 1.07` and the warning beneath it, and three consecutive runs went by without the figure moving. Hand-measuring the same run found the answer one column away — of its round trips only a handful issued several tools at once, and **every** `Edit` call went out alone, splitting the change into a turn per edit. So each `by_tool` row now carries `round_trip_count` and `alone_in_turn_count` beside its call count — `Edit 39 call(s) · 39 round trip(s) · 39 alone` — and the block carries `batched turns` against single-call turns for the run as a whole. **The pair is not derivable from the density**: over 101 round trips, 1.07 is 7 turns of two calls against 94 single-call ones as readily as 3 turns issuing three and four calls against 98 — and the second run has less than half as much batching to build on. **`by_josh_command` deliberately carries neither**, because a `josh` subcommand is a `Bash` call under another name and its round trips are already the `Bash` row's — printing them twice would report one trip under two labels of one report. A row's counts are a **measured** zero where the tool called nothing countable; the withholding is one level up, on the block, so a scope with `span_count: 0` prints `not measured` for the turn split exactly as it does for the counts above it.

**A turn is an assistant message, and a round trip is one message's calls** ([#1406](https://github.com/joshuafolkken/kit/issues/1406)). Both counts were read off the transcript's _lines_ until this issue reconciled them against a hand read of run #1399, and both were wrong in the same way. Claude Code writes **one line per content block** and repeats the message id on each, and the harness returns each result as soon as it has one — so a turn that issued three calls reaches the timeline as `use → result → use → result → use → result`, its calls separated by that turn's own model spans. Counting model spans reported #1399's **41 turns as 79**; grouping tool spans by adjacency reported its **40 round trips as 47**, of which 3 were said to be batched where 8 were. The turn is now read off the message id, with the old adjacency rule kept as the fallback for a span carrying none, so the three quantities read as follows:

| Figure                | What it counts                                                                    | What it is not                                                   |
| --------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `turn_count`          | Assistant messages the run's model spans came from                                | Not model spans, and not transcript lines                        |
| `round_trip_count`    | Times the run stopped for results — one per message that issued at least one call | Not calls, and not runs of adjacent tool spans                   |
| `categories.model_ms` | Total duration of every model span                                                | Not per-turn, so splitting a message across lines never moved it |

- **The three were not equally wrong, and that is the reconciliation's point.** `model_ms` is a _duration_ summed over the same lines the turn count counted, so it was right all along — #1399's `5.93 min` against the hand read's `4.5 min ＋ 1.4 min` is one figure and its own decomposition, not a disagreement. The **1.4 min** is the CI the merge command waited on **inside** its own Bash span: it lives in `categories.tool_ms`, `categories.ci_ms` stays `0`, and the phase table charges it to `ci` while subtracting it from `merge`. Nothing about it is unmeasured, and the note under the header says so on every run that has one.
- **Re-measured, #1399 reads `50 calls over 41 turns / 40 round trips / 1.25` with 8 batched turns against 32 single-call ones** — the hand read exactly. Every figure quoted in the paragraphs above from a run measured before this change (#1379's `101 round trips`, #1299's `172 tool-issuing turns`) was taken under the adjacency rule and reads high.
- **The live hook line moved with it**, since [#1329](https://github.com/joshuafolkken/kit/issues/1329) reuses this same count: a turn that batches is no longer told it did not.

**The bundling block says how much of that count was avoidable** ([#1344](https://github.com/joshuafolkken/kit/issues/1344)). A density under the floor says independent calls went out one per turn; it does not say how many of them could actually have gone out together, and three runs in a row sat at 1.10–1.12 with both the end-of-run warning and the live hook line already shipped. The estimate of what batching would return was arithmetic on the floor — bundle 136 calls to 1.50 and 33 round trips disappear — which assumed every call was bundleable. This block reads the run instead. **A sequence is consecutive single-call round trips whose calls are of a bundleable kind and do not touch one another's targets**; a sequence of `n` turns could have been one, so it holds `n - 1` avoidable round trips, and the third row multiplies the total by the **model** share of the trip price — the part batching removes, since a tool's own execution is paid whichever turn it is issued from.

- **The kind is an allow-list.** `Read`, `Grep`, `Glob`, `Edit`, `Write`, `WebFetch` and `WebSearch`, plus a `Bash` call whose leading command inspects (`cat`, `sed`, `grep`, `gh`, …) and whose line holds no mutation word anywhere in it. A tool nobody classified is **not** bundleable: an unlisted tool counted as one would inflate the figure this block exists to establish. `git` is deliberately absent, because `git status` and `git switch` are one word apart and the label carries only the leading word.
- **The dependency test is on the inputs, because no result text is kept.** Two calls whose targets are equal — or where one names a directory the other reads inside of — are treated as ordered, which catches the search-then-read pair. A person's typed prompt, the tail of a call that bracketed a delegated unit, and a turn that already issued several calls each break a sequence.
- **The error is stated in both directions.** It **under-reports** where the target test finds an overlap that was not a dependency, and where a chained command was excluded for a mutation word it never used as one. It **over-reports** where a call named no target at all, since a dependency that exists only in the earlier call's output is invisible. On the three runs it was built from it read 27, 14 and 25 avoidable round trips — 3.3, 2.4 and 3.7 minutes — against the 33 the estimate assumed for the last of them.
- **The count says how many turns could have been one; `recoverable by tool` says whose** ([#1607](https://github.com/joshuafolkken/kit/issues/1607)). Without it the only measured figure a batching proposal could quote had no attribution at all, so the skill's own instruction to name the tool was satisfied by reading the transcript by hand — once per run. **A trip is attributed to the call that made it its own turn**, which is every call in a sequence after the first: attributing whole sequences instead would name a tool only where one issued every call in the sequence, and a real run's sequences are mixed. A tool's `in N sequence(s)` counts the sequences it contributed a trip to, not its calls, so the row says how many separate places to go and look at. The heading row reconciles the table — `25 of 25 attributed` — and the shortfall is `unattributed_round_trips`. **It balances on every real run and is printed anyway**: only a bundleable call can enter a sequence and every one of those carries a label, so the residue has nothing to hold, and what the row catches is the walk and the attribution coming apart — the one failure a person reading this table to decide what to batch could not otherwise see. Read a shortfall as a defect in the report, never as a bucket of unlabelled calls. It is withheld on the same `is_measured` criterion as the three rows above it, so an empty breakdown is never a run with nothing to batch. `--json` carries every row; the printed table is capped like the others.
- **Its own walk read a turn by adjacency too, and that inflated every figure above** ([#1406](https://github.com/joshuafolkken/kit/issues/1406)). A batched turn whose results arrived one at a time read as several single-call turns, so the block offered the run the very bundling that turn had already done. Run #1399's `recoverable round trips 8 — 0.9 min` was **entirely** that artifact: re-measured, it is `0`, and its `longest 6` sequence was six calls belonging to two turns that had each issued three. Every avoidable-round-trip figure quoted above was taken before the fix and reads high.

**A count cannot be ranked against a phase, so the block also prices one round trip** ([#1307](https://github.com/joshuafolkken/kit/issues/1307)). `diag` ranks candidates by the minutes each would save per run, and `101 round trips` is not minutes — so the counts sat in the report while the ranking was assembled from the phase table beside them, and the 2026-09-04 `diag` left round-trip reduction off its candidate table altogether. The row prints what one trip cost and the **model wait** inside it: on the run above, 15.9 seconds each, of which 8.1 was the model composing the turn that issued the call. Multiplying that by the trips a proposed change would remove is the estimate the table wanted — the same run's 39 `Edit` calls executed for 0.7 minutes and cost about 10 minutes of round trips. **The model share is printed rather than left to be derived** because it is the part batching actually removes: a tool's own execution is paid whichever turn it was issued from.

**And a mean cannot say whether a run was slow everywhere or slow once, so the block beneath it prints the spread** ([#1386](https://github.com/joshuafolkken/kit/issues/1386)). Run #1379's price row read `model wait 8.13 s`; hand-measuring the same run found the mean hiding a spread, and the block above now prints it — 3.8 s at the median, 14.8 s at p90 and a **maximum of 189.5 s**, one uninterrupted stretch charged to `pre-run`, 11.6% of a 1,632-second run and arithmetically invisible in the 8.1 beside it. The two runs a mean of 8 seconds can describe need opposite fixes: batching removes many small round trips and touches one long think not at all. So `model gap per round trip` prints `min` / `median` / `p90` / `max` through the same `Distribution` record `--last` reports its spreads from — `p90` is new to that record and joined it rather than being computed beside it, so the two scopes cannot come to disagree about what an even-sized sample's middle is; `--last`'s own table still prints `median`, `min – max` and a sample count, because a sample of five runs has no separate ninetieth to print. `Longest model gaps` lists the longest few **by length rather than in run order** — the treatment the segment table already gets — each with the phase it was spent in and its share of the run. The mean above it is unchanged.

- **It is the mean's distribution, not a second measurement.** The stretches come from the same walk `model_ms_per_round_trip` is summed from, so a round trip opened with nothing pending — the call that follows a person typing — is a stretch of **zero** rather than one that did not happen, and the median can never sit above a price the same report prints.
- **The phase is what makes one row actionable.** Twenty minutes of thinking during `implement` and the same twenty during `rework` are different findings, and the classification is `time_phases.classify`'s rather than a second one — so the row agrees with the phase table by construction.
- **Withheld rather than zeroed, in the two shapes the neighboring blocks already use.** A scope with `span_count: 0` prints `not measured`, because a median of `0.0 s` would report the fastest possible run for a scope nobody read; a transcript that _was_ read but made no round trip prints `no tool call to divide`, exactly as the price row above it does.

**The numerator is what a round trip is made of, not what the run did while one was outstanding.** Two exclusions, both in the direction that would otherwise over-state a saving and get a cut ranked above one worth more. **Human wait and CI wait are out**: a round trip does not cause them, and a price that folded them in would be multiplied out as a saving and then counted a second time against the `wait` and `ci` rows of the very table it was carried into — on one measured 73.3-minute session, 28.8 minutes of it nobody at the keyboard, that alone would have priced each of its 146 round trips at 30.1 seconds against a real 17.6. **The model wait of a turn that called nothing is out too**: the answer that ends a reply and the turn that stops to wait for a person composed nothing batching could give back, and the run above spent 156 turns on 101 round trips. Both figures divide by the round trips rather than by the turns, for the same reason. Where there was no round trip to divide by, the row says `no tool call to divide` and the JSON's `ms_per_round_trip` / `model_ms_per_round_trip` are the same withheld answer the counts give, never a measured zero.

**The failure block separates work from rework** ([#1309](https://github.com/joshuafolkken/kit/issues/1309)). A row saying `josh gate 3.8 min 4 call(s)` cannot say whether the four runs were four pieces of work or one piece done four times, and on the run this was filed from **three of five gate runs were failures** — one spell-check test half a second over its timeout, one resident-document size violation whose own test ran in five milliseconds. Neither was slow; both were re-run. So every span now carries how its call came back, and the block prints the calls that failed and the time spent on the attempts that followed them. **A re-run is the next call of the same command after one that failed**, not every repeat: the gate runs once beside the review and again over the tree round 1's fixes moved, by design, and counting repeats alone would charge that to failure. The identity a repeat is judged on is the josh subcommand where there is one and the tool label otherwise — the same key the two tables below are built on.

**The outcome is the tool call's, and a josh check's own words are read on top of it** ([#1361](https://github.com/joshuafolkken/kit/issues/1361)). The base reading is the `is_error` the harness writes on a tool result, which reports whether the _call_ failed rather than whether the command inside it did: `pnpm josh gate 2>&1 | tail -40` exits with `tail`'s status, so a red gate read through a pipe came back as a call that succeeded. Measured over this machine's kit transcripts from 2026-09-04 onward, that was **13 of the 13 gate runs that printed a failure line** — none of them counted, which is exactly the rework the block exists to expose. So a result whose call ran `pnpm josh <cmd>` is also read for the failure line josh itself printed (`✗ verification gate failed: lint`), and one found there marks the call failed whatever the pipe reported. **The promotion goes one way only** — a call the harness already marked failed stays failed — and it is confined to josh's own output, whose format this repository owns; the icon is shared with the commands that print it rather than restated, so a rename breaks the build instead of the count. **A command's own verdict outranks the lines it forwarded** ([#1374](https://github.com/joshuafolkken/kit/issues/1374)): `josh gate` prints the body of a step that skipped or passed with warnings, and that body is eslint's, svelte-check's, vitest's or cspell's — one of them opening a line with the failure icon would make a _green_ gate a failed call and charge the next gate run as rework. So the gate's own `✔ verification gate passed` / `✗ verification gate failed` line is read first and settles the call, built from the same prefix the reader matches. A per-command list of failure-line patterns was rejected instead: tight enough to exclude a third-party warning, it is a list of per-command shapes, and the next josh command to print a failure line is silently not counted. Commands that state no verdict — `josh health`, `josh propagate` — are read from the icon exactly as before. What remains invisible is a non-josh command inside a pipeline and a body truncated past its failure line, which keeps the figure a floor rather than a ceiling — a lower one than before. **Where no outcome was readable at all the two rows say `not measured`** — a fifth of the tool results in the transcripts measured carry no `is_error` (a file read, an answered question), and a run of only those failed nothing _that was seen_, which is not the same as failing nothing. Where some outcomes _were_ readable, how many were not is printed beside the failure count rather than folded into it; on the withheld rows it is not repeated, because there it would be the call count the round-trip block prints two lines above.

**The last two blocks reconcile what the run edited against what it merged** ([#1387](https://github.com/joshuafolkken/kit/issues/1387)). The failure block above catches a command re-run after it failed; it cannot catch a change of approach, where nothing failed and the work was thrown away anyway. Hand-measuring run #1379 found `scripts/verification-gate.ts` **edited twice and absent from the merged diff**, which every scope of this command read as ordinary implementation. So one extra request — `repos/{owner}/{repo}/pulls/<N>/files` — is joined to the transcript's own `Edit` / `Write` calls, and both readings come out of it: which paths never landed, and how large the diff that did land was. **The change size is what makes two runs comparable at all**: 27 minutes on a 254-line change and 27 on a 4-line one are the same line in every other block here, and the second is not the same run.

- **The two sides are made comparable by the work tree, which is passed in rather than guessed.** A transcript names `/Users/…/kit/scripts/x.ts` and a diff names `scripts/x.ts`; the only thing relating them is the repository root, and the command already knows it — it is the very directory the transcripts were found by. So an edited path is relativized against it and then compared **for equality**. Learning the root from a matching pair instead was tried and is wrong: `README.md` in a diff is the tail of `docs/README.md` in a transcript, so one basename collision both reports an abandoned file as landed and poisons the root every other row is printed through.
- **An edit outside the work tree is counted apart, never called rework.** A scratchpad script or a temporary file can never appear in any diff, so calling it "never landed" would inflate the headline number on ordinary runs — `CLAUDE.md` tells agents to use a scratchpad. It gets one summary row and no path, because those paths are absolute and local to whoever ran the session.
- **The edit count survives the reconciliation**, because repeatedly editing one file that _did_ land is the same signal at lower confidence. Rows are ordered dropped-first and then by count, so the finding stays above the display cap on a run that touched thirty files.
- **Three states for the diff read, and two of them withhold.** `read` prints everything. `refused` — a rate-limited request, or a pull request with more files than the single page carries, which cannot be told from a truncated one — prints `not measured` for all four size rows, marks every row `not reconciled`, and says so in a note the `--epic` and `--last` tables carry too; `dropped_count` stays 0 there because nothing was reconciled, never because nothing was dropped. `absent` is a scope that never had a pull request — a `--session` report — and prints **no block at all**, the rule `CI wait` already follows. A scope with `span_count: 0` prints `not measured` for the file table, on the criterion every transcript figure here is withheld on.
- **It under-reports a file rewritten only through the shell** — `sed -i` is not an `Edit` call — and over-reports nothing: a path is called dropped only where a diff that _was_ read does not name it, and only for a file inside the tree.

**One run is not a sample.** [#1262](https://github.com/joshuafolkken/kit/issues/1262) recorded "tool execution 59% / model 39%" from a single hand-measured run; three real sessions measured by this command put tool execution at 25–40% and human wait at 17–44%. All three of the sessions [#1267](https://github.com/joshuafolkken/kit/issues/1267) restored by hand reproduce here to within 0.4 points.

**A Bash call is bundled under the command it actually runs.** Taking the literal first word put `Bash: cd` at the top of every table — 82 calls and 12.1 minutes of one measured session, naming the one part of the command that did no work — so the chain is split into segments and each segment walked **word by word** past its `VAR=…` assignments and its wrappers (`time`, `env`, `sudo`) to the command position. A segment that only navigates (`cd`, `export`, `source`) runs nothing and yields no name, and a call nothing could be named for stays under the bare `Bash` rather than under the word that was rejected. `pnpm josh <cmd>` invocations get a second table of their own, keyed by subcommand and read **only at a segment's command position** — searched loosely, `git commit -m "ran pnpm josh gate"` was charged to `josh gate`, and this repository's own commit messages name subcommands constantly.

**The per-tool totals say which command is slow; the phase breakdown says which _stage_ is long** ([#1269](https://github.com/joshuafolkken/kit/issues/1269)). Every issue filed to make `fullrun` faster has been about a stage — one review round instead of two, the gate started beside the review — and [#1262](https://github.com/joshuafolkken/kit/issues/1262)'s split rationale ("verification commands 465s / code review 326s / edits and format hook 143s / CI wait and merge 125s") was one run classified by hand. **The boundaries are decided from recognizable commands, never from how long an interval was**: `gate`, `pr` and `merge` are the spans of `pnpm josh gate` / `josh git` / `josh pr` / `josh followup`, read off the same subcommand name the josh table is keyed by rather than detected a second time; `review` is the `code-review` skill call, which carries the whole review because the skill runs it and hands back the findings; `plan` runs from the start to the plan comment posted to the Issue, `implement` from the first edit to the first gate, and `rework` from that first gate to the pull request. A boundary guessed from durations would move whenever a run got faster, which is the one thing a measurement meant to compare two runs must not do.

**`rework` is a window of its own because a run does not stop editing at its first gate** ([#1281](https://github.com/joshuafolkken/kit/issues/1281)). A `fullrun` is edit → gate → fix what it caught → gate again → review → fix what _that_ caught, and with `implement` ending at the first gate every one of those fixes fell into `other`: **35.7%** of that same 73.3-minute session — now split three ways as the 12.4% named `rework`, the 6.0% still in `other`, and the 17.3% that [#1290](https://github.com/joshuafolkken/kit/issues/1290) moved to `wait` — against 3.0 minutes of `implement`. The totals still reconstructed elapsed time exactly, so it was never an arithmetic defect — it under-reported implementation to the one question the breakdown exists to answer. Measured across epic [#1272](https://github.com/joshuafolkken/kit/issues/1272)'s merged children, rework runs **19–25% of a run**, and `other` falls by exactly that much. **It closes at the pull request rather than at the review start**, because a review's own findings are fixed after it: closing the window earlier would send that half straight back into `other`, which is the same defect one stage further along. `pnpm josh git` / `pnpm josh pr` is the first instant a run demonstrably stopped changing code, and it is a command name rather than a duration. A run with no gate after its first edit reports `rework` as **`not detected`** rather than as zero, and one that stopped before its pull request — a `halfrun` — runs the window to the end of what was measured.

**A window collects intervals, and waiting for a person is an interval — so `wait` is a phase of its own** ([#1290](https://github.com/joshuafolkken/kit/issues/1290)). Every span ending at a typed prompt used to be charged to whichever window it sat in, which is how that 73.3-minute session reported `plan` as **32.4 minutes / 44.2%** when 16.2 of those minutes were nobody at the keyboard; its `other` fell from 23.3% to 6.0% for the same reason. `rework` shows it most reliably rather than most severely: its window falls back to the end of what was measured when no pull request was opened, and the run that opens none is a `halfrun`, which **by specification** stops after the gate and waits for a person — so exactly where the fallback applies, the whole wait was charged to rework and the row reported how long somebody waited instead of how long the rework took. **It is a phase rather than a share of `other`**, because a run that stalls on a person is a fact about the run and the remainder would hide it behind everything else that landed there. Nothing moves out of a command phase: a human span's closing event is a typed prompt, which names no tool, so `gate`, `review`, `pr` and `merge` are untouched and **the wait rows equal the human-wait category above them exactly** — an invariant the two halves of the report can be cross-checked against, and one that became a sum rather than a single row when [#1331](https://github.com/joshuafolkken/kit/issues/1331) split the phase at the run's edges. A run with nobody waiting on it — every delegated child of an `epicrun` — reports both wait rows as a measured **`0.0 min`** and every other row exactly as before.

**`setup`, `wrapup`, `pre-run` and `post-run` are the remainder cut into the regions it was made of** ([#1299](https://github.com/joshuafolkken/kit/issues/1299)). `other` prints with `is_detected: true`, so it ranked as a **measured** block nobody could propose a cut against — 19–63% of each of the four runs the issue was filed from, and larger in every one of them than the biggest named phase. Measured across six merged runs it is two stretches and almost nothing else, so each becomes a window decided from boundary markers exactly as `implement` and `rework` are: **`setup`** runs to the first edit (reading the issue, normalizing its title, `git switch main && git pull`, the dependency-update question, and the turns spent settling the approach) and **`wrapup`** from the pull request onward (the second review round's fixes, the follow-up filing, the completion summary). **`pre-run` and `post-run` are what a run _is not_**: a run is not a session, and spans are attributed to an issue by branch — filled forward before the branch exists and backward after the merge — so a session that ran a `diag` before the keyword was typed and filed the next issue after the merge contributes both to this run. One measured run charged **9.9 minutes of a following conversation** to itself. Their boundaries are the `workflow-commands` skill call or the `in-progress` label, whichever came first, and the **last** `josh followup` — the last, because `followup` exits non-zero on a review blocker and is re-run. **They are two rows rather than one**, because a run has one of those boundaries far more often than none — a `halfrun` never merges, a delegated unit never loads the skill its parent did — and a single row detected on either would print `0.0 min` as a measurement for the half it never checked. That same floor is what every other window's search now starts from, so an edit made before the keyword was typed no longer opens `implement` ahead of the run. Across the same six runs `other` falls to **0.0 min** in every one. Three things deliberately stay where they are: `josh ms` and the report written after the merge are charged to `post-run` with whatever followed them (under a minute, against the 9.9 above); a run whose pull request never merged has no boundary to close `wrapup` at, so it runs to the end of what was measured exactly as `rework` does when no pull request was opened, and `post-run` prints `not detected` beside it; and **a person's wait stays out of both region rows** — it goes to `wait` or, since [#1331](https://github.com/joshuafolkken/kit/issues/1331), to `wait-outside`, so `pre-run` and `post-run` keep reporting work rather than idleness.

**`wait` is cut at the same two edges, because the largest row in the table was the one nothing could be proposed against** ([#1331](https://github.com/joshuafolkken/kit/issues/1331)). Measured on three merged `fullrun`s it was **29–49% of the run** and the single largest phase in one of them, and it held two different things at once: time the run stalled on a person, which a proposal can cut, and time the session was idle before the keyword was typed or after the merge, which is not the run's at all. That is the distinction #1299 drew for `other`, never drawn here only because `wait` was pinned to the category total. **`wait` now collects the human spans inside the run and `wait-outside` those on either side of it**, decided from the same two boundaries `pre-run` and `post-run` rest on, and the split is what the three measured runs were waiting for: #1298's 34.0 minutes is **4.0 inside / 30.0 outside**, #1304's 20.3 is **0.0 / 20.3**, and #1299's 22.2 is **21.4 / 0.8** — so two of the three runs had almost nothing to cut where the single row said they had the most. **The invariant becomes a sum**: `wait` + `wait-outside` equals the human-wait category exactly, and the two are detected on the transcript half together — printed together or withheld together, because a report showing one and hiding the other could not be cross-checked at all. **A wait is placed by where it started**, exactly as every other span is, so a session idle across the keyword is charged wholly to `wait-outside`: splitting the interval at the boundary is the one thing that would stop every span landing in exactly one phase, and nobody was waiting on a run that had not started. `wait-outside` is **not ranked** for the same reason `pre-run` and `post-run` are not — a cut proposed against it would cut a different piece of work.

`gate` and `review` **overlap on purpose** — the gate is started beside the review rather than in front of it — so the command's own phase wins over whichever window its span sits in; a sequential reading would charge the gate to the review and hide exactly what the change was for. Anything belonging to no phase — after the four regions above have taken theirs — is kept as **`other`** rather than discarded, so the phases still reconstruct the elapsed time exactly — exactly in the milliseconds `--json` carries, while each printed row is rounded to a tenth on its own, so a column can add up a tenth away from the header — and a phase whose marker never appeared prints **`not detected`** rather than `0.0 min` — "did not run" and "this transcript could not be read for it" are different answers, and a measured zero asserts the first when only the second may be true. `--json` carries the same breakdown, `is_detected` included.

**A run is measured from its `fullrun` invocation to the merge, and neither source can say that alone** ([#1268](https://github.com/joshuafolkken/kit/issues/1268)). The transcript stops at the last line anyone wrote, so PR #1263's `createdAt 08:57:20Z → mergedAt 09:00:32Z` — 3 minutes 12 seconds of CI wait and merge — appears in no session file; GitHub has no timestamp for the planning, implementation, gate and review that precede the pull request. And **one run is not one session**: a scan of the 25 most recent transcripts barely finds the branch for issue #1256, because that `fullrun` ran in a different one. So `--issue <N>` joins the two on the issue number — every session attributed to it by branch through `cost_attribute`, unchanged and not copied, plus the pull request's `created_at`, each check-run and `merged_at` from `gh api`.

```
issue #1257 — 129.4 min elapsed
  2 transcript(s)
  PR #1264 merged
  2.3 min of the merge command was waiting on CI — the phase table charges it to `ci`

Where the wall clock went:
  model wait               34.7 min   26.8%
  tool execution           24.7 min   19.1%
  human wait               70.0 min   54.1%
  CI wait                   0.0 min   0.0%
```

**One run is three nested windows, and the report opens with all three** ([#1409](https://github.com/joshuafolkken/kit/issues/1409)). A single `started_at` / `ended_at` pair could not say what the run itself controlled: run #1399 was 20.0 minutes of `fullrun` sitting inside a 24.6-minute issue, of which the pull request held 8.2, and nothing in the report separated the three. The block below is that run — a different one from the sample above, named here for the reason the segment tables are:

```
The three windows this run sits in:
  run body                 20.0 min   06:52:19 → 07:12:17
  pull request open         8.2 min   07:03:10 → 07:11:23
  issue open               24.6 min   06:46:50 → 07:11:24
```

**The run body is the transcript's own span and nothing else.** `started_at` / `ended_at` bound everything either source knows about, the pull request's stamps included; the run body deliberately does not, so a checkout that holds no transcript for the issue reports it `not measured` rather than borrowing the pull request's 8.2 minutes and printing them as a run nobody measured.

**The nesting is the reading, not an arithmetic containment.** That run went on to `josh ms` for 53 seconds after the merge closed the issue, so the run body's end sits past the issue's — the rows are ordered by the question each answers, and `diag` uses them to say which of the three a proposed saving is a saving _of_.

**They are not the `pre-run` / `post-run` phases, and neither replaces the other.** Those two are transcript spans that fall _outside_ the run's window and are shares of `elapsed_ms`; these are wall windows the run falls _inside_ and cover no spans at all, so nothing here enters the phase table and adding them to it would double-count every minute in it.

**Each window is read or withheld on its own**, so a half nobody could read never prints as `0.0 min`. `--session` has neither a pull request nor an issue, an issue with no pull request has no middle window, and one still open has no third — each prints `not measured`, the same distinction `span_count: 0` and `not detected` make everywhere else here:

```
The three windows this run sits in:
  run body                 20.0 min   06:52:19 → 07:12:17
  pull request open                   not measured
  issue open                          not measured
```

The issue's own stamps are the one thing neither existing read carried, so they are a read of their own — `repos/{owner}/{repo}/issues/<N>`, issued beside the merged pull request's rather than after it, so a batch scope pays no extra serial request per child.

**CI wait is the part of the open→merge window no span already covers**, not the window itself. `followup` waits for CI _inside_ a Bash tool span that is already counted, so adding the window whole would count it twice and leave the four shares summing to more than the run took — the property that makes two runs comparable. Where the run sat watching its own merge, the honest figure is therefore near zero, and the 3 minutes PR #1263 spent unattended is the case the category exists for. **No sample on this page still shows that case** — every `CI wait` row any of them prints reads `0.0 min` — and the reason is [#1285](https://github.com/joshuafolkken/kit/issues/1285) rather than a run that never waited: a delegated unit's own `pnpm josh followup` span now covers the whole open→merge window. The `ci` **phase** beside those rows is not zero, because the two answer different questions — the paragraph below. The per-check table is informational for the same reason the categories are not: CI jobs run in parallel, so their durations overlap and are never summed into a share.

**The `ci` phase and the `CI wait` share answer two different questions** ([#1384](https://github.com/joshuafolkken/kit/issues/1384)). The share is the paragraph above — the part of the window no span covers. The phase adds what the merge command itself sat waiting for: `josh time` reads the check-runs of **every commit of the pull request**, so a run that pushed twice produces one CI window per cycle, and the part of a window that no span _other than `josh followup`_ covers is charged to `ci` and taken off `merge`. A cycle that ran beside the second review round or beside a gate cost the run nothing extra and stays out of it. Measured on PR #1380 — the pull request of the run the sample above is taken from — whose second cycle ran with nothing else in flight: `ci` went from `0.0 min` to **70.3 seconds** of a 116.7-second merge command, and `merge` from 116.7 to 46.4. The two figures therefore differ on any run that watched its own merge, so a note under the heading says by how much: _1.2 min of the merge command was waiting on CI — the phase table charges it to `ci`_. **A negative `merge_gap` is not evidence that the run did not wait**: `followup` waits for the checks, so they always finish before the merge, and reading the sign as an answer is half of why the phase reported zero. Where the commit listing or a commit's check-runs could not be read the phase prints `not detected` rather than `0.0 min` — the same distinction `span_count: 0` makes for the transcript shares, and the false zero that had `diag` rank a CI proposal last as work with no wall clock behind it.

**A withheld row leaves its minutes in the denominator, so the table says so in a line of its own** ([#1392](https://github.com/joshuafolkken/kit/issues/1392)). `categories.ci_ms` stays inside `elapsed_ms` whether or not the cycles could be read, so a run with three measured minutes of the open→merge window that no span covers prints a `ci` row with no figure while those three minutes still shrink every other row's share — and the column stops adding up with nothing accounting for the difference. The note above says in prose _why_ the row is withheld; it does not make the arithmetic readable. So a footnote under the rows prints what they leave out, naming the row it belongs to:

```
  ci                                  not detected
  merge                     4.0 min   13.3%
  …
  withheld from the rows    3.0 min   10.0% · ci · counted in the elapsed total
```

It is printed only where a withheld row actually holds time: most withheld phases are a window whose boundary was never found, which collects no span either, and a `0.0 min` footnote would be the confident zero the withholding exists to prevent. **`elapsed_ms` and `is_detected` are untouched** — the two alternatives were to print the share under a heading whose cycle detail is unknown, which reinterprets [#1384](https://github.com/joshuafolkken/kit/issues/1384)'s shipped criterion, and to drop the withheld part out of the denominator, which moves the definition the four category shares reconstruct. The complaint was that the difference could not be read off the table, so what changed is that the difference is printed. `--json` was correct throughout and carries the same `duration_ms` it always did.

**Each check row says what it concluded and where its finish sat relative to the merge** ([#1310](https://github.com/joshuafolkken/kit/issues/1310)). A duration alone cannot be ranked: on the run this was added for, `E2E`, `auto-merge` and `Notify Auto Tag` all printed `0.0 min` — one of them skipped, the others completed at once — and the longest row in the table finished **after** the merge, where it cannot have delayed anything. So every row carries GitHub's own `conclusion` (`success`, `failure`, `skipped`, whatever it sent, and `no conclusion recorded` where it sent none), a zero-length row says which of the two zeroes it is (`skipped · did not run` against `success · completed instantly`), and a row that finished past the merge says how far past it (`success · finished 4.0 min after the merge`). Under the table sits the one sentence the table is read for — `the merge waited on SonarQube — the last check to finish before it` — which names the **latest finisher among the checks that ran and finished before the merge**, not the longest one: a job that started early and ran ten minutes was over long before a two-minute job that started last. **"Finished last" and "the merge waited on it" are two claims, and only the first is always true**, so the second is made only where the merge followed within a minute; where CI went green and a person merged an hour later — a `halfrun` picked up the next morning, a pull request left for review — it says `unit was the last check to finish, 63.0 min before the merge — the merge itself waited on something else` instead of charging that hour to CI. A set whose every row was skipped or landed after the merge says so rather than naming one. Only `skipped` is left out of the candidates, and no other conclusion is: a job that failed or was cancelled still finished, and the merge still sat behind it until it did. `--json` carries the same two fields per row, `conclusion` and a signed `merge_gap_ms` — positive means the check finished after the merge.

**A run no transcript was attributed to prints `not measured` for the three transcript shares, not `0.0 min`** ([#1295](https://github.com/joshuafolkken/kit/issues/1295)). The merge was read and the CI wait is real, but model wait, tool execution and human wait totalled zero because nothing was read — and three zeroes above `CI wait 3.2 min 100.0%` read as a run that spent its whole length in CI. The criterion is whether any span was read at all, which is the same one `--epic` withholds its own category rows on and the one `wait`, `wait-outside` and `other` are detected on, so the two tables cannot disagree about it and `wait` + `wait-outside` stays equal to the `human wait` row. **A transcript that _was_ read keeps its measured zero** — "nothing was read" and "read, and genuinely zero" are exactly the two answers the row keeps apart — and `--json` carries the raw milliseconds either way, with `span_count` saying which state the report is in.

**Two sessions with a gap between them leave time that belonged to nobody.** The header states what was accounted for — the sum of the four shares — and a gap of a minute or more between the wall window and that sum is named in a note rather than charged to the run.

**Two sessions running _at once_ make that sum exceed the window, and that is named too** ([#1330](https://github.com/joshuafolkken/kit/issues/1330)). `--issue 1299` reported `77.6 min elapsed` beside a window of 49.9 minutes and said nothing about the difference, so the headline read as a run half again as long as the time it actually occupied, and every phase percentage was a share of the inflated figure. **The excess is reported rather than subtracted**, because there is nothing to subtract: both sessions really worked in the minutes they shared, and the per-session grouping that resolves a delegated unit against its parent exists precisely so one session's intervals are never removed from another's. So a note names the total, the window, how much was counted twice — `the shares total 77.6 min over a 49.9 min window — 27.6 min of it wall clock concurrent sessions shared, …` — and, because the point of the figure is ranking the phases, the denominator those percentages are taken against, which is what the `…` above stands in for and the `#1261` row of the `--epic` sample below prints in full. **`--epic` prints it too**, on a child whose merge was read: that filter exists to explain a missing GitHub half, and every completed child passes it, so without the exception the note would be hidden from exactly the rows whose minutes it qualifies — and those minutes are summed into the batch total. A run whose sessions did not overlap prints no such note and is unchanged.

**Before either of those, the sessions that were never this run's are separated out** ([#1428](https://github.com/joshuafolkken/kit/issues/1428)). Attribution is by branch, and a branch belongs to the **checkout** rather than to a session — so every session open in the same work tree while an issue's branch was checked out was attributed to that issue, whatever it was doing. Two sessions in one work tree is ordinary: a run in the first, an epic being planned or measured in the second. Run #1412 read as **145 round trips, 208 tool calls and 31.1 minutes of model wait** against a hand count of 56 / 77 / 7.9, because a session busy with `josh epic` for 45 minutes across the same window was summed into every one of them — and `diag` ranks what to cut by those figures, so the contaminated reading put `wrapup 8.4 min` first where the hand reading of the same region was 37 seconds. **The discriminator is the `workflow` marker the phase breakdown already uses** — loading the `workflow-commands` skill, or writing the `in-progress` label — because a session that never opened a workflow on this issue did not run it; recognizing the boundary a second way would let the `pre-run` row and this separation disagree about which session a run began in. A left-out session is **named with its minutes** — `1 concurrent session(s) left out — af63e9d6-… (45.1 min) — no workflow marker attributes them to this run` — and the transcript count above it is the kept sessions' own, so the note and the spans beneath it are about one set. The same reading of #1412 is now **66 round trips, 93 tool calls and 12.7 minutes**, over a window that starts where the session did rather than where the other session did. **Nothing is excluded unless something is kept**: where no session carries the marker — the keyword typed while a previous branch was still checked out — every span comes back and the report says `2 sessions are attributed to issue #N and none carries a workflow marker — the run could not be separated from them, …`, because `0.0 min` excluded and "could not be separated" are different answers and only one of them is a measurement. A delegated unit follows the session that delegated it, and a run measured in one session is unchanged.

**Three sentences, because the separation now has three answers to give** ([#1673](https://github.com/joshuafolkken/kit/issues/1673)). Since a marker has to _name_ the issue ([#1648](https://github.com/joshuafolkken/kit/issues/1648)), a session can be **kept and narrowed**: the parent that dispatched a delegated run keeps only the unit's window, and the coordination minutes around it — dispatching the previous child, reading the backlog — leave the figures. Those are reported as `1 kept session(s) narrowed — af63e9d6-… (1.0 min) dropped — these are minutes outside the window this run declared, in a session it kept`, never as a session left out: with a single dispatching parent the old wording read `1 concurrent session(s) left out — S` over figures that had just come out of `S`. And "nothing could be separated" is likewise two states rather than one — where every attributed session carries a marker but every one of them names a different run, the report says `and every workflow marker among them names a different run` instead of `and none carries a workflow marker`, because a reader told no marker exists goes looking for one that is sitting right there.

**`--epic <E>` measures a whole batch, child by child** ([#1271](https://github.com/joshuafolkken/kit/issues/1271)). An `epicrun` is several `fullrun`s, so every slow stage is paid once per child — and which child was long, and whether the run got slower as it went, had no answer that did not start with running `--issue` by hand for each number in the epic body. The children are enumerated by the **epic body parser** (`scripts/git/git-epic-parse.ts`), the one reader of a task list, and each child is measured by exactly the code `--issue` uses; a second enumeration would disagree with `epic:next` about what the batch is, and a second measurement would disagree with `--issue` about what a run took. **The block below and the `--issue 1257` block above are one measurement read through two invocations** — `pnpm josh time --epic 1262` and the `pnpm josh time --issue 1257` inside it — so the `#1257` row here carries exactly the figures that block prints, and the two can be checked against each other rather than read side by side on trust ([#1399](https://github.com/joshuafolkken/kit/issues/1399)). Its `…` rows are children left out for length, never rows from another run.

```
epic #1262 — 22 child(ren), 13 timed, 1118.7 min elapsed
  9 child(ren) have nothing measured and are reported as "not run" — each row says why

By child (in execution order):
  #1257                   129.4 min   model 34.7 min / tool 24.7 min / human 70.0 min / CI 0.0 min
  #1256                    28.3 min   model 11.6 min / tool 16.7 min / human 0.0 min / CI 0.0 min
  #1260                   200.2 min   model 29.1 min / tool 15.9 min / human 155.2 min / CI 0.0 min
  …
  #1261                   162.4 min   model 48.1 min / tool 32.8 min / human 81.5 min / CI 0.0 min
      the shares total 162.4 min over a 69.0 min window — 93.4 min of it wall clock concurrent sessions shared, and every share and phase percentage is of the 162.4 min
  …
  #1266                               not run
      no session transcript is attributed to issue #1266
      no pull request found for issue #1266 among the 500 most recently updated — the CI wait is unknown
  …

Where the batch's wall clock went:
  model wait              355.9 min   31.8%
  tool execution          274.3 min   24.5%
  human wait              488.5 min   43.7%
  CI wait                   0.0 min   0.0%

Model wait per turn (in execution order):
  #1257                       4.7 s
  #1256                       3.7 s
  #1260                       7.7 s
  …
  rising 46% across 13 children
```

**The per-turn trend is the point of the batch scope, not a decoration.** [#1153](https://github.com/joshuafolkken/kit/issues/1153) measured one context's token cost growing — `$0.257` per request on a 463-request run against `$0.108` on a 16-request one — and nothing said whether the same growth shows up in _time_. Model wait divided by the run's turns is that measurement, printed per child and compared across the batch. **Execution order is when each child ran**, read from what was measured rather than from the order the body lists them: an epic's rows are written before the batch starts, and a child can run out of that order or not at all.

**A batch's children are measured from the delegated units' transcripts** ([#1285](https://github.com/joshuafolkken/kit/issues/1285)). `epicrun` runs every child in a delegated unit, so a run that read only the session files saw the parent waiting and none of the work — epic #1272's four merged children all printed as `no transcript`, and after the fix as 37.7 / 47.8 / 35.0 / 18.8 minutes with a model-and-tool breakdown each. The discovery is [`josh cost`](#josh-cost)'s and is shared, not copied. **The parent's wait and the unit's work are not both counted**: a session holds one `Agent` span across the whole time the unit runs, so the unit's spans are kept whole and the parent's are reduced by what they cover — the same interval subtraction the CI wait already used. Where nothing was delegated the subtraction is the identity, so such a run reports exactly as it did before. One consequence is worth expecting: the CI wait of a delegated child usually reads `0.0 min`, because the unit's own `pnpm josh followup` span already covers the open→merge window.

**A child is reported in four states, and three of them are not a duration of zero.** `not run` is a child nothing was measured for; `no transcript` is one that merged with no session transcript attributed, so only its CI wait is known and the three transcript shares are **withheld** rather than printed as `0.0 min`; `not merged` is a run that did not finish; only the fourth is fully measured. **The sample above shows two of them** — `not run` and the fully measured one — because [#1285](https://github.com/joshuafolkken/kit/issues/1285) attributed the delegated units' transcripts and no child of #1262 reports `no transcript` any more; the other two states are described here rather than printed there. The batch totals follow the same rule one level up — a half no child contributed to prints `not measured`, not a summed zero. **A row whose merge was not read carries the child's own notes beneath it**, because `not run` covers "the batch never reached it" and "the pull request listing could not be read" alike, and a status printed alone would report a rate-limited `gh` as an idle batch. `--json` carries each child's whole report, phase breakdown included, exactly as `--issue` carries one run's.

**`--last <N>` reports the last N merged runs as a distribution, because one run is not a sample** ([#1312](https://github.com/joshuafolkken/kit/issues/1312)). [`diag`](https://github.com/joshuafolkken/kit/blob/main/.claude/skills/diag/SKILL.md) already required that a verdict rest on more than one reading, and nothing here could produce the spread that asks for: the 2026-09-04 measurement ran `--issue` five times by hand, lined the rows up in an editor, and still left two verdicts as "cannot tell" with no way to say whether the cause was variance or too few readings. The runs are the N most recently **merged** pull requests whose head branch names an issue — the rule `pnpm josh time` with no argument already resolves "the run that just finished" by, extended from one run to N — and each is measured by exactly the code `--issue` and `--epic` use, so no scope can report a different figure for the same run. **Min, median and max rather than a mean and a deviation**: the question is whether an effect is larger than the spread, and three endpoints answer it without assuming a distribution five readings could never establish. The median goes in the duration column and the range beside it, with the **sample count** at the end — which is the point of the whole table:

```
the last 9 merged run(s) — 9 of 9 fully measured

By run (newest merge first):
  #1311                    40.9 min   measured
  #1310                    25.8 min   measured
  …

Where the wall clock went (median, then min – max):
  model wait               14.6 min   9.7 min – 23.6 min · 9 run(s)
  tool execution           13.3 min   10.0 min – 17.4 min · 9 run(s)

By phase (in run order, median, then min – max):
  plan                                not measured
  implement                 5.2 min   1.1 min – 14.5 min · 9 run(s)
  review                    5.7 min   3.8 min – 8.8 min · 9 run(s)
  …

By CI check (descending by median, jobs overlap):
  Checks                    1.5 min   1.4 min – 1.6 min · 9 run(s)
  SonarQube                 1.5 min   1.4 min – 1.8 min · 9 run(s)
  …
```

**A reading nobody could take is excluded, never counted as zero** — the property the whole scope rests on. A phase absent from two of five runs is **three samples and says so**, so a row is never dragged toward zero by the runs that never reached that stage; a phase no run detected prints `not measured` exactly as it does for one run; and a run that merged with **no session transcript attributed** is left out of the transcript-side rows entirely, with a note saying how many were excluded and why — it still contributes its CI wait, because that half _was_ read. The run list under the heading is what makes the sample checkable: a distribution whose readings nobody can name is not one a reader can verify. `--top` reaches each run's own tables exactly as it reaches an epic's children, and the distribution tables themselves are left uncapped for the reason `by_check` is — their rows are bounded by the vocabulary rather than by the length of a run. **Nothing about the measurement is new**: the runs are chosen here and measured by the same fan-out `--epic` goes through, so a second reading of a run cannot exist to disagree with the first.

**Nothing is ever silently zero**, as on the cost side. An absent transcript exits non-zero and says where it looked; a transcript with fewer than two dated lines says it has no timed lines rather than printing a table of zeroes. An issue with no pull request, one whose pull request is still open, and one no transcript is attributed to each say so in a note and print what _is_ known — and where no merge was read at all, the CI row is **withheld** rather than printed as a measured `0.0 min` beside a note saying it is unknown. The pull-request lookup answers in three states, not two: found, definitely absent, and _not found among the 500 most recently updated_ — and a read that failed (an unauthenticated or rate-limited `gh`) says so rather than being reported as proof that no pull request exists. `pnpm josh time` with nothing merged to report on exits non-zero and names the flags that pick a scope, and naming more than one of `--issue` / `--session` / `--epic` / `--last` / `--period` is refused rather than answered silently. `--period` with no run history to read exits non-zero and says the file is written by `josh followup`, rather than printing a period in which nothing happened. `--last` with no merged run to resolve exits non-zero too, rather than printing a distribution of zeroes. An epic that could not be read exits non-zero too — an epic that tracks no children is a real, empty answer and says so instead. The same distinction reaches inside a batch ([#1352](https://github.com/joshuafolkken/kit/issues/1352)): a child of `--epic`, or a run of `--last`, whose report could not be **built** at all is printed as `failed` rather than as `not run`, counted in its own note, and makes the command exit non-zero — where `not run` stays the ordinary answer for a child the batch simply never reached, and keeps the exit code at 0. The per-check table draws it too: a check-run read that was refused says so in a note instead of leaving an empty `By CI check` table that reads as a run GitHub recorded no checks for. And `--last` says when two merged pull requests named one issue ([#1365](https://github.com/joshuafolkken/kit/issues/1365)): the older is folded into the newer, because both halves of that issue's measurement are the same and keeping both would put one run into the distribution twice — but the fold is now **named** rather than silent, the note carrying the pull request numbers and `--json` the same numbers in `collapsed_pulls`, so a set called "the last 5" cannot be built from six merges with nothing saying so. The text tables are capped at 15 rows and say how many they withheld; `--json` carries every row unless `--top <rows>` asks for fewer, which says how many it withheld in a note rather than stopping silently.

### `josh layers`

List the checks that run in more than one verification layer, read from this project's own
configuration.

```bash
pnpm josh layers          # alias: josh ly
pnpm josh layers --json   # every row, for a script or another report
```

```
Verification layers — 5 read: gate, pre-commit, commit-msg, pre-push, ci

  Repeated across layers
  cspell                   3 layers   gate (project) · pre-commit (staged) · ci (project)
  eslint                   3 layers   gate (project) · pre-commit (staged) · ci (project)
  prettier                 3 layers   gate (project) · pre-commit (staged) · ci (project)
  type-check               3 layers   gate (project) · pre-commit (project) · ci (project)
  unit-tests               3 layers   gate (project) · pre-push (project) · ci (project)
  dependency-audit         2 layers   pre-push (project) · ci (project)
  dependency-install       2 layers   pre-push (project) · ci (project)

  One layer only
  branch-guard              1 layer   pre-commit (project)
  …
```

**It is not part of `josh time`, and that is a design decision rather than an omission**
(joshuafolkken/kit#1313, under epic joshuafolkken/kit#1315). `josh time` reads Claude Code's session
transcripts, and this repetition is invisible there in principle: a hook's seconds are buried inside
`josh git`'s 33–39 seconds, and CI's appear only as a per-check duration with nothing to compare
them against. Saying which check runs in which layer needs the configuration files, which is a
different reading of a different source.

**Nothing here is written down as today's answer.** The four sources are re-read on every run: the
gate's checks come from `gate-plan.ts`, which is `josh gate`'s own declaration of what it runs;
`lefthook.yml` is followed through its `extends` list, so the kit-internal file and the distributed
`lefthook/base.yml` are both read; every hook section carrying `commands` or `setup` becomes a
layer, so a hook added tomorrow is picked up without editing anything; and CI is every job of every
workflow a **pull request** triggers — a `push`-only workflow runs after the merge and is not
something a run waits for.

**The scope column is what says how much of a repeat is really the same work.** A hook command
carrying one of lefthook's file-list placeholders — `{staged_files}`, `{push_files}`, `{files}` —
sees only the files the hook handed it and is reported as `staged`; everything else, `{all_files}`
included, is `project`. That is how kit's pre-commit `tsc --noEmit` shows up as a whole-project type
check sitting beside four staged-only ones.

**Not every repeated row is a check to remove**, which is the other half of reporting rather than
deciding. `dependency-install` repeats between the pre-push `setup` and CI's install step and is
supposed to: `lefthook/base.yml` records at length (joshuafolkken/kit#813) why that barrier exists.
The row is there because it is real repeated work, not because it is a candidate.

**It reports on the working directory, and there is deliberately no flag naming another checkout.**
A file system path taken off the command line and handed straight to `readdir` / `readFile` is a
traversal waiting for a wrong argument, and what such a flag bought was a diagnostic convenience —
the command's use is "which checks repeat in the project I am in", where the installed kit _is_
that project's gate.

**A `josh` sub-command it cannot resolve is reported, not dropped.** The name appears in an
`unresolved josh commands:` note, so a hook rewired to a new target surfaces as a name to classify
rather than vanishing out of the table with nothing to say it had. **Expanding is not resolving**: a
target that carries its own command line — `josh hook:commit`, which runs the whole pre-commit hook —
is judged by what that expansion reached, and one that reached no check is reported by name exactly
like a target nothing knew about (joshuafolkken/kit#1367). Reporting only the names that failed to
expand would have left the loudest case silent, since a step running the whole of another layer is
the one worth seeing in a duplication report.

**It reports and changes nothing.** Which repeats are worth removing is a decision about what a hook
should guard — a red pre-push suite still catches what a local gate was never run for — so this
command puts the list in front of whoever makes that decision and stops there.

### `josh bench`

Measure what a verification command costs with its cache cold and with it warm, by running it twice.

```bash
pnpm josh bench                      # alias: josh bn — the four gate checks
pnpm josh bench gate                 # the whole gate, all three caches cleared
pnpm josh bench lint --repeat 3      # three cycles, the median of each phase
pnpm josh bench --json               # every row, for a script or another report
```

```
Cold and warm cost — 4 command(s) measured

  lint                      128.4 s   warm 2.9 s · 44.3× faster · cleared .eslintcache
  test:unit                  18.2 s   warm 18.0 s · 1.0× faster · no cache cleared
  cspell:dot                  8.4 s   warm 1.4 s · 6.0× faster · cleared .cspellcache
  check                       3.8 s   warm 1.4 s · 2.7× faster · cleared .tsbuildinfo
```

**It is not part of `josh time`, and that is a design decision rather than an omission**
([#1314](https://github.com/joshuafolkken/kit/issues/1314), under epic
[#1315](https://github.com/joshuafolkken/kit/issues/1315)). `josh time` reads Claude Code's session
transcripts and reports what a past run took; a transcript records one reading of a command in
whatever cache state that run happened to be in, so the difference between a cold and a warm one
exists nowhere in it. The answer has to be measured, which is a different act on a different source
— the same judgement `josh layers` was split out on.

**Cold is produced, not assumed.** One cycle per target is: remove that target's caches, run it, run
it again. The second run reads the caches the first one wrote, so the pair is a measurement rather
than a claim about the state the checkout was in when you typed the command.

**The clearing is defined per target.** `josh lint` writes only the eslint cache, so measuring it
clears only that — clearing all three first would report a cold type check and a cold spell check as
part of the lint's own cost. `josh bench gate` clears all three, because the gate writes all three.

**The gate is measured with `--force`, and without it that row would be a fiction.** `josh gate`
reuses a green result recorded on an unedited tree ([#1328](https://github.com/joshuafolkken/kit/issues/1328)),
so the warm reading — taken seconds after a green cold one, with nothing edited in between — would be
the skip notice rather than a run, and a green record already on disk would skip both readings. The
flag is what makes the pair a measurement, and the gate accepts it precisely because a person may know
something outside the tree moved, which is exactly what this command has just done to its caches.

**Nothing outside the gate's own cache files is ever removed, and nothing survives the run.** The
removable set is `GATE_CACHE_FILES` in `scripts/josh/josh-command-types.ts` — the gate's own
declaration of what it writes — and every entry of it is git-ignored and spell-check-excluded, which
`scripts/josh/gate-cache-flags.test.ts` already asserts. So a run changes no tracked file and leaves
nothing in `git status`; the warm run rewrites each cleared cache before the command exits, and a
cache that did not come back is reported in a note rather than left silent. The edit hook's
`.eslintcache.edit` is **not** in that set and is refused outright: a second writer on that file is
[#1332](https://github.com/joshuafolkken/kit/issues/1332) exactly.

**A gate running on this tree stops the command before it removes anything, and the question is asked
again before every clearing.** `josh gate` is started beside `/code-review` and holds its three caches
open for the whole of it, so clearing them mid-flight would corrupt the run paying for them. A default
run is minutes long and clears a target's caches before each cold reading, so a check once at start-up
would walk straight into a gate a hook or another session started after it; once a gate is running the
readings are void anyway, and the run stops rather than finishing with figures nobody can use. The
in-flight marker carries the gate's pid **and the time that process started**
([#1245](https://github.com/joshuafolkken/kit/issues/1245)), so one left behind by a killed gate blocks
nothing — and goes on blocking nothing after the operating system reissues that pid, which the pid on
its own could not promise. **The uncertain answer refuses rather than clears**: where the start time
cannot be read at all, a marker naming a live pid holds `josh bench` back, because being wrong the
other way deletes the caches a running gate is reading.

**Stopping keeps the readings it already took** ([#1369](https://github.com/joshuafolkken/kit/issues/1369)).
The abort's rationale is that a reading taken beside a gate measures neither of them, and that does not
reach backwards: the targets finished _before_ the gate started were measured on a tree nothing else was
running on. So their rows are printed, the targets the run never reached print `not measured`, and a note
says the run was interrupted and how many cycles each unfinished target managed — `cycles not finished:
cspell:dot 0 of 1, test:unit 0 of 1`. Discarding them made a user pay several minutes again because a
pre-commit hook started a gate thirty seconds ago.

```
Cold and warm cost — 2 command(s) measured

  lint                      128.4 s   warm 2.9 s · 44.3× faster · cleared .eslintcache
  check                       3.8 s   warm 1.4 s · 2.7× faster · cleared .tsbuildinfo
  cspell:dot                          not measured
  test:unit                           not measured

  interrupted by josh gate starting on this tree; cycles not finished: cspell:dot 0 of 1, test:unit 0 of 1
```

**An interruption has its own exit code, `2`.** `0` still means every target asked for was measured and
`1` still means the measurement produced nothing usable, so anything that only asks whether the run
finished reads non-zero exactly as before; the third value is what lets a caller tell a gate holding the
caches — worth retrying in a minute — from a red check that wants fixing. It is also on the report
itself, as `is_interrupted`, so a `--json` consumer reads the fact rather than inferring it from a note's
wording.

**A command that keeps no cache says so.** `josh test:unit` declares none — vitest's cache lives under
`node_modules`, and emptying that is a reinstall rather than a cold run — so its two readings measure
the operating system's page cache and run-to-run noise, and the row is labelled `no cache cleared`
rather than presenting the difference as a cache effect.

**A reading whose command exited non-zero is excluded from the figures and counted**, and its output
is written to stderr once per target — not once per phase per cycle — so the red check is visible
rather than only tallied. A check that stops at its
first error has measured how long it took to find that error, not what the check costs; averaging it
in is how a red tree comes to look like a cache win. A target whose every reading failed prints
`not measured`, never a zero — and **a report in which nothing at all was measured exits non-zero**,
so a `--json` consumer cannot read success off an empty answer.

**A ratio below one is printed as a slowdown.** The figure is cold ÷ warm, and on a target that clears
no cache noise routinely puts the warm reading above the cold one; `0.9× faster` would assert a cache
win the measurement contradicts, so the row says `1.1× slower` instead.

**`--repeat` takes the median, not the mean**, for the reason every timing table in this package does:
one reading interrupted by a background build moves a mean of three by seconds and a median not at
all. It is capped at 9 — one cycle of the default set is already two runs of every gate check, and a
cold lint alone is measured in minutes.

**The whole gate is left out of the default set**, since it is the sum of the four checks and
measuring both would double the wall clock to print the same seconds twice. Name it to get it.

### `josh eval`

Run the agent rule-compliance scenarios and report how many held.

```bash
pnpm josh eval                          # every scenario
pnpm josh eval consult-not-execute      # one scenario by name
JOSH_EVAL_MODEL=opus pnpm josh eval     # a different model (default: sonnet)
JOSH_EVAL_CONCURRENCY=2 pnpm josh eval  # fewer sessions at a time (default: 5)
```

Each scenario replays a representative situation against a real Claude session in a throwaway
sandbox carrying the documents and skills kit distributes, then judges it on the tool calls the run
made — never on what it said. That is what makes it usable for deciding whether a document change
worked: the `n/m` line is a number you can compare before and after an edit, where prose could only
be argued about.

Exits `0` only when every scenario held. It needs the `claude` CLI on `PATH` and is deliberately not
part of CI — every scenario costs tokens and minutes, so it is run when a distributed document,
skill or hook changes. See [docs/eval.md](./eval.md) for the scenario format and how to add one.

**Scenarios run up to five at a time**, so the suite's wall-clock is close to its slowest scenario
rather than the sum of all of them ([#1144](https://github.com/joshuafolkken/kit/issues/1144)).
`JOSH_EVAL_CONCURRENCY` lowers the width; a value that is not a positive integer is refused rather
than replaced by the default.

The run's last line is a verdict rather than only a count — `held`, `blocked`, `unmeasured` or
`unreachable` — because the exit code is `0` only when every scenario passed, so a failed run and one
that measured nothing exit alike. `blocked` stops a merge; the other two do not, but are reported.

`unreachable` is the narrow half of `unmeasured`: the sessions never reached the API, so the harness,
the prompt and the rule are all untested rather than tested and unclear
([#1197](https://github.com/joshuafolkken/kit/issues/1197)). Once two sessions have come back that
way the suite starts no more — the retries first, then anything still queued — because each one is a
whole Claude session meeting the same refusal. The environment a session is spawned with drops the
parent Claude session's own messaging socket and session identifiers, which is what made this the
default failure inside a delegated unit before
[#1158](https://github.com/joshuafolkken/kit/issues/1158) found it.

**A run of non-measurements is counted across runs.** The last verdict is kept in a small
per-checkout file in the temp directory, and three runs in a row ending on the same non-`held` word
print a `Warning: N runs in a row have ended …` line above the verdict, which stays the last line.
One non-measurement is already reported and reads as a one-off; the sequence is what says the gate
has been standing open, and nothing was watching it. Only a whole-suite run is counted — the named
re-run a bad verdict asks for would otherwise clear the count with a single scenario — a `held` suite
clears it, a different verdict starts a new one, and `blocked` never warns, because it measured
something and already stops the merge.

**Before the first session it records what it is about to measure** — a content hash per file under
the measured paths, written to a temp-directory file keyed to this checkout
([#1152](https://github.com/joshuafolkken/kit/issues/1152)). That is what lets the run start
alongside `/code-review` and still be checked for staleness afterwards, with
[`josh eval:scope --since-eval`](#josh-evalscope). **Only a whole-suite run writes it** — a named
re-run (`pnpm josh eval <name>`, what a `blocked` verdict asks for) leaves the record alone, so a
one-scenario reading can never stand in for the suite's measurement. **The record is marked finished
when the run returns a verdict** ([#1164](https://github.com/joshuafolkken/kit/issues/1164)) — an
amendment that leaves what was measured and when untouched — so a run interrupted at the keyboard or
killed by a throw leaves a record with no completion, which `--since-eval` reads exactly as it reads
no record at all. A run that cannot write it says
so and continues, which leaves the check with no record — and no record answers `required`. The file
is created owner-only and exclusively, after unlinking whatever was at the path, so a predictable
name in a shared temp directory cannot redirect the write or plant a record the check would trust.

### `josh eval:scope`

Say whether this change has to be measured by `josh eval` ([#907](https://github.com/joshuafolkken/kit/issues/907)).

```bash
pnpm josh eval:scope              # → required | skip ; alias: josh es
pnpm josh eval:scope --staged     # the staged diff
pnpm josh eval:scope --since-eval # what a review changed under a concurrent run
pnpm josh eval:scope --json       # the scope and the reason, machine-readable
```

The scope goes to stdout and the reason to stderr, so `$(pnpm josh eval:scope)` reads the scope and a person still sees why.

**The measurement is opt-in, and off unless `JOSH_EVAL` turns it on** ([#1235](https://github.com/joshuafolkken/kit/issues/1235)). Unset — the state of every checkout that was never told about the variable — answers `skip` whatever the diff holds, with a reason line naming the switch rather than the paths, so an unexpected `skip` leads to the switch instead of into the trigger set. `JOSH_EVAL=on pnpm josh eval:scope` restores the table below exactly as it was; `1`, `true` and `yes` read the same, and every other value, including `off`, leaves it off. It gates this command and `--since-eval` with it — never `josh eval` itself, which still runs when a person types it. The command loads `.env` when the file is there, so a checkout that wants the measurement back keeps `JOSH_EVAL=on` on a line of it rather than prefixing every gate; a value set in the environment still wins over the file. The reason it is off, and what a run then owes its completion report: [docs/eval.md](./eval.md) → "When it runs".

**The decision takes no judgement**, exactly as `josh review:level`'s does: the input is the list of changed paths and nothing else. "This edit is only wording" is a judgement made under cost pressure, and cost pressure resolves it toward `skip` at the moment a regression is most likely to ship.

| Any changed path is…                                                                                             | Scope      |
| ---------------------------------------------------------------------------------------------------------------- | ---------- |
| **measured** — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/skills/**`, `prompts/**`, `.claude/settings.json` | `required` |
| anything else                                                                                                    | `skip`     |

The measured set is derived from what the eval sandbox copies rather than restated here, so it cannot claim a path no scenario reads. **One measured path decides the whole change** — the suite measures the distribution, not the file that changed. **An empty diff answers `required`**: `skip` there would hand a caller that failed to read the diff the same answer as one that measured. The harness and the scenarios themselves (`scripts/eval/**`, `evals/scenarios/**`) do not fire it — changing the ruler is not changing what it measures. `.claude/settings.json` is the one coarse entry: the sandbox drops hooks that invoke the toolchain, so a change to only such a hook answers `required` and no scenario can observe it.

The gate asks about the branch diff. `--staged` is for a pre-commit reading, and the empty-list rule bites hardest there: an empty index answers `required`, which costs five real Claude sessions rather than `review:level`'s free `medium`.

**`--since-eval` asks the same question of a different diff — the one `/code-review` itself produced** ([#1152](https://github.com/joshuafolkken/kit/issues/1152)). The gate starts `josh eval` when the review starts, since neither writes to the working tree; the suite therefore measures the documents as they stood at that moment, and a review that then edited a measured path leaves the verdict describing a tree that no longer exists. This flag compares the record `josh eval` wrote before its first session against the tree now: `skip` means the review changed nothing the scenarios can see and the concurrent verdict stands, `required` means it edited a measured path — or that no record exists, or that the recorded run never reached a verdict ([#1164](https://github.com/joshuafolkken/kit/issues/1164)) — and the suite runs again. Git cannot answer this: the implementation and the review's fixes are uncommitted in the same tree, so a diff cannot say which side of the review a change fell on.

Two differences from the branch reading, both deliberate. **An empty result answers `skip` here**, the opposite of the branch reading's empty diff: the paths come from walking the trigger's own set rather than from a caller's diff, so nothing found is the positive fact that nothing moved. And **`--staged` alongside it is refused rather than resolved** — one asks about the index, the other about a recorded run, and answering one of them silently would answer a question nobody asked. The reason line names when the recorded run started, so a record left by some other loop is visible rather than assumed away — and a record whose run never finished is named as that rather than compared at all, because there is no verdict for the comparison to vouch for.

Where the answer is used, what a failure does, and why an epic's completion does not run the suite a second time: [docs/eval.md](./eval.md) → "When it runs".
