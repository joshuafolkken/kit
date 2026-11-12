#!/usr/bin/env tsx
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cases_interaction_scan } from '#scripts/cases/cases-interaction-scan'
import { cases } from '#scripts/cases/cases-logic'
import { project_checks } from '#scripts/gate/project-checks'
import { plan_consumers } from '#scripts/issue/plan-consumers'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { session_language } from '#scripts/josh/session-language'
import { lane_plan_estimate } from '#scripts/lane/lane-plan-estimate'
import { line_budget } from '#scripts/lines/line-budget'
import { run_prep_cli } from '#scripts/run/run-prep-cli'
import { run_prep_locate } from '#scripts/run/run-prep-locate'
import { plan_scaffold, type ScaffoldParts, type Targets } from './plan-scaffold'

// `josh plan:scaffold <N> [<path>...]` — the work summary's inputs in one call: the `run:prep --summary`
// skeleton, the planned files near the line limit (`lines`), their `test:declared` verdict, the
// abnormal cases `cases` owes for them, and the `plan:consumers` draft for the identifiers the issue
// names. Each answer comes from its own command's functions; this only gathers them concurrently.
// The planned files are the paths given, or else the existing files the issue body puts in backticks.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh plan:scaffold <issue-number> [<path>...] [--estimate <json-file>]'

// A backticked directory is not a planned file: only a regular file reaches `lines` and `test:declared`.
function is_file(target: string): boolean {
	const resolved = path.resolve(process.cwd(), target)

	return existsSync(resolved) && statSync(resolved).isFile()
}

// The `cases` answer for the planned files: the boundary tokens, the shared-state and environment
// lines, then the abnormal cases the boundaries owe.
async function case_lines(files: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	const { lang } = session_language.resolve_session_lang()
	const boundaries = cases.boundaries_in(files)
	const findings = await cases_interaction_scan.scan(files)
	const tokens = [...boundaries, ...cases_interaction_scan.interactions_of(findings)]

	if (tokens.length === 0) return []

	const owed = boundaries.length === 0 ? [] : [cases.cases_for(boundaries, lang).join(' / ')]

	return [tokens.join(' '), ...cases_interaction_scan.lines_for(findings, lang), ...owed]
}

async function near_limit(files: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	const root = process.cwd()
	const budgets = await line_budget.budgets_for(
		files.map((file) => path.resolve(root, file)),
		root,
	)

	return plan_scaffold.near_limit_rows(budgets, root)
}

async function consumers_text(identifiers: ReadonlyArray<string>): Promise<string | undefined> {
	if (identifiers.length === 0) return undefined

	const { text } = await plan_consumers.report(identifiers)

	return text
}

async function gather(
	summary: string,
	files: ReadonlyArray<string>,
	targets: Targets,
): Promise<ScaffoldParts> {
	const [rows, owed, consumers] = await Promise.all([
		near_limit(files),
		case_lines(files),
		consumers_text(targets.identifiers),
	])
	const declared = plan_scaffold.declared_line(files, project_checks.is_basic(process.cwd()))

	return { summary, files, near_limit: rows, declared, cases: owed, consumers }
}

async function scaffold(
	issue_number: string,
	paths: ReadonlyArray<string>,
	estimate?: string,
): Promise<number> {
	const summary = await run_prep_cli.read_summary(issue_number)

	if (summary === undefined) {
		console.error(run_prep_cli.failure_note(issue_number, 'unreadable'))

		return FAILURE_EXIT_CODE
	}

	const targets = plan_scaffold.split_targets(
		run_prep_locate.extract_targets(summary.body),
		is_file,
	)
	const planned = estimate !== undefined || paths.length > 0 ? paths : targets.files
	const scope = await lane_plan_estimate.attach(
		{ issue: Number(issue_number), paths: [...planned], planned_at: '' },
		estimate,
	)
	const parts = await gather(summary.text, scope.paths, targets)

	console.info(plan_scaffold.format({ ...parts, estimate: scope.estimated_size }))

	return SUCCESS_EXIT_CODE
}

// A malformed number is an argument error (usage); an unreadable body is a read failure (its own note).
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const input = lane_plan_estimate.split(argv)
	const [first = '', ...paths] = input.tokens
	const issue_number = run_prep_cli.parse_number([first])

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await scaffold(issue_number, paths, input.file)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	josh_environment_file.load_environment_file()
	process.exitCode = await run(argv)
}

const plan_scaffold_cli = { case_lines, is_file, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { plan_scaffold_cli }
