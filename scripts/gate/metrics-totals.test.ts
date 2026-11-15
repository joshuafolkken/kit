import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_tree } from './gate-tree'

const run_mock = vi.hoisted(() => vi.fn())
const is_kit_mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number }): boolean => result.exit_code !== 0,
	},
}))
vi.mock('./project-checks', () => ({ project_checks: { is_kit_repository: is_kit_mock } }))

const { metrics_totals } = await import('./metrics-totals')

// joshuafolkken/kit#4594: the ratchet totals reported in the implementation loop, before the ship.

const DIRECTORY = '/repository'
const GROWN =
	'josh metrics: 1 total(s) grew past the merge-base abc123:\nRecord the reason: pnpm josh metrics --accept --reason "<why>"'
const PASSED = { exit_code: 0, output: 'josh metrics: no total grew' }

beforeEach(() => {
	run_mock.mockReset()
	is_kit_mock.mockReturnValue(true)
	run_mock.mockResolvedValue(PASSED)
})

describe('metrics_totals.growth_notice', () => {
	it('runs no metrics outside kit', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs the totals-only form in the given directory', async () => {
		await metrics_totals.growth_notice(DIRECTORY)

		expect(run_mock).toHaveBeenCalledWith(['josh', 'metrics', '--totals-only'], {
			cwd: DIRECTORY,
		})
	})

	it('answers nothing when no total grew', async () => {
		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBeUndefined()
	})

	it('answers the notice with the accept hint when a total grew', async () => {
		run_mock.mockResolvedValue({ exit_code: 1, output: `${GROWN}\n` })

		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBe(
			`${metrics_totals.NOTICE_HEADING}\n${GROWN}`,
		)
	})
})

// joshuafolkken/kit#6023: one judgment for run:review's open and the ship's pre-detach backstop.
describe('metrics_totals.totals_check', () => {
	it('answers no run outside kit', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(metrics_totals.totals_check(DIRECTORY)).resolves.toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs the re-record form, so a growth the approval names passes', async () => {
		await expect(metrics_totals.totals_check(DIRECTORY)).resolves.toStrictEqual(PASSED)
		expect(run_mock).toHaveBeenCalledWith(metrics_totals.METRICS_RERECORD_COMMAND, {
			cwd: DIRECTORY,
		})
	})
})

describe('metrics_totals.totals_refusal', () => {
	it('refuses with the accept command when a total grew past every approval', async () => {
		run_mock.mockResolvedValue({ exit_code: 1, output: `${GROWN}\n` })

		await expect(metrics_totals.totals_refusal(DIRECTORY)).resolves.toBe(
			`${metrics_totals.REVIEW_REFUSAL_HEADING}\n${GROWN}`,
		)
	})

	it('refuses nothing once the growth is accepted', async () => {
		await expect(metrics_totals.totals_refusal(DIRECTORY)).resolves.toBeUndefined()
	})

	it('refuses nothing outside kit', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(metrics_totals.totals_refusal(DIRECTORY)).resolves.toBeUndefined()
	})

	it('names the --accept-metrics rerun in its heading', () => {
		expect(metrics_totals.REVIEW_REFUSAL_HEADING).toContain(
			'pnpm josh run:chain <N> --from run:review --accept-metrics "<why>"',
		)
	})
})

// joshuafolkken/kit#7599: `--accept-metrics "<why>"` records a growth at run:review's open.
const REASON = 'a new command'

function spy_info(): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

