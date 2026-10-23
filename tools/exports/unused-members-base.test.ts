import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { working_tree_fixture } from '#scripts/init/working-tree-fixture'
import { unused_members } from '#tools/exports/unused-members'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unused_members_fixture, type FixtureFile } from './unused-members-fixture'

// joshuafolkken/kit#4649: a reader that drops its last reference often drops the import with it, so
// only its text at the change base still names the library whose member it left unused.
const { create_project, with_reader, IMPORT_LIBRARY, READ_KEPT } = unused_members_fixture
const { git } = working_tree_fixture
const USER = 'user.ts'
const DROPPED = 'library.dropped'
const NO_IMPORT = 'export const other = 1'
const FILES: Array<FixtureFile> = [
	...with_reader(READ_KEPT),
	[USER, `${IMPORT_LIBRARY}export const other = library.dropped()`],
]

// The fixture project committed as its own repository, the commit answered as the change base.
function committed_project(): string {
	const root = create_project(FILES)

	git(root, ['init', '--initial-branch=main'])
	git(root, ['add', '--all'])
	git(root, ['commit', '--message', 'Base'])
	vi.spyOn(change_base, 'resolved').mockResolvedValue(git(root, ['rev-parse', 'HEAD']))

	return root
}

async function unused_after(edit: (user: string) => void): Promise<Array<string>> {
	const root = committed_project()
	const user = path.join(root, USER)

	edit(user)
	const members = await unused_members.find_unused_members_in(root, [user])

	return members.map((member) => `${member.namespace}.${member.member}`)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('unused_members.find_unused_members_in — the imports a changed file had at the base', () => {
	it('reports a member whose last reader dropped the import with the reference', async () => {
		const names = await unused_after((user) => {
			writeFileSync(user, NO_IMPORT)
		})

		expect(names).toStrictEqual([DROPPED])
	})

	it('reports a member whose last reader was deleted', async () => {
		const names = await unused_after((user) => {
			rmSync(user)
		})

		expect(names).toStrictEqual([DROPPED])
	})

	it('reports nothing while the reader still reads the member', async () => {
		const names = await unused_after((user) => {
			writeFileSync(user, `${IMPORT_LIBRARY}export const other = library.dropped() + 1`)
		})

		expect(names).toStrictEqual([])
	})

	it('reads only the current imports where no change base answers', async () => {
		vi.spyOn(change_base, 'resolved').mockResolvedValue(undefined)
		const root = create_project(FILES)
		const user = path.join(root, USER)

		writeFileSync(user, NO_IMPORT)

		await expect(unused_members.find_unused_members_in(root, [user])).resolves.toStrictEqual([])
	})
})
