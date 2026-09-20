import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloneGroup } from './clone-aggregate'
import { clone_scan } from './clone-scan'

// joshuafolkken/kit#2217: the scan reads real source trees, so it is exercised against a temporary
// repository with a copied block, and the report shape is pinned so a caller can read `clean`.

// Seven identical significant lines: above the window size, so the copy is detected.
const COPIED_BLOCK = [
	'export function total(values) {',
	'	let sum = 0',
	'	for (const value of values) {',
	'		sum = sum + value',
	'	}',
	'	return sum',
	'}',
].join('\n')

// A repo-relative path reused across two sites so a cross-repository clone is unambiguous.
const SITE_PATH = 'src/one.ts'
const CROSS_REPO = 'cross-repo'

// A temporary directory with no `.git`, so repository discovery adds no siblings and only this tree
// is scanned. Held on an object so the hooks assign a property rather than a top-level binding.
const context = { workspace: '' }

beforeEach(() => {
	context.workspace = mkdtempSync(path.join(tmpdir(), 'clone-scan-'))
	mkdirSync(path.join(context.workspace, 'src'), { recursive: true })
})

afterEach(() => {
	rmSync(context.workspace, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

function write_source(name: string, body: string): void {
	writeFileSync(path.join(context.workspace, 'src', name), body)
}

const GIT = '.git'
const KIT_REMOTE = 'git@github.com:joshuafolkken/kit.git'
const APP_KIT_REMOTE = 'git@github.com:joshuafolkken/app-kit.git'
const CONFIG_BODY = '[core]\n\tbare = false\n[remote "origin"]\n\turl = '

// A work tree declaring `origin_url`, holding one source file.
function make_repository(name: string, origin_url: string, body: string): string {
	const repository_path = path.join(context.workspace, name)

	mkdirSync(path.join(repository_path, GIT), { recursive: true })
	writeFileSync(path.join(repository_path, GIT, 'config'), `${CONFIG_BODY}${origin_url}\n`)
	mkdirSync(path.join(repository_path, 'src'), { recursive: true })
	writeFileSync(path.join(repository_path, 'src', 'one.ts'), body)

	return repository_path
}

// The layout `git worktree add` produces, parked away from the main work tree exactly as a lane is:
// a `.git` *file* naming `<main>/.git/worktrees/<name>`, which holds only a `commondir`.
function make_parked_worktree(main_repository: string, name: string, body: string): string {
	const git_directory = path.join(main_repository, GIT, 'worktrees', name)
	const work_tree = path.join(context.workspace, 'lanes', name)

	mkdirSync(git_directory, { recursive: true })
	writeFileSync(path.join(git_directory, 'commondir'), '../..\n')
	mkdirSync(path.join(work_tree, 'src'), { recursive: true })
	writeFileSync(path.join(work_tree, GIT), `gitdir: ${git_directory}\n`)
	writeFileSync(path.join(work_tree, 'src', 'one.ts'), body)

	return work_tree
}

describe('scan measures duplication in the source tree', () => {
	it('reports no clone when each file is unique', () => {
		write_source('one.ts', COPIED_BLOCK)
		write_source('two.ts', COPIED_BLOCK.replaceAll('total', 'grand_total').replaceAll('sum', 'acc'))

		expect(clone_scan.scan(context.workspace)).toHaveLength(0)
	})

	it('finds a cross-file clone when a block is copied between files', () => {
		write_source('one.ts', COPIED_BLOCK)
		write_source('two.ts', COPIED_BLOCK)

		const clones = clone_scan.scan(context.workspace)

		expect(clones.length).toBeGreaterThan(0)
		expect(clones.every((clone) => clone.category === 'cross-file')).toBe(true)
	})

	it('ignores test files', () => {
		write_source('one.test.ts', COPIED_BLOCK)
		write_source('two.test.ts', COPIED_BLOCK)

		expect(clone_scan.scan(context.workspace)).toHaveLength(0)
	})
})

// A `backlogrun` child runs in a lane parked under its own directory, whose only neighbors are that
// repository's other lanes. Asked from there, discovery found no sibling at all and the
// cross-repository half of this command's answer silently became `clean` (joshuafolkken/kit#2217).
describe('scan reaches the first-party siblings from a linked work tree', () => {
	it('finds a cross-repository clone when it runs in a lane', () => {
		vi.stubEnv('JOSH_REPO_PATHS', '')
		const kit = make_repository('kit', KIT_REMOTE, 'export const unrelated = 1\n')

		make_repository('app-kit', APP_KIT_REMOTE, COPIED_BLOCK)

		const clones = clone_scan.scan(make_parked_worktree(kit, '2217', COPIED_BLOCK))

		expect(clones.some((clone) => clone.category === CROSS_REPO)).toBe(true)
	})
})

describe('format_report reads as a verdict then detail', () => {
	it('prints clean when there is nothing to report', () => {
		expect(clone_scan.format_report([])).toBe(clone_scan.CLEAN_VERDICT)
	})

	it('leads with the count and lists each site', () => {
		const group: CloneGroup = {
			hash: 'h',
			category: CROSS_REPO,
			sites: [
				{ repo: '/repos/a', file: SITE_PATH, line: 3 },
				{ repo: '/repos/b', file: SITE_PATH, line: 9 },
			],
		}

		const report = clone_scan.format_report([group])

		expect(report).toContain(`${clone_scan.CLONES_PREFIX} 1`)
		expect(report).toContain(`[${CROSS_REPO}]`)
		expect(report).toContain('a/src/one.ts:3')
		expect(report).toContain('b/src/one.ts:9')
	})
})
