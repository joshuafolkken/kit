import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5629: `run:entry <N> --adopt` — a `new` run's entry once its Issue is filed. Kept
// apart from `run-entry-cli.test.ts`, which is at the file-length cap.

const josh_run_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const confirm_mock = vi.hoisted(() => vi.fn())
const mark_mock = vi.hoisted(() => vi.fn())
const sync_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { confirm: confirm_mock } }))
vi.mock('#scripts/backlog/backlog-plan-comment', () => ({
	backlog_plan_comment: { read_plan: async () => undefined },
}))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: async () => ({
			kind: 'state',
			state: { state: 'OPEN', labels: [], is_human_review: false },
		}),
	},
}))
vi.mock('#scripts/issue/issue-watch', () => ({
	issue_watch: { record_baseline_here: async () => true },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/run/run-prep-cli', () => ({
	run_prep_cli: { gather: gather_mock, to_parts: () => ({ state: { state: 'OPEN' } }) },
}))
vi.mock('./run-entry-spill', () => ({ run_entry_spill: { fit: () => '' } }))
vi.mock('./run-entry-sync', () => ({ run_entry_sync: { sync: sync_mock } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: mark_mock } }))
vi.mock('#scripts/run/event/run-event-plan', () => ({ run_event_plan: { emit_plan: vi.fn() } }))
vi.mock('#scripts/run/run-step-section', () => ({
	run_step_section: { print_section: () => 0, print_once: () => 0 },
}))
vi.mock('#scripts/run/run-halfrun-resume', () => ({
	run_halfrun_resume: { is_pending: async () => false },
}))
vi.mock('#scripts/run/run-prrun-resume', () => ({
	run_prrun_resume: { resume_token: async () => undefined },
}))

const { run_entry_cli } = await import('./run-entry-cli')

const OK = 0
// Not this lane's own number: the stage read probes the pull request of a branch that names it.
const ISSUE = '4156'
const FRESH = { code: OK, out: 'fresh' }
const HELD = { code: OK, out: 'hold' }
const UNDER = { code: OK, out: 'under' }
const ADOPT_CALL = ['run:hold', '--adopt', ISSUE]
const RELEASE_CALL = ['run:release', ISSUE]
const TRUSTED_READS = { content: { kind: 'ok', block: '', trust: { is_body_trusted: true } } }

function calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	josh_run_mock.mockReset()
	gather_mock.mockReset().mockResolvedValue(TRUSTED_READS)
	confirm_mock.mockReset().mockResolvedValue(true)
	mark_mock.mockReset().mockResolvedValue(true)
	sync_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_entry_cli.run --adopt — the bare hold is re-keyed, then the #N entry runs', () => {
	it.each([[[ISSUE, '--adopt']], [[ISSUE, '--to', 'halfrun', '--adopt']]])(
		're-keys rather than claims, then reads the budget and the issue: %j',
		async (argv) => {
			josh_run_mock
				.mockResolvedValueOnce(FRESH)
				.mockResolvedValueOnce(HELD)
				.mockResolvedValueOnce(UNDER)

			expect(await run_entry_cli.run(argv)).toBe(OK)
			expect(calls()).toStrictEqual([['run:cut', '--resume', ISSUE], ADOPT_CALL, ['cost', '--cut']])
			expect(sync_mock).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ is_adopt: true }))
			expect(gather_mock).toHaveBeenCalledTimes(1)
		},
	)
})

describe('run_entry_cli.run --adopt — the tree sync before the reads', () => {
	it('stops on a failed sync, releasing the adopted record and notifying', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce(UNDER)
			.mockResolvedValueOnce({ code: OK, out: '' })
		sync_mock.mockResolvedValue({ report: '(sync failed)', notice: { reason: 'sync' } })

		expect(await run_entry_cli.run([ISSUE, '--adopt'])).not.toBe(OK)
		expect(calls().at(-1)).toStrictEqual(RELEASE_CALL)
		expect(confirm_mock).toHaveBeenCalledTimes(1)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(mark_mock).not.toHaveBeenCalled()
	})
})

describe('run_entry_cli.run --adopt — the stops before the reads', () => {
	it.each(['none', 'busy', 'unknown'])(
		'stops on a %s adopt without reading, releasing or marking',
		async (token) => {
			josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce({ code: OK, out: token })

			expect(await run_entry_cli.run([ISSUE, '--adopt'])).not.toBe(OK)
			expect(calls()).toStrictEqual([['run:cut', '--resume', ISSUE], ADOPT_CALL])
			expect(gather_mock).not.toHaveBeenCalled()
			expect(mark_mock).not.toHaveBeenCalled()
		},
	)

	it('stops on a spent budget and releases the adopted record', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce({ code: OK, out: 'over' })
			.mockResolvedValueOnce({ code: OK, out: '' })

		expect(await run_entry_cli.run([ISSUE, '--adopt'])).not.toBe(OK)
		expect(calls().at(-1)).toStrictEqual(RELEASE_CALL)
		expect(gather_mock).not.toHaveBeenCalled()
	})
})

describe('run_entry_cli.run --adopt — a refused call', () => {
	it('names --adopt in the usage line it prints', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await run_entry_cli.run([ISSUE, '--adopt', '--adopt'])).not.toBe(OK)
		expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('[--adopt]'))
		expect(josh_run_mock).not.toHaveBeenCalled()
	})
})
