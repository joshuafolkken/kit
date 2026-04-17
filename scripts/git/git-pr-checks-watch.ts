import { spawn } from 'node:child_process'

const PR_CHECKS_WATCH_TIMEOUT_MS = 120_000

interface WatchResult {
	timed_out: boolean
}

function resolve_exit_code(code: number | null): string {
	return code === null ? 'unknown' : String(code)
}

function create_watch_settle_guard(): {
	is_settled: () => boolean
	settle: () => void
} {
	let is_settled = false

	return {
		is_settled: () => is_settled,
		settle: () => {
			is_settled = true
		},
	}
}

function handle_watch_timeout(
	guard: ReturnType<typeof create_watch_settle_guard>,
	child: ReturnType<typeof spawn>,
	resolve: (result: WatchResult) => void,
): void {
	if (guard.is_settled()) return
	guard.settle()
	child.kill()
	console.info('⏱️ pr checks --watch timed out.')
	resolve({ timed_out: true })
}

function handle_watch_close(input: {
	guard: ReturnType<typeof create_watch_settle_guard>
	timeout_id: NodeJS.Timeout
	code: number | null
	callbacks: { resolve: (result: WatchResult) => void; reject: (error: Error) => void }
}): void {
	if (input.guard.is_settled()) return
	input.guard.settle()
	clearTimeout(input.timeout_id)

	if (input.code === 0) {
		input.callbacks.resolve({ timed_out: false })
	} else {
		input.callbacks.reject(
			new Error(`gh pr checks --watch exited with code ${resolve_exit_code(input.code)}`),
		)
	}
}

async function pr_checks_watch(branch_name: string): Promise<WatchResult> {
	return await new Promise<WatchResult>((resolve, reject) => {
		// eslint-disable-next-line sonarjs/no-os-command-from-path -- gh is a well-known CLI tool and safe to execute
		const child = spawn('gh', ['pr', 'checks', branch_name, '--watch'], {
			stdio: 'inherit',
			shell: false,
		})
		const guard = create_watch_settle_guard()

		const timeout_id = setTimeout(() => {
			handle_watch_timeout(guard, child, resolve)
		}, PR_CHECKS_WATCH_TIMEOUT_MS)

		child.on('error', (error) => {
			if (guard.is_settled()) return
			guard.settle()
			clearTimeout(timeout_id)
			reject(error)
		})

		child.on('close', (code) => {
			handle_watch_close({ guard, timeout_id, code, callbacks: { resolve, reject } })
		})
	})
}

const git_pr_checks_watch = { pr_checks_watch }

export {
	git_pr_checks_watch,
	PR_CHECKS_WATCH_TIMEOUT_MS,
	create_watch_settle_guard,
	handle_watch_timeout,
	handle_watch_close,
}
export type { WatchResult }
