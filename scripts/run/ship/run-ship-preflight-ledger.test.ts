import type { PreflightLedgerRecord } from '#scripts/lane/lane-ledger-schema-ship'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const problems_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())
const lock_mock = vi.hoisted(() => vi.fn())
const branch_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const record_mock = vi.hoisted(() => vi.fn<(record: PreflightLedgerRecord) => Promise<void>>())

vi.mock('#scripts/git/git-preflight', () => ({
	git_preflight: {
		PRECONDITION: { ISSUE: 'issue', BRANCH: 'branch', CLASSIFICATION: 'classification' },
		problems_of: problems_mock,
	},
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: vi.fn().mockResolvedValue(['docs/josh-commands.md']) },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_body: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/git/git-branch', () => ({ git_branch: { current: branch_mock } }))
vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_preflight: record_mock },
}))
vi.mock('#scripts/review/acceptance-map-check', () => ({
	acceptance_map_check: { body_refusal: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/review/removed-tests-check', () => ({
	removed_tests_check: { body_refusal: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('./run-ship-scoped', () => ({ run_ship_scoped: { scoped_pair: scoped_mock } }))
vi.mock('./run-ship-preflight-reuse', () => ({
	run_ship_preflight_reuse: { run: async (_k: unknown, ask: () => unknown) => await ask() },
}))
vi.mock('./run-ship-lock', () => ({ run_ship_lock: { lock_problems: lock_mock } }))
vi.mock('./run-ship-planned', () => ({
	run_ship_planned: { PRECONDITION: 'unplanned', problems: vi.fn().mockResolvedValue([]) },
}))
vi.mock('./run-ship-body-draft', () => ({
	run_ship_body_draft: { existing: vi.fn().mockResolvedValue(undefined) },
}))

const { run_ship_preflight } = await import('./run-ship-preflight')

// joshuafolkken/kit#7874: every evaluated preflight, passed or stopped, records the kinds it asked
// beside the ones it found unmet, so each kind's stops are read against its evaluations.

const OK = 0
const FAILED = 1
const ISSUE = 7874
const REQUEST = {
	title: `Record every preflight evaluation #${String(ISSUE)}`,
	body_path: undefined,
}
const ASKED = [
	'issue',
	'branch',
	'classification',
	'live-evidence',
	'acceptance-map',
	'removed-tests',
	'lock',
	'unplanned',
]

beforeEach(() => {
	problems_mock.mockReset().mockResolvedValue([])
	scoped_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	lock_mock.mockReset().mockResolvedValue([])
	branch_mock.mockReset().mockResolvedValue(`${String(ISSUE)}-lane`)
	record_mock.mockReset().mockResolvedValue()
})

describe('run_ship_preflight.stage — the evaluation recorded in the lane ledger', () => {
	it('records every kind asked, the scoped pair included, and none unmet on a pass', async () => {
		await run_ship_preflight.stage(REQUEST)

		expect(record_mock).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			evaluated: [...ASKED, 'scoped'],
			unmet: [],
		})
	})

	it('records the unmet kinds of a stop, without the scoped pair it never ran', async () => {
		problems_mock.mockResolvedValue([{ kind: 'classification', problem: 'no classification' }])
		lock_mock.mockResolvedValue(['pnpm-lock.yaml drifted'])

		await run_ship_preflight.stage(REQUEST)

		expect(scoped_mock).not.toHaveBeenCalled()
		expect(record_mock).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			evaluated: ASKED,
			unmet: ['classification', 'lock'],
		})
	})

	it('records a red scoped pair as its one unmet kind', async () => {
		scoped_mock.mockResolvedValue({ code: FAILED, out: 'lint:related red' })

		await run_ship_preflight.stage(REQUEST)

		expect(record_mock).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			evaluated: [...ASKED, 'scoped'],
			unmet: ['scoped'],
		})
	})

	it('records nothing on a branch with no issue number', async () => {
		branch_mock.mockResolvedValue('main')

		await run_ship_preflight.stage(REQUEST)

		expect(record_mock).not.toHaveBeenCalled()
	})
})
