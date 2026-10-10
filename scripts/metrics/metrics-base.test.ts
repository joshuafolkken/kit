import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reading } from './metrics-base'
import type { Metrics } from './metrics-logic'

// joshuafolkken/kit#3644: which commit the totals are held to, and the approval files read beside
// them. git is mocked — the measured tree is `metrics-base.integration.test.ts`'s — and the approval
// directory is real.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { status: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({
	change_base: { resolved_through_merge: vi.fn() },
}))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { git_command } = await import('#scripts/git/git-command')
const { change_base } = await import('#scripts/git/change-base')
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
