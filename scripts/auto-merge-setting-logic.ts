import { repo_setting, type RepoSettingStatus } from './repo-setting'

// GitHub's repository-level "Allow auto-merge" setting, as reported by the `allow_auto_merge` field
// of `GET /repos/{owner}/{repo}`.
//
// joshuafolkken/kit#834 added `.github/workflows/dependabot-auto-merge.yml` to the distributed
// files, so a synced consumer now runs `gh pr merge --auto` on every github-actions patch and minor
// bump. That command needs this setting: without it the step fails with `Auto-merge is not allowed
// for this repository`, and the pull request sits green and unmerged — which is the exact state
// joshuafolkken/app-kit#184 was found in, and the same defect kit itself hit in
// joshuafolkken/kit#802. The setting is off by default, so distributing the workflow without
// reporting it would hand every consumer a workflow that never merges anything.
type AutoMergeStatus = RepoSettingStatus

const SETTING_LABEL = 'Repository auto-merge'
const ALLOW_AUTO_MERGE_FIELD = 'allow_auto_merge'
const ORIGIN_ISSUE = 'joshuafolkken/kit#834'
const WORKFLOW_PATH = '.github/workflows/dependabot-auto-merge.yml'

// The remediation for `disabled`, addressed at the repository the report actually resolved. kit
// prints it and never runs it: changing a repository setting is outward-facing, needs admin scope,
// and is the maintainer's call — the same line joshuafolkken/kit#805 drew for
// `automated-security-fixes`, which is why `josh doctor --fix` does not enable this either.
function enable_command(repo: string | undefined): string {
	return `gh api -X PATCH repos/${repo_setting.command_target(repo)} -f ${ALLOW_AUTO_MERGE_FIELD}=true`
}

// Classify one `gh api` result. A failed call, unparseable output and a non-boolean field all land
// on `unreadable`: a missing answer is not a negative answer, and reporting one as `disabled` would
// tell a maintainer to change a setting that may already be correct.
function classify_auto_merge(exit_code: number, stdout: string): AutoMergeStatus {
	return repo_setting.classify_boolean_setting(
		repo_setting.parse_payload(exit_code, stdout),
		ALLOW_AUTO_MERGE_FIELD,
	)
}

// What the reader loses while the setting is off, and how to get it back.
function format_disabled_detail(repo: string | undefined): ReadonlyArray<string> {
	return [
		`    off, so ${WORKFLOW_PATH} fails with`,
		'    `Auto-merge is not allowed for this repository` and Dependabot pull requests stay open.',
		`    Enable: ${enable_command(repo)}`,
		`    ${ORIGIN_ISSUE} distributes the workflow; kit never changes a repository setting.`,
	]
}

// Why the setting could not be read. The two branches have different causes and must not share
// wording: when the repository itself was never identified, admin access is beside the point and
// naming a settings page names no page the reader can open.
//
// For an identified repository the causes are listed rather than asserted. `allow_auto_merge` is
// absent from the response for a token without the right scope, and the same branch catches a 404,
// a timeout, an offline run and an unparseable body — so naming any one of them as the cause would
// be a false diagnosis. No enable command here either: it would be wrong whenever the setting is
// actually on and merely unreadable.
function format_unreadable_detail(repo: string | undefined): ReadonlyArray<string> {
	if (repo === undefined) {
		return [
			'    The repository could not be identified — `gh` is missing, unauthenticated, or this is',
			'    not a GitHub remote.',
		]
	}

	return [
		'    No admin access, or the request failed (offline, timed out, or an unexpected response).',
		"    Check Settings → General → Pull Requests → Allow auto-merge on the repository's page.",
	]
}

// The report block for one repository: a single status line, plus the consequence and its
// remediation when the setting is off, or the possible causes when it could not be read.
function format_auto_merge_report(
	status: AutoMergeStatus,
	repo: string | undefined,
): ReadonlyArray<string> {
	const target = repo_setting.report_target(repo)
	if (status === 'enabled') return [`  ✔ ${SETTING_LABEL}: enabled (${target})`]

	if (status === 'unreadable') {
		return [
			`  ⚠ ${SETTING_LABEL}: could not be read (${target}) — not checked, not necessarily off`,
			...format_unreadable_detail(repo),
		]
	}

	return [`  ⚠ ${SETTING_LABEL}: disabled (${target})`, ...format_disabled_detail(repo)]
}

const auto_merge_setting_logic = {
	SETTING_LABEL,
	ALLOW_AUTO_MERGE_FIELD,
	WORKFLOW_PATH,
	enable_command,
	classify_auto_merge,
	format_auto_merge_report,
}

export type { AutoMergeStatus }
export { auto_merge_setting_logic }
