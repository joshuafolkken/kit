import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { git_directory } from './git-directory'

const make_directory = temporary_directory()

function probe_directory(): string {
	return make_directory('josh-git-directory-test-')
}

describe('git_directory.resolve_git_directory', () => {
	it('answers a main checkout its own .git directory', () => {
		const checkout = probe_directory()

		mkdirSync(path.join(checkout, '.git'))

		expect(git_directory.resolve_git_directory(checkout)).toBe(path.join(checkout, '.git'))
	})

	it('answers a linked work tree the common directory its commondir names', () => {
		const parent = probe_directory()
		const common = path.join(parent, 'main', '.git')
		const own = path.join(common, 'worktrees', 'lane')
		const lane = path.join(parent, 'lane')

		mkdirSync(own, { recursive: true })
		mkdirSync(lane)
		writeFileSync(path.join(own, 'commondir'), '../..\n')
		writeFileSync(path.join(lane, '.git'), `gitdir: ${own}\n`)

		expect(git_directory.resolve_git_directory(lane)).toBe(common)
	})

	it('answers nothing for a directory that is no work tree', () => {
		expect(git_directory.resolve_git_directory(probe_directory())).toBeUndefined()
	})

	it('answers nothing for a .git file that points nowhere', () => {
		const checkout = probe_directory()

		writeFileSync(path.join(checkout, '.git'), 'not a pointer\n')

		expect(git_directory.resolve_git_directory(checkout)).toBeUndefined()
	})
})
