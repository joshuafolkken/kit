import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { document_section } from '#scripts/document/document-section'
import { document_section_cli } from '#scripts/document/document-section-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_step } from './run-step'
import { run_step_section } from './run-step-section'

const make_directory = temporary_directory()

const SUCCESS = 0
const FAILURE = 1
const SKILL_DIRECTORY = '.claude/skills/workflow-commands'

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function resolves(document: string, heading: string): boolean {
	const markdown = document_section.read_optional(document_section_cli.resolve_document(document))

	return markdown !== undefined && document_section.section(markdown, heading) !== undefined
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

describe('run_step_section — the one table of governing sections', () => {
	it.each([...run_step_section.GOVERNING_SECTIONS])(
		'resolves the %s row against the shipped documents',
		(_key, reference) => {
			expect(resolves(reference.document, reference.heading)).toBe(true)
		},
	)

	it('keys a command action on its josh subcommand, whatever its arguments', () => {
		const action = { kind: 'command' as const, line: 'pnpm josh run:cut --resume 3921' }

		expect(run_step_section.key_of(action)).toBe('run:cut')
	})

	it('keys a verdict on its token', () => {
		const action = { kind: 'verdict' as const, line: run_step.IMPLEMENT }

		expect(run_step_section.key_of(action)).toBe(run_step.IMPLEMENT)
	})

	it('prints nothing and succeeds for an action with no row', () => {
		const action = { kind: 'verdict' as const, line: run_step.WAIT }

		expect(run_step_section.print_for(action, false)).toBe(SUCCESS)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('prints the chain after a review round, and keeps no row for the round-2 ask ship now runs', () => {
		const ship_review = { kind: 'command' as const, line: 'pnpm josh ship --review' }

		expect(run_step_section.print_for(ship_review, false)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## Run the review-to-merge chain/u)
		expect(run_step_section.GOVERNING_SECTIONS.has('review:round2')).toBe(false)
	})

	it('prints the entry read, the split assessment, verbatim', () => {
		expect(run_step_section.print_section(run_step_section.ENTRY)).toBe(SUCCESS)
		expect(String(vi.mocked(console.info).mock.calls[0]?.[0])).toMatch(/^## The question/u)
	})

	// joshuafolkken/kit#5645: `run:progress --wait` prints the watcher's rules from this row.
	it('prints the progress watcher section for run:progress', () => {
		expect(run_step_section.print_section(run_step_section.PROGRESS)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## Progress while the run is quiet/u)
	})
})

// joshuafolkken/kit#5842: the retrospective step, `run:park` and `run:pause` print their section,
// so none of the three is fetched again.
describe('run_step_section — the sections the retrospective, a park and a pause print', () => {
	it('prints the retrospective for the end-of-run step', () => {
		const retrospective = { kind: 'command' as const, line: run_step.RETROSPECTIVE_COMMAND }

		expect(run_step_section.key_of(retrospective)).toBe(run_step_section.RETROSPECTIVE)
		expect(run_step_section.print_for(retrospective, false)).toBe(SUCCESS)
		expect(printed()).toMatch(/^# The end-of-run retrospective/u)
	})

	it('prints "park and continue" for a parent park, never the whole document', () => {
		expect(run_step_section.print_section(run_step_section.PARK)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## park and continue/u)
		expect(printed()).not.toMatch(/^# backlogrun/mu)
	})

	// A lane child's park is its stop, so it never reads the parent's "keep going".
	it('prints the park-then-stop for a lane child park', () => {
		expect(run_step_section.print_section(run_step_section.PARK, process.cwd(), true)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## A lane child records its park before it stops/u)
		expect(printed()).not.toContain('park and continue\n')
	})

	// Every entry pauses, so the pause prints the section naming each entry's branch — `fullrun` stops.
	it('prints every entry branch for a pause, the fullrun stop included', () => {
		expect(run_step_section.print_section(run_step_section.PAUSE)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## Each entry's branch, and the pause/u)
		expect(printed()).toContain('and then **stop**')
	})
})

describe('run_step_section — a lane child reads its own step of the chain', () => {
	const implement = { kind: 'verdict' as const, line: run_step.IMPLEMENT }
	const MAIN_MERGE_STEP = '`pnpm josh run:chain <N>` in one Bash call'
	const LANE_CHILD_HEADING = /^## A lane child — step 0\n\n0\. \*\*A lane child\*\*/u

	it.each([...run_step_section.LANE_CHILD_SECTIONS])(
		'resolves the lane child %s row against the shipped documents',
		(_key, reference) => {
			expect(resolves(reference.document, reference.heading)).toBe(true)
		},
	)

	it('prints step 0 under implement, through its ship, and never the main:merge step', () => {
		expect(run_step_section.print_for(implement, true)).toBe(SUCCESS)
		expect(printed()).toMatch(LANE_CHILD_HEADING)
		expect(printed()).toContain('`failed` → step 1.')
		expect(printed()).not.toContain(MAIN_MERGE_STEP)
	})

	it('prints step 0, not the main:merge step, after a stopped ship', () => {
		const ship_log = { kind: 'command' as const, line: 'pnpm josh ship --log 5016' }

		expect(run_step_section.print_for(ship_log, true)).toBe(SUCCESS)
		expect(printed()).toMatch(LANE_CHILD_HEADING)
		expect(printed()).not.toContain(MAIN_MERGE_STEP)
	})

	// joshuafolkken/kit#5626: `run:review` prints its own row, so a lane child's open reads step 0 too.
	it('prints step 0, not the main:merge step, for a lane child run:review', () => {
		expect(run_step_section.print_section('run:review', process.cwd(), true)).toBe(SUCCESS)
		expect(printed()).toMatch(LANE_CHILD_HEADING)
		expect(printed()).not.toContain(MAIN_MERGE_STEP)
	})

	it('prints the whole chain under implement outside a lane', () => {
		expect(run_step_section.print_for(implement, false)).toBe(SUCCESS)
		expect(printed()).toMatch(/^## Run the review-to-merge chain/u)
		expect(printed()).toContain(MAIN_MERGE_STEP)
	})
})

// joshuafolkken/kit#5946: step 0 is its own section, so a run outside a lane is not printed it.
describe('run_step_section — the chain outside a lane', () => {
	it('prints the chain for ship without the lane child step 0', () => {
		expect(run_step_section.print_section('ship', process.cwd(), false)).toBe(SUCCESS)
		expect(printed()).not.toContain('0. **A lane child**')
	})
})

describe('run_step_section — an unresolved heading fails', () => {
	let root = ''

	beforeEach(() => {
		root = make_directory('run-step-section-')
		mkdirSync(path.join(root, SKILL_DIRECTORY), { recursive: true })
		writeFileSync(
			path.join(root, SKILL_DIRECTORY, 'split-assessment.md'),
			'# Split\n\n## Renamed\n',
		)
	})

	it('fails when the named heading is gone from the document', () => {
		expect(run_step_section.print_section(run_step_section.ENTRY, root)).toBe(FAILURE)
	})
})

describe('run_step_section — a consumer-shaped root', () => {
	let root = ''

	beforeEach(() => {
		root = make_directory('run-step-section-consumer-')
		writeFileSync(path.join(root, 'package.json'), '{}\n')
	})

	it.each([...run_step_section.GOVERNING_SECTIONS.keys()])(
		'prints the %s row from the kit package when the root ships no copy',
		(key) => {
			expect(run_step_section.print_section(key, root)).toBe(SUCCESS)
		},
	)

	it.each([...run_step_section.LANE_CHILD_SECTIONS.keys()])(
		'prints the lane child %s row from the kit package when the root ships no copy',
		(key) => {
			expect(run_step_section.print_section(key, root, true)).toBe(SUCCESS)
		},
	)
})
