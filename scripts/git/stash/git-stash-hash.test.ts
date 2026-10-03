import { git_spawn } from '#scripts/git/git-spawn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_stash } from './git-stash'

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const read = vi.mocked(git_spawn.read)
const NUL = '\u{0}'
const HASH = 'a'.repeat(40)
const OTHER_HASH = 'b'.repeat(40)
const LEDGER = 'docs/observations.md'

beforeEach(() => {
	read.mockReset()
})

// joshuafolkken/kit#2701: a sweep asks GitHub between reading the stack and dropping from it, so it
// keys each entry by its commit hash and resolves the position only at the drop.
describe('git_stash — entries keyed by hash', () => {
	it('lists entries with the hash as their selector', async () => {
		read.mockResolvedValue(`${HASH}${NUL}On main: backlogrun: parked #1`)

		expect(await git_stash.list_by_hash()).toStrictEqual([
			{ selector: HASH, subject: 'On main: backlogrun: parked #1' },
		])
	})

	it('drops the position the hash has now, not the one read earlier', async () => {
		read.mockResolvedValueOnce(`${OTHER_HASH}${NUL}stash@{0}\n${HASH}${NUL}stash@{1}`)
		read.mockResolvedValueOnce('')

		expect(await git_stash.drop_by_hash(HASH)).toBe(true)
		expect(read).toHaveBeenLastCalledWith(['stash', 'drop', 'stash@{1}'])
	})

	it('answers false and drops nothing for an entry already gone', async () => {
		read.mockResolvedValue(`${OTHER_HASH}${NUL}stash@{0}`)

		expect(await git_stash.drop_by_hash(HASH)).toBe(false)
		expect(read).toHaveBeenCalledOnce()
	})
})

describe('git_stash — reading an entry by hash', () => {
	it('reads the paths an entry carries, untracked files included', async () => {
		read.mockResolvedValue(`${LEDGER}\nscripts/a.ts`)

		expect(await git_stash.changed_paths(HASH)).toStrictEqual([LEDGER, 'scripts/a.ts'])
		expect(read).toHaveBeenCalledWith(['stash', 'show', '--include-untracked', '--name-only', HASH])
	})

	it('reads only the added lines of a path, without the file header', async () => {
		read.mockResolvedValue(
			[
				'--- a/docs/observations.md',
				'+++ b/docs/observations.md',
				'@@ -1 +1,2 @@',
				' - k:a',
				'+- k:b',
				'-- k:c',
			].join('\n'),
		)

		expect(await git_stash.added_lines(HASH, LEDGER)).toStrictEqual(['- k:b'])
	})

	it('reads every line of a path the entry carried as untracked', async () => {
		read.mockResolvedValueOnce('')
		read.mockResolvedValueOnce('# Observations\n- k:a')

		expect(await git_stash.added_lines(HASH, LEDGER)).toStrictEqual(['# Observations', '- k:a'])
		expect(read).toHaveBeenLastCalledWith(['show', `${HASH}^3:${LEDGER}`])
	})

	it('reads no lines for a path in neither the diff nor the untracked parent', async () => {
		read.mockResolvedValueOnce('')
		read.mockRejectedValueOnce(new Error('invalid object name'))

		expect(await git_stash.added_lines(HASH, LEDGER)).toStrictEqual([])
	})
})
