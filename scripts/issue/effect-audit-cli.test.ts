import { readFileSync } from 'node:fs'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effect_audit_cli } from './effect-audit-cli'
import { issue_sample_gate } from './issue-sample-gate'

// joshuafolkken/kit#4958: the listing reads two searches — the window's closed time-shortening issues
// and every follow-up measurement — and `--draft` writes the retirement candidate of a shortfall.

const NOW_MS = Date.parse('2026-10-26T00:00:00Z')
const ORIGIN = {
	number: 4896,
	title: 'Origin',
	state: 'closed',
	labels: [],
	body: '## 背景\n\n- 目的: 時間短縮',
}
const FOLLOW_UP = {
	number: 4897,
	title: 'Measure',
	state: 'closed',
	labels: [{ name: 'measured' }, { name: 'measured:unmet' }],
	body: '## 背景\n\n- 実施可能条件: #4899 のマージ後 10 マージ\n\n#4896 の効果',
}
const MERGED_AT = '2026-10-20T00:00:00Z'
const RATE_LIMITED = new Error('rate limited')

const lines: Array<string> = []

function page(items: ReadonlyArray<object>): string {
	return JSON.stringify({ total_count: items.length, incomplete_results: false, items })
}

beforeEach(() => {
	lines.length = 0
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue('o/r')
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request: GhApiRequest) =>
		page([request.path.includes('closed%3A') ? ORIGIN : FOLLOW_UP]),
	)
	vi.spyOn(issue_sample_gate, 'read_source').mockResolvedValue({
		merged_at: MERGED_AT,
		closes: ORIGIN.number,
	})
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('effect_audit_cli.run — the listing', () => {
	it('prints the summary and one line per issue, the window starting --days back', async () => {
		expect(await effect_audit_cli.run(['--days', '30'], NOW_MS)).toBe(0)
		expect(lines[0]).toBe(
			'effect:audit — closed since 2026-09-26: 1 issues · 届いた 0 · 届かなかった 1 · 未計測 0',
		)
		expect(lines[1]).toMatch(
			/^\S*#4896\S* — 期待効果: 効く率 — · .* — 後続計測: \S*#4897\S* \(closed\) — 結果: 届かなかった$/u,
		)
		expect(lines).toHaveLength(2)
	})

	it.each([['--days', '0'], ['--draft', 'x'], ['--bogus']])(
		'refuses %s with the usage line',
		async (...argv) => {
			expect(await effect_audit_cli.run(argv, NOW_MS)).toBe(1)
			expect(lines[0]).toMatch(/^Usage: josh effect:audit/u)
		},
	)

	it('credits a follow-up to no issue when its cited pull request cannot be read', async () => {
		vi.spyOn(issue_sample_gate, 'read_source').mockRejectedValue(RATE_LIMITED)

		expect(await effect_audit_cli.run([], NOW_MS)).toBe(0)
		expect(lines[0]).toMatch(/届かなかった 0 · 未計測 1$/u)
		expect(lines.at(-1)).toMatch(/^\(1 follow-ups measure no issue: /u)
	})

	it('fails when a search cannot be read', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(RATE_LIMITED)

		expect(await effect_audit_cli.run([], NOW_MS)).toBe(1)
	})
})

describe('effect_audit_cli.run — --draft', () => {
	it('writes the candidate and prints the issue:file line that files it', async () => {
		expect(await effect_audit_cli.run(['--draft', '4896'], NOW_MS)).toBe(0)

		const command = lines[1] ?? ''
		const file = /--body-file (?<file>\S+)/u.exec(command)?.groups?.['file'] ?? ''

		expect(command).toMatch(/^pnpm josh issue:file "Retire or shrink the mechanism of #4896/u)
		expect(readFileSync(file, 'utf8')).toContain('- 出どころ: #4897 の計測')
	})

	it.each([
		['a measurement that reached it', [{ name: 'measured' }]],
		['no recorded measurement', []],
	])('refuses an issue of the window with %s', async (_case, labels) => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (request: GhApiRequest) =>
			page([request.path.includes('closed%3A') ? ORIGIN : { ...FOLLOW_UP, labels }]),
		)

		expect(await effect_audit_cli.run(['--draft', '4896'], NOW_MS)).toBe(1)
		expect(lines[0]).toMatch(/is not an issue of the window whose measurement fell short$/u)
	})

	it('refuses a follow-up, which is no issue of the window', async () => {
		expect(await effect_audit_cli.run(['--draft', '4897'], NOW_MS)).toBe(1)
	})
})
