import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import type { StopFinding } from '#scripts/run/ship/run-ship-review'
import { review_comment_round } from './review-comment-round'
import { review_finding_ledger, type Finding, type LineKind } from './review-finding-ledger'
import { review_finding_text } from './review-finding-text'
import { review_interaction } from './review-interaction'
import { review_lane_handover } from './review-lane-handover'
import { review_record, type RecordVerdict } from './review-record'
import { review_record_code_round } from './review-record-code-round'
import { review_record_comment } from './review-record-comment'
import { review_record_interaction } from './review-record-interaction'
import type { Reuse } from './review-round-reuse'
import { review_stop_log } from './review-stop-log'

// `josh review:record --issue <N> [<category>:<severity>:<file> ...]` — the one write path for a
// `/code-review` round's findings. It appends a `- rf:` line per finding to
// the issue's own file of the observation ledger, which the run's commit carries like any other
// ledger change. **A call with no findings is a zero-finding round, and it still writes one line** — so the
// round that found nothing is recorded rather than mistaken for a round nobody reviewed.
//
// **`--comment` records a round that ran after the pull request opened**: the same lines go to the
// issue as a comment and nothing is appended. A line written to the tree then has no commit of the
// run's left to ride, so `pnpm josh followup` would push it onto the open pull request and its CI
// would start over. The next round recorded to the ledger carries it there once the issue is closed
// (`review-comment-round.ts`).
//
// `josh review:record --check --issue <N>` is the read half `pnpm josh followup` runs before it
// merges: `ok` / `not-required` exit zero, `missing` exits non-zero so the
// merge is refused until the round is recorded. It mirrors `josh review:attest --check`. A recorded
// code round adds whether the ship reuses it (`review-round-reuse.ts`); the exit code does not change.
//
// **`--interaction` records and checks the interaction review's pass instead** (`review-interaction.ts`):
// the same grammar under `- ri:`. It takes no `--comment` — the pass runs before the pull request, and
// a pass kept only on the issue would leave the merge gate reading it as missing.
//
// **A finding written with its reason — `<spec> — <sentence>` — also lands in the durable stop log**,
// marked fixed (joshuafolkken/kit#4817). The ledger keeps the spec alone, as it always has; the stop
// log is the one record that keeps a finding's location and reason, so a lane's own round reaches the
// next stop's fix and the next review (`review-prior-findings.ts`) the way a ship's round already does.

const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh review:record --issue <N> [--comment | --interaction] [<category>:<severity>:<file>[ — <reason>] ...] | josh review:record --check [--interaction] --issue <N>'
const FILE_HINT = '  <file>: the cited path, optionally with :line'
const REASON_HINT =
	'  <reason>: optional, one sentence on what was wrong, kept for the lane’s next review and fix — pass each finding with its reason as one single-quoted argument'
const RECORD_STAGE = 'review:record'
const CHECK_USAGE = 'Usage: josh review:record --check [--interaction] --issue <N>'
const RECORDED_LINE = 'Recorded: the review round for this issue is in the ledger.'
const REUSED_LINE =
	'Reused: josh ship takes this round as its round 1 — the files this round covers hold still since the record. A default branch the ship’s sync merges in moves them only where it changed a file this round covers: run `pnpm josh main:merge` before this check for the answer the ship reaches.'
const DELTA_LINE =
	'Reused, delta to round 2: josh ship takes this round as its round 1 and does not review it again — every file moved since the record is one round 2 reads after the commit, or the ship’s own round 1 stopped on it.'
const REVIEW_AGAIN_LINE =
	'Not reused: josh ship reviews round 1 again — a move since the record round 2 would not read (a file a recorded High cites, documentation or a prompt, a revert to the briefed bytes, a default-branch change to a covered file), the round was not attested on this branch, or the issue changed after its brief. Run `pnpm josh run:review` and the round-1 `/code-review` here (chain-rule.md step 0).'
