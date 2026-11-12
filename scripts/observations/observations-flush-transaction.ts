import { randomUUID } from 'node:crypto'
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { git_worktree } from '#scripts/git/git-worktree'
import { repository_lock } from '#scripts/git/repository-lock'
import { lane_install } from '#scripts/lane/lane-install'
import { error_text } from '#scripts/lib/error-message'
import { poll } from '#scripts/lib/poll'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { z } from 'zod'
import { observation_ledger, OBSERVATION_LEDGER_DIRECTORY } from './observation-ledger'

const LOCK_WAIT_MS = 30_000
const COMMIT_MESSAGE = 'Record observation ledger entries'
const ATTEMPTS = 5
const INTERVAL_MS = 250
const snapshot_schema = z.object({
	name: z.string(),
	content: z.string().optional(),
	base: z.string().optional(),
})
type SnapshotFile = z.infer<typeof snapshot_schema>
const state_schema = z.object({
	branch: z.string(),
	base: z.string(),
	tree: z.string(),
	archived: z.number().optional(),
	landed: z.boolean().optional(),
	initialized: z.boolean().optional(),
	committed: z.boolean().optional(),
	installed: z.boolean().optional(),
	index: z.string(),
	files: z.array(snapshot_schema),
	reconciled: z.array(snapshot_schema).optional(),
})
type State = z.infer<typeof state_schema>

interface Steps {
	prepare: () => Promise<number>
	publish: (branch: string, archived: number) => Promise<void>
}

function lock_failure(error: unknown): undefined {
	if (!/index\.lock.*(?:File exists|exists)/su.test(error_text.message_of(error))) throw error
}

async function retry(work: () => Promise<unknown>): Promise<void> {
	const state: { failure?: unknown } = {}
	const is_complete = await poll.poll_for(
		async () => {
			try {
				await work()
				delete state.failure
			} catch (error) {
				lock_failure(error)
				state.failure = error
			}

			return state.failure === undefined ? true : undefined
		},
		{ attempts: ATTEMPTS, interval_ms: INTERVAL_MS },
	)
	if (is_complete === undefined) throw state.failure
}

function read(root: string, name: string): string | undefined {
	const target = path.join(root, name)
	if (!existsSync(target)) return undefined
	if (!lstatSync(target).isFile()) throw new Error(`Not a regular ledger file: ${target}`)

	return readFileSync(target, 'utf8')
}

function write(root: string, name: string, content: string | undefined): void {
	const target = path.join(root, name)

	if (content === undefined) {
		rmSync(target, { force: true })

		return
	}

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, content, 'utf8')
}

async function capture(root: string): Promise<Array<SnapshotFile>> {
	const output = await git_spawn.read([
		'-C',
		root,
		'ls-files',
		'-z',
		'--cached',
		'--others',
		'--exclude-standard',
	])
	const names = new Set(
		output.split('\0').filter((name) => observation_ledger.is_ledger_path(name)),
	)

	return [...names].map((name) => ({
		name,
		content: read(root, name),
	}))
}

function apply(root: string, files: ReadonlyArray<SnapshotFile>): void {
	for (const file of files) write(root, file.name, file.content)
}

function reconciled_content(file: SnapshotFile, suffix: string): string | undefined {
	if (suffix === '' && file.base === undefined) return undefined

	return (file.base ?? '') + suffix
}

function reconciled_file(root: string, file: SnapshotFile): SnapshotFile {
	const current = read(root, file.name) ?? ''
	const original = file.content ?? ''

	if (!current.startsWith(original)) {
		throw new Error(`Ledger changed beyond an append: ${file.name}; recovery retained`)
	}

	return { ...file, content: reconciled_content(file, current.slice(original.length)) }
}

function starts_with(current = '', expected = ''): boolean {
	return current.startsWith(expected)
}

function restore_file(root: string, file: SnapshotFile, before: SnapshotFile | undefined): void {
	const current = read(root, file.name)
	if (current === file.content) return

	if (before !== undefined && starts_with(current, before.content)) {
		write(root, file.name, reconciled_file(root, before).content)

		return
	}

	if (!starts_with(current, file.content)) throw new Error(`Recovery conflict: ${file.name}`)
}

function restore(
	root: string,
	before: ReadonlyArray<SnapshotFile>,
	after: ReadonlyArray<SnapshotFile>,
): void {
	for (const file of after) {
		restore_file(
			root,
			file,
			before.find((entry) => entry.name === file.name),
		)
	}
}

function save(target: string, state: State): void {
	writeFileSync(`${target}.tmp`, JSON.stringify(state), 'utf8')
	renameSync(`${target}.tmp`, target)
}

async function location(root: string): Promise<string> {
	const own = await git_spawn.read(['-C', root, 'rev-parse', '--absolute-git-dir'])
	const directory = path.join(own, 'josh', 'observation-flush')

	mkdirSync(directory, { recursive: true })

	return path.join(directory, 'state.json')
}

