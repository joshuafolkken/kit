import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const format_report_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))
vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { gather: gather_mock, to_parts: to_parts_mock },
}))
vi.mock('./run-prep', () => ({ run_prep: { format_report: format_report_mock } }))

const { run_entry_cli } = await import('./run-entry-cli')

const OK = 0
const HELD = { code: OK, out: 'hold' }
const UNDER = { code: OK, out: 'under\n43630 billed input tokens' }
const PREP_BODY = '=== issue ===\nbody'
const ISSUE = '2372'

const info_lines: Array<string> = []

function state_parts(state: string, is_human_review = false, latest_scope = 'skip'): unknown {
	return { issue_number: ISSUE, state: { state, is_human_review }, latest_scope }
}

beforeEach(() => {
	josh_run_mock.mockReset()
	is_child_mock.mockReset().mockReturnValue(false)
	gather_mock.mockReset().mockResolvedValue({})
	to_parts_mock.mockReset().mockReturnValue(state_parts('OPEN'))
	format_report_mock.mockReset().mockReturnValue(PREP_BODY)
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_entry_cli.run — a held tree in budget folds hold, cost, prep and step into one report', () => {
	it('claims the tree, reads the budget, gathers the reads and prints one composite', async () => {
		josh_run_mock.mockResolvedValueOnce(HELD).mockResolvedValueOnce(UNDER)

		const code = await run_entry_cli.run([ISSUE])

		expect(code).toBe(OK)
		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:hold', ISSUE],
			['cost', '--cut'],
		])
		expect(gather_mock).toHaveBeenCalledTimes(1)
		expect(info_lines).toStrictEqual([
			`entry #${ISSUE} — hold: hold · cost: under · verdict: implement\n\n${PREP_BODY}`,
		])
	})
})

describe('run_entry_cli.run — a stop short-circuits before the reads it would waste', () => {
	it('stops on a busy hold without reading the budget or the issue', async () => {
		josh_run_mock.mockResolvedValueOnce({ code: OK, out: 'busy' })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(josh_run_mock).toHaveBeenCalledTimes(1)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines[0]).toContain(`entry #${ISSUE} — hold: busy · cost: skipped · verdict: -`)
	})

	it('stops on a spent budget without reading the issue', async () => {
		josh_run_mock.mockResolvedValueOnce(HELD).mockResolvedValueOnce({ code: OK, out: 'over' })

		const code = await run_entry_cli.run([ISSUE])

		expect(code).not.toBe(OK)
		expect(gather_mock).not.toHaveBeenCalled()
		expect(info_lines[0]).toContain('cost: over · verdict: -')
	})
})

describe('run_entry_cli — the lane-aware budget skip', () => {
	it('skips cost --cut in a dispatched lane child, where the parent owns the budget', async () => {
		is_child_mock.mockReturnValue(true)
		josh_run_mock.mockResolvedValueOnce(HELD)

		await run_entry_cli.run([ISSUE])

		expect(josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)).toStrictEqual([
			['run:hold', ISSUE],
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
