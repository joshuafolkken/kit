#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { review_finding_ledger, type Finding } from './review-finding-ledger'
import { review_record, type RecordVerdict } from './review-record'

// `josh review:record --issue <N> [<category>:<severity>:<file> ...]` — the one write path for a
// `/code-review` round's findings. It appends a `- rf:` line per finding to
// the issue's own file of the observation ledger, which the run's commit carries like any other
// ledger change. **A call with no findings is a zero-finding round, and it still writes one line** — so the
// round that found nothing is recorded rather than mistaken for a round nobody reviewed.
//
// **`--comment` records a round that ran after the pull request opened**: the same lines go to the
// issue as a comment and nothing is appended. A line written to the tree then has no commit of the
// run's left to ride, so `pnpm josh followup` would push it onto the open pull request and its CI
// would start over.
//
// `josh review:record --check --issue <N>` is the read half `pnpm josh followup` runs before it
// merges: `ok` / `not-required` exit zero, `missing` exits non-zero so the
// merge is refused until the round is recorded. It mirrors `josh review:attest --check`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh review:record --issue <N> [--comment] [<category>:<severity>:<file> ...] | josh review:record --check --issue <N>'
const FILE_HINT = '  <file>: the cited path, optionally with :line'
const CHECK_USAGE = 'Usage: josh review:record --check --issue <N>'
const RECORDED_LINE = 'Recorded: the review round for this issue is in the ledger.'
const NOT_REQUIRED_LINE =
	'No review-finding ledger is kept in this checkout, so there is nothing to check.'
const COMMENT_HEADING = '### Review round recorded after the pull request opened'
const COMMENT_NOTE =
	'Kept here rather than in the observation ledger: a line appended after the commit would be pushed onto the open pull request and restart its CI.'
const CODE_FENCE = '```'
const OPTIONS = {
	issue: { type: 'string' },
	check: { type: 'boolean' },
	comment: { type: 'boolean' },
} as const

interface Request {
	issue: number
	findings: ReadonlyArray<Finding>
}

interface Parsed {
	check: boolean
	comment: boolean
	issue: string | undefined
	positionals: ReadonlyArray<string>
}

// A finding spec is `<category>:<severity>:<file>`; the file field keeps any `:line` a citation
// carries, so only the first two colons separate fields.
function to_finding(category: string, severity: string, file: string): Finding | undefined {
	if (!review_finding_ledger.is_category(category)) return undefined
	if (!review_finding_ledger.is_severity(severity)) return undefined

	return review_finding_ledger.is_valid_file(file) ? { category, severity, file } : undefined
}

function parse_finding(spec: string): Finding | undefined {
	const first = spec.indexOf(':')
	const second = spec.indexOf(':', first + 1)

	if (first === -1 || second === -1) return undefined

	return to_finding(spec.slice(0, first), spec.slice(first + 1, second), spec.slice(second + 1))
}

function parse_findings(specs: ReadonlyArray<string>): ReadonlyArray<Finding> | undefined {
	const findings: Array<Finding> = []

	for (const spec of specs) {
		const finding = parse_finding(spec)

		if (finding === undefined) return undefined

		findings.push(finding)
	}

	return findings
}

function parse_argv(argv: ReadonlyArray<string>): Parsed | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined

	return {
		check: parsed.values.check === true,
		comment: parsed.values.comment === true,
		issue: parsed.values.issue,
		positionals: parsed.positionals,
	}
}

function to_request(parsed: Parsed): Request | undefined {
	const { issue } = parsed

	if (issue === undefined || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue)) return undefined

	const findings = parse_findings(parsed.positionals)

	return findings === undefined ? undefined : { issue: Number(issue), findings }
}

// The accepted values are built from the ledger's own vocabulary, so a
// refused spec names what would have been accepted and a new category appears here unedited.
function accepted_values(placeholder: string, values: ReadonlyArray<string>): string {
	return `  ${placeholder}: ${values.join(' | ')}`
}

function usage_text(): string {
	return [
		USAGE,
		accepted_values('<category>', review_finding_ledger.CATEGORIES),
		accepted_values('<severity>', review_finding_ledger.SEVERITIES),
		FILE_HINT,
	].join('\n')
}

function build_lines(request: Request, date: string): ReadonlyArray<string> {
	if (request.findings.length === 0) {
		return [review_finding_ledger.zero_round_line(date, request.issue)]
	}

	return request.findings.map((finding) =>
		review_finding_ledger.finding_line(finding, date, request.issue),
	)
}

function confirmation(count: number, ledger_path: string): string {
	return `Recorded ${String(count)} review-finding line(s) in ${ledger_path}.`
}

function check_line(verdict: RecordVerdict): string {
	return verdict.status === 'ok' ? RECORDED_LINE : NOT_REQUIRED_LINE
}

async function run_check(issue: string | undefined, root: string): Promise<number> {
	if (issue === undefined || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue)) {
		console.error(CHECK_USAGE)

		return FAILURE_EXIT_CODE
	}

	const verdict = await review_record.check(Number(issue), root)

	if (verdict.status === 'ok' || verdict.status === 'not-required') {
		console.info(check_line(verdict))

		return 0
	}

	console.error(review_record.refusal_message(Number(issue)))

	return FAILURE_EXIT_CODE
}

function comment_body(lines: ReadonlyArray<string>): string {
	return [COMMENT_HEADING, '', COMMENT_NOTE, '', CODE_FENCE, ...lines, CODE_FENCE].join('\n')
}

// **A comment that could not be posted fails the record**: it is the round's only copy, so a
// swallowed refusal would read as a recorded round that exists nowhere.
async function post_comment(issue: number, lines: ReadonlyArray<string>): Promise<number> {
	try {
		const url = await git_gh_issue_write.issue_comment(String(issue), comment_body(lines))

		console.info(`Recorded ${String(lines.length)} review-finding line(s) in ${url.trim()}.`)

		return 0
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return FAILURE_EXIT_CODE
	}
}

// The round lands in its own issue's file, so two lanes recording at once
// write two files, and their pull requests never conflict on the ledger.
async function run_record(parsed: Parsed, now: Date, root: string): Promise<number> {
	const request = to_request(parsed)

	if (request === undefined) {
		console.error(usage_text())

		return FAILURE_EXIT_CODE
	}

	const lines = build_lines(request, observation_ledger_home.ledger_date(now))

	if (parsed.comment) return await post_comment(request.issue, lines)

	const ledger_path = observation_ledger_home.issue_path(request.issue, root)

	await observation_ledger_home.append(ledger_path, lines)
	console.info(confirmation(lines.length, ledger_path))

	return 0
}

// **The default is the work tree the command runs in, a lane's inside a lane**.
// The line rides that tree's own commit or `pnpm josh followup`'s pre-merge ledger commit, and
// `--check` reads the same tree, so the two halves can never disagree about where the round is.
async function run(
	argv: ReadonlyArray<string>,
	now: Date,
	root: string = observation_ledger_home.ledger_root(),
): Promise<number> {
	const parsed = parse_argv(argv)

	if (parsed === undefined) {
		console.error(usage_text())

		return FAILURE_EXIT_CODE
	}

	if (parsed.check) return await run_check(parsed.issue, root)

	return await run_record(parsed, now, root)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv, new Date())
}

const review_record_cli = {
	accepted_values,
	build_lines,
	comment_body,
	parse_finding,
	run,
	usage_text,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_record_cli }
