import { read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1567 shipped the session-boundary check and wired it to `epicrun` and `queue`
// only, so `fullrun` and `halfrun` carried whatever earlier Issues had run in the same session into
// every one of their own requests — measured at 88,481 tokens riding on all 49 requests of one
// `fullrun`, 24% of that run's cost (joshuafolkken/kit#1605).
//
// These are marker assertions rather than behavioral ones because the entry check is a procedure an
// agent reads, exactly as every other rule in this suite family is. What they pin is that the
// question exists at both entry points, that it is answered by a command rather than by judgement,
// and that the definition lives in one place instead of being copied into each entry.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'

const ENTRIES: ReadonlyArray<string> = [FULLRUN, HALFRUN]

const COMMAND = 'pnpm josh cost --over 150000'
const RELEASE_COMMAND = 'pnpm josh run:release'
const HOLD_COMMAND = 'pnpm josh run:hold'

// The one sentence that names this application point. Both entries cite it, and it exists once.
const DEFINITION = 'The session boundary is asked at the entry as well'
const SKILL_CITATION = '`SKILL.md` → §2, "The session boundary is asked at the entry as well"'
const HANDOFF_CITATION = '`epicrun.md` → "The hand-off"'

// A run that decides from how long the session feels is the failure the command exists to remove,
// so the branch has to be attached to the answer in words.
const NOT_A_JUDGEMENT = 'never on a judgement about how long the session feels'

// The threshold's derivation belongs to the single source. An entry that restates it drifts, and
// the next reader cannot tell which copy the number was actually drawn from.
const DERIVATION_ONLY: ReadonlyArray<string> = ['223 セッションの実測', '54,974', '121,514']

describe(`${SKILL} — the entry application is defined once`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('names the application point', () => {
		expect(unwrapped).toContain(DEFINITION)
	})

	it('asks the same command the post-merge check asks', () => {
		expect(unwrapped).toContain(COMMAND)
	})

	// The whole point of the seam: nothing has been filed, branched or edited, so the stop is free.
	it('puts the question in the same turn as the hold', () => {
		expect(unwrapped).toContain(HOLD_COMMAND)
		expect(unwrapped).toContain('before anything else is started')
	})

	it('releases the tree on the stop rather than keeping the hold', () => {
		expect(unwrapped).toContain(RELEASE_COMMAND)
	})

	it('routes the check itself to its single source instead of restating it', () => {
		expect(unwrapped).toContain(HANDOFF_CITATION)
	})

	// A batch owns this question at its own seam, with the drain and the resume command that
	// continues it. A child that asked at its own entry would release a hold the batch owns and hand
	// the person a resume command that abandons the rest of it.
	it('forbids a dispatched child from asking it', () => {
		expect(unwrapped).toContain('A dispatched child does not ask it')
		expect(unwrapped).toContain(
			'the entry ask belongs to a `fullrun` or a `halfrun` a person typed',
		)
	})
})

describe.each(ENTRIES)('%s — asks the boundary at its entry', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it('asks the command', () => {
		expect(unwrapped).toContain(COMMAND)
	})

	it('branches on the answer rather than on judgement', () => {
		expect(unwrapped).toContain(NOT_A_JUDGEMENT)
	})

	// `over` at the entry is a stop with an empty tree, which is the one stop that both notifies and
	// hands the tree back.
	it('stops with a confirmation notification and releases the tree', () => {
		expect(unwrapped).toContain('confirmation')
		expect(unwrapped).toContain(RELEASE_COMMAND)
	})

	// Without this half the check fires inside a batch, where it stops the wrong run.
	it('exempts a run a batch entry point dispatched', () => {
		expect(unwrapped).toContain('Skip it when this run was dispatched by')
	})

	it('cites the definition instead of holding its own', () => {
		expect(unwrapped).toContain(SKILL_CITATION)
		expect(unwrapped).toContain(HANDOFF_CITATION)
	})

	it.each(DERIVATION_ONLY)('does not copy the derivation %j', (marker) => {
		expect(unwrapped).not.toContain(marker)
	})
})

// The threshold and where it came from stay with the check, so a reader who doubts the number finds
// one derivation rather than three.
describe(`${EPICRUN} — still owns the threshold and its derivation`, () => {
	const unwrapped = read_unwrapped(EPICRUN)

	it.each(DERIVATION_ONLY)('carries %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	// The single source describes the post-merge seam; the entry seam is SKILL.md's sentence.
	it('does not restate the entry application', () => {
		expect(unwrapped).not.toContain(DEFINITION)
	})
})
