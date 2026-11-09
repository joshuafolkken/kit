import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { split_measure } from './split-measure'

const { git, MAIN_BRANCH } = git_fixture_workspace
const ORIGINAL_LINES = 150
const EXTRA_LINES = 60
const CONTENT = 'original\n'.repeat(ORIGINAL_LINES)
const SOURCE = 'source.ts'
const DESTINATION = 'destination.ts'
const SPECIAL_FILES = [
	'tab\tname.ts',
	'quote"name.ts',
	'back\\slash.ts',
	'line\nname.ts',
	'control\u{1}.ts',
	'日本語.ts',
]
const STAGE_ALL = ['add', '--all']
const NO_VERIFY = '--no-verify'
const LEGACY_GUIDE = { files: 8, lines: 200, cap: { files: 12, lines: 300 }, growth: {} }
const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: '',
	restore_environment: undefined,
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace('kit-relocations-'))
	await git(fixture.workspace, ['init', MAIN_BRANCH])
	await Promise.all(
		[SOURCE, ...SPECIAL_FILES].map(async (file) => {
			await writeFile(path.join(fixture.workspace, file), CONTENT)
		}),
	)
	await git(fixture.workspace, STAGE_ALL)
	await git(fixture.workspace, ['commit', NO_VERIFY, '-m', 'base'])
	await git(fixture.workspace, ['switch', '-c', 'relocation'])
	process.chdir(fixture.workspace)
})

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

async function relocate(content = CONTENT): Promise<void> {
	await rename(SOURCE, DESTINATION)
	await writeFile(DESTINATION, content)
}

describe('exact relocation measurement with real git', () => {
	it('excludes an unchanged unstaged relocation without changing the index (ac-db883b67)', async () => {
		await relocate()
		const index = await git(fixture.workspace, ['ls-files', '--stage'])

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 0,
			lines: 0,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
		expect(await git(fixture.workspace, ['ls-files', '--stage'])).toBe(index)
	})

	it('excludes committed relocations as well as untracked destinations', async () => {
		await relocate()
		await git(fixture.workspace, STAGE_ALL)
		await git(fixture.workspace, ['commit', NO_VERIFY, '-m', 'move'])

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 0,
			lines: 0,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})

	it('keeps an edited relocation over the guide (ac-16f90773)', async () => {
		await relocate(`${CONTENT}${'extra\n'.repeat(EXTRA_LINES)}`)

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 2,
			lines: ORIGINAL_LINES * 2 + EXTRA_LINES,
			verdict: 'split',
			guide: LEGACY_GUIDE,
		})
	})
})

describe('relocation boundaries with real git', () => {
	it.each(SPECIAL_FILES)('excludes quoted source and untracked destination: %j', async (file) => {
		await rename(file, `moved-${file}`)

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 0,
			lines: 0,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})

	it('pairs each deletion once and counts an unrelated duplicate addition', async () => {
		await relocate()
		await writeFile('duplicate.ts', CONTENT)

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 1,
			lines: ORIGINAL_LINES,
			verdict: 'single',
			guide: LEGACY_GUIDE,
		})
	})

	it('retains unrelated additions and deletions', async () => {
		await relocate('different\n'.repeat(EXTRA_LINES))

		expect(await split_measure.read_branch()).toStrictEqual({
			files: 2,
			lines: ORIGINAL_LINES + EXTRA_LINES,
			verdict: 'split',
			guide: LEGACY_GUIDE,
		})
	})

	it('compares bytes including the final newline', async () => {
		await relocate(CONTENT.trimEnd())

		const measured = await split_measure.read_branch()

		expect(measured.lines).toBe(ORIGINAL_LINES * 2)
	})
})

// joshuafolkken/kit#6724: by `run:cut` the new module is committed, so the tracked half of the added
// files has to reach the measure for the module and its importer to count as one file.
async function commit_all(message: string): Promise<void> {
	await git(fixture.workspace, STAGE_ALL)
	await git(fixture.workspace, ['commit', NO_VERIFY, '-m', message])
}

// The importer on the default branch, so the base holds it, then a branch to add the module on.
async function commit_base_importer(importer: string): Promise<void> {
	await git(fixture.workspace, ['switch', 'main'])
	await mkdir(path.dirname(importer), { recursive: true })
	await writeFile(importer, CONTENT)
	await commit_all('importer')
	await git(fixture.workspace, ['switch', '-c', 'module'])
}

describe('added files with real git', () => {
	it('counts a committed new module and its edited importer as one file', async () => {
		const importer = 'scripts/x/cli.ts'

		await commit_base_importer(importer)
		await writeFile('scripts/x/new.ts', 'export {}\n')
		await writeFile(importer, `${CONTENT}import './new'\n`)
		await commit_all('module')

		const measured = await split_measure.read_branch()

		expect(measured.files).toBe(1)
	})
})
