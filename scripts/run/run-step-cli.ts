#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { hook_decision } from '#scripts/josh/hook-decision'
import { find_package_directory } from '#scripts/josh/josh-logic'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_carry, type CarryRead } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_prep_cli } from './run-prep-cli'
import { run_step, type StepInput } from './run-step'

// `josh run:step <N>` — print the run's next single action, computed from the event stream, the carry
// record and the issue state (joshuafolkken/kit#2248). It reads exactly those three, never the
// conversation: the issue facts through `run:prep`'s own gather (so this and `run:next` never answer
// from different reads), the newest event off the stream, and the carry record's kind. The reader runs
// the printed line, returns the result through `run:event`, and asks again — the loop `run:step`
// exists to close.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:step <issue-number>'
// The opt-in switch that gates the end-of-run retrospective (joshuafolkken/kit#2370). Read here rather
// than in `run-step.ts` so the position logic stays a pure function of its input; it defaults off, so an
// unset variable prints no retrospective step.
const RETROSPECTIVE_ENV_KEY = 'JOSH_RETROSPECTIVE'

interface RunReads {
	carry_kind: CarryRead['kind']
	is_retrospective_done: boolean
	last_event: string | undefined
}

// The run-level reads, keyed on the common git directory both the carry and the event stream share. A
// directory that cannot be read leaves the position unknowable, which `next_action` answers `unknown`.
function read_run(directory: string | undefined): RunReads {
	if (directory === undefined) {
		return { carry_kind: 'unreadable', is_retrospective_done: false, last_event: undefined }
	}

	const carry = run_carry.read_carry(run_carry.carry_path(directory))
	const last = run_event_stream.read_last(run_event_stream.target_of(directory))

	return {
		carry_kind: carry.kind,
		is_retrospective_done: run_carry.retrospective_done_of(carry),
		last_event: last?.kind,
	}
}

async function gather(issue_number: string): Promise<StepInput> {
	const reads = await run_prep_cli.gather(issue_number)
	const parts = run_prep_cli.to_parts(issue_number, reads)
	const run_reads = read_run(await run_carry.repository_directory())

	return {
		issue_number,
		state: parts.state?.state,
		is_human_review: parts.state?.is_human_review ?? false,
		latest_scope: parts.latest_scope,
		last_event: run_reads.last_event,
		carry_kind: run_reads.carry_kind,
		is_retrospective_done: run_reads.is_retrospective_done,
		is_lane_child: lane_child_marker.is_child_of(process.cwd()),
		is_consumer: doctor_consumer.is_kit_consumer(find_package_directory(process.cwd())),
		is_retrospective_enabled: hook_decision.is_switch_opt_in(RETROSPECTIVE_ENV_KEY),
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = run_prep_cli.parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const input = await gather(issue_number)

	console.info(run_step.next_action(input).line)

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

const run_step_cli = { USAGE, gather, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_step_cli }