async function create(root: string, branch: string, target: string): Promise<State> {
	const existing = git_spawn_sync.read(
		['show-ref', '--verify', `refs/heads/${branch}`],
		git_spawn_sync.located(root),
	)
	const state = {
		branch: existing === undefined ? branch : `${branch}-${randomUUID()}`,
		base: await git_command.head_commit(),
		index: await git_spawn.read(['-C', root, 'diff', '--cached', '--binary']),
		tree: `${path.dirname(target)}/tree`,
		files: await capture(root),
	}

	save(target, state)

	return state
}

async function initialize(root: string, state: State, target: string): Promise<void> {
	if (state.initialized === true) return
	const existing = git_spawn_sync.read(
		['show-ref', '--verify', `refs/heads/${state.branch}`],
		git_spawn_sync.located(root),
	)

	if (!existsSync(state.tree)) {
		await git_worktree.worktree_add(
			state.tree,
			state.branch,
			existing === undefined ? state.base : undefined,
		)
	}

	Object.assign(state, {
		files: state.files.map((file) => ({ ...file, base: read(state.tree, file.name) })),
		initialized: true,
	})
	save(target, state)
}

async function load(root: string, branch: string, target: string): Promise<State> {
	const state = existsSync(target)
		? state_schema.parse(JSON.parse(readFileSync(target, 'utf8')))
		: await create(root, branch, target)

	await initialize(root, state, target)

	return state
}

async function pending(root: string): Promise<boolean> {
	return existsSync(await location(root))
}

async function reset_preparation(state: State, target: string): Promise<void> {
	const ledger = path.join(state.tree, OBSERVATION_LEDGER_DIRECTORY)

	if (existsSync(ledger)) {
		cpSync(ledger, `${path.dirname(target)}/attempt-${String(Date.now())}`, { recursive: true })
	}

	await git_spawn.read(['reset', '--hard', state.base])
	await git_spawn.read(['clean', '-fd', '--', OBSERVATION_LEDGER_DIRECTORY])
	apply(state.tree, state.files)
}

async function stage(): Promise<void> {
	const status = await git_command.status()
	const unstaged = status
		.split('\n')
		.filter((line) => line[1] !== ' ')
		.join('\n')
	const names = observation_ledger.ledger_paths(unstaged)

	for (const name of names) {
		// eslint-disable-next-line no-await-in-loop -- each git add exclusively owns this index
		await retry(async () => await git_spawn.read(['add', '--', name]))
	}
}

async function prepare(state: State, target: string, steps: Steps): Promise<void> {
	if ((await git_command.head_commit()) !== state.base) return

	if (state.archived === undefined) {
		await reset_preparation(state, target)
		Object.assign(state, { archived: await steps.prepare() })
		save(target, state)
	}

	await stage()
	if (!observation_ledger.has_pending_append(await git_command.status())) return
	await retry(async () => await git_spawn.read(['commit', '-m', COMMIT_MESSAGE], SUITE_TIMEOUT_MS))
}

async function publish(state: State, target: string, steps: Steps): Promise<void> {
	const is_committed = (await git_command.head_commit()) !== state.base

	Object.assign(state, { committed: is_committed })
	save(target, state)
	if (is_committed) await steps.publish(state.branch, state.archived ?? 0)

	Object.assign(state, { landed: true })
	save(target, state)
}

async function install(state: State, target: string): Promise<void> {
	if (state.installed === true) return
	const result = await lane_install.install_dependencies(state.tree)

	if (!result.is_installed) {
		throw new Error(`Flush worktree dependency installation failed: ${result.output}`)
	}

	Object.assign(state, { installed: true })
	save(target, state)
}

async function inside(state: State, target: string, steps: Steps): Promise<void> {
	if (state.landed === true) return
	const previous = process.cwd()

	try {
		process.chdir(state.tree)
		await install(state, target)
		await prepare(state, target, steps)
		await publish(state, target, steps)
	} finally {
		process.chdir(previous)
	}
}

async function finish(root: string, state: State, target: string): Promise<void> {
	const index = await git_spawn.read(['-C', root, 'diff', '--cached', '--binary'])
	if (index !== state.index) throw new Error('Source index changed during flush; recovery retained')
	state.reconciled ??= state.files.map((file) => reconciled_file(root, file))
	save(target, state)
	restore(root, state.files, state.reconciled)
	if (existsSync(state.tree)) await git_worktree.worktree_remove(state.tree)
	renameSync(target, `${target}.completed-${path.basename(state.branch)}`)
}

async function transact(root: string, branch: string, steps: Steps): Promise<string> {
	const target = await location(root)

	try {
		const state = await load(root, branch, target)

		await inside(state, target, steps)
		await finish(root, state, target)

		return state.committed === true ? state.branch : ''
	} catch (error) {
		throw new Error(
			`${error_text.message_of(error)} — observations recovery: ${target}; rerun observations:flush; do not remove the recovery tree`,
			{ cause: error },
		)
	}
}

async function run(root: string, branch: string, steps: Steps): Promise<string> {
	const lock = repository_lock.lock_path('josh-observation-flush-', root)
	const result = await repository_lock.with_lock(
		async () => await transact(root, branch, steps),
		lock,
		LOCK_WAIT_MS,
	)
	if (result === undefined) throw new Error('Observation flush is already running; retry later')

	return result
}

const observations_flush_transaction = { pending, run }

export { observations_flush_transaction }
