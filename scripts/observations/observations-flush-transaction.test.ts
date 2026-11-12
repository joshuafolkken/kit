import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_install } from '#scripts/lane/lane-install'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'
import { observations_flush_transaction } from './observations-flush-transaction'

const BRANCH = 'observations/fixture'
const FILE = `${OBSERVATION_LEDGER_DIRECTORY}/1.md`
const SECOND = `${OBSERVATION_LEDGER_DIRECTORY}/2.md`
const ARCHIVE = `${OBSERVATION_LEDGER_DIRECTORY}/archive-2026-11.md`
const ORIGINAL = 'base\nrecord\n'
const LATER = 'later\n'
const RELEASE_MS = 100
const NO_ARCHIVES = 0
const PREFIX = 'flush-transaction-'
const COUNT_COMMITS = ['rev-list', '--count', `main..${BRANCH}`]
const NAME_ONLY = '--name-only'
const LIST_BRANCH_FILES = ['ls-tree', '-r', NAME_ONLY, BRANCH]
const RECOVERY_MESSAGE = 'observations recovery:'
const CLEANUP_REJECTED = 'cleanup rejected'
const STAGE_REJECTED = 'stage rejected'
const STATUS = ['status', '--porcelain']
const TEST_LOCK = 'test-owned lock'
const STAGED_FILE = 'staged.txt'
const USER_CHANGED = 'staged\nunstaged\n'
const PUBLICATION_INTERRUPTED = 'publication interrupted'
const INSTALLATION_REJECTED = 'installation rejected'

interface TestContext {
	fixture: ReturnType<typeof git_fixture_workspace.open_workspace>
	root: string
}

const context: TestContext = {
	fixture: { workspace: '', previous_cwd: '', restore_environment: undefined },
	root: '',
}

async function git(args: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(context.root, args)
}

function contents(name: string, cwd: string = context.root): string {
	return readFileSync(path.join(cwd, name), 'utf8')
}

function write(name: string, content: string, cwd: string = context.root): void {
	const target = path.join(cwd, name)

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, content, 'utf8')
}

async function archive(): Promise<number> {
	write(ARCHIVE, contents(FILE, process.cwd()), process.cwd())
	rmSync(path.join(process.cwd(), FILE))

	return 1
}

async function no_archive(): Promise<number> {
	return NO_ARCHIVES
}

async function publish(): Promise<void> {
	// The remote boundary is offline; the committed tree is the same payload a pull request lands.
	expect(await git_spawn.read(STATUS)).toBe('')
}

async function run(prepare: () => Promise<number> = archive): Promise<void> {
	await observations_flush_transaction.run(context.root, BRANCH, { prepare, publish })
}

async function fingerprint(): Promise<ReadonlyArray<string>> {
	return await Promise.all([git(['rev-parse', 'HEAD']), git(STATUS), git(['diff', '--cached'])])
}

async function own_lock(): Promise<string> {
	const target = await git_spawn.read(['rev-parse', '--git-path', 'index.lock'])

	writeFileSync(target, TEST_LOCK, 'utf8')

	return target
}

async function configure(): Promise<void> {
	await git(['config', 'user.email', 'fixture@example.test'])
	await git(['config', 'user.name', 'Kit Fixture'])
	await git(['config', 'commit.gpgsign', 'false'])
}

beforeEach(async () => {
	context.fixture = git_fixture_workspace.open_workspace(PREFIX)
	context.root = path.join(context.fixture.workspace, 'repo')
	mkdirSync(context.root)
	await git(['init', '--initial-branch=main'])
	await configure()
	write(FILE, 'base\n')
	await git(['add', '.'])
	await git(['commit', '-m', 'Initial'])
	write(FILE, ORIGINAL)
	process.chdir(context.root)
})

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(context.fixture)
})

it('commits one archive and leaves the original branch, HEAD and index clean', async () => {
	const head = await git(['rev-parse', 'HEAD'])

	await run()
	expect(await git(['branch', '--show-current'])).toBe('main')
	expect(await git(['rev-parse', 'HEAD'])).toBe(head)
	expect(await git(STATUS)).toBe('')
	expect(await git(['show', `${BRANCH}:${ARCHIVE}`])).toBe(ORIGINAL.trimEnd())
	await git(['merge', '--ff-only', BRANCH])
	expect(contents(ARCHIVE)).toBe(ORIGINAL)
})

it('waits out a transient index lock without deleting the owner lock', async () => {
	await run(async () => {
		const lock = await own_lock()

		setTimeout(() => {
			rmSync(lock)
		}, RELEASE_MS)

		return await archive()
	})
	expect(await git(STATUS)).toBe('')
})

it('preserves existing staged, unstaged and untracked user files byte for byte', async () => {
	write(STAGED_FILE, 'staged\n')
	await git(['add', STAGED_FILE])
	write(STAGED_FILE, USER_CHANGED)
	write('notes.txt', 'untracked\n')
	const index = await git(['diff', '--cached', '--binary'])

	await run()
	expect(await git(['diff', '--cached', '--binary'])).toBe(index)
	expect(contents(STAGED_FILE)).toBe(USER_CHANGED)
	expect(contents('notes.txt')).toBe('untracked\n')
})

