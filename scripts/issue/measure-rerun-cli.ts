#!/usr/bin/env tsx
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { error_text } from '#scripts/lib/error-message'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { z } from 'zod'
import { baseline_measure, type Baseline } from './baseline-measure'
import { session_cite } from './session-cite'

// `josh measure:rerun <N>` — read a behavior-change Issue body after merge, re-run each baseline
// command, and print the before/after pair. A value that did not move means
// the premise the rule rested on is refuted, so a line is appended to the observation ledger — reusing
// that append-only, same-key mechanism rather than a second one.
//
// **The baseline is shell, and the body is written by whoever filed the Issue**.
// A baseline needs pipes and loops (`git log … | wc -l`, `for d in $(ls …)`), so an allow-list of
// commands cannot make it safe; what can is who wrote it. The input is therefore the Issue number, not
// a file, so the author's `author_association` arrives with the body from the same REST read, and only
// a body written by someone with write access to the repository is run.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const ISSUE_FIELDS = 'body,author_association'
const TRUSTED_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const TRUSTED_LIST = [...TRUSTED_ASSOCIATIONS].join(' / ')
const UNKNOWN_ASSOCIATION = 'unknown'
const USAGE = 'Usage: josh measure:rerun <issue-number>'
const NO_BASELINE = 'no `command → value` baseline found in ## ベースライン — nothing to re-run'
const DATE_END = 10
// One baseline command's budget — the same minute `josh-harness.ts` gives one command it spawns. A
// baseline is a count or a digest that answers in seconds, so a command still running after a minute
// is stuck, and without a bound it would hold the whole re-measurement open with nothing printed.
const MEASURE_TIMEOUT_MS = 60_000
const issue_schema = z.object({
	body: z.string().nullish(),
	author_association: z.string().nullish(),
})

type IssueFields = z.infer<typeof issue_schema>
type BodyRead = { kind: 'trusted'; body: string } | { kind: 'refused'; reason: string }

// The command's stdout, trimmed to one value. A failing or timed-out command yields its message so the
// pair still prints and the remaining baselines still run, rather than aborting the whole
// re-measurement.
function measure(command: string): string {
	try {
		return execSync(command, { encoding: 'utf8', timeout: MEASURE_TIMEOUT_MS }).trim()
	} catch (error) {
		return `(command failed: ${error_text.message_of(error)})`
	}
}

interface Outcome {
	pair: string
	ledger_line: string | undefined
}

function rerun_one(baseline: Baseline, date: string): Outcome {
	const after = measure(baseline.command)
	const is_unchanged = baseline_measure.is_no_change(baseline.value, after)

	return {
		pair: baseline_measure.format_pair(baseline, after),
		ledger_line: is_unchanged ? baseline_measure.ledger_line(baseline, date) : undefined,
	}
}

async function append_ledger(lines: ReadonlyArray<string>, now: Date): Promise<void> {
	if (lines.length === 0) return

	// The running work tree's file for the checked-out issue, a lane's inside a lane — the run's own
	// commit carries it.
	const ledger_path = await observation_ledger_home.writer_path(now)

	await observation_ledger_home.append(ledger_path, lines)
	console.info(`Recorded ${String(lines.length)} refuted premise(s) in ${ledger_path}.`)
}

function today(now: Date): string {
	return now.toISOString().slice(0, DATE_END)
}

async function read_issue(issue_number: string): Promise<IssueFields | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue_number, ISSUE_FIELDS)

	return json === undefined ? undefined : parse_json_object_safe(json, issue_schema)
}

// The body, only when its author can write to the repository. A read that fails is refused as well:
// an unknown author is not a trusted one.
async function read_trusted_body(issue_number: string): Promise<BodyRead> {
	const issue = await read_issue(issue_number)

	if (issue === undefined) {
		return { kind: 'refused', reason: `could not read issue ${session_cite.issue(issue_number)}` }
	}

	const association = issue.author_association ?? UNKNOWN_ASSOCIATION

	if (!TRUSTED_ASSOCIATIONS.has(association)) {
		return {
			kind: 'refused',
			reason: `refusing to run the baseline of ${session_cite.issue(issue_number)}: its author is ${association}, not ${TRUSTED_LIST}`,
		}
	}

	return { kind: 'trusted', body: issue.body ?? '' }
}

async function rerun(body: string, now: Date): Promise<number> {
	const baselines = baseline_measure.parse_baselines(body)

	if (baselines.length === 0) {
		console.error(NO_BASELINE)

		return FAILURE_EXIT_CODE
	}

	const outcomes = baselines.map((baseline) => rerun_one(baseline, today(now)))
	const ledger_lines = outcomes
		.map((outcome) => outcome.ledger_line)
		.filter((line): line is string => line !== undefined)

	console.info(outcomes.map((outcome) => outcome.pair).join('\n\n'))
	await append_ledger(ledger_lines, now)

	return 0
}

async function run(issue_number: string | undefined, now: Date): Promise<number> {
	if (issue_number === undefined || !ISSUE_NUMBER_PATTERN.test(issue_number)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const read = await read_trusted_body(issue_number)

	if (read.kind === 'refused') {
		console.error(read.reason)

		return FAILURE_EXIT_CODE
	}

	return await rerun(read.body, now)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv[0], new Date())
}

const measure_rerun_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { measure_rerun_cli }
