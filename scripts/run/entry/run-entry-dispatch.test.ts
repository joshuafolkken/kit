import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const make_directory = temporary_directory('suite')

const josh_run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/notify/telegram-notify', () => ({
	telegram_notify: { confirm: async () => true },
}))
vi.mock('#scripts/run/run-stage-read', () => ({
	run_stage_read: { read_stage: async () => ({ state: 'fresh' }) },
}))
vi.mock('#scripts/issue/issue-watch', () => ({
	issue_watch: { record_baseline_here: async () => true },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => false },
}))
vi.mock('#scripts/run/run-prep-cli', () => ({
	run_prep_cli: {
		gather: async () => ({ content: { kind: 'ok', trust: { is_body_trusted: true } } }),
		to_parts: () => ({ state: { state: 'OPEN' } }),
	},
}))
vi.mock('./run-entry-spill', () => ({ run_entry_spill: { fit: () => '' } }))
vi.mock('./run-entry-sync', () => ({ run_entry_sync: { sync: async () => undefined } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: async () => true } }))
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
const scratch = make_directory('entry-dispatch-')
const ISSUE = '4156'
const OTHER_ISSUE = 4157
const OK = 0
const fixture = { target: '' }

beforeEach(() => {
	fixture.target = path.join(make_directory(path.join(scratch, 'case-')), 'ledger.jsonl')
	vi.spyOn(lane_ledger, 'target').mockResolvedValue(fixture.target)
	josh_run_mock.mockReset().mockResolvedValueOnce({ code: OK, out: 'fresh' })
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_entry_cli — missing dispatch after claiming the hold (joshuafolkken/kit#6304)', () => {
	it.each([false, true])('records one dispatch on successful hold, adopt=%s', async (is_adopt) => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'hold' })
			.mockResolvedValue({ code: OK, out: 'under' })
		await lane_ledger_write.record_dispatch(OTHER_ISSUE, fixture.target)

		expect(await run_entry_cli.run(is_adopt ? [ISSUE, '--adopt'] : [ISSUE])).toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toMatchObject([
			{ kind: 'dispatch', issue: OTHER_ISSUE },
			{ kind: 'dispatch', issue: Number(ISSUE) },
		])
	})

	it('keeps an existing dispatch unchanged', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'hold' })
			.mockResolvedValue({ code: OK, out: 'under' })
		await lane_ledger_write.record_dispatch(Number(ISSUE), fixture.target)
		const before = lane_ledger.read_entries(fixture.target)

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toStrictEqual(before)
	})
})

describe('run_entry_cli — absent ledgers and skipped claims', () => {
	it('starts a missing ledger after the hold succeeds', async () => {
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'hold' })
			.mockResolvedValue({ code: OK, out: 'under' })

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toMatchObject([
			{ kind: 'dispatch', issue: Number(ISSUE) },
		])
	})

	it('continues without a ledger outside a repository', async () => {
		vi.mocked(lane_ledger.target).mockResolvedValue(undefined)
		josh_run_mock
			.mockResolvedValueOnce({ code: OK, out: 'hold' })
			.mockResolvedValue({ code: OK, out: 'under' })

		expect(await run_entry_cli.run([ISSUE])).toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toStrictEqual([])
	})

	it.each(['busy', 'unknown'])('records nothing when the hold is %s', async (hold) => {
		josh_run_mock.mockResolvedValueOnce({ code: OK, out: hold })

		expect(await run_entry_cli.run([ISSUE])).not.toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toStrictEqual([])
	})

	it('records nothing for kickoff', async () => {
		expect(await run_entry_cli.run([ISSUE, '--to', 'kickoff'])).toBe(OK)
		expect(lane_ledger.read_entries(fixture.target)).toStrictEqual([])
	})

	it('preserves repeated explicit dispatch records', async () => {
		await lane_ledger_write.record_dispatch(Number(ISSUE), fixture.target)
		await lane_ledger_write.record_dispatch(Number(ISSUE), fixture.target)

		expect(lane_ledger.read_entries(fixture.target)).toHaveLength(2)
	})
})
