#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { cli_flags } from '#scripts/lib/cli-flags'
import { INSTALL_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'

// `josh lane:launch <issue> [--stash <message>]` — one composite command for a `backlogrun` lane-start
// event. Opening one lane was four to six turns of the parent: `lane:open`,
// then — only the first lane, and only when `josh latest` had stashed — `stash:pop` and a re-install,
// then `lane:dispatch`. This collapses them into one call that returns the child's pid, or a refusal,
// the same shape `lane:dispatch` alone has.
//
// **It is a thin layer over the existing commands**, shelling out to each so their guards, refusals
// and messages are reused rather than cloned — `lane:open`'s cut-session guard and its `full` /
// `already-open` refusals, `stash:pop`'s message-matched pop, `lane:dispatch`'s in-progress claim and
// warning. Their explanations stream through to stderr; the child's pid is the one thing on stdout.
// A lane a park kept is the one `already-open` it steps past — `lane_directory` below.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const PNPM = 'pnpm'
const ISSUE_PATTERN = /^[1-9]\d*$/u

const USAGE = 'Usage: josh lane:launch <issue-number> [--stash <message>]'

const OPTIONS = { stash: { type: 'string' } } as const

// The stash message is present only for the first lane — the caller passes `--stash` there and nowhere
// else, so "only the first lane pops and re-installs" is preserved by which invocation carries it.
interface LaunchContext {
	issue: string
	stash: string | undefined
}

function read_context(argv: ReadonlyArray<string>): LaunchContext | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined

	const [issue, ...rest] = parsed.positionals

	if (issue === undefined || rest.length > 0 || !ISSUE_PATTERN.test(issue)) return undefined

	return { issue, stash: parsed.values.stash }
}

// The pop brought in the `pnpm-lock.yaml` `josh latest` rewrote, so this one lane installs a second
// time against it. Output is captured and surfaced only on failure, so the composite's stdout stays
// the child's pid alone.
async function install(directory: string): Promise<boolean> {
	const result = await execa(PNPM, ['--dir', directory, 'install', '--frozen-lockfile'], {
		reject: false,
		timeout: INSTALL_TIMEOUT_MS,
	})

	if ((result.exitCode ?? FAILURE_EXIT_CODE) === SUCCESS_EXIT_CODE) return true

	console.error(result.stderr === '' ? result.stdout : result.stderr)

	return false
}

// The first lane pops the shared stash and re-installs against the lock it brought in; a pop that
// refused (`no-match` / `ambiguous`) stops the lane rather than dispatching onto an unprepared tree.
// A caller without `--stash` skips both, which is every lane after the first.
async function prepare(stash: string | undefined, directory: string): Promise<boolean> {
	if (stash === undefined) return true

	const popped = await josh_command.josh_run(
		['stash:pop', stash, '--dir', directory],
		should_forward_stderr,
	)

	if (popped.code !== SUCCESS_EXIT_CODE) return false

	return await install(directory)
}

// Where the chain ended. `unopened` is a `lane:open` refusal — no lane was taken; `failed` is a step
// after it, which leaves the opened lane holding a seat, so a caller cannot read the two alike.
type LaunchOutcome = { kind: 'launched'; pid: string } | { kind: 'unopened' } | { kind: 'failed' }

const UNOPENED: LaunchOutcome = { kind: 'unopened' }
const FAILED: LaunchOutcome = { kind: 'failed' }

async function close_if_vacant(lane: LaneInfo | undefined): Promise<void> {
	if (lane === undefined || !(await lane_vacant.is_vacant(lane))) return

	await josh_command.josh_run(['lane:close', lane.issue], should_forward_stderr)
}

// **A lane a park kept open is resumed, not reopened**. A child parked before
// its commit leaves its uncommitted work in its lane, and `lane:open` refuses that lane as
// `already-open` — so the released child is dispatched into the kept tree instead. **Only a lane a
// child was already dispatched into counts as kept**: `lane:dispatch` records the child's output in the
// lane's `.env`, and a lane whose install failed never got that far, so it still goes through
// `lane:open` and its refusal. So does a stranded lane, whose `.env` is gone with its tree.
//
// **A lane no child was dispatched into and that holds nothing is closed and opened afresh**
// — a run cut between the open and the dispatch leaves one. It is reopened
// rather than reused because nothing recorded whether its install finished. A lane with work or a live
// process in it still meets `lane:open`'s refusal.
async function lane_directory(issue: string): Promise<string | undefined> {
	const kept = await lane_registry.find_open_lane(issue)

	if (kept?.output !== undefined) return kept.directory

	await close_if_vacant(kept)

	const opened = await josh_command.josh_run(['lane:open', issue], should_forward_stderr)

	return opened.code === SUCCESS_EXIT_CODE ? opened.out : undefined
}

// The launch chain in-process. The CLI prints the pid; `backlog:drive` launches through this same
// chain.
async function launch_lane(context: LaunchContext): Promise<LaunchOutcome> {
	const directory = await lane_directory(context.issue)

	if (directory === undefined) return UNOPENED

	if (!(await prepare(context.stash, directory))) return FAILED

	const dispatched = await josh_command.josh_run(
		['lane:dispatch', context.issue],
		should_forward_stderr,
	)

	return dispatched.code === SUCCESS_EXIT_CODE ? { kind: 'launched', pid: dispatched.out } : FAILED
}

async function launch(context: LaunchContext): Promise<number> {
	const outcome = await launch_lane(context)

	if (outcome.kind !== 'launched') return FAILURE_EXIT_CODE

	console.info(outcome.pid)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const context = read_context(argv)

	if (context === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await launch(context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_launch_cli = { launch_lane, read_context, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { LaunchContext, LaunchOutcome }
export { lane_launch_cli }
