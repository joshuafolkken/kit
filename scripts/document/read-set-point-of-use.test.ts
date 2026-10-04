import { describe, expect, it } from 'vitest'
import { backlogrun_parent_read_set } from './backlogrun-parent-read-set'
import { entry_read_set } from './entry-read-set'
import { lane_child_read_set } from './lane-child-read-set'
import { read_set_point_of_use } from './read-set-point-of-use'

const ROOT = process.cwd()
const KICKOFF = 'kickoff'
const FULLRUN = 'fullrun'
const FOLLOWUP = 'followup.md'
const CHAIN_RULE = 'chain-rule.md'
const BACKGROUND_COMMANDS = 'background-commands.md'
const PRE_GATE_CUT = 'pre-gate-cut.md'

function point_of_use_of(entry: string): Array<string> {
	return entry_read_set.costed(ROOT, entry).point_of_use.map((one) => one.file)
}

describe('read_set_point_of_use.point_of_use_files — only what the entry reaches (#3078)', () => {
	it('drops a global point-of-use file the entry path never names', () => {
		const files = read_set_point_of_use.point_of_use_files(KICKOFF, new Set([FOLLOWUP]))

		expect(files).toContain(FOLLOWUP)
		expect(files).not.toContain(CHAIN_RULE)
	})

	it('keeps the per-entry files whatever the path names', () => {
		const files = read_set_point_of_use.point_of_use_files('backlogrun', new Set())

		expect(files).toEqual(expect.arrayContaining(['delegation.md', 'fullrun.md']))
	})
})

describe('entry_read_set.costed — point-of-use totals scoped per entry (#3078)', () => {
	const NEVER_IN_KICKOFF = [
		FOLLOWUP,
		CHAIN_RULE,
		BACKGROUND_COMMANDS,
		PRE_GATE_CUT,
		'backlogrun-child.md',
		'backlogrun-lanes.md',
		'backlogrun-progress.md',
		'backlogrun-park.md',
		'backlogrun-steps.md',
		'retrospective.md',
	]

	it.each(NEVER_IN_KICKOFF)('kickoff is not charged for %s', (file) => {
		expect(point_of_use_of(KICKOFF)).not.toContain(file)
	})

	it('fullrun is charged for the gate and merge documents its manifest names', () => {
		expect(point_of_use_of(FULLRUN)).toEqual(
			expect.arrayContaining([FOLLOWUP, CHAIN_RULE, PRE_GATE_CUT]),
		)
	})

	it('halfrun reaches background-commands.md through its SKILL.md trigger row, not followup.md', () => {
		const files = point_of_use_of('halfrun')

		expect(files).toContain(BACKGROUND_COMMANDS)
		expect(files).not.toContain(FOLLOWUP)
	})

	it('backlogrun is not charged for the pre-gate cut only a gating run takes', () => {
		expect(point_of_use_of('backlogrun')).not.toContain(PRE_GATE_CUT)
	})

	it('kickoff reaches fewer point-of-use documents than fullrun', () => {
		expect(point_of_use_of(KICKOFF).length).toBeLessThan(point_of_use_of(FULLRUN).length)
	})
})

// The per-document ceiling exempts every global point-of-use file, so one no entry or role is charged
// for would be held by neither budget and could grow unchecked.
describe('every global point-of-use file is charged somewhere (#3078)', () => {
	const charged = new Set(
		[
			...entry_read_set.entries(ROOT).map((entry) => entry_read_set.costed(ROOT, entry)),
			lane_child_read_set.costed(ROOT),
			backlogrun_parent_read_set.costed(ROOT),
		].flatMap((report) => report.point_of_use.map((one) => one.file)),
	)

	it.each([...read_set_point_of_use.POINT_OF_USE_FILES])('%s is charged to an entry', (file) => {
		expect(charged).toContain(file)
	})
})

describe('a role reaches documents its base entry path does not name (#3078)', () => {
	it.each([...lane_child_read_set.REACHED_POINT_OF_USE])('the lane child keeps %s', (file) => {
		const files = lane_child_read_set.costed(ROOT).point_of_use.map((one) => one.file)

		expect(files).toContain(file)
	})

	it.each([...backlogrun_parent_read_set.REACHED_POINT_OF_USE])(
		'the backlogrun parent keeps %s',
		(file) => {
			const files = backlogrun_parent_read_set.costed(ROOT).point_of_use.map((one) => one.file)

			expect(files).toContain(file)
		},
	)
})
