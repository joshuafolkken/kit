import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1433: every measure before this one narrowed the second review round, and the
// records that measured them answer "narrow round 2" rather than "do not run one" — none of them
// covers a run that skipped one. This suite pins the condition that decides it, and the four things
// a later trim would take out first, because each of them is what keeps the condition from widening
// back into the line it was written to reject.
//
// **The direction matters and is asymmetric.** A marker lost here does not fail a run; it lets one
// skip a round it should have run, silently, on the exact path the evidence below rules out.
const REVIEW_PROMPT = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const SECTION_TITLE = 'When round 2 is skipped entirely, and when it is not'
const COMMAND = 'pnpm josh review:round2'
const CLOSED_FLAG = '--round-1-closed'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_TITLE}`,
	// Why the two measured sections above it do not already answer this question. Without it the next
	// reader takes `r = 0.05` as covering a skip, which it does not: every figure in those sections
	// came from a run that ran its second round.
	'**The two sections above answer a proposal to _narrow_ round 2. Neither answers a proposal to _not run_ one**',
	// The decision is a command's. Dropped, the condition becomes a list an agent applies from memory
	// under cost pressure — the failure mode `josh review:level` and `josh delegate` both exist for.
	"**the decision is a command's rather than a reading of the list below**",
	`${COMMAND} ${CLOSED_FLAG}`,
	// The default, which is the whole safety property.
	'**Without the flag the answer is `required`**',
	// The two arms, and the answer each gives to joshuafolkken/kit#1222's conclusion. That conclusion —
	// round 1's fix code is unreviewed, structurally — is what this condition has to survive, so the
	// arms are pinned together with the sentence naming it.
	"round 1's fix code is unreviewed",
	'**A — no fix code**',
	'**B — inert fix code**',
	'the premise is absent rather than overridden',
	// The standard is untouched, which is the sentence a reader most easily assumes away when a round
	// disappears.
	'**Neither arm weakens the standard.**',
	// The ordering, which is the difference between a condition that fires and one that cannot.
	// `pnpm josh bump minor` writes `package.json` — not inert — into the fix delta, so an answer
	// taken after it is `required` whatever round 1 did, and neither arm ever fires again.
	'_before_ `pnpm josh bump minor`',
	// And the half a reader most easily takes with the skip: round 1 edited the tree, so the gate is
	// stale and re-runs after the bump. Without this the run commits on an unverified tree.
	'**A `skip` moves only whether the second round runs.**',
	// The one state the digests cannot describe on their own. Without the timestamp in the record,
	// an arm-A skip and a snapshot retaken after the fixes read identically forever after.
	"**Arm A's answer carries round 1's timestamp, because the digests alone cannot separate two states.**",
]

// The three rejections. Each one is a line someone will propose again, and each is rejected on
// measured evidence rather than on caution — so the evidence travels with the rejection or the
// rejection reads as a preference and gets argued with.
const REJECTION_MARKERS: ReadonlyArray<string> = [
	'#### The wider line joshuafolkken/kit#1433 proposed is not adopted',
	'the fix delta touches no **runtime code path**',
	'**It is rejected on evidence already in this repository, not on caution.**',
	'**ten real defects in each**',
	'**no test covered, because prose is what they were**',
	'**The narrower fallback that issue floated — "test files only" — is rejected on the same axis.**',
	'an assertion a fix weakened still passes, and the gate reports green',
	'**A distributed prompt is not documentation about this repository; it is what the agent executes.**',
	'#### Skipping, rather than a lighter round',
	'**The saving here is entirely in not forking**',
]

// The two halves that make the condition auditable: a skip nobody can count is a condition nobody
// can withdraw, and a withdrawal criterion nobody wrote is one nobody applies.
const AUDIT_MARKERS: ReadonlyArray<string> = [
	'#### Recording a skip, so the condition can be judged later',
	'**A skipped round is recorded on the Issue, not only in the run.**',
	'review-round2-skipped',
	'## Round 2 skipped',
	'#### When the condition is withdrawn',
	'**Arm B is withdrawn on the first confirmed case**',
	'**Arm A is not withdrawable by evidence of this kind, and saying so is not confidence.**',
]

describe(`${REVIEW_PROMPT} — the skip condition is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(REJECTION_MARKERS)('keeps the rejected line and its evidence: %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(AUDIT_MARKERS)('keeps the condition auditable: %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('routes the round cap to the condition rather than restating it', () => {
		expect(content).toContain('**Two rounds is the ceiling, not the schedule.**')
		expect(content).toContain(`"${SECTION_TITLE}"`)
	})
})

// The four documents a run actually reads at the moment the round would start. A condition stated
// only in `prompts/review.md` is one the forked agent and a skill-only reader never reach, which is
// the mechanism joshuafolkken/kit#1241 already had to correct once for the round-2 target.
const ROUTING: ReadonlyArray<string> = [CHAIN_RULE, GATE_BULLET, FULLRUN]

// The word that has to survive in each of them. `required` is the half a trim takes out first,
// because it reads as restating the command's own default — and without it the reader is told a
// round can be skipped and never told when it cannot.
const RECORDED_SKIP = /records? the skip|skip is recorded/u
// The ordering constraint, in whichever wording each document reached for. A document that names the
// command without it sends a run to ask after `pnpm josh bump minor`, where the answer is `required`
// forever — the command would look correct and the condition would never once fire.
const ASK_BEFORE_BUMP = /before[^.]{0,40}bump/u

describe('every document that reaches the round names the command', () => {
	it.each(ROUTING)('%s names the command with its flag', (document) => {
		expect(read_unwrapped(document)).toContain(`${COMMAND} ${CLOSED_FLAG}`)
	})

	// Naming the command is not enough on its own: a reader has to be told which answer means what,
	// and that the round runs on anything else. That is the acceptance criterion the issue stated as
	// "the round always runs where the condition is not met", guarded here rather than left to the
	// command's own default.
	it.each(ROUTING)('%s sends the reader to the condition', (document) => {
		expect(read_unwrapped(document)).toContain(SECTION_TITLE)
	})

	it.each(ROUTING)('%s says the round runs on required', (document) => {
		expect(read_unwrapped(document)).toContain('`required`')
	})

	it.each(ROUTING)('%s says a skip is recorded on the Issue', (document) => {
		expect(read_unwrapped(document)).toMatch(RECORDED_SKIP)
	})

	it.each(ROUTING)('%s puts the ask ahead of the version bump', (document) => {
		const content = read_unwrapped(document)

		expect(content).toMatch(ASK_BEFORE_BUMP)
		expect(content).toContain('is not inert')
	})
})

describe(`${COMMAND_DOC} — the command is documented`, () => {
	const content = read_unwrapped(COMMAND_DOC)

	it.each([
		'### `josh review:round2`',
		'alias: josh r2',
		`${COMMAND} ${CLOSED_FLAG}`,
		// The one input no command can read for itself, and the reason its absence is safe.
		'**`--round-1-closed` is the one input no command can read for itself**',
		'a run that forgets it pays a round rather than skipping one',
		// The rejected line, kept beside the command so a reader reaching for `--round-1-closed` on a
		// prompt-only fix finds the answer where they are rather than in `prompts/review.md`.
		'**A prompt fix and a test fix both answer `required`, deliberately.**',
		'**Ask it before `josh bump minor`, never after.**',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
