import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_ship_body_draft } from './run-ship-body-draft'
import type { ShipArguments } from './run-ship-steps'

// The command line `josh ship` takes (`run-ship-cli.ts`). The first positional is the
// `"<title> #<N>"` string `git -y` and `followup` already take; the issue number is read off its tail
// for `run:tail`. Any further positionals are follow-up citations filed this run (`fullrun-steps.md`
// routes branch-2 filing before `ship`), forwarded to `run:tail` after the closed issue so `issue:cite`
// reports them too. A notify body — `--notify-message` or the shell-body-safe `--notify-message-file` —
// is forwarded to `followup` alone; the completion prose is composed before this command and passed
// straight through.

const FIRST = 0
const NUMBER_GROUP = 1
const EXTRA_CITE_START = 1
// The issue reference at the tail of the title — `git -y` and `followup` read the whole string, and
// `run:tail` needs the number alone.
const TRAILING_ISSUE_PATTERN = /#([1-9]\d*)\s*$/u
// Both body forms `followup` documents, forwarded verbatim: the inline `--notify-message` and the
// shell-body-safe `--notify-message-file` a body naming a command or path must use (`followup.md`).
const NOTIFY_OPTIONS = ['notify-message', 'notify-message-file'] as const
const { BODY_FILE_OPTION, body_arguments } = run_ship_body_draft

type NotifyValues = Partial<Record<(typeof NOTIFY_OPTIONS)[number], string>>

const OPTIONS = {
	[NOTIFY_OPTIONS[0]]: { type: 'string' },
	[NOTIFY_OPTIONS[1]]: { type: 'string' },
	[BODY_FILE_OPTION]: { type: 'string' },
	review: { type: 'boolean' },
	// Hand the region to a detached supervisor (`run-ship-detach.ts`), print the
	// report a stopped supervisor left, and carry follow-up citations as options so the supervisor's
	// command line still ends with its title.
	detach: { type: 'boolean' },
	log: { type: 'string' },
	cite: { type: 'string', multiple: true },
} as const

type ShipCommand = { kind: 'ship'; args: ShipArguments } | { kind: 'log'; number: string }

// The notify tail `followup` takes — whichever body form the caller composed, forwarded unchanged so a
// path-based body reaches `followup` exactly as passed.
function notify_arguments(values: NotifyValues): ReadonlyArray<string> {
	return NOTIFY_OPTIONS.flatMap((option) => {
		const value = values[option]

		return value === undefined ? [] : [`--${option}`, value]
	})
}

function issue_number(title: string): string | undefined {
	return TRAILING_ISSUE_PATTERN.exec(title)?.[NUMBER_GROUP]
}

interface ParsedValues extends NotifyValues {
	[BODY_FILE_OPTION]?: string
	review?: boolean
	detach?: boolean
	log?: string
	cite?: Array<string>
}

// A follow-up citation passed as a trailing positional is a bare issue number, so a stray flag is
// refused rather than forwarded to the wrong step.
function ship_args(
	title: string,
	rest: ReadonlyArray<string>,
	values: ParsedValues,
): ShipArguments | undefined {
	const number = issue_number(title)
	const cites = [...rest, ...(values.cite ?? [])]

	if (number === undefined || cites.some((token) => !issue_number_shape.is_issue_number(token))) {
		return undefined
	}

	return {
		title,
		number,
		notify: notify_arguments(values),
		body: body_arguments(values[BODY_FILE_OPTION]),
		body_path: values[BODY_FILE_OPTION],
		cites,
		is_review: values.review === true,
		is_detach: values.detach === true,
	}
}

// `--log <N>` stands alone: a bare issue number and nothing to ship.
function log_command(number: string, positionals: ReadonlyArray<string>): ShipCommand | undefined {
	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(number) && positionals.length === 0
		? { kind: 'log', number }
		: undefined
}

function command_of(
	values: ParsedValues,
	positionals: ReadonlyArray<string>,
): ShipCommand | undefined {
	if (values.log !== undefined) return log_command(values.log, positionals)

	const title = positionals[FIRST]
	const args =
		title === undefined ? undefined : ship_args(title, positionals.slice(EXTRA_CITE_START), values)

	return args === undefined ? undefined : { kind: 'ship', args }
}

// Numbers-only tail and a strict parse, so a title with no `#<N>` or a stray flag is refused rather
// than shipped past the wrong step.
function parse(argv: ReadonlyArray<string>): ShipCommand | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	return parsed === undefined ? undefined : command_of(parsed.values, parsed.positionals)
}

const run_ship_args = { parse }

export { run_ship_args }
export type { ShipCommand }
