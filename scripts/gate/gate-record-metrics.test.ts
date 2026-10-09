import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_own_write } from './gate-own-write'
import { gate_plan } from './gate-plan'
import { gate_skip } from './gate-skip'
import { gate_test_fixture } from './gate-test-fixture'
import { verification_gate, type GateStepResult } from './verification-gate'

// joshuafolkken/kit#3575: a gate whose metrics step moved the baseline down — a total shrank — changed
// its own tree mid-run, the before/after comparison withheld the green record, and `run:review --join`
// answered RED on a gate whose every check passed. The record must be written for the tree the rewrite
// left, so the join's reuse test (`reusable_green_gate`) reads it as green. The tree read is stubbed to
// the rewritten map, since git cannot answer from inside a worker.

const STAMP_FILE = 'scripts/gate/gate-report.ts'
const STAMP_BASE = 'a1b2c3d4'
const BEFORE: Record<string, string> = { [STAMP_FILE]: 'digest-one' }
const REWRITTEN: Record<string, string> = { ...BEFORE, [gate_own_write.BASELINE_PATH]: 'lowered' }

const RECORDS = gate_test_fixture.suite_records('record-metrics')

function green(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: 0, output, elapsed_ms: 1 }
}

const SHRUNK_GATE: ReadonlyArray<GateStepResult> = [
	green(gate_plan.LINT_LABEL, 'output of lint'),
	green(gate_plan.METRICS_LABEL, `josh metrics: no total grew — ${gate_own_write.SHRUNK_NOTE}`),
	green(gate_plan.UNIT_LABEL, 'output of test:unit'),
]

async function record_after(after: Record<string, string>): Promise<void> {
	const spy = vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(after)

	try {
		await verification_gate.record_green_gate(SHRUNK_GATE, BEFORE, RECORDS.stamp_path, STAMP_BASE)
	} finally {
		spy.mockRestore()
	}
}

beforeEach(RECORDS.clear)
afterEach(RECORDS.clear)

describe('record_green_gate — the metrics step rewrote a shrunk baseline mid-gate', () => {
	it('records green for the rewritten tree, which the join reuses as green', async () => {
		await record_after(REWRITTEN)

		const reused = gate_skip.reusable_green_gate(REWRITTEN, STAMP_BASE, RECORDS.stamp_path)

		expect(reused).toBeDefined()
	})

	it('still withholds the record when another file moved beside the rewrite', async () => {
		await record_after({ ...REWRITTEN, [STAMP_FILE]: 'digest-two' })

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeUndefined()
	})
})
