import { git_common_directory } from '#scripts/git/git-common-directory'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { detached_launch, type LaunchArgv } from '#scripts/run/detached-launch'
import { backlogrun_launch } from './backlogrun-launch'

const FAILURE_PREFIX = 'observations:flush skipped: '
const DURATION_PREFIX = 'observations:flush finished in '
const FLUSH_COMMAND = 'observations:flush'
// The `backlog:offer` flag that runs `flush` alone — the body `start` launches detached. `as const`
// keeps the key a literal inside `backlog:offer`'s option table.
const OPTION = 'drain-flush' as const
const FLUSH_ARGV: LaunchArgv = { command: 'pnpm', args: ['josh', 'backlog:offer', `--${OPTION}`] }

function report_failure(reason: string): void {
	console.error(`${FAILURE_PREFIX}${reason.replaceAll(/\s+/gu, ' ')}`)
}

async function flush(now: () => number = Date.now): Promise<void> {
	const started_ms = now()

	try {
		const root = await lane_registry.main_repository_root()

		josh_command.require_success(await josh_command.josh_run_at(['main:sync'], root), 'main:sync')
		josh_command.require_success(
			await josh_command.josh_run_at([FLUSH_COMMAND], root),
			FLUSH_COMMAND,
		)
	} catch (error) {
		report_failure(error_text.message_of(error))
	}

	console.error(`${DURATION_PREFIX}${String((now() - started_ms) / MS_PER_SECOND)}s`)
}

function log_path_of(cwd: string): string | undefined {
	const common = git_common_directory.repository(cwd)

	return common === undefined ? undefined : backlogrun_launch.log_path(common)
}

// The flush pushes through the full pre-push suite, minutes the driver must keep offering through
// (joshuafolkken/kit#7505). Detached in its own process group, it also outlives a driver that ends or a
// run `backlogrun` replaces meanwhile, so the ledger is still published; its lines go to the run's log.
function start(cwd: string = process.cwd()): void {
	const launched = detached_launch.launch(
		{ argv: FLUSH_ARGV, cwd, log_path: log_path_of(cwd) },
		report_failure,
	)

	if (launched.kind === 'failed') report_failure(launched.note)
}

export const backlog_drain_flush = { OPTION, flush, start }
