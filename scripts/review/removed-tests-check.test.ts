import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { removed_tests } from './removed-tests'

const base_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())
const changed_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const held_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())
const show_mock = vi.hoisted(() => vi.fn<(spec: string) => Promise<string>>())
const root_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const pr_body_mock = vi.hoisted(() => vi.fn<() => Promise<string | undefined>>())

vi.mock('#scripts/git/change-base', () => ({
	change_base: { resolved_through_merge: base_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_since: changed_mock, read_held_at: held_mock },
}))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: root_mock, show_file: show_mock },
}))
vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { pr_get_body: pr_body_mock } }))
vi.mock('./review-code-tree', () => ({ review_code_tree: { load_typescript: () => ts } }))

const { removed_tests_check } = await import('./removed-tests-check')

// joshuafolkken/kit#4287: the reads behind the removed-test gate — each changed test file at the base
// and in the working tree — against a temporary checkout, with git answered by the mocks above.

const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const KEPT_FILE = 'scripts/board.test.ts'
const DELETED_FILE = 'scripts/gone.test.ts'
const ROOT = mkdtempSync(path.join(tmpdir(), 'josh-removed-tests-'))
const BOARD_AT_BASE =
	"describe('board', () => {\n\tit('kept', () => {})\n\tit('dropped', () => {})\n})\n"
const BOARD_NOW = "describe('board', () => {\n\tit('kept', () => {})\n})\n"
const GONE_AT_BASE = "it('whole file', () => {})\n"
const AT_BASE: Readonly<Record<string, string>> = {
	[`${BASE}:${KEPT_FILE}`]: BOARD_AT_BASE,
	[`${BASE}:${DELETED_FILE}`]: GONE_AT_BASE,
}

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true })
})

beforeEach(() => {
	mkdirSync(path.join(ROOT, 'scripts'), { recursive: true })
	writeFileSync(path.join(ROOT, KEPT_FILE), BOARD_NOW)
	base_mock.mockReset().mockResolvedValue(BASE)
	changed_mock.mockReset().mockResolvedValue([KEPT_FILE, DELETED_FILE, 'scripts/board.ts'])
	held_mock.mockReset().mockResolvedValue([KEPT_FILE, DELETED_FILE])
	show_mock.mockReset().mockImplementation(async (spec) => AT_BASE[spec] ?? '')
	root_mock.mockReset().mockResolvedValue(ROOT)
	pr_body_mock.mockReset().mockResolvedValue(undefined)
})

describe('removed_tests_check.read — the tests the change removed', () => {
	it('lists a test dropped from a kept file and every test of a deleted one', async () => {
		await expect(removed_tests_check.read()).resolves.toStrictEqual([
			'board > dropped',
			'whole file',
		])
		expect(held_mock).toHaveBeenCalledWith(BASE, [KEPT_FILE, DELETED_FILE])
	})

	it('reads a test file the base did not hold as adding tests, not removing any', async () => {
		held_mock.mockResolvedValue([])

		await expect(removed_tests_check.read()).resolves.toStrictEqual([])
		expect(show_mock).not.toHaveBeenCalled()
	})

	it('answers nothing it can rely on when the base cannot be resolved', async () => {
		base_mock.mockResolvedValue(undefined)

		await expect(removed_tests_check.read()).resolves.toBeUndefined()
	})
})

describe('removed_tests_check.refusal — the merge gate', () => {
	it('refuses with each undisposed test named, reading this branch’s body', async () => {
		const refusal = await removed_tests_check.refusal('4287-lane')

		expect(refusal).toContain('`board > dropped`')
		expect(refusal).toContain('`whole file`')
		expect(pr_body_mock).toHaveBeenCalledWith('4287-lane')
	})

	it('passes once the body disposes of each', async () => {
		const body = [
			'## 消えたテストの処置',
			'',
			'- `board > dropped` — 置き換え: board > kept',
			'- `whole file` — 廃止: #4287 the file tested a removed command',
		].join('\n')

		await expect(removed_tests_check.body_refusal(body)).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#4563: the pending rows `josh test:related` writes into the draft are no disposition.
	it('still refuses a body holding only the pending rows the draft was given', async () => {
		const removed = (await removed_tests_check.read()) ?? []
		const body = removed_tests.with_pending_rows('', removed)

		expect(removed).toHaveLength(2)
		await expect(removed_tests_check.body_refusal(body)).resolves.toBe(
			removed_tests.refusal_message(removed),
		)
	})

	it('refuses, rather than passes, when the base cannot be resolved', async () => {
		base_mock.mockResolvedValue(undefined)

		await expect(removed_tests_check.body_refusal('')).resolves.toBe(
			removed_tests_check.UNREADABLE_MESSAGE,
		)
	})
})
