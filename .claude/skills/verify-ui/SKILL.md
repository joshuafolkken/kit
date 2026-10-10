---
name: verify-ui
description: Screenshot the affected route with the project's own command and check it matches the intent. Use it before reporting any UI, layout, styling, copy or interaction change as done.
argument-hint: '[route] [route...]'
---

# Verify the rendered screen

The completion gate in `CLAUDE.md` says a change that affects the rendered UI is not done until
someone has looked at the rendered result; passing unit and E2E tests are not that look. This skill is
the look. Rationale: `docs/maintainers/verify-ui-rationale.md` → "Why the skill reads as it does".

## 1. Decide which routes to capture

In order:

1. The routes given as arguments (`/verify-ui / /blog`).
2. Otherwise, derive the candidates with `pnpm josh ui:routes`: it reads the
   change (the branch diff, or the staged diff with `--staged`) and lists the routes it touches,
   tracing a changed shared component to the routes that render it. From that list **pick the ones a
   reader would notice** — that narrowing is the judgement the command leaves to you.
3. If it derives no route — it prints that plainly rather than guessing — ask which screen to look
   at. Do not guess.

State the list before capturing, so a wrong route is caught before the build.

## 2. Find this project's screenshot command

The command belongs to the application layer, not to this package, and it differs per project type.
Look for it in this order and stop at the first hit:

1. `pnpm josh-app shot` — the SvelteKit application toolkit (`@joshuafolkken/app-kit`).
2. `pnpm josh-game shot` — the game toolkit (`@joshuafolkken/game-kit`).
3. A project-local script named `shot`, `screenshot` or `verify:ui` in `package.json`.

Option 1 exists since app-kit 0.86.0; game-kit carries no `shot` yet, so a game project lands on
option 3 or the fallback below. Both are true of a version, and
the version a project has installed is the only thing that decides.

**Decide by the printed command list, not by whether the toolkit is installed.** Run the toolkit
with no subcommand (`pnpm josh-app`) and read the usage line it prints; `shot` exists only if that
list names it. An unknown subcommand exits non-zero with the same usage line, so a toolkit that is
present but has no `shot` command and a toolkit that is absent are told apart by reading the list,
not by whether the invocation succeeded.

### When there is no screenshot command

The gate still has to be met, so fall back in this order.

**Capture through the project's own E2E suite.** If it has Playwright specs, add a
`await page.screenshot({ path: … })` to the spec that already covers the affected screen — or a new
spec if none does — and run it.

**Otherwise stop and say so.** Report, in the session language:

- that this project has neither a screenshot command nor an E2E suite to capture through, naming
  what you looked for;
- that the UI verification gate is therefore **not** closed by this run;
- that the change needs a human to look at the screen, and ask the user to do it.

Never report the gate as satisfied on tests alone. Never stand up a preview server by hand and drive
it from a throwaway script left outside the repository. If the project should have the command and
does not, that is an issue to file against the application toolkit.

## 3. Capture

Run the command once for every route in a single invocation (`pnpm josh-app shot / /blog`). Wait for
it to finish and note the output directory it prints. On the E2E fallback, run the spec and note where its
`path` option wrote the images.

If it exits non-zero, report the failure as the result. A failed capture is not a passed gate.

## 4. Look at the images

Read every produced image with the Read tool. Actually look at each one — capturing files without
opening them does not close the gate.

Check what the change was supposed to do to the screen: the element is present, in the right place,
at the right size, with the intended spacing, color and text; nothing that used to be there has
disappeared or moved; the layout is not broken at the captured viewport.

## 5. Report

- **Matches the intent**: say what you looked at, route by route, and what you checked on each. Name
  the image paths so the user can open the same files.
- **Does not match**: for each mismatch give the route, what the change was supposed to produce,
  what the image actually shows, and the image path. Then fix and capture again. Do not report the
  work as done with a known mismatch outstanding.
- **Could not capture**: the report from step 2 or step 3, unchanged. This is not a pass.
