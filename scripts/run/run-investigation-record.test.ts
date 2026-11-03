import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state } from '#scripts/josh/durable-state'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_investigation_record } from './run-investigation-record'

// joshuafolkken/kit#5765: the investigator's conclusion is kept outside the tree, so a later `run:prep`
// of the run prints it rather than asking for the same delegation again. joshuafolkken/kit#6153: it is
// a durable run record, so it outlives a yielding lane's work tree and its git directory.

const ISSUE = '5765'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-investigation-record-'))
const FINDINGS = '- `run:prep` builds its report in scripts/run/run-prep.ts:97'

async function record_path(): Promise<string> {
	const record = await run_investigation_record.load(ISSUE)

	if (record === undefined) throw new Error('no investigation record path')

	return record.path
}

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		mkdtempSync(path.join(TEMPORARY, 'repository-')),
	)
})

afterAll(() => {
	rmSync(TEMPORARY, { recursive: true, force: true })
})

describe('run_investigation_record.load — the saved conclusion as a durable run record', () => {
	it('reads the saved findings, trimmed', async () => {
		const target = await record_path()

		writeFileSync(target, `\n${FINDINGS}\n\n`)

		await expect(run_investigation_record.load(ISSUE)).resolves.toStrictEqual({
			path: target,
			findings: FINDINGS,
		})
	})

	it('names the path with no findings when nothing was saved', async () => {
		await expect(run_investigation_record.load(ISSUE)).resolves.toStrictEqual({
			path: await record_path(),
			findings: undefined,
		})
	})

	it('reads a record holding only whitespace as no findings', async () => {
		writeFileSync(await record_path(), ' \n\t\n')

		const record = await run_investigation_record.load(ISSUE)

		expect(record?.findings).toBeUndefined()
	})

	it('removes the record, and answers no findings after it', async () => {
		const target = await record_path()

		writeFileSync(target, FINDINGS)
		await run_investigation_record.remove(ISSUE)

		expect(existsSync(target)).toBe(false)
		await expect(run_investigation_record.remove(ISSUE)).resolves.toBeUndefined()
	})

	it('answers undefined where no git directory answers', async () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)

		await expect(run_investigation_record.load(ISSUE)).resolves.toBeUndefined()
	})
})

// ac-a6f8fbf5: the re-dispatched lane reads what the yielded lane saved, so it delegates nothing.
describe('run_investigation_record.load — a lane dispatched again after a yield', () => {
	it('keeps the record in the durable state root, outside any work tree git directory', async () => {
		const target = await record_path()

		expect(path.dirname(target)).toBe(durable_state.root())
		expect(path.basename(target)).toContain(durable_state.PREFIX.INVESTIGATION)
	})

	it('reads the findings the yielded lane saved once its work tree is gone', async () => {
		const yielded_work_tree = mkdtempSync(path.join(TEMPORARY, 'worktree-'))

		writeFileSync(await record_path(), FINDINGS)
		rmSync(yielded_work_tree, { recursive: true, force: true })

		const record = await run_investigation_record.load(ISSUE)

		expect(record?.findings).toBe(FINDINGS)
	})
})
