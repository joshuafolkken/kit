import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const make_directory = temporary_directory('suite')
const ROOT = make_directory('josh-removed-tests-')
const BOARD_AT_BASE =
	"describe('board', () => {\n\tit('kept', () => {})\n\tit('dropped', () => {})\n})\n"
const BOARD_NOW = "describe('board', () => {\n\tit('kept', () => {})\n})\n"
const BOARD_GROWN = "describe('board', () => {\n\tit('kept', () => {})\n\tit('new', () => {})\n})\n"
const DROPPED_BODY = 'expect(board_rows.drop(board, 1)).toStrictEqual([ROW_A, ROW_C])'
const BOARD_WITH_BODY = `describe('board', () => {\n\tit('kept', () => {})\n\tit('dropped', () => { ${DROPPED_BODY} })\n})\n`
const RETITLED = `describe('board', () => {\n\tit('kept', () => {})\n\tit('drops a row', () => { ${DROPPED_BODY} })\n})\n`
const REWRITTEN =
	"describe('board', () => {\n\tit('kept', () => {})\n\tit('drops a row', () => { render(view); expect(screen.getByRole('row')).toBeVisible() })\n})\n"
const DROPPED = 'board > dropped'
const WHOLE_FILE = 'whole file'
const REMOVED = [DROPPED, WHOLE_FILE]
const REMOVAL = {
	removed: REMOVED,
	renamed: [],
	files: [{ path: DELETED_FILE, titles: [WHOLE_FILE] }],
}
const GONE_AT_BASE = "it('whole file', () => {})\n"
const AT_BASE: Readonly<Record<string, string>> = {
	[`${BASE}:${KEPT_FILE}`]: BOARD_AT_BASE,
	[`${BASE}:${DELETED_FILE}`]: GONE_AT_BASE,
}

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
		await expect(removed_tests_check.read()).resolves.toMatchObject(REMOVAL)
		expect(held_mock).toHaveBeenCalledWith(BASE, [KEPT_FILE, DELETED_FILE])
	})

	it('reads a test file the base did not hold as adding tests, not removing any', async () => {
		held_mock.mockResolvedValue([])

		await expect(removed_tests_check.read()).resolves.toMatchObject({ removed: [], renamed: [] })
		expect(show_mock).not.toHaveBeenCalled()
	})

	it('answers nothing it can rely on when the base cannot be resolved', async () => {
		base_mock.mockResolvedValue(undefined)

		await expect(removed_tests_check.read()).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#5541: the titles the change added, which meet the draft's acceptance rows.
describe('removed_tests_check.changes — the titles the change removed and added', () => {
	it('lists a test added to a kept file beside the removed ones', async () => {
		writeFileSync(path.join(ROOT, KEPT_FILE), BOARD_GROWN)

		await expect(removed_tests_check.changes()).resolves.toStrictEqual({
			...REMOVAL,
			added: ['board > new'],
		})
	})

	it('answers nothing when the base cannot be resolved', async () => {
		base_mock.mockResolvedValue(undefined)

		await expect(removed_tests_check.changes()).resolves.toBeUndefined()
	})
})

describe('removed_tests_check.refusal — the merge gate', () => {
	it('refuses with each undisposed test or deleted file named, reading the branch’s body', async () => {
		const refusal = await removed_tests_check.refusal('4287-lane')

		expect(refusal).toContain(`\`${DROPPED}\``)
		expect(refusal).toContain(`\`${DELETED_FILE}\` — 未記入`)
		expect(pr_body_mock).toHaveBeenCalledWith('4287-lane')
	})

	// joshuafolkken/kit#8927: one row naming the deleted file disposes of its tests.
	it.each([
		['one row per test (ac-30790fde)', WHOLE_FILE],
		['the deleted file named in place of its tests (ac-5e6ddb59)', DELETED_FILE],
	])('passes once the body disposes of each, %s', async (_name, name) => {
		const body = [
			removed_tests.DISPOSITION_HEADING,
			'',
			`- \`${DROPPED}\` — 置き換え: board > kept`,
			`- \`${name}\` — 廃止: #4287 the file tested a removed command`,
		].join('\n')

		await expect(removed_tests_check.body_refusal(body)).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#4563: the pending rows `josh test:related` writes into the draft are no disposition.
	it('still refuses a body holding only the pending rows the draft was given', async () => {
		const removal = await removed_tests_check.read()
		const removed = removal?.removed ?? []
		const body = removed_tests.with_pending_rows('', removed, removal)

		expect(removed).toHaveLength(2)
		await expect(removed_tests_check.body_refusal(body)).resolves.toBe(
			removed_tests.refusal_message(removed, removal),
		)
	})

	it('refuses, rather than passes, when the base cannot be resolved', async () => {
		base_mock.mockResolvedValue(undefined)

		await expect(removed_tests_check.body_refusal('')).resolves.toBe(
			removed_tests_check.UNREADABLE_MESSAGE,
		)
	})
})

// joshuafolkken/kit#7883: a retitled test is reported with its replacement row already written.
function retitle(now: string): void {
	show_mock.mockImplementation(async (spec) => (spec.endsWith(KEPT_FILE) ? BOARD_WITH_BODY : ''))
	writeFileSync(path.join(ROOT, KEPT_FILE), now)
}

describe('removed_tests_check — a retitled test', () => {
	it('reports a retitled test with an unchanged body as renamed when its row is missing', async () => {
		retitle(RETITLED)

		await expect(removed_tests_check.body_refusal('')).resolves.toContain(
			`- \`${DROPPED}\` — 置き換え: \`board > drops a row\``,
		)
	})

	it('does not take a retitled test whose body was rewritten for a rename', async () => {
		retitle(REWRITTEN)

		await expect(removed_tests_check.read()).resolves.toMatchObject({
			removed: [DROPPED],
			renamed: [],
		})
	})
})
