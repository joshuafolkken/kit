import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { COMMAND_MAP } from './josh/josh-command-map'

// The retirement route and the measurement that decides it (joshuafolkken/kit#1525).
//
// **This is the suite that would have to be edited to undo the change**, which is the point: the
// prose it pins says that what leaves a document when the budget binds is chosen by a reading rather
// than by which sentence a marker happened to protect. Left unpinned, that criterion is itself the
// least-defended text in the section it governs — the exact selection bias it was written to end.

// The residency doctrine's body moved out of `SKILL.md` §3 in joshuafolkken/kit#1797 — it binds on a
// turn spent editing these documents, never on one spent executing an Issue, so a workflow entry no
// longer reads it. The sentences below are the ones it took with it.
const SKILL = '.claude/skills/workflow-commands/rule-residency.md'
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
const COMMANDS = 'docs/josh-commands.md'

const RETIREMENT_MARKERS: ReadonlyArray<string> = [
	'**Trimming is moving, and deleting is the exception that has to be earned.**',
	'**A system that can only move eventually jams, so one route out exists — and it is narrow**',
	'**It is a clone of text that has a declared single source**',
	'**It carries no sentence that exists nowhere else**',
	'**No marker suite pins it**',
	'a rule with a firing test, a marker, or a measured effect is not a candidate at all',
]

const MEASUREMENT_MARKERS: ReadonlyArray<string> = [
	'**What leaves when the budget binds is decided by measurement, not by which sentence a marker happened to pin**',
	'`pnpm josh rule:value`',
	"**That window is the rule's absence**",
	'**The first reading refused the deletion it was built to justify, which is why the measurement runs first.**',
	'**unmeasured, never zero**',
	// The row the table had never carried, and the two facts that make it readable at all
	// (joshuafolkken/kit#1792). Left unpinned, the reason the batching guard is measured without being
	// delivered twice is exactly the sentence a later trim would take.
	'**The third reading added the row the table had never carried, and it changed no verdict either**',
	'**The row is scored on its refusal rather than on a trigger**',
]

describe('the retirement route', () => {
	it.each(RETIREMENT_MARKERS)('states %s', (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})

	it.each(MEASUREMENT_MARKERS)('records the measurement that decides it: %s', (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})

	it('keeps the reading that refused the deletion, so the number is not lost with the session', () => {
		const content = read_unwrapped(SKILL)

		expect(content).toContain('220 recorded runs')
		expect(content).toContain('55%')
		expect(content).toContain('15%')
	})
})

describe('the candidates the route refused', () => {
	it.each([
		'**The three tests then refused every remaining candidate, and that is the route working rather than failing.**',
		'**Being pinned is what test 3 is for**',
		'**A run that finds nothing retirable records the candidates with their evidence and stops there**',
	])('records why nothing further was retired: %s', (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})

	// The duplicate list failed test 3 rather than test 1, and these are the assertions that failed
	// it. If either suite ever stops requiring the row, the refusal recorded in §3 stops being true —
	// so the reason is pinned to the thing that produced it, not to a sentence about it.
	it.each([
		'**独立した呼び出しを同じターンに載せる規則**',
		'**バックログの WIP 上限（オープン 30 件）**',
		'**本文をシェルの二重引用符に載せない**',
	])('keeps the row %s that the marker suites require', (row) => {
		expect(read_unwrapped(RESIDENCY)).toContain(row)
	})
})

describe('the measurement command', () => {
	it('is registered, so the criterion names a command that exists', () => {
		expect(COMMAND_MAP['rule:value']?.script).toBe('scripts/rules/rule-value-cli.ts')
	})

	// The command reference is where the batching row's two design facts are written down, and both
	// are the kind a reader would otherwise have to re-derive from the source (joshuafolkken/kit#1792).
	it.each([
		'**A rule delivered by a binary of its own is measured here too, and the batching guard was the one that was not**',
		'**`keeps` is the one test of the seven that reads the turn rather than the call**',
		'**Reading that row also settled what a turn is here: a message id, not a line**',
	])('records how the batching row is scored: %s', (marker) => {
		expect(read_unwrapped(COMMANDS)).toContain(marker)
	})
})
