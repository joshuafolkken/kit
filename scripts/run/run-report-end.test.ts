import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_report_end } from './run-report-end'

// joshuafolkken/kit#5639: `josh run:report --end` runs the report, `run:carry --end` and
// `run:wake --stop` in order, and stops at the first failed stage, naming it.

const josh_run_mock = vi.hoisted(() => vi.fn())

const is_child_of_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_of_mock },
}))

const SUCCESS = 0
const FAILURE = 1
const REASON = 'epic #2126: everything is blocked'
const { CARRY_STAGE, END_FLAG, REPORT_STAGE, STOPPED_FLAG, WAKE_STAGE } = run_report_end
const calls: Array<string> = []

type JoshStep = (args: ReadonlyArray<string>) => Promise<{ code: number; out: string }>

function josh_result(code: number): JoshStep {
	return async function (args: ReadonlyArray<string>): Promise<{ code: number; out: string }> {
		calls.push(args.join(' '))

		return { code, out: '' }
	}
}

function report_of(code: number): () => Promise<number> {
	return async function (): Promise<number> {
		calls.push(REPORT_STAGE)

		return code
	}
}

beforeEach(() => {
	calls.length = 0
	josh_run_mock.mockReset()
	josh_run_mock.mockImplementation(josh_result(SUCCESS))
	is_child_of_mock.mockReset()
	is_child_of_mock.mockReturnValue(false)
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	vi.spyOn(console, 'error').mockReturnValue()
})

describe('run_report_end.read_request', () => {
	it('reads --end alone and --end --stopped with a reason', () => {
		expect(run_report_end.read_request([END_FLAG])).toStrictEqual({})
		expect(run_report_end.read_request([END_FLAG, STOPPED_FLAG, REASON])).toStrictEqual({
			stopped: REASON,
		})
	})

	it('refuses any other shape', () => {
		expect(run_report_end.read_request([END_FLAG, STOPPED_FLAG])).toBeUndefined()
		expect(run_report_end.read_request([END_FLAG, STOPPED_FLAG, ''])).toBeUndefined()
		expect(run_report_end.read_request([END_FLAG, '--other', REASON])).toBeUndefined()
		expect(run_report_end.read_request(['--handoff'])).toBeUndefined()
	})
})

describe('run_report_end.end — every stage passes', () => {
	it('runs the report, the carry end and the wake stop in order', async () => {
		await expect(run_report_end.end(report_of(SUCCESS), {})).resolves.toBe(SUCCESS)
		expect(calls).toStrictEqual([REPORT_STAGE, CARRY_STAGE, WAKE_STAGE])
	})

	it('passes --stopped through to the carry end', async () => {
		const ended = run_report_end.end(report_of(SUCCESS), { stopped: REASON })

		await expect(ended).resolves.toBe(SUCCESS)
		expect(calls).toStrictEqual([
			REPORT_STAGE,
			`${CARRY_STAGE} ${STOPPED_FLAG} ${REASON}`,
			WAKE_STAGE,
		])
	})
})

describe('run_report_end.end — a stage fails', () => {
	it('runs nothing after a failed report and names it', async () => {
		await expect(run_report_end.end(report_of(FAILURE), {})).resolves.toBe(FAILURE)
		expect(calls).toStrictEqual([REPORT_STAGE])
		expect(console.error).toHaveBeenCalledWith(run_report_end.failed_note(REPORT_STAGE))
	})

	it('skips the wake stop when the carry end fails and names the carry stage', async () => {
		josh_run_mock.mockImplementation(josh_result(FAILURE))

		await expect(run_report_end.end(report_of(SUCCESS), {})).resolves.toBe(FAILURE)
		expect(calls).toStrictEqual([REPORT_STAGE, CARRY_STAGE])
		expect(console.error).toHaveBeenCalledWith(run_report_end.failed_note(CARRY_STAGE))
	})

	it('names a stage that throws as failed and runs nothing after it', async () => {
		josh_run_mock.mockRejectedValueOnce(new Error('spawn failed'))

		await expect(run_report_end.end(report_of(SUCCESS), {})).resolves.toBe(FAILURE)
		expect(calls).toStrictEqual([REPORT_STAGE])
		expect(josh_run_mock).toHaveBeenCalledTimes(1)
		expect(console.error).toHaveBeenCalledWith(run_report_end.failed_note(CARRY_STAGE))
	})

	it('refuses a lane child before any stage runs', async () => {
		is_child_of_mock.mockReturnValue(true)

		await expect(run_report_end.end(report_of(SUCCESS), {})).resolves.toBe(FAILURE)
		expect(calls).toStrictEqual([])
		expect(console.error).toHaveBeenCalledWith(run_report_end.LANE_CHILD_NOTE)
	})

	it('names the wake stage when only the wake stop fails', async () => {
		josh_run_mock
			.mockImplementationOnce(josh_result(SUCCESS))
			.mockImplementationOnce(josh_result(FAILURE))

		await expect(run_report_end.end(report_of(SUCCESS), {})).resolves.toBe(FAILURE)
		expect(console.error).toHaveBeenCalledWith(run_report_end.failed_note(WAKE_STAGE))
	})
})
