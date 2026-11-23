import { parentPort, workerData } from 'node:worker_threads'
import { cost_audit_read } from './cost-audit-read'
import { cost_audit_read_pool } from './cost-audit-read-pool'

// One worker thread of `cost-audit-read-pool.ts`: reads its share of the transcripts and hands their
// sessions back in the order it was given them. Run outside a worker, it does nothing.

if (parentPort !== null) {
	const job = cost_audit_read_pool.JOB_SCHEMA.parse(workerData)

	parentPort.postMessage(cost_audit_read.read_files(job.files, new Set(job.lanes)))
}
