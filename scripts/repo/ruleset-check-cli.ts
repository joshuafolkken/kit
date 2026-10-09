#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { repo_setting } from './repo-setting'
import { required_checks_report, type RequiredChecksReport } from './required-checks-report'
import { ruleset_check } from './ruleset-check'

// `josh ruleset:check [--apply]` — say whether the default branch requires every status check kit's
// distributed workflows report, and with `--apply` add the missing ones.
// Changing a repository setting is outward-facing, so the write happens only on the flag a person
// typed; `josh sync` and `josh doctor` never pass it. Exits non-zero while anything is left to do.

const ARGV_OFFSET = 2
const APPLY_FLAG = '--apply'
const FAILURE_EXIT_CODE = 1

function exit_code_for(report: RequiredChecksReport): number {
	return required_checks_report.is_complete(report) ? 0 : FAILURE_EXIT_CODE
}

function apply(report: RequiredChecksReport): number {
	try {
		if (!ruleset_check.apply_missing(report)) return FAILURE_EXIT_CODE
	} catch (error) {
		console.error(`Could not add ${report.missing.join(', ')}: ${String(error)}`)

		return FAILURE_EXIT_CODE
	}

	console.info(`  ✔ Added: ${report.missing.join(', ')}`)

	return 0
}

function run(argv: ReadonlyArray<string>): number {
	const report = ruleset_check.inspect(gh_spawn.get_repo_name_with_owner(), PROJECT_ROOT)

	repo_setting.print_section(required_checks_report.format_report(report))
	const is_writable = argv.includes(APPLY_FLAG) && report.missing.length > 0

	return is_writable ? apply(report) : exit_code_for(report)
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const ruleset_check_cli = { APPLY_FLAG, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { ruleset_check_cli }
