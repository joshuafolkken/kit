# Verify UI — rationale

This is maintainer-only rationale behind `.claude/skills/verify-ui/SKILL.md`: the reasons and history
behind the rendered-UI check. It is never read during a run — every step, fallback and refusal an agent
acts on stays in the skill, and a change to this file changes no rule.

## Why the skill reads as it does

**Why tests are not the look.** Unit and E2E tests stay green while spacing, layout and styling are
visibly broken, so the completion gate needs someone to look at the rendered result.

**Where the screenshot command came from.** `shot` shipped in app-kit 0.86.0
(joshuafolkken/app-kit#200); game-kit carries none yet. Either statement is true only of a version,
which is why the skill decides by the printed command list rather than by these facts.

**Why the E2E capture is a fallback, not a workaround.** A screenshot added to a Playwright spec is a
real capture and committed test code: it leaves the project with a screenshot the next run can take
again.

**Why no hand-rolled preview server.** Server lifecycle is what the toolkit command owns; an improvised
server driven from a throwaway script leaves a process running and nothing the next run can reuse.

**Why one invocation for every route.** A single invocation keeps the build and the preview server to
one start and one stop.

**Why every image is opened.** The point of the gate is the look; a run that captures files without
opening them has done nothing the tests did not already do.
