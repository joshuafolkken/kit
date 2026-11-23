import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { run_wait_cli } from '#scripts/run/run-wait-cli'
import { run_ship_wait_cli } from '#scripts/run/ship/run-ship-wait-cli'
import { run_review } from './run-review'
import { run_review_steps } from './run-review-steps'

// Each half of `josh run:chain <N>` — the opening (the stages up to and through `run:review`,
// joshuafolkken/kit#8705) and the `--join` (the recheck, the records and the ship's pre-detach,
// joshuafolkken/kit#8761) — runs as a detached worker, and the call waits on it only up to the
// `ship:wait` chunk, counted from process start, below the prompt-cache TTL. A worker done in time
// answers with its own output and exit code, as the stages run in place did; one still running answers
// `pending`, and the same command, re-run, waits on that worker rather than starting another. The
// worker runs every stage itself, so nothing is skipped.
//
// The worker's files sit under `.josh/tmp`, keyed by issue and half: its pid, its output and, once it
// ends, its exit code. A worker gone without an exit code ended abnormally; its output is shown and the
// run fails. The files are cleared once read, so the next call starts a fresh worker. The halves keep
// apart files, so a join finds the opening's unread worker and its own apart.

const WORKER_FLAG = '--worker'
const COMMAND = 'run:chain'
const STATE_DIRECTORY = path.join('.josh', 'tmp')
const FAILURE_EXIT_CODE = 1
const HALF = { OPENING: 'opening', JOIN: 'join' } as const
// The opening keeps the name it had before the join had a worker of its own.
const SUFFIX: Record<Half, string> = { opening: '', join: '-join' }
const FORWARDED_SESSION_KEY = 'JOSH_RUN_CHAIN_SESSION_ID'
const { SESSION_ID_KEY } = agent_session_environment

type Half = (typeof HALF)[keyof typeof HALF]
type Environment = Readonly<Record<string, string | undefined>>

interface Worker {
	issue: string
	half: Half
	root: string
}

interface WorkerFiles {
	pid: string
	log: string
	result: string
}

function worker_of(issue: string, half: Half, root: string = PROJECT_ROOT): Worker {
	return { issue, half, root }
}

function files_of(worker: Worker): WorkerFiles {
	const name = `run-chain-${worker.issue}${SUFFIX[worker.half]}`
	const base = path.join(worker.root, STATE_DIRECTORY, name)

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

// The detached launch strips the agent session id, yet the join's cut check
// (`run-chain-review-fix.ts`) must measure this session, not a guessed one: the worker gets the id
// under its own key and puts it back for that check.
function forwarded_environment(source: Environment = process.env): Record<string, string> {
	const id = source[SESSION_ID_KEY]

	return id === undefined ? {} : { [FORWARDED_SESSION_KEY]: id }
}

function session_environment(source: Environment = process.env): Environment {
	const id = source[FORWARDED_SESSION_KEY]

	return id === undefined ? source : { ...source, [SESSION_ID_KEY]: id }
}

function launch(worker: Worker, argv: ReadonlyArray<string>): string | undefined {
	const files = files_of(worker)

	clear(files)
	mkdirSync(path.dirname(files.pid), { recursive: true })
	const launched = run_review_steps.launch_josh_with(
		[COMMAND, ...argv, WORKER_FLAG],
		files.log,
		worker.root,
		forwarded_environment(),
	)

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
		`next: re-run the same \`pnpm josh ${COMMAND} ${issue}\` call, which waits on the same run`,
	].join('\n')
}

// One chunk's wait on the worker: its exit code once it ended, else `pending`.
async function attach(worker: Worker): Promise<number> {
	const files = files_of(worker)
	const verdict = await run_wait_cli.wait_for(is_done(files), {
		chunk_ms: Math.max(0, run_ship_wait_cli.CHUNK_MS - performance.now()),
		sleeper: sleep,
	})

	if (verdict === run_wait_cli.VERDICT.DONE) return collect(worker.issue, files)
	console.info(pending_report(worker.issue, files))

	return run_review.PENDING_EXIT_CODE
}

// Whether the worker was started and not yet read.
function has_worker(worker: Worker): boolean {
	return existsSync(files_of(worker).pid)
}

// `argv` is the call's own arguments, which the worker runs with.
async function open(worker: Worker, argv: ReadonlyArray<string>): Promise<number> {
	const failed = has_worker(worker) ? undefined : launch(worker, argv)

	if (failed === undefined) return await attach(worker)
	console.error(`run:chain ${worker.issue} — the background run did not start: ${failed}`)

	return FAILURE_EXIT_CODE
}

// The worker's last act: its exit code, which ends the wait on it.
function finish(worker: Worker, code: number): void {
	writeFileSync(files_of(worker).result, String(code))
}

const run_chain_background = {
	HALF,
	WORKER_FLAG,
	finish,
	forwarded_environment,
	has_worker,
	open,
	session_environment,
	worker_of,
}

export type { Half, Worker }
export { run_chain_background }
