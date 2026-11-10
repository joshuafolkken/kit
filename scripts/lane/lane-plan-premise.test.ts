import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { trusted_measure } from '#scripts/issue/trusted-measure'
import { line_budget } from '#scripts/lines/line-budget'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'

// joshuafolkken/kit#7022: joshuafolkken/kit#6982 was filed on a premise that no longer held, and its lane
// noticed only by chance. A first `lane:plan` re-runs the premises and stops before the first edit.

const make_directory = temporary_directory('suite')
const ROOT = make_directory('lane-plan-premise-')
const ISSUE = 6982
const FILE = 'scripts/lane/one.ts'
const COMMAND = 'pnpm josh count'
const HOLDS = `## 背景\n\n- 前提: \`${COMMAND}\` <= 5\n`
const NO_PREMISE = '## 背景\n\n- 種別: 非不具合\n'
const UNREADABLE = 'measured unreadable'
const LISTING_LIMIT = 100
const directory = path.join(ROOT, 'lane')

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const read_trusted_body = vi.spyOn(trusted_measure, 'read_trusted_body')
const run_command = vi.spyOn(trusted_measure, 'run_command')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')

function listed(body: string): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]
	const issues: Array<OpenIssueData> = [
		{ number: ISSUE, title: 'premised', createdAt: '2026-11-10T00:00:00Z', labels, body },
	]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

async function plan_with(body: string): Promise<number> {
	fetch_opted_in.mockResolvedValue(listed(body))
	read_trusted_body.mockResolvedValue({
		kind: 'trusted',
		body,
		issue: String(ISSUE),
		author: 'author',
		editor: 'author',
	})

	return await lane_plan_cli.run([String(ISSUE), FILE], directory)
}

function printed(): string {
	return error.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
	vi.spyOn(lane_plan_signals, 'signals_of').mockResolvedValue(
		lane_plan_signals.signals_from(ISSUE, { hunk_files: [], committed_files: [] }, [], 0),
	)
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	run_command.mockReturnValue({ kind: 'ok', output: '3' })
})

describe('lane:plan premises', () => {
	it('records a premise that holds and answers `clear`', async () => {
		const code = await plan_with(HOLDS)

		expect(code).toBe(0)
		expect(info).toHaveBeenCalledWith('clear')
		expect(printed()).toContain(`premise: \`${COMMAND}\` <= 5 measured 3`)
		expect(lane_plan.read(ISSUE, directory)).toBeDefined()
	})

	it.each([
		['a value out of the bound', { kind: 'ok', output: '9' }, 'measured 9'],
		['an unreadable value', { kind: 'ok', output: 'nine' }, UNREADABLE],
		['a failed command', { kind: 'failed', message: 'boom' }, 'measured failed (boom)'],
	] as const)('stops before the first edit on %s, unrecorded', async (_case, run, words) => {
		run_command.mockReturnValue(run)

		const code = await plan_with(HOLDS)

		expect(code).toBe(lane_plan_check.PREMISE_EXIT_CODE)
		expect(info).toHaveBeenCalledWith('premise')
		expect(printed()).toContain(`\`${COMMAND}\` <= 5 ${words}`)
		expect(lane_plan.read(ISSUE, directory)).toBeUndefined()
	})

	it('stops when the body cannot be trusted, running nothing', async () => {
		fetch_opted_in.mockResolvedValue(listed(HOLDS))
		read_trusted_body.mockResolvedValue({ kind: 'refused', reason: 'untrusted author' })

		const code = await lane_plan_cli.run([String(ISSUE), FILE], directory)

		expect(code).toBe(lane_plan_check.PREMISE_EXIT_CODE)
		expect(printed()).toContain('not re-run: untrusted author')
		expect(run_command).not.toHaveBeenCalled()
	})
})

describe('lane:plan premise source', () => {
	it('reads the premises from the trusted body of an issue the listing does not carry', async () => {
		read_trusted_body.mockResolvedValue({
			kind: 'trusted',
			body: HOLDS,
			issue: String(ISSUE),
			author: 'author',
			editor: 'author',
		})
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })
		run_command.mockReturnValue({ kind: 'ok', output: '9' })

		const code = await lane_plan_cli.run([String(ISSUE), FILE], directory)

		expect(code).toBe(lane_plan_check.PREMISE_EXIT_CODE)
		expect(printed()).toContain(`\`${COMMAND}\` <= 5 measured 9`)
	})

	it('answers as before when an unlisted issue’s body cannot be read', async () => {
		fetch_opted_in.mockResolvedValue({ kind: 'unreadable' })
		read_trusted_body.mockResolvedValue({ kind: 'refused', reason: 'could not read issue' })

		const code = await lane_plan_cli.run([String(ISSUE), FILE], directory)

		expect(code).not.toBe(lane_plan_check.PREMISE_EXIT_CODE)
		expect(info).toHaveBeenCalledWith('wait')
		expect(run_command).not.toHaveBeenCalled()
	})
})

describe('lane:plan without a premise to re-run', () => {
	it('answers as before for an issue with no premise line, running nothing', async () => {
		const code = await plan_with(NO_PREMISE)

		expect(code).toBe(0)
		expect(info).toHaveBeenCalledWith('clear')
		expect(read_trusted_body).not.toHaveBeenCalled()
		expect(run_command).not.toHaveBeenCalled()
	})

	it('never re-runs the premises on a re-plan after the lane started', async () => {
		lane_plan.record(
			{ issue: ISSUE, paths: [FILE], planned_at: '2026-11-10T00:00:00.000Z' },
			directory,
		)
		run_command.mockReturnValue({ kind: 'ok', output: '9' })

		const code = await plan_with(HOLDS)

		expect(code).toBe(0)
		expect(run_command).not.toHaveBeenCalled()
	})
})
