#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { hook_decision } from '#scripts/josh/hook-decision'
import { find_package_directory } from '#scripts/josh/josh-logic'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_reap } from '#scripts/lane/lane-reap'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_headless } from './run-headless'
import { run_prep, type PrepParts } from './run-prep'
import { run_prep_cli } from './run-prep-cli'
import { run_retrospective } from './run-retrospective'
import { run_step, type StepInput } from './run-step'

// `josh run:step <N>` — print the run's next single action, computed from the event stream, the carry
// record and the issue state. It reads exactly those three, never the
// conversation: the issue facts through `run:prep`'s own gather (so this and `run:next` never answer
// from different reads), the newest event off the stream, and the carry record's kind. The reader runs
// the printed line, returns the result through `run:event`, and asks again — the loop `run:step`
// exists to close.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:step <issue-number>'

interface RunReads {
	carry_kind: CarryRead['kind']
	is_retrospective_done: boolean
	is_at_cut_cap: boolean
	is_handed_off: boolean
	is_merge_owed: boolean
	last_event: string | undefined
}

// **A hand-off stops only the session that declared the record**. The record is
// one per repository, so a `fullrun #M` a person starts in a fresh conversation beside a `backlogrun`
// waiting for its successor reads the same handed-off mark — and would be told to stop on every step.
// The owner is `--owner "$PPID"`, an ancestor of this process only in the session that took the cut.
function is_handed_off_here(carry: CarryRead): boolean {
	if (carry.kind !== 'carried' || carry.carry.is_handed_off !== true) return false

	return run_headless.is_owned_here(carry.carry, lane_reap.own_ancestry)
}

const UNREADABLE_RUN: RunReads = {
	carry_kind: 'unreadable',
	is_retrospective_done: false,
	is_at_cut_cap: false,
	is_handed_off: false,
	is_merge_owed: false,
	last_event: undefined,
}

// The run-level reads, keyed on the common git directory both the carry and the event stream share. A
// directory that cannot be read leaves the position unknowable, which `next_action` answers `unknown`.
function read_run(
	directory: string | undefined,
	issue_number: string,
	is_lane_child: boolean,
): RunReads {
	if (directory === undefined) return UNREADABLE_RUN

	const carry = run_carry.read_carry(run_carry.carry_path(directory))
	const events = run_event_stream.read_events(run_event_stream.target_of(directory))
	// The last event *within this invocation's scope*, not the raw newest one: a stale event a previous
	// invocation left on the stream — an old `child-launch`, say — must not be read as this run's
	// position. Another issue's detached ship supervisor is left out the same way, and so — for a lane
	// child — is every event that does not name its own issue.
	const scope = run_event_scope.scope_of(carry)
	const last = run_event_scope.last_issue_event(events, scope, issue_number, is_lane_child)

	return {
		carry_kind: carry.kind,
		is_retrospective_done: run_carry.retrospective_done_of(carry),
		is_at_cut_cap: carry.kind === 'carried' && run_headless.is_cut_capped(carry.carry),
		is_handed_off: is_handed_off_here(carry),
		is_merge_owed: run_event_scope.is_merge_owed(events, scope, issue_number),
		last_event: last?.kind,
	}
}

interface Gathered {
	input: StepInput
	ship_problems: ReadonlyArray<string>
}

function step_input(parts: PrepParts, run_reads: RunReads, is_lane_child: boolean): StepInput {
	return {
		issue_number: parts.issue_number,
		state: parts.state?.state,
		is_human_review: parts.state?.is_human_review ?? false,
		latest_scope: parts.latest_scope,
		last_event: run_reads.last_event,
		carry_kind: run_reads.carry_kind,
		is_retrospective_done: run_reads.is_retrospective_done,
		is_at_cut_cap: run_reads.is_at_cut_cap,
		is_handed_off: run_reads.is_handed_off,
		is_merge_owed: run_reads.is_merge_owed,
		is_lane_child,
		is_consumer: doctor_consumer.is_kit_consumer(find_package_directory(process.cwd())),
		// Read here rather than in `run-step.ts` so the position logic stays a pure function of its input.
		is_retrospective_enabled: run_retrospective.is_enabled(),
		has_changes: parts.has_changes,
		has_completion_callback: agent_role_profile.has_completion_callback(),
	}
}

async function gather(issue_number: string): Promise<Gathered> {
	const reads = await run_prep_cli.gather(issue_number)
	const parts = run_prep_cli.to_parts(issue_number, reads)
	const is_lane_child = lane_child_marker.is_child_of(process.cwd())
	const run_reads = read_run(await run_carry.repository_directory(), issue_number, is_lane_child)

	return { input: step_input(parts, run_reads, is_lane_child), ship_problems: parts.ship_problems }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = run_prep_cli.parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const { input, ship_problems } = await gather(issue_number)

	console.info(run_step.next_action(input).line)
	// On stderr, so stdout stays the one action line: what `josh ship` would
	// refuse on is said at every step, while it is still cheap to meet.
	if (ship_problems.length > 0) console.error(run_prep.ship_body(ship_problems))

	// A state that could not be read exits non-zero, exactly as `run:prep` and `run:next` exit on the
	// same failure, so a position missing its issue state is never read as a confident next step.
	return input.state === undefined ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	// Load `.env` on the real command path only, so `JOSH_RETROSPECTIVE` set there reaches `gather`; the
	// unit tests call `run`/`gather` directly and are never swayed by a developer's `.env`.
	hook_decision.load_environment_file()
	process.exitCode = await run(argv)
}

const run_step_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_step_cli }
