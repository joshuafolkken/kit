import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_carry, type CarryRead } from './run-carry'
import { run_invocation } from './run-invocation'
import type { DriveResult } from './run-wake-loop'

const SUCCESS = 0
const FIRST_LINE = 0
const RESUME_PREFIX = 'resume: '
const DETAILS_TAIL_LENGTH = 2048
const TRUNCATION_MARK = '... '

function driver_args(invocation: string): ReadonlyArray<string> | undefined {
	const rebuilt = run_invocation.rebuild(invocation)
	if (rebuilt !== invocation) return undefined
	const named_count = run_invocation.issue_numbers(rebuilt)?.length ?? 0

	return [
		'backlog:drive',
		'--owner',
		String(process.pid),
		...rebuilt.split(' ').slice(1 + named_count),
	]
}

function is_final_stop(verdict: string | undefined, read: CarryRead): boolean {
	return verdict?.startsWith('stop') === true && read.kind === 'none'
}

// **The details are the driver's whole stderr, so only their tail is handed on, and it goes last**
// (joshuafolkken/kit#2931). The stderr carries every command the driver ran since it started, which
// after a long run is tens of kilobytes — far past what `is_safe_value` lets into an argv element. Its
// tail is where the reason for stopping is; placing it last means the cap `wake_argv` applies to the
// whole prompt can only ever cut into the details, never the verdict, the resume line or the epic note.
function details_tail(details: string): string {
	return details.length > DETAILS_TAIL_LENGTH
		? `${TRUNCATION_MARK}${details.slice(-DETAILS_TAIL_LENGTH)}`
		: details
}

function handoff_material(verdict: string, resume: string, details: string): string {
	const context = details === '' ? '' : `\nDetails: ${details_tail(details)}`
	const epic = verdict.startsWith('epic #')
		? '\nThe named item is an epic. Follow backlogrun-steps.md named epic procedure; do not launch the epic root as a fullrun child. After all children merge or park, record the root with pnpm josh run:carry --done <epic-number> --owner "$PPID" before continuing to the next named item.'
		: ''

	return `Driver result: ${verdict}\n${resume}${epic}${context}`
}

function driver_result(out: string, read: CarryRead, details = ''): DriveResult {
	const lines = out.split('\n')
	const verdict = lines[FIRST_LINE]

	if (is_final_stop(verdict, read)) return { kind: 'finished' }
	const resume = lines.find((line) => line.startsWith(RESUME_PREFIX))

	if (verdict === undefined || resume === undefined) {
		return { kind: 'failed', note: `backlog:drive returned an incomplete result: ${out}` }
	}

	return { kind: 'judgment', material: handoff_material(verdict, resume, details) }
}

function read_result(result: JoshResult, target: string): DriveResult {
	if (result.code !== SUCCESS) return { kind: 'failed', note: result.err ?? result.out }

	return driver_result(result.out, run_carry.read_carry(target), result.err)
}

function claim_record(target: string, invocation: string): boolean {
	const current = run_carry.read_carry(target)
	if (current.kind !== 'carried' || current.carry.invocation !== invocation) return false
	if (current.carry.is_handed_off !== true && run_carry.is_owner_live(current.carry)) return false

	return run_carry.adopt_carry(target, current.carry, run_carry.owner_of(process.pid)) !== undefined
}

async function drive(target: string): Promise<DriveResult> {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return { kind: 'failed', note: 'The carry record changed.' }

	const args = driver_args(read.carry.invocation)
	if (args === undefined) return { kind: 'failed', note: 'The carried invocation is invalid.' }

	if (!claim_record(target, read.carry.invocation)) {
		return { kind: 'failed', note: 'The driver could not claim the carry record.' }
	}

	const result = await josh_command.josh_run(args, true)

	return read_result(result, target)
}

export const run_wake_driver = { drive, driver_args, driver_result }
