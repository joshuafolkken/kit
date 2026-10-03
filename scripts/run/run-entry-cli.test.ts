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

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { gather: gather_mock, to_parts: to_parts_mock },
}))
vi.mock('./run-prep', () => ({ run_prep: { format_report: format_report_mock } }))
vi.mock('./run-halfrun-resume', () => ({
	run_halfrun_resume: { adopt: adopt_mock, is_pending: is_pending_mock },
}))
vi.mock('./run-prrun-resume', () => ({
	run_prrun_resume: { adopt: prrun_adopt_mock, resume_token: prrun_token_mock },
}))

const { run_entry_cli } = await import('./run-entry-cli')

const OK = 0
const FRESH = { code: OK, out: 'fresh' }
const HELD = { code: OK, out: 'hold' }
const UNDER = { code: OK, out: 'under\n43630 billed input tokens' }
const PREP_BODY = '=== issue ===\nbody'
const ISSUE = '2372'

const info_lines: Array<string> = []

function state_parts(state: string, is_human_review = false, latest_scope = 'skip'): unknown {
	return { issue_number: ISSUE, state: { state, is_human_review }, latest_scope }
}

function reset_resume_mocks(): void {
	adopt_mock.mockReset().mockResolvedValue(false)
	is_pending_mock.mockReset().mockResolvedValue(false)
	prrun_adopt_mock.mockReset().mockResolvedValue(false)
	prrun_token_mock.mockReset().mockResolvedValue(undefined)
}

beforeEach(() => {
	josh_run_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(false)
	gather_mock.mockReset().mockResolvedValue({})
	to_parts_mock.mockReset().mockReturnValue(state_parts('OPEN'))
	format_report_mock.mockReset().mockReturnValue(PREP_BODY)
	reset_resume_mocks()
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
		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['run:hold', ISSUE, '--fullrun'],
			['cost', '--cut'],
		])
		expect(gather_mock).toHaveBeenCalledTimes(1)
		expect(info_lines).toStrictEqual([
			`entry #${ISSUE} — hold: hold · cost: under · verdict: implement\n\n${PREP_BODY}`,
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
		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['cost', '--cut'],
		])
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([
			`entry #${ISSUE} — resume: ${run_entry_cli.HALFRUN_RESUME_TOKEN}`,
		])
	})

	it('stops on a spent budget without adopting the halfrun hold', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce({ code: OK, out: 'over' })
		is_pending_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(adopt_mock).not.toHaveBeenCalled()
		expect(info_lines[0]).toContain('cost: over')
	})
})

describe('run_entry_cli.run — a prrun stop is resumed rather than claimed (joshuafolkken/kit#3023)', () => {
	const PRRUN_TOKEN = 'prrun-merge'

	it('adopts the prrun hold and reports its token without claiming', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		prrun_token_mock.mockResolvedValue(PRRUN_TOKEN)
		prrun_adopt_mock.mockResolvedValue(true)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(prrun_adopt_mock).toHaveBeenCalledWith(ISSUE)
		expect(josh_run_mock).toHaveBeenCalledTimes(2)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([`entry #${ISSUE} — resume: ${PRRUN_TOKEN}`])
	})

	it('stops busy when the hold could not be adopted', async () => {
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(UNDER)
		prrun_token_mock.mockResolvedValue(PRRUN_TOKEN)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(info_lines[0]).toContain('hold: busy')
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
		expect(info_lines[0]).toContain(`entry #${ISSUE} — hold: busy · cost: skipped · verdict: -`)
	})

	it('stops on a spent budget without reading the issue', async () => {
		josh_run_mock
			.mockResolvedValueOnce(FRESH)
			.mockResolvedValueOnce(HELD)
			.mockResolvedValueOnce({ code: OK, out: 'over' })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines[0]).toContain('cost: over · verdict: -')
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
		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:cut', '--resume', ISSUE],
		])
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines).toStrictEqual([`entry #${ISSUE} — resume: ${token}`])
	})
})

describe('run_entry_cli — the lane-aware budget skip', () => {
	it('skips cost --cut in a dispatched lane child, where the parent owns the budget', async () => {
		is_child_mock.mockReturnValue(true)
		josh_run_mock.mockResolvedValueOnce(FRESH).mockResolvedValueOnce(HELD)

		await run_entry_cli.run([ISSUE])

		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:cut', '--resume', ISSUE],
			['run:hold', ISSUE, '--fullrun'],
		])
		expect(info_lines[0]).toContain('cost: skipped')
	})
})

describe('run_entry_cli.parse_number — exactly one issue number', () => {
	it('refuses zero, two, or a non-number', () => {
		expect(run_entry_cli.parse_number([])).toBeUndefined()
		expect(run_entry_cli.parse_number([ISSUE, '99'])).toBeUndefined()
		expect(run_entry_cli.parse_number(['x'])).toBeUndefined()
		expect(run_entry_cli.parse_number([ISSUE])).toBe(ISSUE)
	})
})
