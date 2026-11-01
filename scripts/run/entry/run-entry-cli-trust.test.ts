import type { ConfirmInput } from '#scripts/notify/telegram-notify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4663: a named issue from an author without write access runs only on a trusted
// `kickoff` plan. Kept apart from `run-entry-cli.test.ts`, which is at the file-length cap.

const josh_run_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const confirm_mock = vi.hoisted(() => vi.fn())
const record_baseline_mock = vi.hoisted(() => vi.fn())
const read_issue_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { confirm: confirm_mock } }))
vi.mock('#scripts/backlog/backlog-plan-comment', () => ({
	backlog_plan_comment: { read_plan: async () => undefined },
}))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/issue/issue-watch', () => ({
	issue_watch: { record_baseline_here: record_baseline_mock },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/run/run-prep-cli', () => ({
	run_prep_cli: { gather: gather_mock, to_parts: () => ({ state: { state: 'OPEN' } }) },
}))
vi.mock('./run-entry-spill', () => ({ run_entry_spill: { fit: () => '' } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: async () => true } }))
vi.mock('#scripts/run/event/run-event-plan', () => ({ run_event_plan: { emit_plan: vi.fn() } }))
vi.mock('#scripts/run/run-step-section', () => ({ run_step_section: { print_section: () => 0 } }))
vi.mock('#scripts/run/run-halfrun-resume', () => ({
	run_halfrun_resume: { is_pending: async () => false },
}))
vi.mock('#scripts/run/run-prrun-resume', () => ({
	run_prrun_resume: { resume_token: async () => undefined },
}))

const { run_entry_cli } = await import('./run-entry-cli')
const { run_entry_trust } = await import('./run-entry-trust')

const OK = 0
const ISSUE = '4663'
const RELEASE = ['run:release', ISSUE]
const PLANNED = 'run:planned'

const STOP_CASES: ReadonlyArray<[string, boolean, Array<string>]> = [
	['no plan', false, []],
	['a trusted comment without the plan label', true, []],
	['the plan label without a trusted comment', false, [PLANNED]],
]

function state_read(labels: ReadonlyArray<string>): unknown {
	return { kind: 'state', state: { state: 'OPEN', labels, is_human_review: false } }
}

function gathered(
	is_body_trusted: boolean | undefined,
	has_trusted_comment: boolean | undefined,
	labels: Array<string>,
): unknown {
	const content = { kind: 'ok', block: '', trust: { is_body_trusted, has_trusted_comment } }

	return { content, state: state_read(labels) }
}

beforeEach(() => {
	josh_run_mock
		.mockReset()
		.mockResolvedValueOnce({ code: OK, out: 'fresh' })
		.mockResolvedValueOnce({ code: OK, out: 'hold' })
		.mockResolvedValue({ code: OK, out: 'under' })
	confirm_mock.mockReset().mockResolvedValue(true)
	record_baseline_mock.mockReset().mockResolvedValue(true)
	read_issue_mock.mockReset().mockResolvedValue(state_read([]))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('run_entry_cli.run — an untrusted author stops the run until a trusted plan exists', () => {
	it.each(STOP_CASES)(
		'stops on %s, releasing its claim and naming kickoff',
		async (_label, has_comment, labels) => {
			gather_mock.mockResolvedValue(gathered(false, has_comment, labels))

			expect(await run_entry_cli.run([ISSUE])).not.toBe(OK)
			expect(josh_run_mock).toHaveBeenLastCalledWith(RELEASE, true)
			expect(record_baseline_mock).not.toHaveBeenCalled()

			const [input] = confirm_mock.mock.calls[0] as [ConfirmInput]

			expect(input.recommended).toContain(`kickoff #${ISSUE}`)
		},
	)

	it.each([
		['a trusted author', true, false, []],
		['an untrusted author planned by a trusted kickoff', false, true, [PLANNED]],
	])('proceeds for %s', async (_label, is_trusted, has_comment, labels) => {
		gather_mock.mockResolvedValue(gathered(is_trusted, has_comment, labels))

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(record_baseline_mock).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(confirm_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4703: a lookup or a listing that failed is named as the failed read, not as an
// untrusted author whom a `kickoff` would clear.
describe('run_entry_cli.run — a trust read that failed stops as the failed read', () => {
	it.each([
		['the body author lookup', undefined, false, []],
		['the comment listing of a planned issue', false, undefined, [PLANNED]],
	])(
		'stops when %s failed, naming the failed read',
		async (_label, is_trusted, has_comment, labels) => {
			gather_mock.mockResolvedValue(gathered(is_trusted, has_comment, labels))

			expect(await run_entry_cli.run([ISSUE])).not.toBe(OK)
			expect(josh_run_mock).toHaveBeenLastCalledWith(RELEASE, true)

			const [input] = confirm_mock.mock.calls[0] as [ConfirmInput]

			expect(input.body).toContain(run_entry_trust.UNREAD_REASON)
			expect(input.body).not.toContain(run_entry_trust.STOP_REASON)
			expect(input.recommended).not.toContain('kickoff')
		},
	)
})
