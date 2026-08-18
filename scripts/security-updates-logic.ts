// GitHub's Dependabot security-updates setting, as reported by
// `GET /repos/{owner}/{repo}/automated-security-fixes`.
//
// joshuafolkken/kit#803 set `open-pull-requests-limit: 0` on the npm entry of the distributed
// `.github/dependabot.yml`, which makes the security-advisory path the only remaining source of npm
// Dependabot PRs. That path depends on this repository-level setting, which is opt-in and off by
// default for private repositories — so a consumer that syncs the file without it gets zero npm
// Dependabot PRs, advisories included. The failure is silent: no PR looks exactly like no advisory
// (joshuafolkken/kit#805).
type SecurityUpdatesStatus = 'enabled' | 'paused' | 'disabled' | 'unreadable'

// The API payload. `paused` is absent from older responses, so it is optional.
interface SecurityUpdatesPayload {
	enabled?: unknown
	paused?: unknown
}

const SETTING_LABEL = 'Dependabot security updates'
const UNKNOWN_REPOSITORY = 'unknown repository'
const REPO_PLACEHOLDER = '<owner>/<repo>'
const ORIGIN_ISSUE = 'joshuafolkken/kit#803'

// The remediation for `disabled`, addressed at the repository the report actually resolved. A
// literal `<owner>/<repo>` would be unusable when pasted into a shell, where `<` redirects.
function enable_command(repo: string | undefined): string {
	return `gh api -X PUT repos/${repo ?? REPO_PLACEHOLDER}/automated-security-fixes`
}

function parse_payload(stdout: string): SecurityUpdatesPayload | undefined {
	try {
		const parsed: unknown = JSON.parse(stdout)

		return typeof parsed === 'object' && parsed !== null ? parsed : undefined
	} catch {
		return undefined
	}
}

// `paused` is held to the same standard as `enabled`: a present but non-boolean value means the
// payload is not the one this code was written against, and guessing `enabled` from it would print
// the false all-clear the module exists to prevent. Absent is the older response shape, not a pause.
function classify_active(paused: unknown): SecurityUpdatesStatus {
	if (paused === undefined) return 'enabled'
	if (typeof paused !== 'boolean') return 'unreadable'

	return paused ? 'paused' : 'enabled'
}

// Unparseable output, a missing `enabled`, or a non-boolean `enabled` are all unreadable: a missing
// answer is not a negative answer, and reporting one as `disabled` would raise a false alarm.
function classify_payload(payload: SecurityUpdatesPayload | undefined): SecurityUpdatesStatus {
	if (typeof payload?.enabled !== 'boolean') return 'unreadable'
	if (!payload.enabled) return 'disabled'

	return classify_active(payload.paused)
}

// Classify one `gh api` result. A non-zero exit covers every case where the answer cannot be
// trusted — 404 on a repository that never had the setting, a token without the scope, no network —
// and they collapse into `unreadable` because none of them proves the setting is off.
function classify_security_updates(exit_code: number, stdout: string): SecurityUpdatesStatus {
	return exit_code === 0 ? classify_payload(parse_payload(stdout)) : 'unreadable'
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
	const target = repo ?? UNKNOWN_REPOSITORY
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
	UNKNOWN_REPOSITORY,
	enable_command,
	classify_security_updates,
	is_exposed,
	format_security_updates_report,
}

export type { SecurityUpdatesStatus }
export { security_updates_logic }
