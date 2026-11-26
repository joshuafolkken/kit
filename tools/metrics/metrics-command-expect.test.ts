import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { metrics_base, type Reading } from './metrics-base'
import { metrics_command } from './metrics-command'
import type { Metrics } from './metrics-logic'
import { metrics_ratchet } from './metrics-ratchet'

// joshuafolkken/kit#8860: `josh metrics --expect` writes the declaration as the branch issue's approval.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: vi.fn(), branch: vi.fn() },
}))

const BASE_COMMIT = 'abc1234'
const APPROVAL_FILE = '.josh/metrics-accepted/8860.json'
const REASON = 'adds a guard'
const EXPECT_ARGV = ['--expect', 'guards=5', '--reason', REASON]

const TOTALS: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
	prose: { long_paragraphs: 800, excess_bold: 2100 },
}

const make_directory = temporary_directory()

function without_base_approvals(_commit: string, current: Reading): Promise<Reading> {
	return Promise.resolve({ ...current, approvals: new Map<string, string>() })
}

// A fresh root on branch `8860-lane`, its merge-base `commit` carrying no approvals.
function staged_root(commit: string | undefined): string {
	const root = make_directory('metrics-expect-')

	vi.spyOn(console, 'info').mockReturnValue(undefined)
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	vi.mocked(git_command.repository_root).mockResolvedValue(root)
	vi.mocked(git_command.branch).mockResolvedValue('8860-lane')
	vi.spyOn(metrics_base, 'resolve_commit').mockResolvedValue(commit)
	vi.spyOn(metrics_base, 'read').mockImplementation(without_base_approvals)

	return root
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('metrics_command.run_metrics — the --expect form', () => {
	it('writes the declared growth as the branch issue approval (ac-df494071)', async () => {
		const root = staged_root(BASE_COMMIT)

		expect(await metrics_command.run_metrics(EXPECT_ARGV)).toBe(0)

		const approval = metrics_ratchet.parse_approval(
			readFileSync(path.join(root, APPROVAL_FILE), 'utf8'),
		)

		expect(approval?.growth).toStrictEqual({ guards: 5 })
		expect(approval?.reason).toBe(REASON)
	})

	it('refuses a malformed declaration before reading the tree', async () => {
		staged_root(BASE_COMMIT)

		expect(await metrics_command.run_metrics(['--expect', 'guards=0', '--reason', REASON])).toBe(1)
		expect(git_command.repository_root).not.toHaveBeenCalled()
	})

	it('fails without a merge-base to declare against', async () => {
		staged_root(undefined)

		expect(await metrics_command.run_metrics(EXPECT_ARGV)).toBe(1)
	})

	it('fails on a branch that names no issue', async () => {
		staged_root(BASE_COMMIT)
		vi.mocked(git_command.branch).mockResolvedValue('main')

		expect(await metrics_command.run_metrics(EXPECT_ARGV)).toBe(1)
	})
})

// An `--accept` after a `--expect` writes through `write_raised`.
describe('metrics_command.record_growth after a declaration', () => {
	const RAISED_PREFIX = 'metrics-raised-'
	const unchanged = { metrics: TOTALS, approvals: new Map<string, string>() }
	const grown_metrics = { ...TOTALS, guards: TOTALS.guards + 2 }

	it('keeps the declared ceiling an accept measured below (ac-a8740432)', () => {
		vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const root = make_directory(RAISED_PREFIX)
		const declared = { reason: 'declared', date: '2026-11-23', growth: { guards: 5 } }
		const approvals = new Map([['1.json', metrics_ratchet.approval_text(declared)]])
		const growth = {
			base: unchanged,
			current: { metrics: grown_metrics, approvals },
			reason: 'accepted',
		}

		expect(metrics_command.record_growth(root, 1, growth)).toBe(0)

		const written = readFileSync(path.join(root, '.josh/metrics-accepted/1.json'), 'utf8')

		expect(metrics_ratchet.parse_approval(written)?.growth).toStrictEqual({ guards: 5 })
	})

	it('records nothing on a branch that names no issue', () => {
		const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const growth = {
			base: unchanged,
			current: { ...unchanged, metrics: grown_metrics },
			reason: 'accepted',
		}

		expect(metrics_command.record_growth(make_directory(RAISED_PREFIX), undefined, growth)).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('names no issue'))
	})
})
