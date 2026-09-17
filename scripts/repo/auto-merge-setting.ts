import { auto_merge_setting_logic, type AutoMergeStatus } from './auto-merge-setting-logic'
import { repo_setting } from './repo-setting'

// Read the repository's "Allow auto-merge" setting. Never throws and never propagates a non-zero
// exit: an unreadable answer is a reported status, not a command failure (joshuafolkken/kit#834).
//
// The whole repository object is requested rather than a `--jq` projection, because a projection
// cannot distinguish a field that is `false` from a field the response never carried — and that
// distinction is the entire point of the `unreadable` status.
function read_auto_merge(repo: string): AutoMergeStatus {
	const { exit_code, stdout } = repo_setting.query_repo_api(`repos/${repo}`)

	return auto_merge_setting_logic.classify_auto_merge(exit_code, stdout)
}

// Report the repository's setting as a blank-line-separated block. A repository that cannot be
// resolved (no `gh`, not a GitHub remote) reports `unreadable` rather than skipping the check
// silently: an absent answer must not look like a clean one.
//
// `repo` is supplied by the caller rather than defaulted, for the same reason as the
// security-updates report — a default parameter fires on an explicitly-passed `undefined` and would
// re-spawn `gh repo view` in the very path where the caller's own lookup already failed.
function report_auto_merge_section(repo: string | undefined): AutoMergeStatus {
	const status = repo === undefined ? 'unreadable' : read_auto_merge(repo)

	repo_setting.print_section(auto_merge_setting_logic.format_auto_merge_report(status, repo))

	return status
}

const auto_merge_setting = {
	GH_TIMEOUT_MS: repo_setting.GH_TIMEOUT_MS,
	read_auto_merge,
	report_auto_merge_section,
}

export { auto_merge_setting }
