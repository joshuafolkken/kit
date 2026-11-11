import {
	run_board_usage_rusage,
	type RusageReader,
} from '#scripts/run/board/run-board-usage-rusage'
import { eslint_daemon } from './eslint-daemon'
import { eslint_daemon_calls } from './eslint-daemon-calls'
import { eslint_warm } from './eslint-warm'

// Restarts a checkout's eslint daemon once its footprint outgrows a fresh one (joshuafolkken/kit#7246).
// The footprint grows with the files the daemon has linted over its life (#7245) and stays until the
// lane closes. An idle timeout would not do: the daemon is warmed at `lane:open` and the first edit
// comes after the plan and the reading, often past any short timeout, which would leave that edit cold.
// **The restart is the warm-up's**, detached, so no edit waits for a cold daemon (#4720).
//
// The limit is about twice a daemon fresh from the warm-up, and under what a resident one reached
// (both recorded on #7246), so restarts stay rare.
const FOOTPRINT_LIMIT_MB = 600
const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB

function default_reader(): RusageReader | undefined {
	return run_board_usage_rusage.rusage_reader(process.platform, run_board_usage_rusage.load_builtin)
}

function is_heavy(project_root: string, reader: RusageReader | undefined): boolean {
	const pid = eslint_daemon_calls.pid_of(eslint_daemon.read_record(project_root).daemon)
	if (pid === undefined || reader === undefined) return false
	const footprint_bytes = reader(Number(pid))?.footprint_bytes ?? 0

	return footprint_bytes > FOOTPRINT_LIMIT_MB * BYTES_PER_MB
}

// Whether the daemon was stopped and its replacement's warm-up started. Off macOS, or before Node
// reads a footprint, nothing is measured and nothing restarts.
async function trim(project_root: string, reader = default_reader()): Promise<boolean> {
	if (!is_heavy(project_root, reader) || !(await eslint_daemon.stop(project_root))) return false
	eslint_warm.start(project_root)

	return true
}

const eslint_trim = { trim, BYTES_PER_MB, FOOTPRINT_LIMIT_MB }

export { eslint_trim }
