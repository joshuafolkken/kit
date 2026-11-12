import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { cli_flags } from '#scripts/lib/cli-flags'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { DriveState } from './backlog-drive'

// The `josh backlog:drive` flags — read into a `DriveContext`, and written back as the `resume:` line —
// split out of `backlog-drive-cli.ts` when it neared its line limit.
// `backlog_drive_cli` re-exports `parse` and `resume_line` under the names they always had, so the move
// changed no call site and no suite that reads them through `backlog_drive_cli`.

const LIST_SEPARATOR = ','
const USAGE =
	'Usage: josh backlog:drive [--owner <pid>] [--active <ISO-8601>] [--max <n>] [--idle <minutes>] [--only] [--exclude <n>[,<n>...]] [--await <n>[,<n>...]] [--window <minutes>] [--stopped <n>]'

const OPTIONS = {
	active: { type: 'string' },
	await: { type: 'string' },
	exclude: { type: 'string' },
	idle: { type: 'string' },
	max: { type: 'string' },
	only: { type: 'boolean' },
	owner: { type: 'string' },
	stopped: { type: 'string' },
	'triage-owed': { type: 'boolean' },
	'triage-pid': { type: 'string' },
	'triage-start': { type: 'string' },
	window: { type: 'string' },
} as const
// A start time read from `ps` holds spaces, and the resume line is split on them.
const START_SPACE = ' '
const START_SPACE_TOKEN = '_'

interface DriveContext {
	owner: string
	active: string | undefined
	// Flags forwarded to `backlog:offer` unchanged — the declared budgets.
	forwarded: ReadonlyArray<string>
	exclude: ReadonlyArray<string>
	awaited: ReadonlyArray<string>
	window_ms: number | undefined
	window: string | undefined
	is_only: boolean
	// The child whose merge answered `stop` before the hand-back: the resumed run starts already stopping.
	stopped: string | undefined
	is_triage_owed?: boolean
	// The triage session the supervisor launched beside the driver (joshuafolkken/kit#7120).
	triage_pid?: number
	// That session's process start time, so a reissued pid never reads as it (`process_identity`).
	triage_start?: string
}

type TriageFlags = Pick<DriveContext, 'is_triage_owed' | 'triage_pid' | 'triage_start'>

type Values = Partial<Record<Exclude<keyof typeof OPTIONS, 'only' | 'triage-owed'>, string>> &
	Partial<Record<'only' | 'triage-owed', boolean>>

function beside_session(values: Values): Pick<DriveContext, 'triage_pid' | 'triage_start'> {
	const pid = cli_flags.to_count(values['triage-pid'])
	if (pid === undefined) return {}

	const start = values['triage-start']?.split(START_SPACE_TOKEN).join(START_SPACE)

	return start === undefined ? { triage_pid: pid } : { triage_pid: pid, triage_start: start }
}

function triage_flags(values: Values): TriageFlags {
	const owed = values['triage-owed'] === true ? { is_triage_owed: true } : {}

	return { ...owed, ...beside_session(values) }
}

function read_values(argv: ReadonlyArray<string>): Values | undefined {
	return cli_flags.parse_or_undefined({ args: [...argv], options: OPTIONS, strict: true })?.values
}

// A comma list of issue numbers; one entry that is not an issue number refuses the whole list.
function to_issues(raw: string | undefined): ReadonlyArray<string> | undefined {
	if (raw === undefined) return []

	const issues = raw.split(LIST_SEPARATOR)

	return issues.some((issue) => !issue_number_shape.is_issue_number(issue)) ? undefined : issues
}

function forwarded_of(values: Values): ReadonlyArray<string> | undefined {
	const pairs = (['max', 'idle'] as const).filter((name) => values[name] !== undefined)

	if (pairs.some((name) => cli_flags.to_count(values[name]) === undefined)) return undefined

	return pairs.flatMap((name) => [`--${name}`, values[name] ?? ''])
}

// An absent window is no bound; a present one must be a count, which `is_count_or_absent` checks first.
function window_of(raw: string | undefined): number | undefined {
	return raw === undefined ? undefined : Number(raw) * MS_PER_MINUTE
}

function is_count_or_absent(raw: string | undefined): boolean {
	return raw === undefined || cli_flags.to_count(raw) !== undefined
}

function is_valid_single(values: Values): boolean {
	const is_valid_stopped =
		values.stopped === undefined || issue_number_shape.ISSUE_NUMBER_PATTERN.test(values.stopped)
	const is_valid_counts =
		is_count_or_absent(values.window) && is_count_or_absent(values['triage-pid'])

	return is_valid_stopped && is_valid_counts
}

// Omitted, the pid the session exports (`agent_session_environment.own_session_pid`).
function owner_of(values: Values | undefined): string | undefined {
	const owner = values?.owner ?? agent_session_environment.own_session_pid()?.toString()

	return cli_flags.to_count(owner) === undefined ? undefined : owner
}

function to_context(values: Values, owner: string): DriveContext | undefined {
	if (!is_valid_single(values)) return undefined

	const forwarded = forwarded_of(values)
	const exclude = to_issues(values.exclude)
	const awaited = to_issues(values.await)

	if (forwarded === undefined || exclude === undefined || awaited === undefined) return undefined

	const window_ms = window_of(values.window)

	return {
		owner,
		active: values.active,
		forwarded,
		exclude,
		awaited,
		window_ms,
		window: values.window,
		is_only: values.only === true,
		stopped: values.stopped,
		...triage_flags(values),
	}
}

function parse(argv: ReadonlyArray<string>): DriveContext | undefined {
	const values = read_values(argv)
	const owner = owner_of(values)

	return values === undefined || owner === undefined ? undefined : to_context(values, owner)
}

// The flags that name the triage session beside the driver, for the resume line and the supervisor
// that launched it (`run-wake-resume.ts` → `name_beside`).
function beside_flags(pid: number | undefined, start: string | undefined): ReadonlyArray<string> {
	if (pid === undefined) return []

	const named = ['--triage-pid', String(pid)]

	if (start === undefined) return named

	return [...named, '--triage-start', start.split(START_SPACE).join(START_SPACE_TOKEN)]
}

function triage_line_flags(state: DriveState): ReadonlyArray<string> {
	const owed = state.is_triage_owed === true ? ['--triage-owed'] : []

	return [...owed, ...beside_flags(state.triage_pid, state.triage_start)]
}

function resume_line(state: DriveState, context: DriveContext): string {
	const exclude = [...new Set([...context.exclude, ...state.exclude])]
	const flags = ['--owner', context.owner, '--active', state.active, ...context.forwarded]

	if (exclude.length > 0) flags.push('--exclude', exclude.join(LIST_SEPARATOR))
	if (context.window !== undefined) flags.push('--window', context.window)
	if (state.stopped_by !== undefined) flags.push('--stopped', state.stopped_by)

	return `resume: ${[...flags, ...triage_line_flags(state)].join(' ')}`
}

const backlog_drive_args = {
	USAGE,
	beside_flags,
	parse,
	resume_line,
}

export { backlog_drive_args }
export type { DriveContext }
