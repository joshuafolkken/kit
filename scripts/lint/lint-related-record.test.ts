import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { launch_timing } from '#scripts/lane/launch-timing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lint_related_record, type LintStages } from './lint-related-record'

vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_lint_related: vi.fn() },
}))
vi.mock('#scripts/lane/lane-paths', () => ({ lane_paths: { issue_here: vi.fn(() => 7827) } }))

const REBUILD_MS = 1200.4
const CORE_WAIT_MS = 300.6
const EXIT_CODE = 3
const FIX_FAILED = 'fix failed'

afterEach(() => {
	launch_timing.clear()
	vi.mocked(lane_ledger_write.record_lint_related).mockClear()
})

describe('lint_related_record.timed — one stage time per call', () => {
	it('records the stage it ran and hands back its value', async () => {
		const stages: LintStages = {}

		await expect(lint_related_record.timed(stages, 'lint_ms', async () => 0)).resolves.toBe(0)
		expect(stages.lint_ms).toBeTypeOf('number')
		expect(stages).not.toHaveProperty('fix_ms')
	})

	it('records the time of a stage that throws', async () => {
		const stages: LintStages = {}
		const failing = lint_related_record.timed(stages, 'fix_ms', async () => {
			throw new Error(FIX_FAILED)
		})

		await expect(failing).rejects.toThrow(FIX_FAILED)
		expect(stages.fix_ms).toBeTypeOf('number')
	})
})

describe('lint_related_record.record_run — one ledger row per run', () => {
	it('writes the stages beside the handed-over launch times, rounded', async () => {
		launch_timing.set_rebuild_ms(REBUILD_MS)
		launch_timing.set_core_wait_ms(CORE_WAIT_MS)

		await lint_related_record.record_run(
			{ lint_ms: 5 },
			{ started: performance.now(), exit_code: EXIT_CODE },
		)

		expect(lane_ledger_write.record_lint_related).toHaveBeenCalledWith(
			expect.objectContaining({
				issue: 7827,
				rebuild_ms: 1200,
				core_wait_ms: 301,
				lint_ms: 5,
				exit_code: EXIT_CODE,
				elapsed_ms: expect.any(Number) as number,
			}),
			undefined,
		)
	})

	it('leaves out a launch time the launcher did not hand over', async () => {
		await lint_related_record.record_run({}, { started: performance.now(), exit_code: 0 })

		const [row] = vi.mocked(lane_ledger_write.record_lint_related).mock.calls[0] ?? []

		expect(row?.rebuild_ms).toBeUndefined()
		expect(row?.core_wait_ms).toBeUndefined()
	})

	it('settles when the ledger write throws', async () => {
		vi.mocked(lane_ledger_write.record_lint_related).mockRejectedValueOnce(new Error('disk full'))

		await expect(
			lint_related_record.record_run({}, { started: performance.now(), exit_code: 1 }),
		).resolves.toBeUndefined()
	})
})
