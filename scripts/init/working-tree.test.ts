import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { working_tree } from './working-tree'
import { working_tree_fixture } from './working-tree-fixture'

const { MANIFEST, committed_repository, git, remove_all, repository, temporary_directory, write } =
	working_tree_fixture
const PROJECT = 'app'
const NOTE = 'notes.md'
const DRAFT = 'draft\n'
const EDITED_MANIFEST = '{ "name": "edited" }\n'
const COMMAND = 'josh init'

afterEach(() => {
	remove_all()
})

describe('working_tree.uncommitted_paths — nothing to tell apart', () => {
	it('reads nothing in a directory without Git', () => {
		const root = temporary_directory()

		write(root, NOTE, DRAFT)

		expect(working_tree.uncommitted_paths(root)).toEqual([])
	})

	it('reads nothing in a repository without a commit', () => {
		const root = repository()

		write(root, NOTE, DRAFT)

		expect(working_tree.uncommitted_paths(root)).toEqual([])
	})

	it('reads nothing in a clean repository', () => {
		expect(working_tree.uncommitted_paths(committed_repository())).toEqual([])
	})

	it('reads nothing when only ignored files are new', () => {
		const root = committed_repository()

		write(root, 'debug.log', 'trace\n')

		expect(working_tree.uncommitted_paths(root)).toEqual([])
	})
})

describe('working_tree.uncommitted_paths — the user’s own work', () => {
	it('reads a modified tracked file', () => {
		const root = committed_repository()

		write(root, MANIFEST, EDITED_MANIFEST)

		expect(working_tree.uncommitted_paths(root)).toEqual([MANIFEST])
	})

	it('reads a staged file', () => {
		const root = committed_repository()

		write(root, NOTE, DRAFT)
		git(root, ['add', NOTE])

		expect(working_tree.uncommitted_paths(root)).toEqual([NOTE])
	})

	it('reads an untracked file', () => {
		const root = committed_repository()

		write(root, NOTE, DRAFT)

		expect(working_tree.uncommitted_paths(root)).toEqual([NOTE])
	})

	it('reads every indexed file on an orphan branch of a repository with commits', () => {
		const root = committed_repository()

		git(root, ['checkout', '--orphan', 'fresh'])
		write(root, NOTE, DRAFT)

		expect(working_tree.uncommitted_paths(root)).toEqual([NOTE, '.gitignore', MANIFEST])
	})
})

describe('working_tree.uncommitted_paths — a project below its repository’s top level', () => {
	it('reads the project’s own changes relative to it, and none from outside it', () => {
		const top_level = committed_repository()
		const project = path.join(top_level, PROJECT)

		mkdirSync(project)
		write(project, MANIFEST, DRAFT)
		git(top_level, ['add', '--all'])
		git(top_level, ['commit', '--message', 'Add the project'])
		write(project, MANIFEST, EDITED_MANIFEST)
		write(project, NOTE, DRAFT)
		write(top_level, MANIFEST, EDITED_MANIFEST)

		expect(working_tree.uncommitted_paths(project)).toEqual([NOTE, MANIFEST])
	})
})

describe('working_tree.uncommitted_paths — git that does not answer', () => {
	it('throws rather than reading a clean tree', () => {
		const root = temporary_directory()

		write(root, '.git', 'not a repository\n')

		expect(() => working_tree.uncommitted_paths(root)).toThrow('could not read HEAD')
	})

	it('throws when HEAD reads but the listing fails', () => {
		const root = committed_repository()

		write(root, '.git/index', 'not an index\n')

		expect(() => working_tree.uncommitted_paths(root)).toThrow('git ls-files')
	})
})

describe('working_tree.dirty_tree_refusal', () => {
	it('is undefined for a clean repository', () => {
		expect(working_tree.dirty_tree_refusal(committed_repository(), COMMAND)).toBeUndefined()
	})

	it('names the command, every changed path and the way out', () => {
		const root = committed_repository()

		write(root, MANIFEST, EDITED_MANIFEST)
		write(root, NOTE, DRAFT)
		const refusal = working_tree.dirty_tree_refusal(root, COMMAND) ?? ''

		expect(refusal).toContain(`${COMMAND} refuses to run`)
		expect(refusal).toContain(`  ${MANIFEST}`)
		expect(refusal).toContain(`  ${NOTE}`)
		expect(refusal).toContain('git stash push -u -- .')
	})
})
