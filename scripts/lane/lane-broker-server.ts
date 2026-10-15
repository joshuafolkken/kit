import { readFileSync } from 'node:fs'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// Which process serves a lane's brokered sessions, recorded beside the response it answers in.
//
// **A server is live while its process is, never while its event loop happens to answer.** One
// supervisor serves every Claude lane beside its drive passes, so any synchronous call in it — a
// `spawnSync` of an agent CLI's `--version` alone may take 10 s — stalled the timer-written heartbeat
// past its limit and failed every review then in flight (joshuafolkken/kit#3840).
//
// **A record of its own rather than fields on the response**, because a ship branched before this
// record existed parses the response strictly and reads any new field as no server at all; the
// response keeps the shape and heartbeat that ship reads, and this record names the writer by
// `process_identity.own_fields()`, so a pid the operating system reissued is not taken for it.

const SERVER_SUFFIX = '.server'
const server_schema = z
	.object({
		session: z.uuid(),
		pid: z.number().int().positive(),
		process_start: z.string().optional(),
	})
	.strict()
type BrokerServer = z.infer<typeof server_schema>

function server_path(response: string): string {
	return `${response}${SERVER_SUFFIX}`
}

function write(response: string, session: string): void {
	stamp_file.replace_stamp(server_path(response), { session, ...process_identity.own_fields() })
}

function remove(response: string): void {
	stamp_file.remove_stamp(server_path(response))
}

// Only the record of the session the response names: one left by an earlier server is no answer.
function read(response: string, session: string): BrokerServer | undefined {
	try {
		const server = json_value.parse_with(readFileSync(server_path(response), 'utf8'), server_schema)

		return server?.session === session ? server : undefined
	} catch {
		return undefined
	}
}

// **The identity is checked when a ship first finds the server, the pid while it waits.** A response
// a killed supervisor left behind is met on that first look, where a reissued pid must not read as
// it; the wait polls every 100 ms, where a start-time probe would spawn `ps` on each. Both read
// through `is_present_*`, because a Codex lane's ship probes from inside its sandbox, where the kernel
// answers `EPERM` for a supervisor it has found. A start time that cannot be read is no proof of a
// dead server, so it does not fail the review.
function is_serving_process(server: BrokerServer): boolean {
	return process_identity.is_present_process(server.pid, server.process_start) !== false
}

function is_running(server: BrokerServer): boolean {
	return process_identity.is_present_pid(server.pid)
}

const lane_broker_server = { is_running, is_serving_process, read, remove, server_path, write }

export type { BrokerServer }
export { lane_broker_server }
