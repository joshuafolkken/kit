import { execa, type Options } from 'execa'
import { get_exit_code } from './git-execa-error'

const PR_CHECKS_WATCH_TIMEOUT_MS = 120_000
const WATCH_OPTIONS: Options = { stdio: 'inherit', timeout: PR_CHECKS_WATCH_TIMEOUT_MS }

interface WatchResult {
	timed_out: boolean
}

// execa sets `timedOut: true` on the thrown error when its `timeout` option kills
// the process — the replacement for the previous manual setTimeout + child.kill().
function is_timeout_error(error: unknown): boolean {
	return (
		typeof error === 'object' && error !== null && 'timedOut' in error && error.timedOut === true
	)
}

function to_watch_failure(error: unknown): Error {
	const exit_code = get_exit_code(error)

	if (exit_code !== undefined) {
		return new Error(`gh pr checks --watch exited with code ${String(exit_code)}`)
	}

	return error instanceof Error ? error : new Error(String(error))
}

async function pr_checks_watch(branch_name: string): Promise<WatchResult> {
	try {
		await execa('gh', ['pr', 'checks', branch_name, '--watch'], WATCH_OPTIONS) // NOSONAR S8705: execa array args (no shell), trusted dev CLI tooling

		return { timed_out: false }
	} catch (error) {
		if (is_timeout_error(error)) {
			console.info('⏱️ pr checks --watch timed out.')

			return { timed_out: true }
		}

		throw to_watch_failure(error)
	}
}

const git_pr_checks_watch = { pr_checks_watch }

export { git_pr_checks_watch, PR_CHECKS_WATCH_TIMEOUT_MS, is_timeout_error }
export type { WatchResult }
