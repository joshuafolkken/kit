import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { removed_tests } from '#scripts/review/removed-tests'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { branch_mock, read_mock, existing_mock } = vi.hoisted(() => ({
	branch_mock: vi.fn<() => Promise<string>>(),
	read_mock: vi.fn<() => Promise<ReadonlyArray<string> | undefined>>(),
	existing_mock: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: branch_mock } }))
vi.mock('#scripts/review/removed-tests-check', () => ({
	removed_tests_check: { read: read_mock },
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
	read_mock.mockResolvedValue([TITLE])
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

describe('run_ship_removed_rows.surface — the removed tests before the ship', () => {
	it('writes a titled pending row into the branch draft and names it', async () => {
		await run_ship_removed_rows.surface()

		expect(existing_mock).toHaveBeenCalledWith('4563')
		expect(draft_text()).toContain(`${removed_tests.DISPOSITION_HEADING}\n\n${PENDING}`)
		expect(removed_tests.undisposed([TITLE], draft_text())).toStrictEqual([TITLE])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(DRAFT))
	})

	it.each([
		['no test removed', []],
		['an unreadable base, left to the preflight', undefined],
	])('asks no branch and writes nothing on %s', async (_name, removed) => {
		read_mock.mockResolvedValue(removed)

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
