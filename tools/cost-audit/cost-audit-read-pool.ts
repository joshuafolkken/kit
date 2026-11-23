import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import { bundle_flag } from '#scripts/build/bundle-flag'
import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { thread_entry } from '#scripts/run/thread-entry'
import { z } from 'zod'
import type { AuditSession } from './cost-audit-read'

// The transcripts `josh cost:audit` reads, parsed across worker threads: an audit reads the period and
// the one before it, and reading and parsing that on one thread was most of the audit's time
// (joshuafolkken/kit#8757). Each worker reads every `count`-th file, so a worker is not left with a run
// of large ones; the sessions are put back in file order after. Too few files for two workers are read
// on this thread.

const WORKER_SCRIPT = 'tools/cost-audit/cost-audit-read-worker.ts'
const FILES_PER_WORKER = 64
const MIN_WORKERS = 2

const FILE_SCHEMA = z.object({
	session_id: z.string(),
	path: z.string(),
	modified_ms: z.number(),
	is_delegated: z.boolean(),
	depth: z.number(),
})
const JOB_SCHEMA = z.object({ files: z.array(FILE_SCHEMA), lanes: z.array(z.string()) })

type ReadJob = z.infer<typeof JOB_SCHEMA>
type ReadFiles = (
	files: ReadonlyArray<SessionFile>,
	lanes: ReadonlySet<string>,
) => Array<AuditSession>

function worker_count(files: number, cores: number = availableParallelism()): number {
	return Math.min(cores, Math.floor(files / FILES_PER_WORKER))
}

// Share `index` holds every `count`-th item from `index` on.
function shares<T>(items: ReadonlyArray<T>, count: number): Array<Array<T>> {
	return Array.from({ length: count }, (_, index) =>
		items.filter((_item, position) => position % count === index),
	)
}

// The inverse of `shares`: item `position` is share `position % count`'s `position / count`-th.
function interleaved<T>(parts: ReadonlyArray<ReadonlyArray<T>>): Array<T> {
	const count = parts.length
	const total = parts.reduce((sum, part) => sum + part.length, 0)

	return Array.from(
		{ length: total },
		(_, position) => parts[position % count]?.[Math.floor(position / count)],
	).filter((one) => one !== undefined)
}

async function read_in_worker(job: ReadJob): Promise<Array<AuditSession>> {
	const launch = thread_entry.launch_of(WORKER_SCRIPT, bundle_flag.is_bundled(), process.execArgv)
	const worker = new Worker(launch.url, { workerData: job, execArgv: launch.exec_argv })

	return await new Promise((resolve, reject) => {
		worker.once('message', (sessions: Array<AuditSession>) => {
			resolve(sessions)
		})
		worker.once('error', reject)
		worker.once('exit', (code) => {
			reject(new Error(`cost:audit read worker exited with code ${String(code)}`))
		})
	})
}

// Every file's session, in file order; `read_files` is the reading itself, run here for a small set.
async function sessions_of(
	files: ReadonlyArray<SessionFile>,
	lanes: ReadonlySet<string>,
	read_files: ReadFiles,
): Promise<Array<AuditSession>> {
	const count = worker_count(files.length)

	if (count < MIN_WORKERS) return read_files(files, lanes)

	const jobs = shares(files, count).map((share) => ({ files: share, lanes: [...lanes] }))

	return interleaved(await Promise.all(jobs.map(async (job) => await read_in_worker(job))))
}

const cost_audit_read_pool = {
	WORKER_SCRIPT,
	JOB_SCHEMA,
	worker_count,
	shares,
	interleaved,
	sessions_of,
}

export { cost_audit_read_pool }
export type { ReadFiles }
