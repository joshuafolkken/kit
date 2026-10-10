import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ancestor_directories } from '#scripts/lib/ancestor-directories'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { run_progress } from './run-progress'

// Where the silence interval comes from, and in what order.
//
// **The repository carries a setting of its own.** `JOSH_PROGRESS_INTERVAL_MINUTES` is read from
// `.env`, which is never committed, so it cannot reach other machines or cloud sessions.
// `josh.progress_interval_minutes` in `package.json` is
// committed, is per repository rather than per toolkit, and is read through the same reader both
// halves of the mechanism already share — the watcher before it prints, and the `early-heartbeat` row
// before it allows an arm. A guard that could disagree with the watcher it guards is worse than no
// guard, so there is one order and both sides ask for it here.
//
// **The environment still outranks the file**, because a person's own machine is allowed to differ
// from what the repository asks for, and `--interval` outranks both for the watcher alone — a hook has
// no command line to read.
//
// **The nearest declaring `package.json` wins, searched upward.** The two callers do not stand in the
// same directory — `pnpm` runs a script from the package root and Claude Code runs a hook from the
// project root — and in a workspace those are different files, only one of which declares a cadence.
// Reading the working directory alone would let the guard enforce the repository's interval while the
// watcher it guards kept the default, which is the one state this module exists to prevent.

const PACKAGE_FILE = 'package.json'

// Unknown keys are stripped rather than rejected: this reads a whole `package.json`, and every other
// field in it is none of this module's business. A present-but-unusable interval fails the parse and
// falls through, which is the same answer an unusable environment variable already gets.
const package_schema = z.object({
	josh: z.object({ progress_interval_minutes: z.number().positive() }).optional(),
})

function read_declared_minutes(directory: string): number | undefined {
	try {
		const raw = readFileSync(path.join(directory, PACKAGE_FILE), 'utf8')

		return json_value.parse_with(raw, package_schema)?.josh?.progress_interval_minutes
	} catch {
		return undefined
	}
}

function read_package_minutes(start: string): number | undefined {
	for (const directory of ancestor_directories.list(start)) {
		const minutes = read_declared_minutes(directory)

		if (minutes !== undefined) return minutes
	}

	return undefined
}

function to_ms(minutes: number | undefined): number | undefined {
	return minutes === undefined ? undefined : minutes * run_progress.MS_PER_MINUTE
}

/**
 * The interval in force: a hand-typed value, then the environment, then the repository, then twenty.
 *
 * Each step answers `undefined` for anything that is not a positive number, so an unusable value falls
 * through to the next source rather than throwing — this runs unattended, and dying on a typo in an
 * optional setting removes the reporting the setting was there to tune.
 */
function resolve_interval_ms(raw: string | undefined, directory: string = process.cwd()): number {
	return (
		to_ms(run_progress.minutes_from(raw)) ??
		to_ms(run_progress.minutes_from(process.env[run_progress.INTERVAL_KEY])) ??
		to_ms(read_package_minutes(directory)) ??
		run_progress.DEFAULT_INTERVAL_MS
	)
}

/**
 * The **floor** the guard enforces — the same order with no command line in it.
 *
 * It is deliberately not the watcher's effective interval: the watcher takes `--interval` on top, and
 * a hook has no flag to read. A `--interval` above the floor makes the watcher quieter than the guard
 * requires, which is the harmless direction; below it, the watcher prints more often than the guard
 * would let a run arm a timer for — so a run that wants a different cadence sets the environment
 * variable or the committed field, which both sides read.
 */
function configured_interval_ms(directory: string = process.cwd()): number {
	return resolve_interval_ms(undefined, directory)
}

const run_progress_config = {
	PACKAGE_FILE,
	configured_interval_ms,
	read_package_minutes,
	resolve_interval_ms,
}

export { run_progress_config }
