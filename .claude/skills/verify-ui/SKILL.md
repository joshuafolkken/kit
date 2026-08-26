---
name: verify-ui
description: Close the UI verification gate on a change that alters the rendered screen — capture a screenshot of the affected route through this project's own screenshot command, look at it, and report whether it matches the intent. Use it before reporting any UI, layout, styling, copy, visible-state or interaction change as done. It reports that the project has no screenshot command rather than passing when it cannot capture anything.
argument-hint: [route] [route...]
---

# Verify the rendered screen

The completion gate in `CLAUDE.md` says a change that affects the rendered UI is not done until
someone has looked at the rendered result. Passing unit and E2E tests are not that look: they stay
green while spacing, layout and styling are visibly broken. This skill is the look.

## 1. Decide which routes to capture

In order:

1. The routes given as arguments (`/verify-ui / /blog`).
2. Otherwise, derive them from the change: read `git diff` (and `git diff main...HEAD` on a feature
   branch) and take the routes whose components, styles or copy the diff touches. A change to a
   shared component means every route that renders it — pick the ones a reader would notice.
3. If neither yields a route, ask which screen to look at. Do not guess.

State the list before capturing, so a wrong route is caught before the build.

## 2. Find this project's screenshot command

The command belongs to the application layer, not to this package, and it differs per project type.
Look for it in this order and stop at the first hit:

1. `pnpm josh-app shot` — the SvelteKit application toolkit (`@joshuafolkken/app-kit`).
2. `pnpm josh-game shot` — the game toolkit (`@joshuafolkken/game-kit`).
3. A project-local script named `shot`, `screenshot` or `verify:ui` in `package.json`.

Option 1 exists: `shot` shipped in app-kit 0.86.0 (joshuafolkken/app-kit#200). Option 2 does not
yet — game-kit carries no `shot` — so a game project still lands on option 3 or the fallback below.
Neither statement is a substitute for the check in the next paragraph: both are true of a version,
and the version a project has installed is the only thing that decides.

**Decide by the printed command list, not by whether the toolkit is installed.** Run the toolkit
with no subcommand (`pnpm josh-app`) and read the usage line it prints; `shot` exists only if that
list names it. An unknown subcommand exits non-zero with the same usage line, so a toolkit that is
present but has no `shot` command and a toolkit that is absent are told apart by reading the list,
not by whether the invocation succeeded.

### When there is no screenshot command

The gate still has to be met, so fall back in this order.

**Capture through the project's own E2E suite.** If it has Playwright specs, add a
`await page.screenshot({ path: … })` to the spec that already covers the affected screen — or a new
spec if none does — and run it. This is a real capture and it is committed test code, which is why
it is a fallback and not a workaround: it leaves the project with a screenshot the next run can take
again.

**Otherwise stop and say so.** Report, in the session language:

- that this project has neither a screenshot command nor an E2E suite to capture through, naming
  what you looked for;
- that the UI verification gate is therefore **not** closed by this run;
- that the change needs a human to look at the screen, and ask the user to do it.

Never report the gate as satisfied on tests alone. Never stand up a preview server by hand and drive
it from a throwaway script left outside the repository: server lifecycle is what the toolkit command
owns, and an improvised one leaves a process running and nothing the next run can reuse. If the
project should have the command and does not, that is an issue to file against the application
toolkit.

## 3. Capture

Run the command once for every route in a single invocation (`pnpm josh-app shot / /blog`). One
invocation is what keeps the build and the preview server to one start and one stop. Wait for it to
finish and note the output directory it prints. On the E2E fallback, run the spec and note where its
`path` option wrote the images.

If it exits non-zero, report the failure as the result. A failed capture is not a passed gate.

## 4. Look at the images

Read every produced image with the Read tool. Actually look at each one — the point of the gate is
the look, and a run that captures files without opening them has done nothing the tests did not
already do.

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
