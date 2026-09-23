#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { issue_label_schema } from '#scripts/git/schemas'
import { z } from 'zod'
import { defect_rate, type DefectRate, type RateIssue } from './defect-rate'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PER_PAGE = '100'
const USAGE = 'Usage: pnpm josh defect:rate [--days <n>]'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote`, so no issue can be searched — check `gh auth status` and that this is a checkout with an `origin` remote.'
const UNREADABLE_SEARCH_MESSAGE =
	'Could not read the issue search from GitHub, so no rate is printed.'

const OPTIONS = { days: { type: 'string' } } as const

// A positive whole number of days and nothing else — `0`, an empty string from an unset shell
// variable and `1.5` are refused rather than read as a window nobody asked for.
const DAYS_PATTERN = /^[1-9]\d*$/u
// Ten years — far past any window worth asking for, and far inside the Date range, so an absurd value
// is refused with the usage instead of crashing the window's date conversion.
const MAX_WINDOW_DAYS = 3650

const ARGV_OFFSET = 2

const search_item_schema = z.object({
	body: z.string().nullish(),
	labels: z.array(issue_label_schema),
})

// One page of `search/issues`. `--paginate --slurp` hands back every page as one array.
const search_page_schema = z.object({
	total_count: z.number(),
	incomplete_results: z.boolean(),
	items: z.array(search_item_schema),
})

type SearchPage = z.infer<typeof search_page_schema>

interface SearchResult {
	issues: ReadonlyArray<RateIssue>
	is_capped: boolean
}

function read_days(argv: ReadonlyArray<string>): number | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: OPTIONS, strict: true })
		const raw = values.days ?? String(defect_rate.DEFAULT_WINDOW_DAYS)

		if (!DAYS_PATTERN.test(raw)) return undefined

		const days = Number(raw)

		return days <= MAX_WINDOW_DAYS ? days : undefined
	} catch {
		return undefined
	}
}

function search_path(query: string): string {
	return `search/issues?${new URLSearchParams({ q: query, per_page: PER_PAGE }).toString()}`
}

function to_result(pages: ReadonlyArray<SearchPage>): SearchResult {
	const issues = pages.flatMap((page) =>
		page.items.map((item) => ({
			body: item.body ?? '',
			labels: item.labels.map((label) => label.name),
		})),
	)
	// The search API serves at most 1000 results, and says so only by a total larger than what it
	// handed back — a window past that ceiling is measured on part of itself.
	const total = pages[0]?.total_count ?? 0
	const is_incomplete = pages.some((page) => page.incomplete_results)

	return { issues, is_capped: is_incomplete || total > issues.length }
}

async function search(query: string): Promise<SearchResult | undefined> {
	try {
		const raw = await git_gh_exec.exec_gh_api({
			path: search_path(query),
			should_paginate: true,
			should_slurp: true,
		})
		const pages = parse_json_array_or_undefined(raw, search_page_schema)

		return pages === undefined ? undefined : to_result(pages)
	} catch {
		return undefined
	}
}

// The rate over a window, or `undefined` when either search could not be read. `backlog:next` asks
// this same measurement (joshuafolkken/kit#2455), so the two cannot disagree about the rate.
async function measure_window(
	repo: string,
	days: number,
	now_ms: number,
): Promise<DefectRate | undefined> {
	const since = defect_rate.window_start(now_ms, days)
	const [filed, completed] = await Promise.all([
		search(defect_rate.filed_query(repo, since)),
		search(defect_rate.completed_query(repo, since)),
	])

	if (filed === undefined || completed === undefined) return undefined

	const is_capped = filed.is_capped || completed.is_capped

	return defect_rate.measure({
		days,
		since,
		filed: filed.issues,
		completed: completed.issues,
		is_capped,
	})
}

async function report(repo: string, days: number, now_ms: number): Promise<number> {
	const measured = await measure_window(repo, days, now_ms)

	if (measured === undefined) {
		console.error(UNREADABLE_SEARCH_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	for (const line of defect_rate.format(measured)) console.info(line)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>, now_ms: number = Date.now()): Promise<number> {
	const days = read_days(argv)

	if (days === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repo = await git_gh_command.repo_get_name_with_owner()

	if (repo === undefined) {
		console.error(UNKNOWN_REPO_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return await report(repo, days, now_ms)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const defect_rate_cli = { USAGE, read_days, search_path, measure_window, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { defect_rate_cli }
