import { derive_check } from '#scripts/document/derive-check'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const make_directory = temporary_directory()

const run_mock = vi.hoisted(() => vi.fn())
const is_kit_mock = vi.hoisted(() => vi.fn(() => false))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number }): boolean => result.exit_code !== 0,
	},
}))
vi.mock('#scripts/gate/type-check-step', () => ({
	type_check_step: { resolve_type_check_args: vi.fn(async () => ['josh', 'check']) },
}))
vi.mock('#scripts/gate/project-checks', () => ({
	project_checks: { is_kit_repository: is_kit_mock },
}))
vi.mock('#scripts/gate/metrics-totals', () => ({
	metrics_totals: { METRICS_RERECORD_COMMAND: [], totals_check: vi.fn(async () => undefined) },
}))
vi.mock('#scripts/gate/check-reuse', () => ({
	check_reuse: { DEFAULT_RECORDS: (): string => '', record_green_checks: vi.fn() },
}))
vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: vi.fn(async () => ({ files: {}, base: 'base-a' })) },
}))

const { run_ship_pre_detach } = await import('./run-ship-pre-detach')

// joshuafolkken/kit#7728: the generated-page check `run:chain` runs before the review, run again
// before the detach, in kit only.

const OK = 0
const FAILED = 1
const DERIVE_CHECK = ['josh', ...derive_check.DERIVE_CHECK_ARGV].join(' ')
const DRIFT = `command:derive --check: \`pnpm josh command:derive\` would rewrite these generated pages\nbacklog`
const tree = { directory: '' }

function commands(): ReadonlyArray<string> {
	return run_mock.mock.calls.map((call) => (call[0] as ReadonlyArray<string>).join(' '))
}

beforeEach(() => {
	tree.directory = make_directory('pre-detach-derive-')
	run_mock.mockReset()
	run_mock.mockImplementation(async (list: ReadonlyArray<string>) => {
		const is_drift = list.join(' ') === DERIVE_CHECK

		return is_drift ? { exit_code: FAILED, output: DRIFT } : { exit_code: OK, output: '' }
	})
	is_kit_mock.mockReturnValue(false)
})

describe('run_ship_pre_detach.checks — the generated pages', () => {
	it('runs no generated-page check outside kit', async () => {
		expect(await run_ship_pre_detach.checks(tree.directory)).toMatchObject({ code: OK })
		expect(commands()).not.toContain(DERIVE_CHECK)
	})

	it('fails in kit with the check run:chain runs, naming the drifted page', async () => {
		is_kit_mock.mockReturnValue(true)

		expect(await run_ship_pre_detach.checks(tree.directory)).toStrictEqual({
			code: FAILED,
			out: `✗ ${DERIVE_CHECK} — exit code ${String(FAILED)}\n${DRIFT}`,
			preconditions: ['pre-detach'],
		})
	})
})
