import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import type { DriveState } from './backlog-drive'

// The `josh backlog:drive` flags — read into a `DriveContext`, and written back as the `resume:` line —
// split out of `backlog-drive-cli.ts` when it neared its line limit.
// `backlog_drive_cli` re-exports `parse` and `resume_line` under the names they always had, so the move
// changed no call site and no suite that reads them through `backlog_drive_cli`.

const MS_PER_MINUTE = 60_000
const LIST_SEPARATOR = ','
const COUNT_PATTERN = /^\d+$/u
const USAGE =
	'Usage: josh backlog:drive --owner <pid> [--active <ISO-8601>] [--max <n>] [--idle <minutes>] [--only] [--exclude <n>[,<n>...]] [--await <n>[,<n>...]] [--window <minutes>] [--stopped <n>]'

const OPTIONS = {
	active: { type: 'string' },
	await: { type: 'string' },
	exclude: { type: 'string' },
	idle: { type: 'string' },
	max: { type: 'string' },
	only: { type: 'boolean' },
	owner: { type: 'string' },
	stopped: { type: 'string' },
	window: { type: 'string' },
} as const

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
}

type Values = Partial<Record<Exclude<keyof typeof OPTIONS, 'only'>, string>> & { only?: boolean }

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

	if (pairs.some((name) => !COUNT_PATTERN.test(values[name] ?? ''))) return undefined

	return pairs.flatMap((name) => [`--${name}`, values[name] ?? ''])
}

// An absent window is no bound; a present one must be a count, which `is_valid_window` checks first.
function window_of(raw: string | undefined): number | undefined {
	return raw === undefined ? undefined : Number(raw) * MS_PER_MINUTE
}

function is_valid_window(raw: string | undefined): boolean {
	return raw === undefined || COUNT_PATTERN.test(raw)
}

function is_valid_single(values: Values): boolean {
	const is_valid_stopped =
		values.stopped === undefined || issue_number_shape.ISSUE_NUMBER_PATTERN.test(values.stopped)

	return is_valid_stopped && is_valid_window(values.window)
}

function owner_of(values: Values | undefined): string | undefined {
	const owner = values?.owner

	return owner !== undefined && COUNT_PATTERN.test(owner) ? owner : undefined
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
	}
}

function parse(argv: ReadonlyArray<string>): DriveContext | undefined {
	const values = read_values(argv)
	const owner = owner_of(values)

	return values === undefined || owner === undefined ? undefined : to_context(values, owner)
}

function resume_line(state: DriveState, context: DriveContext): string {
	const exclude = [...new Set([...context.exclude, ...state.exclude])]
	const flags = ['--owner', context.owner, '--active', state.active, ...context.forwarded]

	if (exclude.length > 0) flags.push('--exclude', exclude.join(LIST_SEPARATOR))
	if (context.window !== undefined) flags.push('--window', context.window)
	if (state.stopped_by !== undefined) flags.push('--stopped', state.stopped_by)

	return `resume: ${flags.join(' ')}`
}

const backlog_drive_args = {
	USAGE,
	parse,
	resume_line,
}

export { backlog_drive_args }
export type { DriveContext }
