import { session_cite } from '#scripts/issue/session-cite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const format_report_mock = vi.hoisted(() => vi.fn())
const adopt_mock = vi.hoisted(() => vi.fn())
const is_pending_mock = vi.hoisted(() => vi.fn())
const prrun_adopt_mock = vi.hoisted(() => vi.fn())
const prrun_token_mock = vi.hoisted(() => vi.fn())
const read_issue_mock = vi.hoisted(() => vi.fn())
const confirm_mock = vi.hoisted(() => vi.fn())
const mark_mock = vi.hoisted(() => vi.fn())
const emit_plan_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { confirm: confirm_mock } }))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('#scripts/run/run-prep-cli', () => ({
	run_prep_cli: { gather: gather_mock, to_parts: to_parts_mock },
}))
vi.mock('#scripts/run/run-prep', () => ({ run_prep: { format_report: format_report_mock } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: mark_mock } }))
vi.mock('#scripts/run/event/run-event-plan', () => ({
	run_event_plan: { emit_plan: emit_plan_mock },
}))
vi.mock('#scripts/run/run-halfrun-resume', () => ({
	run_halfrun_resume: { adopt: adopt_mock, is_pending: is_pending_mock },
}))
vi.mock('#scripts/run/run-prrun-resume', () => ({
	run_prrun_resume: { adopt: prrun_adopt_mock, resume_token: prrun_token_mock },
}))

const { run_entry_cli } = await import('./run-entry-cli')
const { run_stage } = await import('#scripts/run/run-stage')
const { lane_park } = await import('#scripts/rules/lane-park')

const OK = 0
const FRESH = { code: OK, out: 'fresh' }
const HELD = { code: OK, out: 'hold' }
const UNDER = { code: OK, out: 'under\n43630 billed input tokens' }
const PREP_BODY = '=== issue ===\nbody'
const ISSUE = '2372'
const CITED = session_cite.issue(ISSUE)
const PRRUN_TOKEN = 'prrun-merge'
const RELEASE_CALL = ['run:release', ISSUE]

const info_lines: Array<string> = []

function state_parts(state: string, is_human_review = false, latest_scope = 'skip'): unknown {
	return { issue_number: ISSUE, state: { state, is_human_review }, latest_scope }
}

function issue_read(state: string, labels: ReadonlyArray<string> = []): unknown {
	return { kind: 'state', state: { state, labels, is_human_review: false } }
}

function stage_line(state: string, command: string, start: string): string {
	return `stage ${CITED} — at: ${state} · to: ${command} · start: ${start}`
}

function last_line(): string {
	return info_lines.at(-1) ?? ''
}

function calls(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

function reset_resume_mocks(): void {
	adopt_mock.mockReset().mockResolvedValue(false)
	is_pending_mock.mockReset().mockResolvedValue(false)
	prrun_adopt_mock.mockReset().mockResolvedValue(false)
	prrun_token_mock.mockReset().mockResolvedValue(undefined)
	read_issue_mock.mockReset().mockResolvedValue(issue_read('OPEN'))
	mark_mock.mockReset().mockResolvedValue(true)
	emit_plan_mock.mockReset().mockResolvedValue(undefined)
}

beforeEach(() => {
	josh_run_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(false)
	gather_mock.mockReset().mockResolvedValue({})
	to_parts_mock.mockReset().mockReturnValue(state_parts('OPEN'))
	format_report_mock.mockReset().mockReturnValue(PREP_BODY)
	reset_resume_mocks()
	confirm_mock.mockReset().mockResolvedValue(true)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_entry_cli.run — a held tree in budget folds hold, cost, prep and step into one report', () => {
	it('claims the tree, reads the budget, gathers the reads and prints one composite', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce(UNDER)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(calls()).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['run:hold', ISSUE, '--fullrun'],
			['cost', '--cut'],
		])
		expect(gather_mock).toHaveBeenCalledTimes(1)
		expect(mark_mock).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(emit_plan_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([
			stage_line('fresh', 'fullrun', 'plan'),
			`entry ${CITED} — hold: hold · cost: under · verdict: implement\n\n${PREP_BODY}`,
		])
	})
})

