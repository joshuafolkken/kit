import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state } from '#scripts/josh/durable-state'
import { OBSERVATION_LEDGER_DIRECTORY } from '#scripts/observations/observation-ledger'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { codex_permission_arguments } from './codex-permission-arguments'

const AGENT_COMMAND = 'codex'
const AGENT_FLAGS: ReadonlyArray<string> = ['exec']
const MODEL_FLAG = '--model'
const CONFIG_FLAG = '-c'
const JSON_FLAG = '--json'
const SQLITE_CACHE_PATH = ['node_modules', '.cache', 'josh', 'openai']
const EPHEMERAL_FLAG = '--ephemeral'
const GIT_DIRECTORY = '.git'
const LEDGER_DIRECTORY = path.dirname(OBSERVATION_LEDGER_DIRECTORY)
const WORKTREE_REGISTRY = 'worktrees'
const READ = 'read'
const WRITE = 'write'

// The sandbox is a Codex permission profile, not `--sandbox workspace-write` with `--add-dir` roots
// (joshuafolkken/kit#4653). It reads the whole disk and writes the work tree, the temp directories, the
// network and the common git directory — whose root a ref deletion needs: `git branch -d` and
// `git stash drop` rewrite `packed-refs` through `packed-refs.lock` there.
const BASE_GRANTS: ReadonlyArray<Grant> = [
	[':root', READ],
	[':workspace_roots', WRITE],
	[':slash_tmp', WRITE],
	[':tmpdir', WRITE],
]
// What git runs or follows to another directory stays read-only, so the sandbox cannot plant code that
// runs outside it the next time anything runs git: `hooks/` and `config`, and the `commondir` and
// `config.worktree` that would point a git directory at a planted one. An exact read-only path also
// refuses creating, renaming and deleting it (measured on codex-cli 0.156.1).
const PINNED_WORKTREE_ENTRIES: ReadonlyArray<string> = ['commondir', 'config.worktree']
const PINNED_ENTRIES: ReadonlyArray<string> = ['hooks', 'config', ...PINNED_WORKTREE_ENTRIES]
// Each registered work tree's git directory is pinned the same way; one registered after launch — a
// later lane, or the detached tree `josh test:red` and `josh metrics` add (`base-tree.ts`) — is not.

type Grant = readonly [string, string]

interface CodexArgv {
	command: string
	args: ReadonlyArray<string>
	ends_with_prompt: true
}

function effort_config(profile: AgentProfile): string {
	return `model_reasoning_effort="${profile.effort}"`
}

function sqlite_config(cwd: string): string {
	return `sqlite_home=${JSON.stringify(path.resolve(cwd, ...SQLITE_CACHE_PATH))}`
}

function persistence_arguments(profile: AgentProfile): ReadonlyArray<string> {
	return profile.role === agent_role_profile.WORKER ? [] : [EPHEMERAL_FLAG]
}

// A granted directory is created up front — it would otherwise be created in a directory the sandbox
// cannot write — and refused when it is not a real directory, so a symlink cannot widen the grant.
function ensure_writable_directory(directory: string, mode?: number): void {
	const current = lstatSync(directory, { throwIfNoEntry: false })

	if (current === undefined) mkdirSync(directory, { recursive: true, mode })
	else if (!current.isDirectory() || current.isSymbolicLink()) {
		throw new Error(`Writable root must be a real directory: ${directory}`)
	}
}

function pinned(directory: string, entries: ReadonlyArray<string>): ReadonlyArray<Grant> {
	return entries.map((entry) => [path.join(directory, entry), READ])
}

function registered_worktrees(common_directory: string): ReadonlyArray<string> {
	const registry = path.join(common_directory, WORKTREE_REGISTRY)
	if (!existsSync(registry)) return []

	return readdirSync(registry, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(registry, entry.name))
}

// Real paths, since the sandbox matches resolved paths: a `.git` reached through a symlink is granted
// where it lives, and an entry of it that is a symlink is not followed out of it.
function git_grants(common_directory: string | undefined): ReadonlyArray<Grant> {
	if (common_directory === undefined) return []

	const root = realpathSync(common_directory)

	return [
		[root, WRITE],
		...pinned(root, PINNED_ENTRIES),
		...registered_worktrees(root).flatMap((worktree) => pinned(worktree, PINNED_WORKTREE_ENTRIES)),
	]
}

// Codex also protects a linked work tree's own git directory even under a writable common root
// (codex-cli 0.165.0). FETCH_HEAD and PR body files need an explicit grant there.
function own_git_grants(cwd: string, common_directory: string | undefined): ReadonlyArray<Grant> {
	const own = git_common_directory.own(cwd)
	if (own === undefined || own === common_directory) return []

	const root = realpathSync(own)

	return [[root, WRITE], ...pinned(root, PINNED_ENTRIES)]
}

// Only the ledger's parent directory is writable outside a lane, never the primary checkout root.
function ledger_grants(
	common_directory: string | undefined,
	profile: AgentProfile,
): ReadonlyArray<Grant> {
	if (
		common_directory === undefined ||
		profile.role !== agent_role_profile.WORKER ||
		path.basename(common_directory) !== GIT_DIRECTORY
	) {
		return []
	}

	const ledger = path.join(path.dirname(common_directory), LEDGER_DIRECTORY)

	ensure_writable_directory(ledger)

	return [[realpathSync(ledger), WRITE]]
}

// The run-state directory is granted on its own, since a temp-root override moves it out of the
// common git directory — without it the records would fall back to the temp root, apart from the run's.
function state_grants(common_directory: string | undefined): ReadonlyArray<Grant> {
	if (common_directory === undefined) return []

	const state = durable_state.root_for(common_directory)

	ensure_writable_directory(state, durable_state.STATE_DIRECTORY_MODE)

	return [[realpathSync(state), WRITE]]
}

// The common git directory in every checkout, the primary one included: a `backlogrun` parent runs
// there, and the sandbox refuses a work tree's own `.git` unless it is granted — `josh ms` could not
// write `index.lock` (joshuafolkken/kit#5401).
function lane_grants(cwd: string | undefined, profile: AgentProfile): ReadonlyArray<Grant> {
	if (cwd === undefined) return []

	const common_directory = git_common_directory.repository(cwd)

	return [
		...git_grants(common_directory),
		...own_git_grants(cwd, common_directory),
		...state_grants(common_directory),
		...ledger_grants(common_directory, profile),
	]
}

function permission_arguments(
	cwd: string | undefined,
	profile: AgentProfile,
): ReadonlyArray<string> {
	const grants = [...BASE_GRANTS, ...lane_grants(cwd, profile)]

	return codex_permission_arguments.build(grants)
}

function lane_arguments(cwd: string | undefined, profile: AgentProfile): ReadonlyArray<string> {
	if (cwd === undefined) return []

	return [CONFIG_FLAG, sqlite_config(cwd), ...persistence_arguments(profile)]
}

function build(invocation: string, profile: AgentProfile, cwd?: string): CodexArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			MODEL_FLAG,
			profile.model,
			CONFIG_FLAG,
			effort_config(profile),
			...permission_arguments(cwd, profile),
			...lane_arguments(cwd, profile),
			JSON_FLAG,
			invocation,
		],
		ends_with_prompt: true,
	}
}

const codex_agent_argv = { build }

export type { CodexArgv }
export { codex_agent_argv }
