import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_test_fixture } from './gate-test-fixture'
import { verification_gate, type GateStepResult } from './verification-gate'

// joshuafolkken/kit#3644: no gate step writes to the tree any more, so the green record is withheld
// for every tree that moved while the checks were in flight — with no exception left to let through.
// A record written for a tree the checks never read is reused by `run:review --join` and the pre-push
// hook as "these checks passed", so the comparison is pinned here in both directions. The tree read
// is stubbed, since git cannot answer from inside a worker.

const STAMP_FILE = 'scripts/gate/gate-report.ts'
const ADDED_FILE = 'scripts/gate/gate-plan.ts'
const STAMP_BASE = 'a1b2c3d4'
const DIGEST = 'digest-one'
const BEFORE: Record<string, string> = { [STAMP_FILE]: DIGEST }
const MOVED: Record<string, string> = { [STAMP_FILE]: 'digest-two' }
const ADDED: Record<string, string> = { ...BEFORE, [ADDED_FILE]: DIGEST }

const RECORDS = gate_test_fixture.suite_records('record-moved-tree')

function green(label: string): GateStepResult {
	return {
		label,
		command: `josh ${label}`,
		exit_code: 0,
		output: `output of ${label}`,
		elapsed_ms: 1,
	}
}

const GREEN_GATE: ReadonlyArray<GateStepResult> = [
	green(gate_plan.LINT_LABEL),
	green(gate_plan.METRICS_LABEL),
	green(gate_plan.UNIT_LABEL),
]

async function record_after(after: Record<string, string>): Promise<void> {
	const spy = vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(after)

	try {
		await verification_gate.record_green_gate(GREEN_GATE, BEFORE, RECORDS.stamp_path, STAMP_BASE)
	} finally {
		spy.mockRestore()
	}
}

beforeEach(RECORDS.clear)
afterEach(RECORDS.clear)

describe('record_green_gate — a tree that moved while the checks were in flight', () => {
	it('writes the record when the tree read back is the one the checks ran on', async () => {
		await record_after({ ...BEFORE })

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeDefined()
	})

	it('withholds the record when a file changed under the checks', async () => {
		await record_after(MOVED)

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeUndefined()
	})

	it('withholds the record when a file appeared under the checks', async () => {
		await record_after(ADDED)

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeUndefined()
	})
})
