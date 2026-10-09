import path from 'node:path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { gh_failure } from '#scripts/gh/git-gh-failure'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_reader } from '#scripts/lib/read-file'
import { repo_setting } from './repo-setting'
import { required_checks_logic, type ApiRead, type RequiredSource } from './required-checks-logic'
import { required_checks_report, type RequiredChecksReport } from './required-checks-report'

// Read a repository's required status checks on its default branch and compare them with the checks
// kit's distributed workflows report. Every read degrades to `unreadable`
// rather than throwing; the one write, `apply_missing`, runs only on `josh ruleset:check --apply`.

function read_api(api_path: string): string | undefined {
	return git_gh_exec.read_gh_api_sync({
		path: api_path,
		cwd: PROJECT_ROOT,
		timeout_ms: repo_setting.GH_TIMEOUT_MS,
	})
}

function read_default_branch(repo: string): string | undefined {
	const branch = git_gh_exec
		.read_gh_api_sync({
			path: `repos/${repo}`,
			jq_filter: '.default_branch',
			cwd: PROJECT_ROOT,
			timeout_ms: repo_setting.GH_TIMEOUT_MS,
		})
		?.trim()

	return branch === '' ? undefined : branch
}

// Unlike `read_api`, keeps the failure's HTTP status: a 404 here means "no protection", which is an
// answer, while any other failure is not.
function read_protection(repo: string, branch: string): ApiRead {
	try {
		const stdout = git_gh_exec.exec_gh_api_sync({
			path: `repos/${repo}/branches/${branch}/protection/required_status_checks`,
			cwd: PROJECT_ROOT,
			timeout_ms: repo_setting.GH_TIMEOUT_MS,
		})

		return { kind: 'body', stdout }
	} catch (error) {
		return { kind: 'failed', status: gh_failure.failure_of(error)?.status }
	}
}

// Rulesets and classic branch protection both, since GitHub enforces both; unreadable rules stop
// there rather than letting protection alone pass for the whole answer.
function read_source(repo: string, branch: string): RequiredSource {
	const from_rules = required_checks_logic.parse_branch_rules(
		read_api(`repos/${repo}/rules/branches/${branch}`),
	)
	if (from_rules.kind === 'unreadable') return from_rules
	const from_protection = required_checks_logic.parse_protection(read_protection(repo, branch))

	return required_checks_logic.combine_sources(from_rules, from_protection)
}

// The checks `root` should require, decided by the jobs its distributed workflows define on disk.
function expected_in(root: string): Array<string> {
	return required_checks_logic.expected_checks((workflow) =>
		file_reader.read_if_readable(path.join(root, workflow)),
	)
}

function contexts_of(source: RequiredSource): ReadonlyArray<string> {
	return source.kind === 'ruleset' || source.kind === 'protection' ? source.contexts : []
}

function inspect(repo: string | undefined, root: string): RequiredChecksReport {
	const expected = expected_in(root)
	const branch = repo === undefined ? undefined : read_default_branch(repo)
	const source: RequiredSource =
		repo === undefined || branch === undefined ? { kind: 'unreadable' } : read_source(repo, branch)
	const missing =
		source.kind === 'unreadable'
			? []
			: required_checks_logic.missing_checks(expected, contexts_of(source))

	return { repo, branch, source, expected, missing }
}

function apply_to_ruleset(repo: string, ruleset_id: number, missing: ReadonlyArray<string>): void {
	const api_path = `repos/${repo}/rulesets/${String(ruleset_id)}`
	const current = git_gh_exec.exec_gh_api_sync({ path: api_path, cwd: PROJECT_ROOT })
	const body = required_checks_logic.ruleset_update_body(current, missing)
	if (body === undefined) throw new Error(`Unexpected ruleset response from ${api_path}`)

	git_gh_exec.exec_gh_api_sync({ path: api_path, method: 'PUT', body, cwd: PROJECT_ROOT })
}

function apply_to_protection(repo: string, branch: string, missing: ReadonlyArray<string>): void {
	git_gh_exec.exec_gh_api_sync({
		path: `repos/${repo}/branches/${branch}/protection/required_status_checks/contexts`,
		method: 'POST',
		body: required_checks_logic.protection_update_body(missing),
		cwd: PROJECT_ROOT,
	})
}

function apply_to_source(
	repo: string,
	branch: string,
	source: RequiredSource,
	missing: ReadonlyArray<string>,
): boolean {
	if (source.kind === 'ruleset') {
		apply_to_ruleset(repo, source.ruleset_id, missing)

		return true
	}

	if (source.kind !== 'protection') return false
	apply_to_protection(repo, branch, missing)

	return true
}

// The one write: append the missing checks to the rule that already requires checks. A repository
// with neither a ruleset rule nor protection gets nothing created for it, which `format_report`
// explains. Throws on a failed request so the caller can report it; `false` when nothing was written.
function apply_missing(report: RequiredChecksReport): boolean {
	const { repo, branch, source, missing } = report
	if (repo === undefined || branch === undefined || missing.length === 0) return false

	return apply_to_source(repo, branch, source, missing)
}

// The `josh doctor` section: read, never write.
function report_required_checks_section(
	repo: string | undefined,
	root: string,
): RequiredChecksReport {
	const report = inspect(repo, root)

	repo_setting.print_section(required_checks_report.format_report(report))

	return report
}

const ruleset_check = { expected_in, inspect, apply_missing, report_required_checks_section }

export { ruleset_check }
