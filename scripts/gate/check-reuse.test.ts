import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_tree } from '#scripts/review/review-tree'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_reuse, type CheckRecords } from './check-reuse'
import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'
import type { GateTree } from './gate-tree'

// joshuafolkken/kit#3903: a main sync that brought in only `.claude/**/*.md` re-ran lint and the type
// check over sources neither had a reason to read again. Each scoped check now keeps its own record and
// is reused while none of its inputs moved — across a base move included.

const scratch = mkdtempSync(path.join(tmpdir(), 'check-reuse-test-'))
const read_git = vi.spyOn(git_spawn, 'read')
const read_tree = vi.spyOn(review_tree, 'read_changed_tree')
const { LINT_LABEL, TYPE_CHECK_LABEL } = gate_plan
const CSPELL = 'cspell'
const LABELS = [LINT_LABEL, TYPE_CHECK_LABEL, CSPELL]
const SOURCE = 'scripts/a.ts'
const FILES = { [SOURCE]: 'digest-a' }
const RECORDED: GateTree = { files: FILES, base: 'base-a' }
const SYNCED: GateTree = { files: FILES, base: 'base-b' }
const SKILL_DOC = '.claude/skills/x/SKILL.md'
const FAIL = 1

function records_in(prefix: string): CheckRecords {
	const directory = mkdtempSync(path.join(scratch, prefix))

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function passed(label: string): GateStepResult {
	return { label, command: `josh ${label}`, exit_code: 0, output: '', elapsed_ms: 1 }
}

function all_passed(): Array<GateStepResult> {
	return LABELS.map((label) => passed(label))
}

function base_moved(...paths: ReadonlyArray<string>): void {
	read_git.mockResolvedValue(paths.map((name) => `${name}\0`).join(''))
}

async function reused(records: CheckRecords, tree: GateTree = SYNCED): Promise<Array<string>> {
	const reusable = await check_reuse.reusable_checks(LABELS, tree, records)

	return [...reusable.keys()]
}

// A full set of green records taken on `RECORDED`.
async function recorded(): Promise<CheckRecords> {
	const records = records_in('records-')

	await check_reuse.record_green_checks(all_passed(), RECORDED, records)

	return records
}

beforeEach(() => {
	read_git.mockReset()
	read_tree.mockResolvedValue(FILES)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('check_reuse — across a main sync', () => {
	it('reuses lint and the type check when the base moved only a prettier-ignored document', async () => {
		base_moved(SKILL_DOC)

		await expect(reused(await recorded())).resolves.toStrictEqual([LINT_LABEL, TYPE_CHECK_LABEL])
		expect(read_git).toHaveBeenCalledWith(expect.arrayContaining(['base-a', 'base-b']))
	})

	it('reuses nothing when the base moved a source module', async () => {
		base_moved(SKILL_DOC, 'scripts/b.ts')

		await expect(reused(await recorded())).resolves.toStrictEqual([])
	})

	it('reuses nothing when the base moved the lock file', async () => {
		base_moved('pnpm-lock.yaml')

		await expect(reused(await recorded())).resolves.toStrictEqual([])
	})

	it('reuses nothing when the base could not be resolved', async () => {
		const unresolved = { files: FILES, base: undefined }

		await expect(reused(await recorded(), unresolved)).resolves.toStrictEqual([])
	})

	it('reuses nothing when the changed-file map came back empty', async () => {
		const documents_only = { files: { [SKILL_DOC]: 'digest-doc' }, base: RECORDED.base }
		const records = records_in('unread-')

		read_tree.mockResolvedValue(documents_only.files)
		await check_reuse.record_green_checks(all_passed(), documents_only, records)

		await expect(reused(records, { files: {}, base: RECORDED.base })).resolves.toStrictEqual([])
	})

	it('reuses nothing when the base diff could not be read', async () => {
		read_git.mockRejectedValue(new Error('unknown revision'))

		await expect(reused(await recorded())).resolves.toStrictEqual([])
	})

	it('reuses nothing when a changed source moved on the branch itself', async () => {
		const edited = { files: { [SOURCE]: 'digest-b' }, base: RECORDED.base }

		await expect(reused(await recorded(), edited)).resolves.toStrictEqual([])
	})
})

describe('check_reuse.record_green_checks', () => {
	it('records the checks that passed and not the one that failed', async () => {
		const records = records_in('red-')
		const results = [{ ...passed(LINT_LABEL), exit_code: FAIL }, passed(TYPE_CHECK_LABEL)]

		await check_reuse.record_green_checks(results, RECORDED, records)

		await expect(reused(records, RECORDED)).resolves.toStrictEqual([TYPE_CHECK_LABEL])
	})

	it('records nothing when the tree moved while the checks ran', async () => {
		const records = records_in('moved-')

		read_tree.mockResolvedValue({ [SOURCE]: 'digest-during' })
		await check_reuse.record_green_checks(all_passed(), RECORDED, records)

		await expect(reused(records, RECORDED)).resolves.toStrictEqual([])
	})
})

// joshuafolkken/kit#4495: each record carries the fingerprint of its own check's tools and environment.
describe('check_reuse — the inputs fingerprint', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('reuses nothing when a declared environment variable changed since the records', async () => {
		const records = await recorded()

		vi.stubEnv('NODE_ENV', 'production')

		await expect(reused(records, RECORDED)).resolves.toStrictEqual([])
	})

	it('keeps reusing a check whose declaration leaves the changed variable out', async () => {
		const records = await recorded()

		vi.stubEnv('TZ', 'Etc/GMT+12')

		await expect(reused(records, RECORDED)).resolves.toStrictEqual(LABELS)
	})
})

// joshuafolkken/kit#5156: cspell reads every file, so `check:related` reuses its record only while
// nothing moved.
describe('check_reuse — cspell', () => {
	it('reuses cspell over the tree it was recorded on', async () => {
		const records = await recorded()

		await expect(reused(records, RECORDED)).resolves.toContain(CSPELL)
	})

	it('reuses no cspell once any file moved, a document included', async () => {
		const records = await recorded()

		base_moved(SKILL_DOC)

		await expect(reused(records)).resolves.not.toContain(CSPELL)
	})
})
