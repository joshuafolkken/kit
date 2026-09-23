#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { josh_command } from '#scripts/josh/josh-run'
import { run_ship, type ShipSection } from './run-ship'

// `josh ship "<title> #<N>"` — one call for the fixed commit-to-report region a run ships a change on
// (joshuafolkken/kit#2398). The loop used to spend a round trip each on `gate`, `git -y`, `followup`
// and `run:tail`, re-billing a lane's full context every time; this runs the four internally and
// prints one composite report, the same way `run:tail` folds the post-merge bookkeeping. Each step's
// stderr is forwarded, so the reader still sees every explanation — a red check, a CI wait, a refusal —
// the four would have printed on their own.
//
// It stops at the first failed step: the gate must be green before the commit, the commit before the
// merge. The report ends at the failure and names the stopped step, so the run reads only that one.
//
// The first positional is the `"<title> #<N>"` string `git -y` and `followup` already take; the issue
// number is read off its tail for `run:tail`. Any further positionals are follow-up citations filed
// this run (`fullrun-steps.md` routes branch-2 filing before `ship`), forwarded to `run:tail` after the
// closed issue so `issue:cite` reports them too. A notify body — `--notify-message` or the
// shell-body-safe `--notify-message-file` — is forwarded to `followup` alone; the completion prose is
// composed before this command and passed straight through.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const FIRST = 0
const NUMBER_GROUP = 1
const EXTRA_CITE_START = 1
// The issue reference at the tail of the title — `git -y` and `followup` read the whole string, and
// `run:tail` needs the number alone.
const TRAILING_ISSUE_PATTERN = /#([1-9]\d*)\s*$/u
// A follow-up citation passed as a trailing positional — a bare issue number, so a stray flag is
// refused rather than forwarded to the wrong step.
const CITE_PATTERN = /^[1-9]\d*$/u
// Both body forms `followup` documents, forwarded verbatim: the inline `--notify-message` and the
// shell-body-safe `--notify-message-file` a body naming a command or path must use (`followup.md`).
const NOTIFY_OPTIONS = ['notify-message', 'notify-message-file'] as const
const USAGE =
	'Usage: josh ship "<title> #<N>" [<follow-up-N> ...] [--notify-message <text> | --notify-message-file <path>]'
const should_forward_stderr = true

type NotifyValues = Partial<Record<(typeof NOTIFY_OPTIONS)[number], string>>

const OPTIONS = {
	[NOTIFY_OPTIONS[0]]: { type: 'string' },
	[NOTIFY_OPTIONS[1]]: { type: 'string' },
} as const

interface ShipArguments {
	title: string
	number: string
	notify: ReadonlyArray<string>
	cites: ReadonlyArray<string>
}

interface Step {
	header: string
	argv: (args: ShipArguments) => ReadonlyArray<string>
}

// The notify tail `followup` takes — whichever body form the caller composed, forwarded unchanged so a
// path-based body reaches `followup` exactly as passed.
function notify_arguments(values: NotifyValues): ReadonlyArray<string> {
	return NOTIFY_OPTIONS.flatMap((option) => {
		const value = values[option]

		return value === undefined ? [] : [`--${option}`, value]
	})
}

// The four steps in the order a change ships: the gate before the commit, the commit/push/PR before
// the merge, the merge before the report bookkeeping.
const STEPS: ReadonlyArray<Step> = [
	{ header: run_ship.GATE_HEADER, argv: () => ['gate'] },
	{ header: run_ship.COMMIT_HEADER, argv: (args) => ['git', '-y', args.title] },
	{
		header: run_ship.FOLLOWUP_HEADER,
		argv: (args) => ['followup', args.title, ...args.notify],
	},
	{ header: run_ship.REPORT_HEADER, argv: (args) => ['run:tail', args.number, ...args.cites] },
]

function issue_number(title: string): string | undefined {
	return TRAILING_ISSUE_PATTERN.exec(title)?.[NUMBER_GROUP]
}

function read_args(argv: ReadonlyArray<string>): ShipArguments | undefined {
	const args = [...argv]
	const parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true })
	const title = parsed.positionals[FIRST]

	if (title === undefined) return undefined

	const number = issue_number(title)

	if (number === undefined) return undefined

	const cites = parsed.positionals.slice(EXTRA_CITE_START)

	if (cites.some((token) => !CITE_PATTERN.test(token))) return undefined

	return { title, number, notify: notify_arguments(parsed.values), cites }
}

// Numbers-only tail and a strict parse, so a title with no `#<N>` or a stray flag is refused rather
// than shipped past the wrong step.
function parse(argv: ReadonlyArray<string>): ShipArguments | undefined {
	try {
		return read_args(argv)
	} catch {
		return undefined
	}
}

async function run_step(step: Step, args: ShipArguments): Promise<ShipSection> {
	const result = await josh_command.josh_run(step.argv(args), should_forward_stderr)

	return { header: step.header, body: result.out, code: result.code }
}

// Run the four in order, stopping at the first that failed: a red gate never reaches the commit, so
// the returned sections end at the failure the report names.
async function ship(args: ShipArguments): Promise<ReadonlyArray<ShipSection>> {
	const sections: Array<ShipSection> = []

	for (const step of STEPS) {
		const section = await run_step(step, args)

		sections.push(section)

		if (section.code !== SUCCESS_EXIT_CODE) break
	}

	return sections
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const args = parse(argv)

	if (args === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const sections = await ship(args)

	console.info(run_ship.format_report(sections))

	return run_ship.exit_code(sections)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_ship_cli = { SUCCESS_EXIT_CODE, USAGE, main, parse, run, ship }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ship_cli }
