import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_stash } from '#scripts/git/stash/git-stash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_set_aside_commit } from './run-set-aside-commit'

// joshuafolkken/kit#5930: the set-aside on a lane branch is a WIP commit there, not a stash. Git is
// an in-memory stand-in — the head subject and the commands run — so a rerun reads back the commit.

const MESSAGE = 'run:pause: #10 waits on #11'
const WIP = `wip: ${MESSAGE}`

const EARLIER = 'feat: earlier'

const state = { head: EARLIER, has_work: true, unmerged: [] as Array<string> }
const commands: Array<Array<string>> = []

beforeEach(() => {
	Object.assign(state, { head: EARLIER, has_work: true, unmerged: [] })
	commands.length = 0
	vi.spyOn(git_stash, 'unmerged_paths').mockImplementation(async () => state.unmerged)
	vi.spyOn(git_stash, 'has_stashable_changes').mockImplementation(async () => state.has_work)
	vi.spyOn(git_spawn, 'read').mockImplementation(async (arguments_: Array<string>) => {
		commands.push(arguments_)
		if (arguments_[0] === 'commit') state.head = arguments_.at(-1) ?? ''

		return arguments_[0] === 'log' ? state.head : ''
	})
})

describe('run_set_aside_commit.is_lane', () => {
	it('answers yes on the issue’s own lane branch and no elsewhere', async () => {
		vi.spyOn(git_command, 'branch').mockResolvedValueOnce('10-lane').mockResolvedValueOnce('main')

		expect(await run_set_aside_commit.is_lane('10')).toBe(true)
		expect(await run_set_aside_commit.is_lane('10')).toBe(false)
	})
})

describe('run_set_aside_commit.commit', () => {
	it('stages everything and commits it without the hooks under the WIP message', async () => {
		expect(await run_set_aside_commit.commit(MESSAGE)).toBe('committed')
		expect(commands).toContainEqual(['add', '-A', '--', ':/'])
		expect(commands).toContainEqual(['commit', '--no-verify', '-m', WIP])
		expect(await run_set_aside_commit.is_committed(MESSAGE)).toBe(true)
	})

	it('answers `already` on a rerun once the head is the WIP commit', async () => {
		await run_set_aside_commit.commit(MESSAGE)
		commands.length = 0

		expect(await run_set_aside_commit.commit(MESSAGE)).toBe('already')
		expect(commands.some(([command]) => command === 'commit')).toBe(false)
	})

	it('commits nothing on a clean tree', async () => {
		state.has_work = false

		expect(await run_set_aside_commit.commit(MESSAGE)).toBe('clean')
		expect(commands.some(([command]) => command === 'commit')).toBe(false)
	})

	it('refuses an index with unresolved paths rather than committing the markers', async () => {
		state.unmerged = ['a.ts']

		await expect(run_set_aside_commit.commit(MESSAGE)).rejects.toThrow('a.ts')
		expect(commands.some(([command]) => command === 'add')).toBe(false)
	})
})
