import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { measure_declaration, type MeasureDeclaration } from '#scripts/issue/measure-declaration'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { lane_breakdown, type Breakdown } from '#scripts/lane/lane-breakdown'
import type { LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_archive } from '#scripts/lane/lane-ledger-archive'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_audit } from './cost-audit'
import { cost_audit_cli } from './cost-audit-cli'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'
import { cost_audit_tool } from './cost-audit-tool'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: vi.fn() },
}))
vi.mock('./cost-audit-read', () => ({
	cost_audit_read: { load: vi.fn(), load_lane_children: vi.fn(() => []) },
}))
vi.mock('#scripts/lane/lane-net-read', () => ({
	lane_net_read: { read_ledger: vi.fn(() => []), read_events: vi.fn(() => []) },
}))

const { ms, day, record, session } = cost_audit_fixture
const NOW_MS = ms(day(14))
const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const repo_name = vi.mocked(git_gh_command.repo_get_name_with_owner)
const load = vi.mocked(cost_audit_read.load)
const load_lane_children = vi.mocked(cost_audit_read.load_lane_children)
// One $2 request three days into the current seven-day period.
const SESSIONS = [session('fullrun', [record('a', day(10), 2)])]
const LANE_SESSION = { ...session('fullrun', [record('a', day(10), 2)], [], true), issue: 7 }
const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	implement: [],
	pre_detach: [],
	ship: [],
}

describe('cost_audit_cli.read_period — the --period flag', () => {
	it('defaults to seven days', () => {
		expect(cost_audit_cli.read_period([])).toBe(7)
	})

	it('reads a positive whole number of days', () => {
		expect(cost_audit_cli.read_period(['--period', '30'])).toBe(30)
	})

	it.each(['0', '1.5', 'abc', '99999'])('refuses %j', (raw) => {
		expect(cost_audit_cli.read_period(['--period', raw])).toBeUndefined()
	})

	it.each([[['--period']], [['--days', '30']]])('refuses the argv %j', (argv) => {
		expect(cost_audit_cli.read_period(argv)).toBeUndefined()
	})
})

// joshuafolkken/kit#7042: a fixed period, so a before and an after are read on the same dates.
function dated(since: string, until: string): Array<string> {
	return ['--since', since, '--until', until]
}

describe('cost_audit_cli.read_span — the --since / --until pair', () => {
	const START = '2026-10-27'
	const END = '2026-11-10'

	it('reads both UTC dates included, ending at the midnight after --until', () => {
		expect(cost_audit_cli.read_span(dated(START, END), NOW_MS)).toStrictEqual({
			days: 15,
			now_ms: Date.UTC(2026, 10, 11),
		})
	})

	it('reads one day where both dates are the same', () => {
		expect(cost_audit_cli.read_span(dated(END, END), NOW_MS)?.days).toBe(1)
	})

	it('falls back to --period ending now without the pair', () => {
		expect(cost_audit_cli.read_span(['--period', '14'], NOW_MS)).toStrictEqual({
			days: 14,
			now_ms: NOW_MS,
		})
	})

	it.each([
		[dated(START, END).slice(0, 2)],
		[dated(START, END).slice(2)],
		[[...dated(START, END), '--period', '7']],
		[dated(END, START)],
		[dated('2026-02-30', '2026-03-01')],
		[dated('2026-1-1', '2026-01-02')],
		[dated('1990-01-01', '2026-01-01')],
	])('refuses the dated argv %j', (argv) => {
		expect(cost_audit_cli.read_span(argv, NOW_MS)).toBeUndefined()
	})
})

describe('cost_audit_cli.merged_query — the GitHub search for merged pull requests', () => {
	it('bounds the window by ISO instants without milliseconds', () => {
		const window = { start_ms: Date.UTC(2026, 0, 1), end_ms: Date.UTC(2026, 0, 8) }

		expect(cost_audit_cli.merged_query('o/r', window)).toBe(
			'repo:o/r is:pr is:merged merged:2026-01-01T00:00:00Z..2026-01-08T00:00:00Z',
		)
	})
})

function stub_sources(): void {
	load.mockReturnValue(SESSIONS)
	repo_name.mockResolvedValue('o/r')
	exec_gh_api.mockResolvedValue(JSON.stringify({ total_count: 2 }))
}

describe('cost_audit_cli.run — the printed report', () => {
	beforeEach(stub_sources)

	it('prints the report with the per-merge row and exits 0', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run([], '/repo', NOW_MS)).toBe(0)
		expect(info).toHaveBeenCalledWith('  merges: 2 (prev 2)')
		expect(info).toHaveBeenCalledWith('  per merge: $1.0000 (prev $0.0000, new)  regression')
	})

	it('prints nothing and exits 1 under --density where no lane child made a request', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run(['--density'], '/repo', NOW_MS)).toBe(1)
		expect(info).not.toHaveBeenCalled()
	})

	it('prints no per-merge row when GitHub cannot be read', async () => {
		exec_gh_api.mockRejectedValue(new Error('offline'))
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await cost_audit_cli.run([], '/repo', NOW_MS)

		expect(info).toHaveBeenCalledWith('  merges: not read from GitHub')
	})

	it("prints a lane request under the phase its lane's breakdown places it in", async () => {
		const plan = { from_ms: ms(day(9)), to_ms: ms(day(11)) }
		const breakdown = { ...BREAKDOWN, plan: [plan] }
		const of = vi.spyOn(lane_breakdown, 'of').mockReturnValue(breakdown)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		load.mockReturnValue([LANE_SESSION])
		await cost_audit_cli.run([], '/repo', NOW_MS)

		expect(of).toHaveBeenCalledWith([], [], 7)
		expect(info).toHaveBeenCalledWith(expect.stringMatching(/^ {2}plan: \$2\.0000 — /u))
	})

	it('prints the usage and exits 1 on a bad period', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run(['--period', '0'], '/repo', NOW_MS)).toBe(1)
		expect(error).toHaveBeenCalledWith(cost_audit_cli.USAGE)
	})
})

