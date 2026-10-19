#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cases } from '#scripts/cases/cases-logic'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { session_language } from '#scripts/josh/session-language'
import { report_labels } from './report-labels'
import { report_template, type ChangeInput } from './report-template'

// `josh report:template summary|done [<path>...]` — print the work summary or the completion report
// skeleton in the session language. Each path is a file the change touches; it fills the target and
// changed-file lines, and for the summary its own change block, opened by the abnormal cases
// `josh cases` owes for it.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = `Usage: josh report:template ${report_template.KINDS.join('|')} [<path>...]`

// The owed cases follow the session language, so an English skeleton carries English conditions.
function change_for(path: string): ChangeInput {
	const { lang } = session_language.resolve_session_lang()

	return { path, abnormal_cases: cases.cases_for(cases.boundaries_in([path]), lang) }
}

function run(argv: ReadonlyArray<string>): number {
	const [kind = '', ...paths] = argv

	if (!report_template.is_kind(kind)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const changes = paths.map((path) => change_for(path))

	console.info(report_template.build(kind, changes, report_labels.session_labels()))

	return SUCCESS_EXIT_CODE
}

function main(argv: ReadonlyArray<string>): void {
	josh_environment_file.load_environment_file()
	process.exitCode = run(argv)
}

const report_template_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { report_template_cli }
