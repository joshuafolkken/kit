import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { run_hold } from './hold/run-hold'

const ARGV_OFFSET = 2
const FAILURE = 1

async function is_held(issue: string): Promise<boolean> {
	const target = await run_hold.worktree_directory()
	if (target === undefined) return false
	const read = run_hold.read_hold(run_hold.hold_path(target))

	return read.kind === 'held' && run_hold.is_own_hold(read.hold, issue)
}

async function remove_if_ended(issue: string, is_retry: boolean): Promise<void> {
	if (!is_retry || (await is_held(issue))) return

	await git_gh_command.issue_remove_label(issue, IN_PROGRESS_LABEL)
}

async function apply(issue: string, is_retry: boolean): Promise<number> {
	const is_applied = await git_gh_command.issue_add_label(issue, IN_PROGRESS_LABEL)

	await remove_if_ended(issue, is_retry)

	console.info(`run label: ${session_cite.issue(issue)} ${is_applied ? 'applied' : 'failed'}`)

	return is_applied ? 0 : FAILURE
}

async function run(args: ReadonlyArray<string>): Promise<number> {
	const [issue = '', retry] = args
	if (!/^\d+$/u.test(issue)) throw new Error('A numeric issue is required')
	const is_retry = retry === '--retry'
	if (is_retry && !(await is_held(issue))) return 0

	return await apply(issue, is_retry)
}

function set_exit_code(code: number): void {
	process.exitCode = code
}

async function main(): Promise<void> {
	set_exit_code(await run(process.argv.slice(ARGV_OFFSET)))
}

const run_label_main = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { run_label_main }
