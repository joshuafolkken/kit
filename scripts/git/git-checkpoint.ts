import { USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { error_text } from '#scripts/lib/error-message'
import { SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { git_checkpoint_tip } from './git-checkpoint-tip'
import { git_command } from './git-command'
import { git_spawn } from './git-spawn'
import { git_worktree } from './git-worktree'

// `josh git:checkpoint <name> "<what>"` — a no-filing producer's save point (joshuafolkken/kit#9091).
// The settings deny list and the index rule refuse a raw `git add` / `git commit`, so the producer
// hook passes this one command instead (`producer-checkpoint.ts`). It stages everything, commits a
// `WIP checkpoint:` subject with lefthook skipped — a checkpoint is not a finish, so the ship refuses
// one left on the tip (`git-checkpoint-tip.ts`) — and points `wip/<name>` at it for the next producer.
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'usage: pnpm josh git:checkpoint <name> "<what>"'
const NAME = /^\w[\w.-]*$/u
const NO_HOOKS = { LEFTHOOK: '0' }

function is_usage(argv: ReadonlyArray<string>): boolean {
	const [name = '', what = '', ...rest] = argv

	return NAME.test(name) && what.trim() !== '' && rest.length === 0
}

// Why this checkout takes no checkpoint, or `undefined` when it does.
async function refusal(): Promise<string | undefined> {
	if (!(await git_worktree.is_linked())) return 'not a linked worktree — a checkpoint stays in one'
	const [branch, default_branch] = await Promise.all([
		git_command.branch(),
		git_command.get_default_branch(),
	])

	return branch === default_branch ? `on ${branch}, the default branch` : undefined
}

async function checkpoint(name: string, what: string): Promise<string> {
	await git_spawn.read(['add', '-A'])
	const message = git_checkpoint_tip.checkpoint_subject(what)

	await git_spawn.with_output('commit', ['-m', message], {
		environment: NO_HOOKS,
		timeout_ms: SUITE_TIMEOUT_MS,
	})
	await git_spawn.read(['branch', '-f', `wip/${name}`, 'HEAD'])

	return await git_spawn.read(['rev-parse', '--short', 'HEAD'])
}

function failed(reason: string): number {
	console.error(`josh git:checkpoint: ${reason}`)

	return FAILURE_EXIT_CODE
}

async function committed(name: string, what: string): Promise<number> {
	try {
		console.info(`josh git:checkpoint: wip/${name} → ${await checkpoint(name, what)}`)

		return SUCCESS_EXIT_CODE
	} catch (error) {
		return failed(error_text.message_of(error))
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (!is_usage(argv)) {
		console.error(USAGE)

		return USAGE_ERROR_EXIT_CODE
	}

	const [name = '', what = ''] = argv
	const problem = await refusal()

	return problem === undefined ? await committed(name, what) : failed(problem)
}

const git_checkpoint = { run }

export { git_checkpoint }
