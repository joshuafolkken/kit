import { repo_setting } from './repo-setting'
import { security_updates_logic, type SecurityUpdatesStatus } from './security-updates-logic'

const SECURITY_FIXES_PATH = 'automated-security-fixes'

// Read the repository's Dependabot security-updates setting. Never throws and never propagates a
// non-zero exit: an unreadable answer is a reported status, not a command failure
// (joshuafolkken/kit#805).
function read_security_updates(repo: string): SecurityUpdatesStatus {
	const { exit_code, stdout } = repo_setting.query_repo_api(`repos/${repo}/${SECURITY_FIXES_PATH}`)

	return security_updates_logic.classify_security_updates(exit_code, stdout)
}

// Report the repository's setting as a blank-line-separated block. A repository that cannot be
// resolved (no `gh`, not a GitHub remote) reports `unreadable` rather than skipping the check
// silently — the whole point of joshuafolkken/kit#805 is that an absent answer must not look like a
// clean one.
//
// `repo` is always supplied by the caller — deliberately not a default parameter. A default fires
// on an explicitly-passed `undefined`, so `josh sync` handing over a failed lookup would silently
// spawn `gh repo view` a second time, defeating the hoist in exactly the path where `gh` is already
// known to be failing. `josh init` and `josh sync` already resolve the name for the Sonar config.
function report_security_updates_section(repo: string | undefined): SecurityUpdatesStatus {
	const status = repo === undefined ? 'unreadable' : read_security_updates(repo)

	repo_setting.print_section(security_updates_logic.format_security_updates_report(status, repo))

	return status
}

const security_updates = {
	GH_TIMEOUT_MS: repo_setting.GH_TIMEOUT_MS,
	read_security_updates,
	report_security_updates_section,
}

export { security_updates }
