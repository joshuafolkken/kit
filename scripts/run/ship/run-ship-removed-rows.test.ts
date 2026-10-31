import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { removed_tests } from '#scripts/review/removed-tests'
import type { TitleChanges } from '#scripts/review/removed-tests-check'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { branch_mock, changes_mock, existing_mock } = vi.hoisted(() => ({
	branch_mock: vi.fn<() => Promise<string>>(),
	changes_mock: vi.fn<() => Promise<TitleChanges | undefined>>(),
	existing_mock: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: branch_mock } }))
vi.mock('#scripts/review/removed-tests-check', () => ({
	removed_tests_check: { changes: changes_mock },
}))
vi.mock('./run-ship-body-draft', () => ({ run_ship_body_draft: { existing: existing_mock } }))

const { run_ship_removed_rows } = await import('./run-ship-removed-rows')

// joshuafolkken/kit#4563: a lane that removed a test met its disposition rows only at the ship's
// preflight; a green `josh test:related` now writes them into the ship body draft first.

const TITLE = 'removed_tests.removed > lists a test the change deleted'
const PENDING = `- \`${TITLE}\` — 未記入`
const ROWS = '## 受け入れ条件の対応\n\n- `ac-12345678` the criterion — 未記入\n'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-ship-removed-rows-'))
const DRAFT = path.join(TEMPORARY, 'josh-ship-body-4563.md')

function draft_text(): string {
	return readFileSync(DRAFT, 'utf8')
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	writeFileSync(DRAFT, ROWS)
	branch_mock.mockResolvedValue('4563-lane')
	existing_mock.mockResolvedValue(DRAFT)
	changes_mock.mockResolvedValue({ removed: [TITLE], added: [] })
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

describe('run_ship_removed_rows.surface — the removed tests before the ship', () => {
	it('writes a titled pending row for each removed test the brief lists (ac-6159e31a)', async () => {
		await run_ship_removed_rows.surface()

		expect(existing_mock).toHaveBeenCalledWith('4563')
		expect(draft_text()).toContain(`${removed_tests.DISPOSITION_HEADING}\n\n${PENDING}`)
		expect(removed_tests.undisposed([TITLE], draft_text())).toStrictEqual([TITLE])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(DRAFT))
	})

	it.each([
		['no test removed or added', { removed: [], added: [] }],
		['an unreadable base, left to the preflight', undefined],
	])('asks no branch and writes nothing on %s', async (_name, changes) => {
		changes_mock.mockResolvedValue(changes)

		await run_ship_removed_rows.surface()

		expect(branch_mock).not.toHaveBeenCalled()
		expect(draft_text()).toBe(ROWS)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('leaves the draft and the output alone once each removed test is disposed', async () => {
		const disposed = `${removed_tests.DISPOSITION_HEADING}\n\n- \`${TITLE}\` — 廃止: #4563 merged away\n`

		writeFileSync(DRAFT, `${ROWS}\n${disposed}`)

		await run_ship_removed_rows.surface()

		expect(draft_text()).toBe(`${ROWS}\n${disposed}`)
		expect(console.info).not.toHaveBeenCalled()
	})

	it('prints the titles when the branch names no issue, writing nothing', async () => {
		branch_mock.mockResolvedValue('main')

		await run_ship_removed_rows.surface()

		expect(existing_mock).not.toHaveBeenCalled()
		expect(draft_text()).toBe(ROWS)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(TITLE))
	})
})

// joshuafolkken/kit#5541: an added test naming a criterion's identifier meets its pending row.
describe('run_ship_removed_rows.surface — the acceptance rows before the ship', () => {
	it('meets the row an added test names, and keeps it on a second pass (ac-05552640)', async () => {
		const naming = 'acceptance rows > meets the criterion (ac-12345678)'

		changes_mock.mockResolvedValue({ removed: [], added: [naming] })
		await run_ship_removed_rows.surface()
		const filled = draft_text()

		changes_mock.mockResolvedValue({ removed: [], added: ['a later test (ac-12345678)'] })
		await run_ship_removed_rows.surface()

		expect(filled).toContain(`- \`ac-12345678\` the criterion — 満たした: \`${naming}\``)
		expect(draft_text()).toBe(filled)
		expect(console.info).not.toHaveBeenCalled()
	})
})
