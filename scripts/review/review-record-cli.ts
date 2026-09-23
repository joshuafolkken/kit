#!/usr/bin/env tsx
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { review_finding_ledger, type Finding } from './review-finding-ledger'
import { review_record, type RecordVerdict } from './review-record'

// `josh review:record --issue <N> [<category>:<severity>:<file> ...]` — the one write path for a
// `/code-review` round's findings (joshuafolkken/kit#2325). It appends a `- rf:` line per finding to
// the observation ledger, which `pnpm josh observations:flush` then commits like any other ledger
// change. **A call with no findings is a zero-finding round, and it still writes one line** — so the
// round that found nothing is recorded rather than mistaken for a round nobody reviewed.
//
// `josh review:record --check --issue <N>` is the read half `pnpm josh followup` runs before it
// merges (joshuafolkken/kit#2343): `ok` / `not-required` exit zero, `missing` exits non-zero so the
// merge is refused until the round is recorded. It mirrors `josh review:attest --check`.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const DATE_END = 10
const USAGE =
	'Usage: josh review:record --issue <N> [<category>:<severity>:<file> ...] | josh review:record --check --issue <N>'
const CHECK_USAGE = 'Usage: josh review:record --check --issue <N>'
const RECORDED_LINE = 'Recorded: the review round for this issue is in the ledger.'
const NOT_REQUIRED_LINE =
	'No review-finding ledger is kept in this checkout, so there is nothing to check.'
const ISSUE_PATTERN = /^[1-9]\d*$/u
const OPTIONS = { issue: { type: 'string' }, check: { type: 'boolean' } } as const

interface Request {
	issue: number
	findings: ReadonlyArray<Finding>
}

interface Parsed {
	check: boolean
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
	try {
		const parsed = parseArgs({
			args: [...argv],
			options: OPTIONS,
			strict: true,
			allowPositionals: true,
		})

		return {
			check: parsed.values.check === true,
			issue: parsed.values.issue,
			positionals: parsed.positionals,
		}
	} catch {
		return undefined
	}
}

function to_request(parsed: Parsed): Request | undefined {
	const { issue } = parsed

	if (issue === undefined || !ISSUE_PATTERN.test(issue)) return undefined

	const findings = parse_findings(parsed.positionals)

	return findings === undefined ? undefined : { issue: Number(issue), findings }
}

function today(now: Date): string {
	return now.toISOString().slice(0, DATE_END)
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

async function run_check(issue: string | undefined, ledger_path: string): Promise<number> {
	if (issue === undefined || !ISSUE_PATTERN.test(issue)) {
		console.error(CHECK_USAGE)

		return FAILURE_EXIT_CODE
	}

	const verdict = await review_record.check(Number(issue), ledger_path)

	if (verdict.status === 'ok' || verdict.status === 'not-required') {
		console.info(check_line(verdict))

		return 0
	}

	console.error(review_record.refusal_message(Number(issue)))

	return FAILURE_EXIT_CODE
}

async function run_record(parsed: Parsed, now: Date, ledger_path: string): Promise<number> {
	const request = to_request(parsed)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const lines = build_lines(request, today(now))

	// A consumer that does not keep the observation ledger has no `docs/` at its root, so the append
	// below would fail with ENOENT and leave the merge gate unsatisfiable (joshuafolkken/kit#2402).
	// Creating the parent first is the one write path that can bring the ledger into existence there.
	await mkdir(path.dirname(ledger_path), { recursive: true })
	await appendFile(ledger_path, `${lines.join('\n')}\n`, 'utf8')
	console.info(confirmation(lines.length, ledger_path))

	return 0
}

async function run(
	argv: ReadonlyArray<string>,
	now: Date,
	ledger_path: string = OBSERVATION_LEDGER_PATH,
): Promise<number> {
	const parsed = parse_argv(argv)

	if (parsed === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	if (parsed.check) return await run_check(parsed.issue, ledger_path)

	return await run_record(parsed, now, ledger_path)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv, new Date())
}

const review_record_cli = { USAGE, build_lines, parse_finding, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_record_cli }
