import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1806: the `fullrun #<N>` branch printed its run's first commit as a bare
// `pnpm josh git -y`, with no message. That form does not work there: `fullrun #<N>` implements
// after `git switch main && git pull` and the branch is created only at commit time, so the current
// branch is `main` when the commit is issued — and `derive_issue_input_from_branch`
// (`scripts/git/git-issue.ts`) throws when it cannot read an issue number from the branch name.
// `fullrun new` (step 11) and `queue.md` (step 2b) already printed the form that carries the number,
// `pnpm josh git -y "<title> #<N>"`, so the failing shape survived in exactly one place. These
// markers pin the one form so the two cannot drift apart again.
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const BARE_CHAIN_GONE = 'no longer prints the message-less arrow chain'

// The commit form works from `main` because the message carries the issue number the branch name
// does not. Both first-commit points in the `#<N>` branch now print it.
const FIRST_COMMIT_MARKERS: ReadonlyArray<string> = [
	'exactly what it was) → `pnpm josh git -y "<title> #<N>"` →',
	'join it, and `pnpm josh git -y "<title> #<N>"`; on `skip`',
]

describe(`${FULLRUN} — the #<N> branch's first commit carries the issue number`, () => {
	const content = read_unwrapped(FULLRUN)

	it.each(FIRST_COMMIT_MARKERS)('prints %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The bare shape, asserted as an absence at each of the two first-commit points. A bare
// `pnpm josh git -y` still appears once as prose naming the step ("the bundle after
// `pnpm josh git -y`"), so the absence is pinned by context rather than as a blanket ban on the
// substring.
const RETIRED_BARE_FORMS: ReadonlyArray<string> = [
	'exactly what it was) → `pnpm josh git -y` →',
	'join it, and `pnpm josh git -y`; on `skip`',
]

describe(`${FULLRUN} — the message-less first-commit form is gone`, () => {
	const content = read_unwrapped(FULLRUN)

	it.each(RETIRED_BARE_FORMS)('no longer prints %j', (marker) => {
		expect(content).not.toContain(marker)
	})
})

// The form matches across the entries that print the commit as an issued step. `fullrun new` shares
// the FULLRUN file; `queue.md`, `chain-rule.md` and `SKILL.md` spell the pipeline out in their own
// files, so a form fixed only in FULLRUN would leave those entries printing the shape that fails
// from `main`.
const SHARED_COMMIT_FORM = 'pnpm josh git -y "<title> #<N>"'
const SHARED_FORM_FILES: ReadonlyArray<string> = [FULLRUN, QUEUE, CHAIN_RULE, SKILL]

describe('every entry prints the commit form that carries the issue number', () => {
	it.each(SHARED_FORM_FILES)('%s prints it', (path) => {
		expect(read_unwrapped(path)).toContain(SHARED_COMMIT_FORM)
	})
})

// The bare arrow chain `chain-rule.md` printed at its lines 16 and 36 is gone too — it was the same
// first-commit step, and its own decision table already used the numbered form.
describe(`${CHAIN_RULE} — the pipeline chain no longer prints the bare commit`, () => {
	it(BARE_CHAIN_GONE, () => {
		expect(read_unwrapped(CHAIN_RULE)).not.toContain('→ `pnpm josh git -y` → the follow-up filing')
	})
})

// `SKILL.md` printed the same first commit as `gate → join → git -y` in its own verification-gate
// paragraph, bare. The pull request opens there between the two review rounds, so it is the run's
// first commit and fails from `main` just as the `#<N>` branch did.
describe(`${SKILL} — the gate→join→commit chain no longer prints the bare commit`, () => {
	it(BARE_CHAIN_GONE, () => {
		expect(read_unwrapped(SKILL)).not.toContain('→ join → `pnpm josh git -y`,')
	})
})