describe('metrics_totals.totals_refusal with an accept reason — a grown total', () => {
	const RECORDED =
		'josh metrics: growth recorded in .josh/metrics-accepted/7599.json — a new command'

	it('records a growth with `josh metrics --accept --reason` and goes on', async () => {
		run_mock
			.mockResolvedValueOnce({ exit_code: 1, output: GROWN })
			.mockResolvedValueOnce({ exit_code: 0, output: `metrics table\n${RECORDED}\n` })
		const info = spy_info()

		await expect(metrics_totals.totals_refusal(DIRECTORY, REASON)).resolves.toBeUndefined()
		expect(run_mock).toHaveBeenLastCalledWith(['josh', 'metrics', '--accept', '--reason', REASON], {
			cwd: DIRECTORY,
		})
		expect(info).toHaveBeenCalledWith(RECORDED)
	})

	it('refuses with the accept output when the record fails', async () => {
		run_mock
			.mockResolvedValueOnce({ exit_code: 1, output: GROWN })
			.mockResolvedValueOnce({ exit_code: 1, output: 'no issue to record under\n' })

		await expect(metrics_totals.totals_refusal(DIRECTORY, REASON)).resolves.toBe(
			`${metrics_totals.ACCEPT_REFUSAL_HEADING}\nno issue to record under`,
		)
	})
})

describe('metrics_totals.totals_refusal with an accept reason — no growth', () => {
	it('records nothing and says the reason went unused when no total grew', async () => {
		const info = spy_info()

		await expect(metrics_totals.totals_refusal(DIRECTORY, REASON)).resolves.toBeUndefined()
		expect(run_mock).toHaveBeenCalledOnce()
		expect(run_mock).toHaveBeenCalledWith(metrics_totals.METRICS_RERECORD_COMMAND, {
			cwd: DIRECTORY,
		})
		expect(info).toHaveBeenCalledWith(metrics_totals.ACCEPT_UNUSED_NOTE)
	})

	it('says nothing when no reason was given and no total grew', async () => {
		const info = spy_info()

		await metrics_totals.totals_refusal(DIRECTORY)

		expect(info).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4716: the branch's approval re-recorded before a scoped pair reads the tree.
describe('metrics_totals.rerecord', () => {
	const SOURCE = 'a.ts'
	const WITHOUT_APPROVAL = Object.fromEntries([[SOURCE, 'digest']])
	const WITH_APPROVAL = Object.fromEntries([
		['.josh/metrics-accepted/4716.json', 'digest'],
		[SOURCE, 'digest'],
	])

	it('runs the re-record form when the changed tree carries an approval', async () => {
		await expect(metrics_totals.rerecord(DIRECTORY, WITH_APPROVAL)).resolves.toBe(true)
		expect(run_mock).toHaveBeenCalledWith(
			[...metrics_totals.METRICS_TOTALS_COMMAND, '--rerecord'],
			{ cwd: DIRECTORY },
		)
	})

	it('answers that it ran even when a total still grew, leaving the verdict to the gate', async () => {
		run_mock.mockResolvedValue({ exit_code: 1, output: GROWN })

		await expect(metrics_totals.rerecord(DIRECTORY, WITH_APPROVAL)).resolves.toBe(true)
	})

	it('runs nothing when the changed tree carries no approval', async () => {
		await expect(metrics_totals.rerecord(DIRECTORY, WITHOUT_APPROVAL)).resolves.toBe(false)
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs nothing outside kit', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(metrics_totals.rerecord(DIRECTORY, WITH_APPROVAL)).resolves.toBe(false)
		expect(run_mock).not.toHaveBeenCalled()
	})
})

describe('metrics_totals.rerecorded_tree', () => {
	it('keeps the original tree when no approval needs writing', async () => {
		const tree = { files: { 'a.ts': 'source' }, base: 'base' }
		const read = vi.fn(async () => tree)

		expect(await metrics_totals.rerecorded_tree(read, DIRECTORY)).toBe(tree)
		expect(read).toHaveBeenCalledOnce()
	})

	it('uses the shared tree reader by default', async () => {
		const tree = { files: {}, base: 'base' }
		const read = vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(tree)

		expect(await metrics_totals.rerecorded_tree()).toBe(tree)
		expect(read).toHaveBeenCalledOnce()
		read.mockRestore()
	})
})
