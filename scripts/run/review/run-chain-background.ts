import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { run_wait_cli } from '#scripts/run/run-wait-cli'
import { run_ship_wait_cli } from '#scripts/run/ship/run-ship-wait-cli'
import { run_review } from './run-review'
import { run_review_steps } from './run-review-steps'

// `josh run:chain <N>`'s opening half — the stages up to and through `run:review`, which starts the
// gate and waits on it — runs as a detached worker, and the call waits on it only up to the
// `ship:wait` chunk, counted from process start, below the prompt-cache TTL (joshuafolkken/kit#8705).
// A worker done in time answers with its own output and exit code, as the stages run in place did; one
// still running answers `pending`, and the same command, re-run, waits on that worker rather than
// starting another. The worker runs every stage itself, so nothing is skipped.
//
// The worker's files sit under `.josh/tmp`, keyed by issue: its pid, its output and, once it ends, its
// exit code. A worker gone without an exit code ended abnormally; its output is shown and the run
// fails. The files are cleared once read, so the next call starts a fresh worker.

const WORKER_FLAG = '--worker'
const COMMAND = 'run:chain'
const STATE_DIRECTORY = path.join('.josh', 'tmp')
const FAILURE_EXIT_CODE = 1

interface WorkerFiles {
	pid: string
	log: string
	result: string
}

function files_of(issue: string, root: string): WorkerFiles {
	const base = path.join(root, STATE_DIRECTORY, `run-chain-${issue}`)

	return { pid: `${base}.pid`, log: `${base}.log`, result: `${base}.result` }
}

function clear(files: WorkerFiles): void {
	for (const file of [files.pid, files.log, files.result]) rmSync(file, { force: true })
}

// Done once the worker wrote its exit code or its process is gone.
function is_done(files: WorkerFiles): () => Promise<boolean> {
	return async () => {
		if (existsSync(files.result)) return true
		const gone = run_wait_cli.probe_of(['--pid', readFileSync(files.pid, 'utf8').trim()])

		return gone === undefined || (await gone())
	}
}

function launch(issue: string, argv: ReadonlyArray<string>, root: string): string | undefined {
	const files = files_of(issue, root)

	clear(files)
	mkdirSync(path.dirname(files.pid), { recursive: true })
	const launched = run_review_steps.launch_josh([COMMAND, ...argv, WORKER_FLAG], files.log, root)

	if (launched.kind === 'failed') return launched.note
	writeFileSync(files.pid, String(launched.pid))

	return undefined
}

function read_text(file: string): string {
	return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

// The worker's output as it printed it, then its exit code; the files go.
function collect(issue: string, files: WorkerFiles): number {
	const output = read_text(files.log).trimEnd()
	const code = read_text(files.result).trim()

	if (output !== '') console.info(output)
	clear(files)
	if (code !== '') return Number(code)
	console.error(`run:chain ${issue} — the background run ended without an exit code (output above)`)

	return FAILURE_EXIT_CODE
}

function pending_report(issue: string, files: WorkerFiles): string {
	return [
		`run:chain ${issue} — pending: the stages still run in the background (output: ${files.log})`,
		`next: re-run \`pnpm josh ${COMMAND} ${issue}\`, which waits on the same run`,
	].join('\n')
}

// One chunk's wait on the worker: its exit code once it ended, else `pending`.
async function attach(issue: string, root: string): Promise<number> {
	const files = files_of(issue, root)
	const verdict = await run_wait_cli.wait_for(is_done(files), {
		chunk_ms: Math.max(0, run_ship_wait_cli.CHUNK_MS - performance.now()),
		sleeper: sleep,
	})

	if (verdict === run_wait_cli.VERDICT.DONE) return collect(issue, files)
	console.info(pending_report(issue, files))

	return run_review.PENDING_EXIT_CODE
}

// Whether a worker for `issue` was started and not yet read.
function has_worker(issue: string, root: string = PROJECT_ROOT): boolean {
	return existsSync(files_of(issue, root).pid)
}

// `argv` is the call's own arguments, which the worker runs with.
async function open(
	issue: string,
	argv: ReadonlyArray<string>,
	root: string = PROJECT_ROOT,
): Promise<number> {
	const failed = has_worker(issue, root) ? undefined : launch(issue, argv, root)

	if (failed === undefined) return await attach(issue, root)
	console.error(`run:chain ${issue} — the background run did not start: ${failed}`)

	return FAILURE_EXIT_CODE
}

// The worker's last act: its exit code, which ends the wait on it.
function finish(issue: string, code: number, root: string = PROJECT_ROOT): void {
	writeFileSync(files_of(issue, root).result, String(code))
}

const run_chain_background = { WORKER_FLAG, finish, has_worker, open }

export { run_chain_background }
