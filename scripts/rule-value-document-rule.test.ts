import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { COMMAND_MAP } from './josh/josh-command-map'

// The retirement route and the measurement that decides it (joshuafolkken/kit#1525).
//
// **This is the suite that would have to be edited to undo the change**, which is the point: the
// prose it pins says that what leaves a document when the budget binds is chosen by a reading rather
// than by which sentence a marker happened to protect. Left unpinned, that criterion is itself the
// least-defended text in the section it governs — the exact selection bias it was written to end.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'

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
		expect(content).toContain('58%')
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
})
