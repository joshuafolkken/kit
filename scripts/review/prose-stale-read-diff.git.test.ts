import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prose_stale_read } from './prose-stale-read'
import { prose_stale_scan, type Reference } from './prose-stale-scan'

// joshuafolkken/kit#5287, with real git: the diff read from a base to the working tree (an uncommitted
// edit and a deleted file both count) and the search over the prose paths, as `josh prose:stale` runs them.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-prose-stale-'
const CODE = 'scripts/a.ts'
const GONE_DOC = 'docs/gone.md'
const GONE_CODE = 'scripts/gone.ts'

const { git, MAIN_BRANCH } = git_fixture_workspace

// The change base is the one commit, so the diff is the working tree's edits since it.
const BASE = 'HEAD'

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function write(file: string, content: string): Promise<void> {
	await mkdir(path.dirname(path.join(fixture.root, file)), { recursive: true })
	await writeFile(path.join(fixture.root, file), content)
}

async function commit(message: string): Promise<void> {
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', message])
}

// A name, a heading, and the prose and code that still name them.
async function commit_base(): Promise<void> {
	await write(CODE, 'function old_name(): void {}\n')
	await write(GONE_DOC, '## Old heading\n')
	await write('docs/a.md', 'Call old_name, as → "Old heading" says.\n')
	await write('scripts/b.ts', '// old_name reads it\nold_name()\n')
	await commit('base')
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await commit_base()
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

async function found_references(): Promise<Array<Reference>> {
	return await prose_stale_read.references(
		fixture.root,
		await prose_stale_read.read_hunks(fixture.root, BASE),
	)
}

describe('prose_stale_read.references against real git', () => {
	it(
		'lists the prose that names an uncommitted removal and a deleted file’s heading, not the code',
		async () => {
			await write(CODE, '')
			await rm(path.join(fixture.root, GONE_DOC))

			const found = await found_references()

			expect(prose_stale_scan.report(found).text).toBe(
				'docs/a.md:1 heading Old heading\ndocs/a.md:1 name old_name\nscripts/b.ts:1 name old_name',
			)
		},
		TIMEOUT_MS,
	)

	it(
		'answers ok when the working tree still matches the base',
		async () => {
			const found = await found_references()

			expect(prose_stale_scan.report(found)).toEqual({ text: 'ok', exit_code: 0 })
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#6077: a deleted file's constant another changed file still declares is kept.
describe('prose_stale_read.references — a name an unchanged line still declares', () => {
	it(
		'keeps PATH the kept file still declares, and reports SIZE no file declares',
		async () => {
			const kept = 'scripts/kept.ts'

			await write(GONE_CODE, 'const PATH = 1\n')
			await write(kept, 'const PATH = 2\nconst SIZE = 3\n')
			await write('docs/b.md', 'PATH and SIZE.\n')
			await commit('constants')
			await rm(path.join(fixture.root, GONE_CODE))
			await write(kept, 'const PATH = 2\n')

			const found = await found_references()

			expect(prose_stale_scan.report(found).text).toBe('docs/b.md:1 constant SIZE')
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#6737: a test file's own names removed, with English and another scope's
// parameter that spell them left in prose.
describe('prose_stale_read.references — a test file’s local names', () => {
	it(
		'answers ok for the English word and the other scope’s `text_of`',
		async () => {
			const test_file = 'scripts/x.test.ts'

			await write(test_file, 'type Appended = string\nfunction text_of(): string {}\n')
			await write('scripts/guard.ts', "// Appended to git's own report\n")
			await write('scripts/fixture.ts', '// `count` lines, each reading `text_of(index)`\n')
			await commit('test locals')
			await write(test_file, '')

			const found = await found_references()

			expect(prose_stale_scan.report(found)).toEqual({ text: 'ok', exit_code: 0 })
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#6130: a deleted file's local name is not searched; its exported one is.
describe('prose_stale_read.references — a deleted file', () => {
	it(
		'reports the exported name prose still carries, not the local one',
		async () => {
			await write(GONE_CODE, 'function count(): number {}\nexport function gone_name(): void {}\n')
			await write('docs/c.md', 'count gone_name\n')
			await commit('gone')
			await rm(path.join(fixture.root, GONE_CODE))

			const found = await found_references()

			expect(prose_stale_scan.report(found).text).toBe('docs/c.md:1 name gone_name')
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#7048: a deleted namespace's members, `record` of which a live module outside the
// change still declares.
async function delete_namespace(): Promise<Array<Reference>> {
	await write(
		GONE_CODE,
		'function record(): void {}\nfunction gone_only(): void {}\nexport const gone = { record, gone_only }\n',
	)
	await write('scripts/ledger.ts', 'function record(): void {}\n')
	await write('docs/d.md', 'Call `record`.\n')
	await write('docs/e.md', 'gone_only\n')
	await commit('namespace')
	await rm(path.join(fixture.root, GONE_CODE))

	return await found_references()
}

describe('prose_stale_read.references — a deleted name a live module still declares', () => {
	it(
		'does not count prose naming `record`, which the live ledger still declares',
		async () => {
			const found = await delete_namespace()

			expect(prose_stale_scan.report(found).text).not.toContain('record')
		},
		TIMEOUT_MS,
	)

	it(
		'still counts prose naming `gone_only`, which only the deleted file declared',
		async () => {
			const found = await delete_namespace()

			expect(prose_stale_scan.report(found).text).toBe('docs/e.md:1 name gone_only')
		},
		TIMEOUT_MS,
	)
})
