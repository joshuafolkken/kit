import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_audit_cli } from './cost-audit-cli'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: vi.fn() },
}))
vi.mock('./cost-audit-read', () => ({ cost_audit_read: { load: vi.fn() } }))

const { ms, day, record, session } = cost_audit_fixture
const NOW_MS = ms(day(14))
const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const repo_name = vi.mocked(git_gh_command.repo_get_name_with_owner)
const load = vi.mocked(cost_audit_read.load)
// One $2 request three days into the current seven-day period.
const SESSIONS = [session('fullrun', [record('a', day(10), 2)])]

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

describe('cost_audit_cli.merged_query — the GitHub search for merged pull requests', () => {
	it('bounds the window by ISO instants without milliseconds', () => {
		const window = { start_ms: Date.UTC(2026, 0, 1), end_ms: Date.UTC(2026, 0, 8) }

		expect(cost_audit_cli.merged_query('o/r', window)).toBe(
			'repo:o/r is:pr is:merged merged:2026-01-01T00:00:00Z..2026-01-08T00:00:00Z',
		)
	})
})

describe('cost_audit_cli.run — the printed report', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		load.mockReturnValue(SESSIONS)
		repo_name.mockResolvedValue('o/r')
		exec_gh_api.mockResolvedValue(JSON.stringify({ total_count: 2 }))
	})

	it('prints the report with the per-merge row and exits 0', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run([], '/repo', NOW_MS)).toBe(0)
		expect(info).toHaveBeenCalledWith('  merges: 2 (prev 2)')
		expect(info).toHaveBeenCalledWith('  per merge: $1.0000 (prev $0.0000, new)  regression')
	})

	it('prints no per-merge row when GitHub cannot be read', async () => {
		exec_gh_api.mockRejectedValue(new Error('offline'))
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await cost_audit_cli.run([], '/repo', NOW_MS)

		expect(info).toHaveBeenCalledWith('  merges: not read from GitHub')
	})

	it('prints the usage and exits 1 on a bad period', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await cost_audit_cli.run(['--period', '0'], '/repo', NOW_MS)).toBe(1)
		expect(error).toHaveBeenCalledWith(cost_audit_cli.USAGE)
	})
})

describe('josh cost:audit registration', () => {
	it('is registered as a command', () => {
		expect(COMMAND_MAP['cost:audit']?.script).toBe('scripts/cost-audit/cost-audit-cli.ts')
	})
})
