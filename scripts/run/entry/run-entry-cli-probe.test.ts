import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5211: a lane child probes the paths dispatch gated on at its entry, before any
// reading, and stops there when a running lane planned one of them since. Kept apart from
// `run-entry-cli.test.ts`, which is at the file-length cap.

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const yield_mock = vi.hoisted(() => vi.fn())
const record_baseline_mock = vi.hoisted(() => vi.fn())
const print_section_mock = vi.hoisted(() => vi.fn(() => 0))

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { confirm: vi.fn() } }))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: async () => ({
			kind: 'state',
			state: { state: 'OPEN', labels: [], is_human_review: false },
		}),
	},
}))
vi.mock('#scripts/issue/issue-watch', () => ({
	issue_watch: { record_baseline_here: record_baseline_mock },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/lane/lane-plan-check', () => ({
	lane_plan_check: { YIELD_EXIT_CODE: 2, yield_at_entry: yield_mock },
}))
vi.mock('#scripts/run/run-prep-cli', () => ({
	run_prep_cli: {
		gather: async () => ({ content: { kind: 'ok', block: '', trust: { is_body_trusted: true } } }),
		to_parts: () => ({ state: { state: 'OPEN' } }),
	},
}))
vi.mock('./run-entry-spill', () => ({ run_entry_spill: { fit: () => 'report' } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: async () => true } }))
vi.mock('#scripts/run/event/run-event-plan', () => ({ run_event_plan: { emit_plan: vi.fn() } }))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { print_section: print_section_mock },
}))
vi.mock('#scripts/run/run-halfrun-resume', () => ({
	run_halfrun_resume: { adopt: vi.fn(), is_pending: async () => false },
}))
vi.mock('#scripts/run/run-prrun-resume', () => ({
	run_prrun_resume: { adopt: vi.fn(), resume_token: async () => undefined },
}))

const { run_entry_cli } = await import('./run-entry-cli')

const OK = 0
const ISSUE = '5171'
const FRESH = { code: OK, out: 'fresh' }
const HELD = { code: OK, out: 'hold' }
const UNDER = { code: OK, out: 'under' }

const info_lines: Array<string> = []

beforeEach(() => {
	vi.clearAllMocks()
	josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(HELD).mockResolvedValue(UNDER)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_entry_cli.run — the entry probe of a lane child', () => {
	it('stops before the report and the investigation when the probe gives the lane back', async () => {
		is_child_mock.mockReturnValue(true)
		yield_mock.mockResolvedValue(true)

		expect(await run_entry_cli.run([ISSUE])).toBe(2)
		expect(yield_mock).toHaveBeenCalledExactlyOnceWith(Number(ISSUE))
		expect(info_lines.at(-1)).toContain('lane given back at the entry')
		expect(info_lines.join('\n')).not.toContain('report')
		expect(record_baseline_mock).not.toHaveBeenCalled()
		expect(print_section_mock).not.toHaveBeenCalled()
	})

	it('runs on to the report when the probe finds no holder', async () => {
		is_child_mock.mockReturnValue(true)
		yield_mock.mockResolvedValue(false)

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(info_lines.at(-1)).toContain('report')
		expect(print_section_mock).toHaveBeenCalledOnce()
	})

	// Moved from `run-entry-cli.test.ts`, which is at the file-length cap: the lane child's entry is here.
	it('skips cost --cut in a dispatched lane child, where the parent owns the budget', async () => {
		is_child_mock.mockReturnValue(true)
		yield_mock.mockResolvedValue(false)

		await run_entry_cli.run([ISSUE])

		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['run:hold', ISSUE, '--fullrun'],
		])
		expect(info_lines.at(-1)).toContain('cost: skipped')
	})

	it('probes nothing outside a lane child', async () => {
		is_child_mock.mockReturnValue(false)

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(yield_mock).not.toHaveBeenCalled()
	})
})
