---
name: verify-ui
description: Screenshot the affected route with the project's own command and check it matches the intent. Use it before reporting any UI, layout, styling, copy or interaction change as done.
argument-hint: '[route] [route...]'
---

# Verify the rendered screen

A rendered-UI change is not done until someone has looked at it (`CLAUDE.md` → completion gate);
passing tests are not that look.

## 1. Decide which routes to capture

1. The routes given as arguments (`/verify-ui / /blog`).
2. Otherwise `pnpm josh ui:routes` (branch diff, or `--staged`) lists the routes the change touches;
   **pick the ones a reader would notice**.
3. If it derives none, ask which screen to look at. Do not guess.

State the list before capturing.

## 2. Capture

Run `pnpm josh ui:shot <route>...` once, with every route (`pnpm josh ui:shot / /blog`). It finds this
project's screenshot command and runs it; do not probe the candidates by hand. The command prints the
image paths, and its exit status is the result. A failed capture is not a passed gate.

### When there is no screenshot command

`ui:shot` says so — `no screenshot command in this project — tried:` and the candidates — and exits
non-zero. Only then:

**Capture through the project's own E2E suite**: add `await page.screenshot({ path: … })` to the
Playwright spec covering the screen (or a new spec) and run it.

**Otherwise stop and say so**, in the session language: what you looked for, that the UI verification
gate is **not** closed by this run, and ask the user to look at the screen.

Never report the gate as satisfied on tests alone. Never stand up a preview server by hand and drive
it from a throwaway script. A project that should have the command and does not is an issue against
the application toolkit.

## 3. Look at the images

Read every produced image with the Read tool — capturing without opening does not close the gate.
Check the change's intent: element present, placed, sized, spaced, colored and worded as intended;
nothing else disappeared or moved; the layout holds at the captured viewport.

## 4. Report

- **Matches the intent**: route by route, what you checked, with the image paths (on the E2E
  fallback, the `path` option).
- **Does not match**: route, intended result, what the image shows, image path. Fix and capture again.
- **Could not capture**: the report from step 2, unchanged. This is not a pass.
