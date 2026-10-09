#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_read_cli, type BlockRead } from '#scripts/issue/issue-read-cli'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_preflight } from '#scripts/run/ship/run-ship-preflight'
import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import { run_prep, type PrepParts } from './run-prep'
import { run_prep_locate } from './run-prep-locate'

// `josh run:prep <N>` — one call for the reads a `fullrun` makes before its first edit:
// the issue body and comments (`issue:read`), the state, labels and
// `human_review` line (`issue:state`), the dependency-update scope (`latest:scope`), and where the
// paths and identifiers the body names occur in code (`run-prep-locate.ts`). Each is
// reused rather than reproduced, and the two body reads run concurrently, so three round trips become
// one.
//
// **The hold and the cost check stay their own calls.** `run:hold` writes the working-tree record and
// `cost --over` reads the session, not the issue; folding a side effect and a session read into a
// bundle of issue reads would make one command answer three unrelated questions. They are batched in
// the same turn as this one instead.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:prep <issue-number>'
const LANE_SKIP_SCOPE = 'not asked'
const LANE_SKIP_REASON =
	'a dispatched lane child does not run josh latest — the parent does, once per session'

interface LatestDecision {
	scope: string
	reason: string
}

interface PrepReads {
	content: BlockRead
	state: StateRead
	latest: LatestDecision
	has_changes: boolean
	locations: string
	ship_problems: ReadonlyArray<string>
}

// Exactly one issue number, or the call is refused: `run:prep` prepares one run, and a second number
// would print a second issue's body a caller reads as this run's own.
function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1 || !ISSUE_NUMBER_PATTERN.test(first)) {
		return undefined
	}

	return first
}

// One note for a read that produced nothing, naming which of the two it was — the same distinction
// `issue:read` and `issue:state` keep, so a bundled failure still tells a retry from an answer.
function failure_note(issue_number: string, kind: string): string {
	return `(issue ${session_cite.issue(issue_number)} not bundled: ${kind})`
}

// A dispatched lane child never runs `josh latest` — the parent does it once per session
// (`backlogrun.md` → "`josh latest` runs once per session, not once per child"), so computing the
// dependency scope inside a lane would report a decision nothing there acts on. Skip the read and say
// so, rather than printing a `required` a lane never honors.
function latest_decision(): LatestDecision {
	if (lane_child_marker.is_child_of(process.cwd())) {
		return { scope: LANE_SKIP_SCOPE, reason: LANE_SKIP_REASON }
	}

	return latest_scope_cli.decide()
}

// Whether a dispatched lane child's tree holds uncommitted work. A lane child that popped
// its parked work back and then found its issue closed is the one position that work is lost from —
// the lane is removed by force — so only a lane is asked; a person's own checkout keeps its unrelated
// edits out of the verdict. A status that cannot be read reports none, leaving the verdict unchanged.
async function lane_has_changes(): Promise<boolean> {
	if (!lane_child_marker.is_child_of(process.cwd())) return false

	try {
		return await git_stash.has_changes(process.cwd())
	} catch (error) {
		error_text.trace_swallowed('run_prep_cli.lane_has_changes', error)

		return false
	}
}

async function gather(issue_number: string): Promise<PrepReads> {
	const [content, state, has_changes, ship_problems] = await Promise.all([
		issue_read_cli.read_block(issue_number),
		issue_state_cli.read_issue(issue_number),
		lane_has_changes(),
		run_ship_preflight.ahead(issue_number),
	])
	// Located from the body just read, so it waits for that read rather than joining the batch above.
	const locations = await run_prep_locate.locate(content.kind === 'ok' ? content.block : '')

	return { content, state, latest: latest_decision(), has_changes, locations, ship_problems }
}

function content_body(issue_number: string, content: BlockRead): string {
	return content.kind === 'ok' ? content.block : failure_note(issue_number, content.kind)
}

function to_parts(issue_number: string, reads: PrepReads): PrepParts {
	const state = reads.state.kind === 'state' ? reads.state.state : undefined
	const state_failure = state === undefined ? failure_note(issue_number, reads.state.kind) : ''

	return {
		issue_number,
		content_body: content_body(issue_number, reads.content),
		state,
		state_failure,
		latest_scope: reads.latest.scope,
		latest_reason: reads.latest.reason,
		has_changes: reads.has_changes,
		locations: reads.locations,
		ship_problems: reads.ship_problems,
	}
}

// Non-zero when either issue read failed, exactly as `issue:read` and `issue:state` each exit, so a
// bundle missing a part is never read as a complete one.
function exit_code(reads: PrepReads): number {
	const is_complete = reads.content.kind === 'ok' && reads.state.kind === 'state'

	return is_complete ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reads = await gather(issue_number)
	const report = run_prep.format_report(to_parts(issue_number, reads))

	console.info(session_cite.text(report))

	return exit_code(reads)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

// `gather` and `to_parts` are exported so `run:next` reads the same state from the same three reads
// rather than growing a second copy of the gather.
const run_prep_cli = { gather, parse_number, run, to_parts }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_prep_cli }