// joshuafolkken/kit#8383: the Issues the lane ledger records a merge of reach the audit.
describe('cost_audit_cli.run — the merged-issue set', () => {
	beforeEach(stub_sources)

	it("passes the ledger's merge entries as merged_issues", async () => {
		const at = '2026-01-10T00:00:00.000Z'
		const entries: Array<LedgerEntry> = [
			{ kind: 'merge', at, issue: 5 },
			{ kind: 'dispatch', at, issue: 6 },
		]

		vi.spyOn(lane_ledger_archive, 'read_history').mockResolvedValue(entries)
		const audit = vi.spyOn(cost_audit, 'audit')

		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		await cost_audit_cli.run([], '/repo', NOW_MS)

		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ merged_issues: new Set([5]) }))
	})

	it('passes merged_issues as undefined when the ledger cannot be read', async () => {
		vi.spyOn(lane_ledger_archive, 'read_history').mockRejectedValue(new Error('unreadable'))
		const audit = vi.spyOn(cost_audit, 'audit')

		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		await cost_audit_cli.run([], '/repo', NOW_MS)

		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ merged_issues: undefined }))
	})
})

// joshuafolkken/kit#8284: `--density` reads the current period's lane children alone and labels the number.
const GREP_CALL = { name: 'Grep', input: {} }
const DENSITY_SESSION = {
	...LANE_SESSION,
	categories: new Map([['a', [cost_audit_tool.category_of(GREP_CALL.name, GREP_CALL.input)]]]),
}
const DENSITY_ARGV = ['--density']
const LABEL_PATTERN = /^lane-child calls per request \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/u

describe('cost_audit_cli.run — --density', () => {
	beforeEach(stub_sources)

	it('reads the lane children from the period start, with no full load, merges or breakdowns', async () => {
		const of = vi.spyOn(lane_breakdown, 'of')

		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		load_lane_children.mockReturnValue([DENSITY_SESSION])

		expect(await cost_audit_cli.run(DENSITY_ARGV, '/repo', NOW_MS)).toBe(0)
		expect(load_lane_children).toHaveBeenCalledWith('/repo', ms(day(7)))
		expect([load, exec_gh_api, repo_name, of].map((one) => one.mock.calls.length)).toStrictEqual([
			0, 0, 0, 0,
		])
	})

	it('prints the label line, then the number a measure declaration reads as the last line', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		load_lane_children.mockReturnValue([DENSITY_SESSION])
		await cost_audit_cli.run(DENSITY_ARGV, '/repo', NOW_MS)

		const output = info.mock.calls.map(([line]) => String(line))
		const declaration: MeasureDeclaration = {
			command: 'pnpm josh cost:audit --density',
			operator: '<=',
			threshold: 2,
		}

		expect(output).toStrictEqual([expect.stringMatching(LABEL_PATTERN), '1.00'])
		expect(measure_declaration.judge(declaration, output.join('\n'))).toStrictEqual({
			kind: 'pass',
			value: 1,
		})
	})
})

describe('cost_audit_cli.run — help', () => {
	it.each(['--help', '-h'])('prints the usage and exits 0 on %s', async (flag) => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run([flag], '/repo', NOW_MS)).toBe(0)
		expect(info).toHaveBeenCalledWith(cost_audit_cli.USAGE)
	})
})

describe('cost_audit_cli.run — a dated period', () => {
	beforeEach(stub_sources)

	it('counts merges over the dated window, not the trailing period ending now', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await cost_audit_cli.run(dated('2026-01-03', '2026-01-09'), '/repo', NOW_MS)

		const paths = exec_gh_api.mock.calls.map(([options]) => decodeURIComponent(options.path))

		expect(paths).toContainEqual(
			expect.stringContaining('merged:2026-01-03T00:00:00Z..2026-01-10T00:00:00Z'),
		)
	})
})

describe('cost_audit_cli.USAGE', () => {
	it('names the absolute period flags', () => {
		expect(cost_audit_cli.USAGE).toContain('--since <YYYY-MM-DD> --until <YYYY-MM-DD>')
	})
})

describe('cost_audit_cli.summary — the lines josh retrospective carries', () => {
	beforeEach(stub_sources)

	it('follows the summary line with the filing line a regression owes', async () => {
		const summary = await cost_audit_cli.summary('/repo', NOW_MS)

		expect(summary.split('\n')).toStrictEqual([
			expect.stringMatching(/^Cost audit \(7d\): /u),
			'File a cost regression: total, per merge, kind fullrun, tool reply — reproduce with `pnpm josh cost:audit`',
		])
	})
})

describe('josh cost:audit registration', () => {
	it('is registered as a command', () => {
		expect(COMMAND_MAP['cost:audit']?.script).toBe('tools/cost-audit/cost-audit-main.ts')
	})
})