describe('run_entry_cli.run — a halfrun stop is resumed rather than claimed (joshuafolkken/kit#2796)', () => {
	it('reads the budget, adopts the halfrun hold and reports the resume without claiming', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		is_pending_mock.mockResolvedValue(true)
		adopt_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(adopt_mock).toHaveBeenCalledWith(ISSUE)
		expect(calls()).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['cost', '--cut'],
		])
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([
			stage_line(run_stage.HALFRUN_STOPPED, 'fullrun', 'gate'),
			`entry ${CITED} — resume: ${run_entry_cli.HALFRUN_RESUME_TOKEN}`,
		])
	})

	it('stops on a spent budget without adopting the halfrun hold', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce({ code: OK, out: 'over' })
		is_pending_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(adopt_mock).not.toHaveBeenCalled()
		expect(info_lines[1]).toContain('cost: over')
		expect(calls()).not.toContainEqual(RELEASE_CALL)
	})
})

describe('run_entry_cli.run — a prrun stop is resumed rather than claimed (joshuafolkken/kit#3023)', () => {
	it('adopts the prrun hold and reports its token without claiming', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		prrun_token_mock.mockResolvedValue(PRRUN_TOKEN)
		prrun_adopt_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(prrun_adopt_mock).toHaveBeenCalledWith(ISSUE)
		expect(josh_run_mock).toHaveBeenCalledTimes(2)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([
			stage_line(run_stage.PRRUN_STOPPED, 'fullrun', 'followup'),
			`entry ${CITED} — resume: ${PRRUN_TOKEN}`,
		])
	})

	it('stops busy when the hold could not be adopted', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		prrun_token_mock.mockResolvedValue(PRRUN_TOKEN)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(info_lines[1]).toContain('hold: busy')
	})

	it('asks nothing of the prrun stop when a halfrun stop is pending', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		is_pending_mock.mockResolvedValue(true)
		adopt_mock.mockResolvedValue(true)

		await run_entry_cli.run([ISSUE])

		expect(prrun_token_mock).not.toHaveBeenCalled()
	})
})

describe('run_entry_cli.run — a stop short-circuits before the reads it would waste', () => {
	it('stops on a busy hold without reading the budget or the issue', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce({ code: OK, out: 'busy' })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(josh_run_mock).toHaveBeenCalledTimes(2)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines[1]).toContain(`entry ${CITED} — hold: busy · cost: skipped · verdict: -`)
		expect(mark_mock).not.toHaveBeenCalled()
		expect(confirm_mock).toHaveBeenCalledTimes(1)
	})

	// joshuafolkken/kit#3099: the stop's Telegram and release are the command's, not the agent's.
	it('stops on a spent budget without reading the issue, releasing its claim and notifying', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce({ code: OK, out: 'over' })
			.mockResolvedValueOnce({ code: OK, out: '' })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines[1]).toContain('cost: over · verdict: -')
		expect(mark_mock).not.toHaveBeenCalled()
		expect(calls().at(-1)).toStrictEqual(RELEASE_CALL)
		expect(last_line()).toBe(lane_park.COMMAND_NOTIFY_MARKER)
	})
})

// joshuafolkken/kit#2760: an implementation cut outside a lane keeps its hold, so claiming first
// refused the fresh session `busy` by its own run's hold and the resume was never asked.
describe('run_entry_cli.run — a carried cut is resumed before the hold is claimed', () => {
	it.each([
		['resume-impl', OK],
		['over', 1],
	])('answers %j with its exit code and claims nothing', async (token, exit) => {
		josh_run_mock.mockResolvedValueOnce({ code: exit, out: token })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(exit)
		expect(calls()).toStrictEqual([['run:cut', '--resume', ISSUE]])
		expect(read_issue_mock).not.toHaveBeenCalled()
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([`entry ${CITED} — resume: ${token}`])
	})
})

