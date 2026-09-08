import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { EPICRUN_SKILL } from '#scripts/epicrun-loop-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1567. A delegated child's summary is re-read on every remaining turn of the
// parent, so its length is a cost the run keeps paying — one day's twenty children averaged 240,000
// tokens each, and `tool_result` was 25.2% of everything the parent accumulated.
//
// "Make it shorter" cannot be the rule, because a report cut by feel loses the observation nobody
// else recorded and keeps the file list anyone could have fetched. So both halves are written out,
// and this suite is what keeps them written.

const SKILL = EPICRUN_SKILL
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const POINTER = 'prompts/collaboration-workflow/epicrun.md'
const SECTION = 'What the summary carries, and how long it may be'
const PARENT_SECTION = '## Each child runs in a delegated unit'

// The criterion, which is what makes the two lists derivable rather than arbitrary.
const CRITERION = "The summary's only job is to carry what GitHub does not"

const FRAME: ReadonlyArray<string> = [
	CRITERION,
	'"Make it shorter" is not the rule',
	'Always kept — five things',
	'Always cut — three things',
	// A number, so that the length is not a judgement made under the pressure to be brief.
	'The bound is 25 lines',
	// A unit never told the bound writes to the length its own report format suggests.
	'The brief states the bound',
	// The bound is on the hand-back, not on what a person reads at the end of a run.
	'This does not shorten the person-facing completion report',
]

// Each of these is somewhere only the child was: cut, it is gone rather than fetched.
const KEPT: ReadonlyArray<string> = [
	'`Cause` / `Fix` / `Result`',
	'`josh eval` answering `skip`, `unmeasured` or `unreachable` is one of them',
	'Observations that could bite later',
	'Decisions taken and why',
	'What was left undone',
]

// Each of these is already on GitHub, so sending it costs the parent twice and buys nothing.
const CUT: ReadonlyArray<string> = [
	'The changed-file enumeration',
	'The per-round review detail',
	'Restatements of rules the parent already holds',
]

describe(`${SKILL} — the summary's contents and bound are written down`, () => {
	const content = read_repo_file(SKILL)
	const unwrapped = read_unwrapped(SKILL)

	it('gives the rule a section of its own', () => {
		expect(content).toMatch(new RegExp(`^### ${SECTION}$`, 'mu'))
	})

	// It is a rule about the delegated unit's hand-back, so it has to sit where that unit is defined
	// — a section that drifted out of it would read as a rule about reports in general.
	it('places the section inside the delegated-unit section', () => {
		const parent = content.indexOf(PARENT_SECTION)
		const section = content.indexOf(`### ${SECTION}`)

		expect(parent).toBeGreaterThan(-1)
		expect(section).toBeGreaterThan(parent)
		expect(section).toBeLessThan(content.indexOf('## A delegated unit that stopped'))
	})

	it.each(FRAME)('states %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	it.each(KEPT)('keeps %j in the summary', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	it.each(CUT)('cuts %j from the summary', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	// The measurement is what makes the bound arguable rather than a preference, so a reader who
	// wants to raise it has to argue with a number.
	it('cites the measurement the bound came from', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#1567')
		expect(unwrapped).toContain('240,000 tokens each')
		expect(unwrapped).toContain('25.2%')
	})
})

// `queue.md` already routes every paragraph of the delegated-unit section here, so a copy would be
// the clone `CLAUDE.md` prohibits — and the two would then disagree about what a summary may drop.
const SIBLINGS: ReadonlyArray<string> = [QUEUE, POINTER]

describe.each(SIBLINGS)('%s — carries none of the body', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it.each([...FRAME, ...KEPT, ...CUT])('does not restate %j', (marker) => {
		expect(unwrapped).not.toContain(marker)
	})
})
