import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import {
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	MIGRATION_CLAIM_SUFFIX,
	OBSERVATION_LEDGER_DIRECTORY,
} from '#scripts/observations/observation-ledger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stash_pop_cli } from './stash-pop-cli'
import { stash_push_cli } from './stash-push-cli'

// Real git in a throwaway repository: what is asserted is which paths `git stash push` takes under the
// `-u` flag and the ledger-excluding pathspec, a property of git rather than of an argument list.

const TIMEOUT_MS = 30_000
const MESSAGE = 'fullrun new: pre-existing changes'
const TRACKED = 'tracked.ts'
const UNTRACKED = 'new.test.ts'
const LEDGER = path.join(OBSERVATION_LEDGER_DIRECTORY, '4131.md')
const SUBDIRECTORY = 'nested'
const BASE = 'base\n'
const EDITED = 'edited\n'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: process.cwd(),
	restore_environment: undefined,
}

function file(name: string): string {
	return path.join(fixture.workspace, name)
}

function write(name: string, content: string): void {
	mkdirSync(path.dirname(file(name)), { recursive: true })
	writeFileSync(file(name), content)
}

function verdict(): string {
	return String(vi.mocked(console.info).mock.calls.at(-1)?.[0])
}

async function stash_count(): Promise<number> {
	const list = await git_fixture_workspace.git(fixture.workspace, ['stash', 'list'])

	return list === '' ? 0 : list.split('\n').length
}

function leave_clean(): void {
	// The tree stays as the base commit left it.
}

function edit_ledger(): void {
	write(LEDGER, EDITED)
}

// Every path `observation_ledger.is_ledger_path` names: the old directory, the single-file ledgers and
// a claim a killed migration left.
function write_legacy_ledgers(): void {
	write(path.join(LEGACY_OBSERVATION_LEDGER_DIRECTORY, '1.md'), EDITED)

	for (const legacy of LEGACY_OBSERVATION_LEDGER_PATHS) {
		write(legacy, EDITED)
		write(`${legacy}.123${MIGRATION_CLAIM_SUFFIX}`, EDITED)
	}
}

async function push(): Promise<number> {
	return await stash_push_cli.run([MESSAGE, '--dir', fixture.workspace])
}

beforeEach(async () => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	Object.assign(fixture, git_fixture_workspace.open_workspace('stash-push-'))
	await git_fixture_workspace.git(fixture.workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	write(TRACKED, BASE)
	write(LEDGER, BASE)
	write(path.join(SUBDIRECTORY, TRACKED), BASE)
	await git_fixture_workspace.git(fixture.workspace, ['add', '.'])
	await git_fixture_workspace.git(fixture.workspace, ['commit', '-m', 'base'])
})

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('josh stash:push targets', () => {
	it(
		'stashes tracked and untracked changes and leaves the ledger in the tree',
		async () => {
			write(TRACKED, EDITED)
			write(UNTRACKED, EDITED)
			write(LEDGER, EDITED)

			const code = await push()

			expect(code).toBe(SUCCESS_EXIT_CODE)
			expect(verdict()).toBe(stash_push_cli.STASHED_VERDICT)
			expect(readFileSync(file(TRACKED), 'utf8')).toBe(BASE)
			expect(existsSync(file(UNTRACKED))).toBe(false)
			expect(readFileSync(file(LEDGER), 'utf8')).toBe(EDITED)
		},
		TIMEOUT_MS,
	)
})

// The pathspec is anchored at the root, so a subdirectory narrows neither what is stashed nor the
// ledger left behind.
describe('josh stash:push from a subdirectory', () => {
	it(
		'stashes the whole tree, the root ledger still left',
		async () => {
			write(TRACKED, EDITED)
			write(LEDGER, EDITED)
			write(path.join(SUBDIRECTORY, UNTRACKED), EDITED)

			const code = await stash_push_cli.run([MESSAGE, '--dir', file(SUBDIRECTORY)])

			expect(code).toBe(SUCCESS_EXIT_CODE)
			expect(readFileSync(file(TRACKED), 'utf8')).toBe(BASE)
			expect(readFileSync(file(LEDGER), 'utf8')).toBe(EDITED)
		},
		TIMEOUT_MS,
	)
})

describe('josh stash:push over nothing to set aside', () => {
	it.each([
		['a clean tree', leave_clean],
		['a tree whose only change is the ledger', edit_ledger],
		['a tree whose only change is a legacy ledger', write_legacy_ledgers],
	])(
		'pushes nothing on %s',
		async (_label, change) => {
			change()

			const code = await push()

			expect(code).toBe(SUCCESS_EXIT_CODE)
			expect(verdict()).toBe(stash_push_cli.CLEAN_VERDICT)
			expect(await stash_count()).toBe(0)
		},
		TIMEOUT_MS,
	)
})

describe('josh stash:push refusals', () => {
	it('refuses a missing message without touching the tree', async () => {
		write(TRACKED, EDITED)

		const code = await stash_push_cli.run(['--dir', fixture.workspace])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(readFileSync(file(TRACKED), 'utf8')).toBe(EDITED)
	})
})

// joshuafolkken/kit#4769: `run:pause` stashed over a merge left unresolved and failed inside
// `git stash`; the push is refused first and points at closing the merge.
async function conflict_on_tracked(): Promise<void> {
	const git = git_fixture_workspace.git.bind(undefined, fixture.workspace)

	await git(['checkout', '-b', 'side'])
	write(TRACKED, 'side\n')
	await git(['commit', '-am', 'side'])
	await git(['checkout', '-'])
	write(TRACKED, EDITED)
	await git(['commit', '-am', 'main'])

	try {
		await git(['merge', 'side'])
	} catch {
		// The conflicted merge exits non-zero, and the conflict it leaves is the fixture.
	}
}

describe('josh stash:push over unresolved paths', () => {
	it(
		'refuses before stashing and points at closing the merge',
		async () => {
			await conflict_on_tracked()

			await expect(
				stash_push_cli.set_aside({ message: MESSAGE, dir: fixture.workspace }),
			).rejects.toThrow(/unresolved paths \(tracked\.ts\).*pnpm josh git -y/u)
			expect(await push()).toBe(FAILURE_EXIT_CODE)
			expect(await stash_count()).toBe(0)
		},
		TIMEOUT_MS,
	)
})

describe('josh stash:push with stash:pop', () => {
	it(
		'restores what it stashed by the same message',
		async () => {
			write(TRACKED, EDITED)
			write(UNTRACKED, EDITED)
			await push()

			const code = await stash_pop_cli.run([MESSAGE, '--dir', fixture.workspace])

			expect(code).toBe(SUCCESS_EXIT_CODE)
			expect(verdict()).toBe(stash_pop_cli.POPPED_VERDICT)
			expect(readFileSync(file(TRACKED), 'utf8')).toBe(EDITED)
			expect(readFileSync(file(UNTRACKED), 'utf8')).toBe(EDITED)
			expect(await stash_count()).toBe(0)
		},
		TIMEOUT_MS,
	)
})
