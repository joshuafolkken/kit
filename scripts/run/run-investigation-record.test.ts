import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const directories_mock = vi.hoisted(() => vi.fn<() => Promise<Array<string>>>())

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: directories_mock },
}))

const { run_investigation_record } = await import('./run-investigation-record')

// joshuafolkken/kit#5765: the investigator's conclusion is kept in the work tree git directory, so a
// later `run:prep` of the run prints it rather than asking for the same delegation again.

const ISSUE = '5765'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-investigation-record-'))
const GIT_DIRECTORY = path.join(TEMPORARY, 'git')
const RECORD = path.join(GIT_DIRECTORY, `josh-investigation-${ISSUE}.md`)
const FINDINGS = '- `run:prep` builds its report in scripts/run/run-prep.ts:97'

mkdirSync(GIT_DIRECTORY)

beforeEach(() => {
	rmSync(RECORD, { force: true })
	directories_mock.mockReset().mockResolvedValue([GIT_DIRECTORY, TEMPORARY])
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

describe('run_investigation_record.load — the saved conclusion in the work tree git directory', () => {
	it('reads the saved findings, trimmed, from the work tree git directory', async () => {
		writeFileSync(RECORD, `\n${FINDINGS}\n\n`)

		await expect(run_investigation_record.load(ISSUE)).resolves.toStrictEqual({
			path: RECORD,
			findings: FINDINGS,
		})
	})

	it('names the path with no findings when nothing was saved', async () => {
		await expect(run_investigation_record.load(ISSUE)).resolves.toStrictEqual({
			path: RECORD,
			findings: undefined,
		})
	})

	it('reads a record holding only whitespace as no findings', async () => {
		writeFileSync(RECORD, ' \n\t\n')

		const record = await run_investigation_record.load(ISSUE)

		expect(record?.findings).toBeUndefined()
	})

	it('removes the record, and answers no findings after it', async () => {
		writeFileSync(RECORD, FINDINGS)

		await run_investigation_record.remove(ISSUE)

		expect(existsSync(RECORD)).toBe(false)
		await expect(run_investigation_record.remove(ISSUE)).resolves.toBeUndefined()
	})

	it('answers undefined where no git directory answers', async () => {
		directories_mock.mockResolvedValue([])

		await expect(run_investigation_record.load(ISSUE)).resolves.toBeUndefined()
	})
})
