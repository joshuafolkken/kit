#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { cli_flags } from '#scripts/lib/cli-flags'
import { z } from 'zod'
import { cost_audit, type Audit, type AuditWindow, type MergeCounts } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'
import { cost_audit_read } from './cost-audit-read'

// `josh cost:audit [--period <days>]` — what AI work cost over a period, by session kind, tool
// category and guard, with the cost per merged pull request, set against the period before it. It
// exists so a cost reduction can be watched after it lands rather than measured once by hand: a row
// that grew past the threshold in `cost-audit.ts` is printed as a regression.
//
// **Kit-only.** It reads kit's own transcript store, like `josh retrospective`, which carries its
// summary line.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: pnpm josh cost:audit [--period <days>]'
const OPTIONS = { period: { type: 'string' } } as const
// A positive whole number of days, at most ten years — `0`, `1.5` and an empty string are refused.
const DAYS_PATTERN = /^[1-9]\d*$/u
const MAX_PERIOD_DAYS = 3650
// GitHub's search qualifier takes an ISO instant without the milliseconds `toISOString` writes.
const MILLISECONDS_PATTERN = /\.\d{3}Z$/u

const search_count_schema = z.object({ total_count: z.number() })

// An unknown flag or a `--period` with no value is refused, not read as the default period.
function read_period(argv: ReadonlyArray<string>): number | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	const raw = values.period ?? String(cost_audit.DEFAULT_PERIOD_DAYS)
	const days = Number(raw)

	return DAYS_PATTERN.test(raw) && days <= MAX_PERIOD_DAYS ? days : undefined
}

function instant(ms: number): string {
	return new Date(ms).toISOString().replace(MILLISECONDS_PATTERN, 'Z')
}

function merged_query(repo: string, window: AuditWindow): string {
	return `repo:${repo} is:pr is:merged merged:${instant(window.start_ms)}..${instant(window.end_ms)}`
}

async function merge_count(repo: string, window: AuditWindow): Promise<number | undefined> {
	const parameters = new URLSearchParams({ q: merged_query(repo, window), per_page: '1' })
	const raw = await git_gh_exec.exec_gh_api({ path: `search/issues?${parameters.toString()}` })

	return parse_json.parse_json_object_or_undefined(raw, search_count_schema)?.total_count
}

// Both periods' merge counts, or `undefined` when GitHub could not be read — the audit then prints
// no per-merge row rather than one divided by a guess.
async function read_merges(days: number, now_ms: number): Promise<MergeCounts | undefined> {
	try {
		const repo = await git_gh_command.repo_get_name_with_owner()

		if (repo === undefined) return undefined

		const [current, previous] = await Promise.all(
			cost_audit.windows_of(days, now_ms).map(async (window) => await merge_count(repo, window)),
		)

		return current === undefined || previous === undefined ? undefined : { current, previous }
	} catch {
		return undefined
	}
}

async function measure(cwd: string, days: number, now_ms: number): Promise<Audit> {
	const sessions = cost_audit_read.load(cwd, cost_audit.since_ms(days, now_ms))
	const merges = await read_merges(days, now_ms)

	return cost_audit.audit({ sessions, days, now_ms, merges })
}

// The default period's summary line, for `josh retrospective`.
async function summary(cwd: string, now_ms: number = Date.now()): Promise<string> {
	const audit = await measure(cwd, cost_audit.DEFAULT_PERIOD_DAYS, now_ms)

	return cost_audit_format.summary_line(audit)
}

async function run(
	argv: ReadonlyArray<string>,
	cwd: string = process.cwd(),
	now_ms: number = Date.now(),
): Promise<number> {
	const days = read_period(argv)

	if (days === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const lines = cost_audit_format.report_lines(await measure(cwd, days, now_ms))

	for (const line of lines) console.info(line)

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const cost_audit_cli = { USAGE, read_period, merged_query, run, summary }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { cost_audit_cli }