it('leaves the primary index lock owned by another writer untouched', async () => {
	const lock = await own_lock()

	await run()
	expect(contents(lock)).toBe(TEST_LOCK)
	rmSync(lock)
	expect(await git(STATUS)).toBe('')
})

it('reuses a commit after publication interruption instead of preparing a second payload', async () => {
	const steps = { prepare: vi.fn(archive), publish: vi.fn(publish) }

	steps.publish.mockRejectedValueOnce(new Error(PUBLICATION_INTERRUPTED))
	await expect(observations_flush_transaction.run(context.root, BRANCH, steps)).rejects.toThrow(
		PUBLICATION_INTERRUPTED,
	)
	expect(contents(FILE)).toBe(ORIGINAL)
	appendFileSync(path.join(context.root, FILE), LATER)
	await observations_flush_transaction.run(context.root, BRANCH, steps)
	expect(steps.prepare).toHaveBeenCalledOnce()
	expect(await git(COUNT_COMMITS)).toBe('1')
	expect(contents(FILE)).toBe(`base\n${LATER}`)
})
it('bounds a persistent lock failure, retains recovery and retries with later appends intact', async () => {
	let lock = ''
	const before = await fingerprint()

	await expect(
		run(async () => {
			lock = await own_lock()

			return await archive()
		}),
	).rejects.toThrow(RECOVERY_MESSAGE)
	expect(existsSync(lock)).toBe(true)
	expect(await fingerprint()).toEqual(before)
	appendFileSync(path.join(context.root, FILE), LATER)
	rmSync(lock)
	await run()
	expect(contents(FILE)).toBe(`base\n${LATER}`)
	expect(await git(['show', `${BRANCH}:${ARCHIVE}`])).toBe(ORIGINAL.trimEnd())
})

it('preserves the original tree and index after a partial staging failure', async () => {
	write(SECOND, 'second\n')
	const before = await fingerprint()
	const original_read = git_spawn.read

	vi.spyOn(git_spawn, 'read').mockImplementation(async (args, timeout) => {
		if (args[0] === 'add' && args.includes(SECOND)) throw new Error(STAGE_REJECTED)

		return await original_read(args, timeout)
	})
	await expect(run(no_archive)).rejects.toThrow(STAGE_REJECTED)
	expect(await fingerprint()).toEqual(before)
	vi.restoreAllMocks()
	await run(no_archive)
	expect(await git(['show', `${BRANCH}:${SECOND}`])).toBe('second')
})

it('retains payload after commit rejection and commits it only once on retry', async () => {
	const hook = path.join(context.root, '.git', 'hooks', 'pre-commit')

	writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
	const before = await fingerprint()

	await expect(run()).rejects.toThrow(RECOVERY_MESSAGE)
	expect(await fingerprint()).toEqual(before)
	rmSync(hook)
	await run()
	expect(await git(COUNT_COMMITS)).toBe('1')
})

it('rebuilds an interrupted archive from the snapshot without duplicating its lines', async () => {
	await expect(
		run(async () => {
			await archive()
			throw new Error('interrupted')
		}),
	).rejects.toThrow('interrupted')
	expect(contents(FILE)).toBe(ORIGINAL)
	await run()
	expect(await git(['show', `${BRANCH}:${ARCHIVE}`])).toBe(ORIGINAL.trimEnd())
})

it('reuses the committed payload after cleanup failure and protects a later append', async () => {
	vi.spyOn(git_worktree, 'worktree_remove').mockRejectedValue(new Error(CLEANUP_REJECTED))
	await expect(run()).rejects.toThrow(CLEANUP_REJECTED)
	appendFileSync(path.join(context.root, FILE), LATER)
	vi.restoreAllMocks()
	await run()
	expect(contents(FILE)).toBe(`base\n${LATER}`)
	expect(await git(COUNT_COMMITS)).toBe('1')
})

it('retains the snapshot if worktree dependency installation fails', async () => {
	vi.spyOn(lane_install, 'install_dependencies').mockResolvedValueOnce({
		is_installed: false,
		output: INSTALLATION_REJECTED,
	})
	const before = await fingerprint()

	await expect(run()).rejects.toThrow(INSTALLATION_REJECTED)
	expect(await fingerprint()).toEqual(before)
	await run()
	expect(await git(COUNT_COMMITS)).toBe('1')
})

it('refuses source cleanup if another writer changed the source index', async () => {
	await expect(
		observations_flush_transaction.run(context.root, BRANCH, {
			prepare: archive,
			publish: async () => {
				write(STAGED_FILE, 'user work\n')
				await git(['add', STAGED_FILE])
			},
		}),
	).rejects.toThrow('Source index changed')
	expect(contents(FILE)).toBe(ORIGINAL)
	expect(await git(['diff', '--cached', NAME_ONLY])).toBe(STAGED_FILE)
})

it('stages both a migrated file and its deleted predecessor in the isolated payload', async () => {
	await run(async () => {
		write(SECOND, contents(FILE, process.cwd()), process.cwd())
		rmSync(path.join(process.cwd(), FILE))

		return NO_ARCHIVES
	})
	expect(await git(LIST_BRANCH_FILES)).not.toContain(FILE)
	expect(await git(['show', `${BRANCH}:${SECOND}`])).toBe(ORIGINAL.trimEnd())
	expect(contents(FILE)).toBe('base\n')
})
