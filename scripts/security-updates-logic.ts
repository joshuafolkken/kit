import { repo_setting, type RepoSettingStatus } from './repo-setting'

// GitHub's Dependabot security-updates setting, as reported by
// `GET /repos/{owner}/{repo}/automated-security-fixes`.
//
// joshuafolkken/kit#803 set `open-pull-requests-limit: 0` on the npm entry of the distributed
// `.github/dependabot.yml`, which makes the security-advisory path the only remaining source of npm
// Dependabot PRs. That path depends on this repository-level setting, which is opt-in and off by
// default for private repositories — so a consumer that syncs the file without it gets zero npm
// Dependabot PRs, advisories included. The failure is silent: no PR looks exactly like no advisory
// (joshuafolkken/kit#805).
//
// `paused` is this setting's own third state, which is why the shared two-state classifier is only
// half the answer here (see classify_security_updates).
type SecurityUpdatesStatus = RepoSettingStatus | 'paused'

const SETTING_LABEL = 'Dependabot security updates'
const ENABLED_FIELD = 'enabled'
const PAUSED_FIELD = 'paused'
const ORIGIN_ISSUE = 'joshuafolkken/kit#803'

// The remediation for `disabled`, addressed at the repository the report actually resolved.
function enable_command(repo: string | undefined): string {
	return `gh api -X PUT repos/${repo_setting.command_target(repo)}/automated-security-fixes`
}

// `paused` is held to the same standard as `enabled`: a present but non-boolean value means the
// payload is not the one this code was written against, and guessing `enabled` from it would print
// the false all-clear the module exists to prevent. Absent is the older response shape, not a pause.
function classify_active(paused: unknown): SecurityUpdatesStatus {
	if (paused === undefined) return 'enabled'
	if (typeof paused !== 'boolean') return 'unreadable'

	return paused ? 'paused' : 'enabled'
}

// Classify one `gh api` result. The shared classifier answers `enabled` / `disabled` / `unreadable`
// off the `enabled` field — a failed call, unparseable output and a non-boolean field all landing on
// `unreadable` — and only an affirmative answer is refined further by `paused`.
function classify_security_updates(exit_code: number, stdout: string): SecurityUpdatesStatus {
	const payload = repo_setting.parse_payload(exit_code, stdout)
	const status = repo_setting.classify_boolean_setting(payload, ENABLED_FIELD)
	if (status !== 'enabled') return status

	return classify_active(repo_setting.read_field(payload, PAUSED_FIELD))
}

// Whether the status leaves npm security advisories unable to open a PR. `unreadable` is excluded:
// it is worth reporting but it is not evidence of exposure.
function is_exposed(status: SecurityUpdatesStatus): boolean {
	return status === 'disabled' || status === 'paused'
}

// `disabled` and `paused` need different advice. The enable endpoint is a no-op on a paused
// repository — it is already `enabled: true` — so printing it there would send the reader in a
// circle and the same warning would return on the next sync.
function format_exposed_detail(
	status: SecurityUpdatesStatus,
	repo: string | undefined,
): ReadonlyArray<string> {
	const remediation =
		status === 'paused'
			? [
					'    enabled but paused, so no advisory pull request is opened.',
					"    Resume it from the repository's Security → Dependabot page; re-running the enable",
					'    API does not clear a pause.',
				]
			: [
					'    off, so npm advisories open no pull request at all.',
					`    Enable: ${enable_command(repo)}`,
				]

	return [
		...remediation,
		`    ${ORIGIN_ISSUE} disabled npm version updates, so this is the only remaining npm path.`,
	]
}

// Why the setting could not be read. The two branches have different causes and must not share
// wording: when the repository itself was never identified, admin access and Dependabot's state are
// both beside the point, and pointing at a Security page names no page the reader can open.
//
// For an identified repository the causes are listed rather than asserted. GitHub answers 404 both
// for a token without admin access and for a repository where Dependabot is not enabled, and the
// same branch catches a timeout, an offline run and an unparseable body — so naming any one of them
// as the cause would be a false diagnosis. No enable command here either: it would be wrong whenever
// the setting is actually on and merely unreadable.
function format_unreadable_detail(repo: string | undefined): ReadonlyArray<string> {
	if (repo === undefined) {
		return [
			'    The repository could not be identified — `gh` is missing, unauthenticated, or this is',
			'    not a GitHub remote.',
		]
	}

	return [
		'    No admin access, Dependabot not enabled for the repository, or the request failed',
		'    (offline, timed out, or an unexpected response).',
		"    Check the repository's Security → Dependabot page.",
	]
}

// The report block for one repository: a single status line, plus the cause and its remediation when
// the repository is exposed, or the two possible causes when the setting could not be read.
function format_security_updates_report(
	status: SecurityUpdatesStatus,
	repo: string | undefined,
): ReadonlyArray<string> {
	const target = repo_setting.report_target(repo)
	if (status === 'enabled') return [`  ✔ ${SETTING_LABEL}: enabled (${target})`]

	if (!is_exposed(status)) {
		return [
			`  ⚠ ${SETTING_LABEL}: could not be read (${target}) — not checked, not necessarily off`,
			...format_unreadable_detail(repo),
		]
	}

	return [`  ⚠ ${SETTING_LABEL}: ${status} (${target})`, ...format_exposed_detail(status, repo)]
}

const security_updates_logic = {
	SETTING_LABEL,
	enable_command,
	classify_security_updates,
	is_exposed,
	format_security_updates_report,
}

export type { SecurityUpdatesStatus }
export { security_updates_logic }
