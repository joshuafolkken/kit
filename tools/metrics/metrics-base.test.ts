import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reading } from './metrics-base'
import type { CachedReading } from './metrics-base-cache'
import type { Metrics } from './metrics-logic'

// joshuafolkken/kit#3644: which commit the totals are held to, and the approval files read beside
// them. git is mocked — the measured tree is `metrics-base.integration.test.ts`'s — and the approval
// directory is real.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { status: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({
	change_base: { resolved_through_merge: vi.fn() },
}))
vi.mock('#scripts/git/base-tree', () => ({ base_tree: { with_tree: vi.fn() } }))
vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('./metrics-base-cache', () => ({ metrics_base_cache: { read: vi.fn(), write: vi.fn() } }))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { git_command } = await import('#scripts/git/git-command')
const { change_base } = await import('#scripts/git/change-base')
const { base_tree } = await import('#scripts/git/base-tree')
const { execa } = await import('execa')
const { metrics_base_cache } = await import('./metrics-base-cache')
const { metrics_base } = await import('./metrics-base')
const { metrics_ratchet } = await import('./metrics-ratchet')

const scratch = mkdtempSync(path.join(tmpdir(), 'metrics-base-test-'))
const MERGE_BASE = 'aaaaaaa'
const NAMED_COMMIT = 'bbbbbbb'
const NAMED = 'HEAD^1'
const ISSUE = 7
const APPROVAL_FILE = '7.json'
const RULE_LINES = 'rules.lines'
const APPROVAL = { reason: 'Fixture rules', date: '2026-10-10', growth: { [RULE_LINES]: 2 } }
const CLEAN_STATUS = ''
const COMMIT_PEEL = '^{commit}'
const METRICS: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
	prose: { long_paragraphs: 800, excess_bold: 2100 },
}

function root(): string {
	return mkdtempSync(path.join(scratch, 'root-'))
}

