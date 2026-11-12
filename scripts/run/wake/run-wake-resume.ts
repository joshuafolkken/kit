import { backlog_drive_args } from '#scripts/backlog/backlog-drive-args'
import type { JoshResult } from '#scripts/josh/josh-run'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import type { RunCarry } from '#scripts/run/carry/run-carry'

// **The driver's `resume:` line carries what its next pass must not lose** (joshuafolkken/kit#6530):
// the exclusions and the stop a pass recorded, which the carried invocation cannot say. The
// supervisor re-drives a `merge busy` from it and keeps it beside the record for the pass after a
// hand-back, so a state one child left survives a later child's retry.
//
// **It is kept beside the record, keyed to it**, rather than in it: the key is the record's start and
// invocation, so a later run of the same invocation — a new `started_at` — never reads it, and each
// completed driver run replaces it, so a state a pass consumed is not replayed.
const RESUME_PREFIX = 'resume: '
const OWNER_FLAG = '--owner'
// Dropped with their values: the driver runs as the supervisor that has just claimed the record, and
// `--idle` is the one budget not carried, so its watch begins again each pass
// (`docs/maintainers/backlogrun-driver.md`).
const DROPPED_FLAGS: ReadonlySet<string> = new Set([OWNER_FLAG, '--active'])
const SUFFIX = '.resume'
const SUCCESS = 0

function resume_of(out: string): string | undefined {
	return out.split('\n').find((line) => line.startsWith(RESUME_PREFIX))
}

function is_dropped(flags: ReadonlyArray<string>, index: number): boolean {
	return [flags[index], flags[index - 1]].some(
		(flag) => flag !== undefined && DROPPED_FLAGS.has(flag),
	)
}

// The line must name its owner: `parse` would otherwise fill an absent one from the environment.
function state_flags(line: string): ReadonlyArray<string> | undefined {
	const flags = line.slice(RESUME_PREFIX.length).split(' ')

	if (!flags.includes(OWNER_FLAG) || backlog_drive_args.parse(flags) === undefined) return undefined

	return flags.filter((_flag, index) => !is_dropped(flags, index))
}

function is_valid(line: string): boolean {
	return state_flags(line) !== undefined
}

// The state flags follow the invocation's, and `parse` reads the last of a repeated flag, so the
// resumed state overrides while `--only` and the budgets the line does not repeat stay.
function resumed_args(
	base: ReadonlyArray<string>,
	line: string | undefined,
): ReadonlyArray<string> | undefined {
	const state = line === undefined ? undefined : state_flags(line)

	return state === undefined ? undefined : [...base, ...state]
}

function key_of(carry: RunCarry): string {
	return `${carry.started_at} ${carry.invocation}`
}

function resume_path(target: string): string {
	return `${target}${SUFFIX}`
}

function stored(target: string, carry: RunCarry): string | undefined {
	const [key, line] = stamp_file.read_stamp_text(resume_path(target))?.split('\n') ?? []

	return key === key_of(carry) ? line : undefined
}

// A run with no resume line clears the stored one, so a consumed state is never replayed.
function remember(target: string, carry: RunCarry, result: JoshResult): void {
	if (result.code !== SUCCESS) return

	const line = resume_of(result.out)
	const source = resume_path(target)

	if (line === undefined) stamp_file.remove_stamp(source)
	else stamp_file.replace_text_stamp(source, `${key_of(carry)}\n${line}`)
}

// The triage session launched beside the driver is named on the kept line, so every later driver run
// holds back the answers that triage could change until its process has ended
// (joshuafolkken/kit#7120). The `triage` hand-back that launched it left the line this extends. The
// process's start time rides with its pid, so a reissued pid never holds the driver back.
function name_beside(target: string, carry: RunCarry, pid: number): void {
	const line = stored(target, carry)
	if (line === undefined) return

	const flags = backlog_drive_args.beside_flags(pid, process_identity.read_start(pid))

	stamp_file.replace_text_stamp(resume_path(target), `${key_of(carry)}\n${line} ${flags.join(' ')}`)
}

const run_wake_resume = { is_valid, name_beside, remember, resume_of, resumed_args, stored }

export { run_wake_resume }