const REUSE_LINES: Readonly<Record<Reuse, string>> = {
	again: REVIEW_AGAIN_LINE,
	delta: DELTA_LINE,
	held: REUSED_LINE,
}
const NOT_REQUIRED_LINE =
	'No review-finding ledger is kept in this checkout, so there is nothing to check.'
const CARRIED_LINE =
	'review-finding line(s) recorded on closed issues after their pull requests opened into the ledger.'
const CARRY_FAILED_LINE =
	'Could not carry the closed issues’ comment rounds into the ledger; the next round retries:'
const OPTIONS = {
	issue: { type: 'string' },
	check: { type: 'boolean' },
	comment: { type: 'boolean' },
	interaction: { type: 'boolean' },
} as const

interface Request {
	issue: number
	findings: ReadonlyArray<Finding>
}

interface Parsed {
	check: boolean
	comment: boolean
	interaction: boolean
	issue: string | undefined
	positionals: ReadonlyArray<string>
}

// A finding spec is `<category>:<severity>:<file>`; the file field keeps any `:line` a citation
// carries, so only the first two colons separate fields.
function to_finding(category: string, severity: string, file: string): Finding | undefined {
	if (
		!review_finding_ledger.is_category(category) ||
		!review_finding_ledger.is_severity(severity)
	) {
		return undefined
	}

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
		const finding = parse_finding(review_finding_text.split_description(spec).spec)

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
		interaction: parsed.values.interaction === true,
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
		REASON_HINT,
	].join('\n')
}

function build_lines(
	request: Request,
	date: string,
	kind: LineKind = 'code',
): ReadonlyArray<string> {
	if (request.findings.length === 0) {
		return [review_finding_ledger.zero_round_line(date, request.issue, kind)]
	}

	return request.findings.map((finding) =>
		review_finding_ledger.finding_line(finding, date, request.issue, kind),
	)
}

function confirmation(count: number, ledger_path: string): string {
	return `Recorded ${String(count)} review-finding line(s) in ${ledger_path}.`
}

type CheckStatus = RecordVerdict['status']

interface CheckMode {
	status: (issue: number, root: string) => Promise<CheckStatus>
	recorded: (issue: number) => Promise<string>
	refusal: (issue: number) => string
	not_required: string
}

// **A recorded code round also says whether `josh ship` reuses it** (joshuafolkken/kit#4763), from the
// ship's own predicate, in the ship's three outcomes (joshuafolkken/kit#4878): reused as it stands,
// reused with the moved files left to round 2, or reviewed again — so the lane runs it itself rather
// than reading "recorded" as "done".
async function code_recorded(issue: number): Promise<string> {
	const reuse = await review_lane_handover.reuse_here(issue)

	return [RECORDED_LINE, REUSE_LINES[reuse]].join('\n')
}

async function interaction_recorded(): Promise<string> {
	return RECORDED_LINE
}

async function code_status(issue: number, root: string): Promise<CheckStatus> {
	const verdict = await review_record.check(issue, root)

	return verdict.status
}

// The two rounds a check reads, each with its own ledger line, refusal and quiet answer.
const CHECK_MODES: Record<LineKind, CheckMode> = {
	code: {
		status: code_status,
		recorded: code_recorded,
		refusal: review_record.refusal_message,
		not_required: NOT_REQUIRED_LINE,
	},
	interaction: {
		status: review_interaction.status,
		recorded: interaction_recorded,
		refusal: review_interaction.refusal_message,
		not_required: review_record_interaction.NOT_REQUIRED_LINE,
	},
}

function kind_of(parsed: Parsed): LineKind {
	return parsed.interaction ? 'interaction' : 'code'
}

async function report_check(issue: number, mode: CheckMode, root: string): Promise<number> {
	const status = await mode.status(issue, root)

	if (status === 'missing') {
		console.error(mode.refusal(issue))

		return FAILURE_EXIT_CODE
	}

	console.info(status === 'ok' ? await mode.recorded(issue) : mode.not_required)

	return 0
}

