#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { cli_flags } from '#scripts/lib/cli-flags'
import { defect_rate } from './defect-rate'
import { effect_audit, type AuditRow, type FollowUp } from './effect-audit'
import { issue_sample_gate } from './issue-sample-gate'
import { issue_search, type SearchIssue } from './issue-search'
import { session_cite } from './session-cite'

// `josh effect:audit [--days <N>] [--draft <N>]` — every run-time-shortening issue closed in the window,
// one line each: its expected effect, its follow-up measurements and their verdict (`effect-audit.ts`).
// `--draft <N>` writes the retirement candidate for an issue whose measurement fell short and prints the
// `issue:file` line that files it once its placeholders are filled.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const DEFAULT_DAYS = 30
const PULL_CONCURRENCY = 4
const USAGE = 'Usage: josh effect:audit [--days <N>] [--draft <issue-number>]'
const OPTIONS = { days: { type: 'string' }, draft: { type: 'string' } } as const

interface AuditRequest {
	days: number
	draft: number | undefined
}

interface Audit {
	rows: ReadonlyArray<AuditRow>
	since: string
	is_capped: boolean
	unattributed: number
}

interface CitedFollowUp {
	issue: SearchIssue
	pr: number
}

function positive(text: string | undefined): number | undefined {
	const value = Number(text)

	return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function with_draft(days: number, text: string | undefined): AuditRequest | undefined {
	if (text === undefined) return { days, draft: undefined }
	const draft = positive(text)

	return draft === undefined ? undefined : { days, draft }
}

function parse_request(argv: ReadonlyArray<string>): AuditRequest | undefined {
	const parsed = cli_flags.values_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const days = positive(parsed.days ?? String(DEFAULT_DAYS))

	return days === undefined ? undefined : with_draft(days, parsed.draft)
}

// The issue the cited pull request closes; an unreadable pull request leaves the follow-up unattributed,
// and the listing counts it.
async function measured_issue(pr: number): Promise<number | undefined> {
	try {
		const pull = await issue_sample_gate.read_source(pr)

		return pull.closes
	} catch {
		return undefined
	}
}

// Each cited pull request is read once, a few at a time: the follow-up search spans every date.
async function closes_by_pull(
	prs: ReadonlyArray<number>,
): Promise<ReadonlyMap<number, number | undefined>> {
	const unique = [...new Set(prs)]
	const closes = await bounded_pool.bounded_map(unique, PULL_CONCURRENCY, measured_issue)

	return new Map(unique.map((pr, index) => [pr, closes[index]]))
}

// A follow-up citing the issue form names what it measures itself; only a cited pull request is read.
async function follow_ups_of(candidates: ReadonlyArray<SearchIssue>): Promise<Array<FollowUp>> {
	const cited = candidates
		.map((issue) => ({ issue, pr: effect_audit.cited_pull(issue) }))
		.filter((entry): entry is CitedFollowUp => entry.pr !== undefined)
	const closes = await closes_by_pull(cited.map(({ pr }) => pr))
	const by_issue = candidates
		.map((issue) => ({ issue, measures: effect_audit.cited_issue(issue) }))
		.filter(({ measures }) => measures !== undefined)

	return [...cited.map(({ issue, pr }) => ({ issue, measures: closes.get(pr) })), ...by_issue]
}

async function read_audit(repo: string, days: number, now_ms: number): Promise<Audit | undefined> {
	const since = defect_rate.window_start(now_ms, days)
	const [origins, follow_ups] = await Promise.all([
		issue_search.search(effect_audit.origin_query(repo, since)),
		issue_search.search(effect_audit.follow_up_query(repo)),
	])

	if (origins === undefined || follow_ups === undefined) return undefined

	const linked = await follow_ups_of(follow_ups.issues)
	const rows = effect_audit.rows(origins.issues, linked)
	const unattributed = linked.filter((follow_up) => follow_up.measures === undefined).length

	return { rows, since, is_capped: origins.is_capped || follow_ups.is_capped, unattributed }
}

function print_audit(audit: Audit): number {
	console.info(effect_audit.summary(audit.rows, audit.since))
	for (const row of audit.rows) console.info(session_cite.text(effect_audit.format_row(row)))
	if (audit.is_capped) console.info('(capped: the search served part of the window only)')

	if (audit.unattributed > 0) {
		console.info(
			`(${String(audit.unattributed)} follow-ups measure no issue: their pull request could not be read or closes none)`,
		)
	}

	return 0
}

function print_draft(rows: ReadonlyArray<AuditRow>, issue: number): number {
	const row = rows.find((candidate) => candidate.origin.number === issue)

	if (row?.result !== 'unmet') {
		console.error(
			`${session_cite.issue(issue)} is not an issue of the window whose measurement fell short`,
		)

		return FAILURE_EXIT_CODE
	}

	const file = path.join(tmpdir(), `josh-effect-retire-${String(issue)}.md`)

	writeFileSync(file, effect_audit.draft_body(row))
	console.info(`Fill in the <...> lines of ${file}, then file it:`)
	console.info(
		`pnpm josh issue:file "${effect_audit.draft_title(row)}" --body-file ${file} --label run:lane`,
	)

	return 0
}

async function audit_of(request: AuditRequest, now_ms: number): Promise<Audit | undefined> {
	const repo = await git_gh_command.repo_get_name_with_owner()

	return repo === undefined ? undefined : await read_audit(repo, request.days, now_ms)
}

async function run(argv: ReadonlyArray<string>, now_ms: number = Date.now()): Promise<number> {
	const request = parse_request(argv)
	if (request === undefined) return (console.error(USAGE), FAILURE_EXIT_CODE)
	const audit = await audit_of(request, now_ms)

	if (audit === undefined) {
		return (console.error('effect:audit: the issue search could not be read'), FAILURE_EXIT_CODE)
	}

	return request.draft === undefined ? print_audit(audit) : print_draft(audit.rows, request.draft)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const effect_audit_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { effect_audit_cli }