beforeEach(() => {
	vi.stubEnv(metrics_base.BASE_VARIABLE, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetAllMocks()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('metrics_base.resolve_commit', () => {
	it('asks git for the merge-base where no commit is named', async () => {
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue(MERGE_BASE)

		await expect(metrics_base.resolve_commit()).resolves.toBe(MERGE_BASE)
		expect(git_spawn.read).not.toHaveBeenCalled()
	})

	it('has no commit where none is named and git has no merge-base', async () => {
		vi.mocked(change_base.resolved_through_merge).mockResolvedValue(undefined)

		await expect(metrics_base.resolve_commit()).resolves.toBeUndefined()
	})

	it('peels the named commit instead of asking for the merge-base', async () => {
		vi.stubEnv(metrics_base.BASE_VARIABLE, NAMED)
		vi.mocked(git_spawn.read).mockResolvedValue(NAMED_COMMIT)

		await expect(metrics_base.resolve_commit()).resolves.toBe(NAMED_COMMIT)
		expect(git_spawn.read).toHaveBeenCalledWith(['rev-parse', '--verify', `${NAMED}${COMMIT_PEEL}`])
		expect(change_base.resolved_through_merge).not.toHaveBeenCalled()
	})

	it('fails on a name that resolves to no commit', async () => {
		vi.stubEnv(metrics_base.BASE_VARIABLE, NAMED)
		vi.mocked(git_spawn.read).mockRejectedValue(new Error('unknown revision'))

		await expect(metrics_base.resolve_commit()).rejects.toThrow(
			`${metrics_base.BASE_VARIABLE}=${NAMED} names no commit in this checkout`,
		)
	})
})

describe('metrics_base.approval_texts', () => {
	it('reads back the approval file written for an issue, by its file name', () => {
		const directory = root()

		const file = metrics_base.write_approval(directory, ISSUE, APPROVAL)

		expect(file).toBe(`${metrics_base.APPROVAL_DIRECTORY}/${APPROVAL_FILE}`)
		expect(metrics_base.approval_texts(directory)).toStrictEqual(
			new Map([[APPROVAL_FILE, metrics_ratchet.approval_text(APPROVAL)]]),
		)
	})

	it('has no approval where the directory was never written', () => {
		expect(metrics_base.approval_texts(root())).toStrictEqual(new Map())
	})
})

describe('metrics_base.read', () => {
	it('answers with the checkout own reading where it sits clean on the base commit', async () => {
		const current: Reading = { metrics: METRICS, approvals: new Map() }

		vi.mocked(git_spawn.read).mockResolvedValue(MERGE_BASE)
		vi.mocked(git_command.status).mockResolvedValue(CLEAN_STATUS)

		await expect(metrics_base.read(MERGE_BASE, current)).resolves.toBe(current)
	})
})

type ExecaResult = Awaited<ReturnType<typeof execa>>

const CURRENT: Reading = { metrics: METRICS, approvals: new Map() }
const OTHER_HEAD = 'ccccccc'
const APPROVAL_TEXT = 'approved'
const MEASURED: CachedReading = {
	stdout: JSON.stringify(METRICS),
	approvals: [[APPROVAL_FILE, APPROVAL_TEXT]],
}

function off_base(): void {
	vi.mocked(git_spawn.read).mockResolvedValue(OTHER_HEAD)
	vi.mocked(git_command.status).mockResolvedValue(CLEAN_STATUS)
}

function child_result(stdout: string): ExecaResult {
	return { stdout } as unknown as ExecaResult
}

function measuring(stdout: string): void {
	vi.mocked(execa).mockResolvedValue(child_result(stdout))
	vi.mocked(base_tree.with_tree).mockImplementation(
		async (_prefix, _commit, use) => await use({ parent: scratch, tree: root() }),
	)
}

// joshuafolkken/kit#4382: one base commit under one ruler is measured once.
describe('metrics_base.read — the cached base', () => {
	it('reads a cached base back without building a tree or starting the child', async () => {
		off_base()
		vi.mocked(metrics_base_cache.read).mockReturnValue(MEASURED)

		const reading = await metrics_base.read(MERGE_BASE, CURRENT)

		expect(reading).toStrictEqual({
			metrics: METRICS,
			approvals: new Map([[APPROVAL_FILE, APPROVAL_TEXT]]),
		})
		expect(base_tree.with_tree).not.toHaveBeenCalled()
		expect(execa).not.toHaveBeenCalled()
	})
})

describe('metrics_base.read — a base the cache does not answer for', () => {
	it('measures a base nothing cached, and writes the measurement back', async () => {
		off_base()
		vi.mocked(metrics_base_cache.read).mockReturnValue(undefined)
		measuring(JSON.stringify(METRICS))

		const reading = await metrics_base.read(MERGE_BASE, CURRENT)

		expect(reading).toStrictEqual({ metrics: METRICS, approvals: new Map() })
		expect(execa).toHaveBeenCalledOnce()
		expect(metrics_base_cache.write).toHaveBeenCalledWith(MERGE_BASE, expect.any(String), {
			stdout: JSON.stringify(METRICS),
			approvals: [],
		})
	})

	it('measures again where the cached record no longer parses', async () => {
		off_base()
		vi.mocked(metrics_base_cache.read).mockReturnValue({ stdout: '{}', approvals: [] })
		measuring(JSON.stringify(METRICS))

		await expect(metrics_base.read(MERGE_BASE, CURRENT)).resolves.toStrictEqual(CURRENT)
		expect(execa).toHaveBeenCalledOnce()
	})

	it('fails, and caches nothing, where the base printed no totals', async () => {
		off_base()
		vi.mocked(metrics_base_cache.read).mockReturnValue(undefined)
		measuring('')

		await expect(metrics_base.read(MERGE_BASE, CURRENT)).rejects.toThrow('printed no totals')
		expect(metrics_base_cache.write).not.toHaveBeenCalled()
	})
})
