import { uptime } from 'node:os'
import { agent_exit_record } from '#scripts/agent/agent-exit-record'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_ending } from '#scripts/run/run-ending'

// Whether a returned child was killed by the host restarting rather than ending on its own
// (joshuafolkken/kit#4540). A restart clears the temporary directory the child's transcript and the run's
// event stream live in, so the exit record cannot tell it apart from a failure; the lane's dispatch time,
// kept in its worktree, can: a child dispatched before the host booted, with no exit record of its own,
// did not end itself.

const MS_PER_SECOND = 1000

// When the host last booted, in epoch milliseconds.
function booted_ms(): number | undefined {
	try {
		return Date.now() - uptime() * MS_PER_SECOND
	} catch {
		// A denied host reading is no evidence of a restart (joshuafolkken/kit#5431).
		return undefined
	}
}

// Whether the newest launch ended on its own exit record. The log is appended across launches, and where
// the temporary root survives a reboot it still holds an earlier launch's record, so only a record that
// is the log's last line belongs to the launch the restart may have killed.
function has_exit_record(output: string | undefined): boolean {
	const transcript = output === undefined ? undefined : run_ending.read_transcript(output)

	return transcript !== undefined && agent_exit_record.ends_on_exit_record(transcript)
}

async function is_host_restart(child: string, output: string | undefined): Promise<boolean> {
	if (has_exit_record(output)) return false

	const lane = await lane_registry.find_open_lane(child)
	const dispatched_ms = lane?.dispatched_ms
	if (dispatched_ms === undefined) return false
	const boot_ms = booted_ms()

	return boot_ms !== undefined && dispatched_ms < boot_ms
}

const run_merge_restart = { is_host_restart }

export { run_merge_restart }