async function run_check(parsed: Parsed, root: string): Promise<number> {
	const { issue } = parsed

	if (issue === undefined || !issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue)) {
		console.error(CHECK_USAGE)

		return FAILURE_EXIT_CODE
	}

	return await report_check(Number(issue), CHECK_MODES[kind_of(parsed)], root)
}

// The closed issues' comment rounds ride this round's commit (`review-comment-round.ts`). **A carry
// that fails never fails the record**: this round is recorded, and the comment rounds wait for the
// next run's.
async function carry_comment_rounds(root: string): Promise<void> {
	try {
		const count = await review_comment_round.carry(root)

		if (count > 0) console.info(`Carried ${String(count)} ${CARRIED_LINE}`)
	} catch (error) {
		console.warn(`${CARRY_FAILED_LINE} ${error instanceof Error ? error.message : String(error)}`)
	}
}

// The round lands in its own issue's file, so two lanes recording at once
// write two files, and their pull requests never conflict on the ledger.
interface AppendedRound {
	issue: number
	lines: ReadonlyArray<string>
	root: string
	kind: LineKind
	findings: ReadonlyArray<Finding>
}

// A code round goes on to what its tree means for the ship (`review-record-code-round.ts`).
async function append_round({
	issue,
	lines,
	root,
	kind,
	findings,
}: AppendedRound): Promise<number> {
	const ledger_path = observation_ledger_home.issue_path(issue, root)

	await observation_ledger_home.append(ledger_path, lines)
	console.info(confirmation(lines.length, ledger_path))
	await carry_comment_rounds(root)

	if (kind === 'code') await review_record_code_round.follow(issue, root, findings)

	return 0
}

// A code round recorded after the push goes to the issue unasked (`review-record-comment.ts`).
async function write_round(
	parsed: Parsed,
	request: Request,
	now: Date,
	root: string,
): Promise<number> {
	const kind = kind_of(parsed)
	const lines = build_lines(request, observation_ledger_home.ledger_date(now), kind)
	const { issue, findings } = request

	if (parsed.comment) return await review_record_comment.post(issue, lines)

	if (kind === 'code' && (await review_record_comment.is_after_push())) {
		return await review_record_comment.post_after_push({ issue, lines, root, findings })
	}

	return await append_round({
		issue: request.issue,
		lines,
		root,
		kind,
		findings: request.findings,
	})
}

// The stop-log finding a positional carries, or `undefined` for one written without a reason.
function reason_of(positional: string): StopFinding | undefined {
	const { spec, description } = review_finding_text.split_description(positional)
	const finding = parse_finding(spec)

	if (finding === undefined || description.length === 0) return undefined

	return {
		kind: `${finding.category}:${finding.severity}`,
		location: finding.file,
		sentence: review_finding_text.first_sentence(description),
	}
}

function is_reason(finding: StopFinding | undefined): finding is StopFinding {
	return finding !== undefined
}

// Recorded only once the round itself is, so the stop log never holds a round the ledger refused.
function record_reasons(issue: number, positionals: ReadonlyArray<string>): void {
	review_stop_log.record({
		issue,
		stage: RECORD_STAGE,
		findings: positionals.map((positional) => reason_of(positional)).filter(is_reason),
		is_fixed: true,
	})
}

async function run_record(parsed: Parsed, now: Date, root: string): Promise<number> {
	const request = parsed.comment && parsed.interaction ? undefined : to_request(parsed)

	if (request === undefined) {
		console.error(usage_text())

		return FAILURE_EXIT_CODE
	}

	const code = await write_round(parsed, request, now, root)

	if (code === 0) record_reasons(request.issue, parsed.positionals)

	return code
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

	if (parsed.check) return await run_check(parsed, root)

	return await run_record(parsed, now, root)
}

const review_record_cli = {
	accepted_values,
	build_lines,
	parse_finding,
	run,
	usage_text,
}

export { review_record_cli }
