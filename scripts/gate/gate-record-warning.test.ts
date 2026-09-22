import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_plan } from './gate-plan'
import { gate_test_fixture } from './gate-test-fixture'
import { verification_gate, type GateStepResult } from './verification-gate'

// joshuafolkken/kit#2318: a green gate whose `test:unit` step merely forwarded a Vite config
// deprecation — a line that contains the word "warning" but is not a per-tree checker finding —
// withheld the green record, so the reuse the whole `run:review --join` chain depends on found nothing
// and reported RED on a green gate. The record must be written for such a benign line and still
// withheld for a real eslint/svelte-check warning. `record_green_gate` reads the changed tree back to
// confirm it did not move, which git cannot answer from inside a worker, so the read is stubbed to a
// stable map — the branch under test is the warning classification, not the tree comparison.

const PASS = 0
const CSPELL_LABEL = 'cspell'
const STAMP_FILE = 'scripts/gate/gate-report.ts'
const STAMP_TREE: Record<string, string> = { [STAMP_FILE]: 'digest-one' }
const STAMP_BASE = 'a1b2c3d4'
const VITE_DEPRECATION =
	"(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`.\n" +
	'Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.'
const ESLINT_WARNING = 'src/a.ts:1:1  warning  Unexpected console statement'

const RECORDS = gate_test_fixture.suite_records('record-warning')

function green_saying(label: string, output: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: PASS, output, elapsed_ms: 1 }
}

function plain(label: string): GateStepResult {
	return green_saying(label, `output of ${label}`)
}

async function record_with(results: ReadonlyArray<GateStepResult>): Promise<void> {
	const spy = vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(STAMP_TREE)

	try {
		await verification_gate.record_green_gate(results, STAMP_TREE, RECORDS.stamp_path, STAMP_BASE)
	} finally {
		spy.mockRestore()
	}
}

beforeEach(RECORDS.clear)
afterEach(RECORDS.clear)

describe('record_green_gate — a benign warning does not withhold the record', () => {
	it('writes the reusable record when a non-checker step forwarded a benign warning', async () => {
		await record_with([
			plain(gate_plan.LINT_LABEL),
			plain(gate_plan.TYPE_CHECK_LABEL),
			plain(CSPELL_LABEL),
			green_saying(gate_plan.UNIT_LABEL, VITE_DEPRECATION),
		])

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeDefined()
	})

	it('still withholds the record when a checker step passed with its own warnings', async () => {
		await record_with([
			green_saying(gate_plan.LINT_LABEL, ESLINT_WARNING),
			plain(gate_plan.TYPE_CHECK_LABEL),
			plain(CSPELL_LABEL),
			plain(gate_plan.UNIT_LABEL),
		])

		expect(review_stamps.gate_stamp.read(RECORDS.stamp_path)).toBeUndefined()
	})
})
