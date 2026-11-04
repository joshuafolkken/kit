import { package_path } from '#scripts/init/init-paths'
import { session_cite } from '#scripts/issue/session-cite'
import { resolve_tsx_runner } from '#scripts/josh/josh-logic'
import { stamp_file } from '#scripts/josh/stamp-file'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { execa } from 'execa'
import { detached_launch } from './detached-launch'

const LABEL_SCRIPT = 'scripts/run/run-label-main.ts'
const SWEEP_SCRIPT = 'scripts/run/tidy/run-tidy-main.ts'
const HOLD_PARENT = 'run:entry › run:hold'

function argv(
	script: string,
	args: ReadonlyArray<string>,
): { command: string; args: Array<string> } {
	const runner = resolve_tsx_runner()

	return {
		command: runner.executable,
		args: [...runner.leading_arguments, package_path(script), ...args],
	}
}

function background(script: string, args: ReadonlyArray<string>, prefix: string): void {
	const log_path = stamp_file.stamp_path(prefix, process.cwd(), '.log')
	const result = detached_launch.launch(
		{
			argv: argv(script, args),
			cwd: process.cwd(),
			log_path,
			env: run_ship_lap.environment(HOLD_PARENT),
		},
		console.warn,
	)

	const state = result.kind === 'failed' ? result.note : `pid ${String(result.pid)}`

	console.warn(`run maintenance: ${result.kind} (${state}) — ${log_path}`)
}

async function label(issue: string): Promise<boolean> {
	const command = argv(LABEL_SCRIPT, [issue])
	const result = await execa(command.command, command.args, {
		reject: false,
		timeout: MS_PER_MINUTE,
	})

	if (result.exitCode === 0) return true

	console.warn(
		`run label: ${result.timedOut ? '60s timeout' : 'failed'}; retry queued for ${session_cite.issue(issue)}`,
	)
	background(LABEL_SCRIPT, [issue, '--retry'], `josh-run-label-retry-${issue}-`)

	return false
}

function sweep(): void {
	background(SWEEP_SCRIPT, [], 'josh-run-sweep-')
}

const run_maintenance = { label, sweep }

export { run_maintenance }
