#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
	CLEAN,
	FINDINGS,
	sonar_new_code,
	UNREADABLE,
	type NewCodeFetch,
	type NewCodeIssue,
	type NewCodeReading,
} from './sonar-new-code'
import { sonar_project } from './sonar-project'

// `josh sonar:new-code <PR>` — fail when a pull request adds any new SonarCloud issue or duplicated
// block.
//
// `sonar-qube.yml` runs it after the scan on every pull request, so the `SonarQube` check turns red on
// a single finding instead of only when the Quality Gate's ratios tip over. The verdict lives in
// `sonar-new-code.ts`; this file is the I/O around it: two SonarCloud API reads, one line per issue,
// and the verdict line. A read that fails is `unreadable` and fails the check too, so an outage never
// passes a pull request as clean.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh sonar:new-code <PR>'
const ISSUES_PATH = '/api/issues/search'
const MEASURES_PATH = '/api/measures/component'
const DUPLICATED_BLOCKS_METRIC = 'new_duplicated_blocks'
// The most issues one page carries; the verdict reads the API's own total, so a longer list only
// shortens what is printed.
const ISSUE_PAGE_SIZE = '100'
const FAILURE_EXIT_CODE = 1
const UNKNOWN = '?'

// `looseObject` so a field SonarCloud adds later does not fail the parse; only the fields the report
// prints are declared.
const issue_schema = z.looseObject({
	rule: z.string(),
	severity: z.string().optional(),
	type: z.string().optional(),
	component: z.string(),
	line: z.number().optional(),
	message: z.string(),
})
const issues_schema = z.looseObject({ total: z.number(), issues: z.array(issue_schema) })
const period_schema = z.looseObject({ value: z.string().optional() })
const measure_schema = z.looseObject({
	metric: z.string(),
	value: z.string().optional(),
	periods: z.array(period_schema).optional(),
})
const measures_schema = z.looseObject({
	component: z.looseObject({ measures: z.array(measure_schema) }),
})

function issues_url(project_key: string, pull_request: string): string {
	return sonar_project.api_url(ISSUES_PATH, {
		componentKeys: project_key,
		pullRequest: pull_request,
		resolved: 'false',
		ps: ISSUE_PAGE_SIZE,
	})
}

function measures_url(project_key: string, pull_request: string): string {
	return sonar_project.api_url(MEASURES_PATH, {
		component: project_key,
		pullRequest: pull_request,
		metricKeys: DUPLICATED_BLOCKS_METRIC,
	})
}

function duplicated_blocks_of(measures: z.infer<typeof measures_schema>): NewCodeFetch {
	const measure = measures.component.measures.find(
		(entry) => entry.metric === DUPLICATED_BLOCKS_METRIC,
	)
	const blocks = sonar_new_code.measure_value(measure)

	return blocks === undefined
		? { error: `${DUPLICATED_BLOCKS_METRIC} is not a number` }
		: { issues: [], issue_total: 0, duplicated_blocks: blocks }
}

async function fetch_new_code(project_key: string, pull_request: string): Promise<NewCodeFetch> {
	const [issues, measures] = await Promise.all([
		sonar_project.fetch_json(issues_url(project_key, pull_request), issues_schema),
		sonar_project.fetch_json(measures_url(project_key, pull_request), measures_schema),
	])
	if ('error' in issues) return { error: `issues: ${issues.error}` }
	if ('error' in measures) return { error: `measures: ${measures.error}` }

	const blocks = duplicated_blocks_of(measures.data)

	return 'error' in blocks
		? blocks
		: { ...blocks, issues: issues.data.issues, issue_total: issues.data.total }
}

function format_issue(issue: NewCodeIssue): string {
	const line = issue.line === undefined ? UNKNOWN : String(issue.line)
	const kind = `${issue.severity ?? UNKNOWN} ${issue.type ?? UNKNOWN}`

	return `${kind}\t${issue.component}:${line}\t${issue.rule}\t${issue.message}`
}

function findings_line(reading: NewCodeReading): string {
	const counts = `${String(reading.issue_total)} new issue(s), ${String(reading.duplicated_blocks)} new duplicated block(s)`

	return `${FINDINGS}: ${counts} — fix them, or resolve a deliberate exception in SonarCloud`
}

// The report, and whether it passes: one line per issue, then the verdict line.
function report(fetched: NewCodeFetch): { lines: ReadonlyArray<string>; is_clean: boolean } {
	const verdict = sonar_new_code.verdict_of(fetched)

	if ('error' in fetched) return { lines: [`${UNREADABLE}: ${fetched.error}`], is_clean: false }
	if (verdict === CLEAN) return { lines: [CLEAN], is_clean: true }

	const issue_lines = fetched.issues.map((issue) => format_issue(issue))

	return { lines: [...issue_lines, findings_line(fetched)], is_clean: false }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const target = await sonar_project.resolve_target(argv, USAGE)
	if (target === undefined) return FAILURE_EXIT_CODE

	const { lines, is_clean } = report(await fetch_new_code(target.project_key, target.pull_request))

	for (const line of lines) console.info(line)

	return is_clean ? 0 : FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const sonar_new_code_cli = {
	fetch_new_code,
	issues_url,
	measures_url,
	report,
	run,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { sonar_new_code_cli }
