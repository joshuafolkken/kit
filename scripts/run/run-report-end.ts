import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'

// `josh run:report --end` — the end-of-run record in one call (joshuafolkken/kit#5639): the report,
// then `run:carry --end` (with `--stopped` on a stopping run), then `run:wake --stop`, in that order.
// The report goes first because it scopes by the record `--end` removes (joshuafolkken/kit#2393); a
// failed stage stops the sequence and names itself, so a record is never ended unreported.
//
// The carry and wake stages run as `pnpm josh` subprocesses: `run-carry-cli.ts` carries a main guard,
// which a bundle would fire for every command that imported it (joshuafolkken/kit#4186).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const END_FLAG = '--end'
const STOPPED_FLAG = '--stopped'
const STOPPED_LENGTH = 3
const REPORT_STAGE = 'run:report'
const CARRY_STAGE = 'run:carry --end'
const WAKE_STAGE = 'run:wake --stop'
const LANE_CHILD_NOTE =
	'run:report --end: a lane child never ends the run — the record and the supervisor are the backlogrun parent’s.'
const should_forward_stderr = true

type Step = () => Promise<number>

interface Stage {
	name: string
	run: Step
}

interface EndRequest {
	stopped?: string
}

function stopped_reason(argv: ReadonlyArray<string>): string | undefined {
	const [flag, stopped_flag, reason] = argv

	if (flag !== END_FLAG || stopped_flag !== STOPPED_FLAG || argv.length !== STOPPED_LENGTH) {
		return undefined
	}

	return reason === '' ? undefined : reason
}

// `--end` alone, or `--end --stopped <reason>` with a non-empty reason — the two shapes
// `run:carry --end` accepts, passed through to it.
function read_request(argv: ReadonlyArray<string>): EndRequest | undefined {
	if (argv.length === 1 && argv[0] === END_FLAG) return {}

	const stopped = stopped_reason(argv)

	return stopped === undefined ? undefined : { stopped }
}

function carry_args(stopped: string | undefined): ReadonlyArray<string> {
	if (stopped === undefined) return ['run:carry', '--end']

	return ['run:carry', '--end', '--stopped', stopped]
}

async function josh_stage(args: ReadonlyArray<string>): Promise<number> {
	const result = await josh_command.josh_run(args, should_forward_stderr)

	if (result.out !== '') process.stdout.write(`${result.out}\n`)

	return result.code
}

async function wake(): Promise<number> {
	return await josh_stage(['run:wake', '--stop'])
}

function stages_of(report: Step, stopped: string | undefined): ReadonlyArray<Stage> {
	async function carry(): Promise<number> {
		return await josh_stage(carry_args(stopped))
	}

	return [
		{ name: REPORT_STAGE, run: report },
		{ name: CARRY_STAGE, run: carry },
		{ name: WAKE_STAGE, run: wake },
	]
}

function failed_note(name: string): string {
	return `run:report --end: \`${name}\` failed, so the stages after it did not run.`
}

// A stage that throws has failed as surely as one that exits non-zero, so it is named the same way.
async function has_passed(stage: Stage): Promise<boolean> {
	try {
		return (await stage.run()) === SUCCESS_EXIT_CODE
	} catch (error) {
		console.error(error)

		return false
	}
}

// The record and the supervisor are the backlogrun parent's: the `lane-carry-conflict` rule refuses a
// child's typed `run:carry`, but never sees the subprocesses this runs, so the refusal is made here.
async function end(report: Step, request: EndRequest, directory = process.cwd()): Promise<number> {
	if (lane_child_marker.is_child_of(directory)) {
		console.error(LANE_CHILD_NOTE)

		return FAILURE_EXIT_CODE
	}

	for (const stage of stages_of(report, request.stopped)) {
		// eslint-disable-next-line no-await-in-loop -- each stage must finish before the next starts
		if (!(await has_passed(stage))) {
			console.error(failed_note(stage.name))

			return FAILURE_EXIT_CODE
		}
	}

	return SUCCESS_EXIT_CODE
}

const run_report_end = {
	CARRY_STAGE,
	END_FLAG,
	LANE_CHILD_NOTE,
	REPORT_STAGE,
	STOPPED_FLAG,
	WAKE_STAGE,
	end,
	failed_note,
	read_request,
}

export { run_report_end }