describe('run_entry_cli — the lane-aware budget skip', () => {
	it('skips cost --cut in a dispatched lane child, where the parent owns the budget', async () => {
		is_child_mock.mockReturnValue(true)
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(HELD)

		await run_entry_cli.run([ISSUE])

		expect(calls()).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['run:hold', ISSUE, '--fullrun'],
		])
		expect(last_line()).toContain('cost: skipped')
	})
})

describe('run_entry_cli.run — a stop already made is resumed or reported (joshuafolkken/kit#3042)', () => {
	it('adopts a halfrun stop under prrun and resumes at the gate', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		is_pending_mock.mockResolvedValue(true)
		adopt_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE, '--to', 'prrun'])

		expect(code).toBe(OK)
		expect(info_lines).toStrictEqual([
			stage_line(run_stage.HALFRUN_STOPPED, 'prrun', 'gate'),
			`entry ${CITED} — resume: ${run_entry_cli.HALFRUN_RESUME_TOKEN}`,
		])
	})

	it('reports a prrun stop reached under prrun without adopting or claiming', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH)
		prrun_token_mock.mockResolvedValue(PRRUN_TOKEN)

		const code = await run_entry_cli.run([ISSUE, '--to', 'prrun'])

		expect(code).toBe(OK)
		expect(calls()).toStrictEqual([['run:cut', '--resume', ISSUE]])
		expect(prrun_adopt_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([stage_line(run_stage.PRRUN_STOPPED, 'prrun', 'reached')])
	})
})

describe('run_entry_cli.run — the command decides what is claimed (joshuafolkken/kit#3042)', () => {
	it('claims a planned issue for halfrun without the fullrun mark', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce(UNDER)
		read_issue_mock.mockResolvedValue(issue_read('OPEN', ['run:planned']))

		await run_entry_cli.run([ISSUE, '--to', 'halfrun'])

		expect(calls()[1]).toStrictEqual(['run:hold', ISSUE])
		expect(info_lines[0]).toBe(stage_line('planned', 'halfrun', 'implement'))
		expect(emit_plan_mock).toHaveBeenCalledExactlyOnceWith(ISSUE)
	})

	it('prints the stage line alone for kickoff, asking no cut and claiming nothing', async () => {
		const code = await run_entry_cli.run([ISSUE, '--to', 'kickoff'])

		expect(code).toBe(OK)
		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([stage_line('fresh', 'kickoff', 'plan')])
	})

	it('leaves a merged issue to the ordinary entry rather than settling it', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce(UNDER)
		read_issue_mock.mockResolvedValue(issue_read('CLOSED'))

		await run_entry_cli.run([ISSUE])

		expect(info_lines[0]).toBe(stage_line('merged', 'fullrun', 'reached'))
		expect(gather_mock).toHaveBeenCalledTimes(1)
	})
})

describe('run_entry_cli.run — a closed issue keeps its prrun hand-off (joshuafolkken/kit#3042)', () => {
	it.each(['fullrun', 'prrun'])(
		'still resumes a prrun stop merged by hand under %s, claiming nothing',
		async (command) => {
			josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
			read_issue_mock.mockResolvedValue(issue_read('CLOSED'))
			prrun_token_mock.mockResolvedValue('prrun-merged')
			prrun_adopt_mock.mockResolvedValue(true)

			const code = await run_entry_cli.run([ISSUE, '--to', command])

			expect(code).toBe(OK)
			expect(prrun_adopt_mock).toHaveBeenCalledWith(ISSUE)
			expect(calls()).toStrictEqual([
				['run:cut', '--resume', ISSUE],
				['cost', '--cut'],
			])
			expect(info_lines).toStrictEqual([
				stage_line(run_stage.MERGED, command, run_stage.REACHED),
				`entry ${CITED} — resume: prrun-merged`,
			])
		},
	)
})
