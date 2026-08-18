import { execaSync } from 'execa'
import { PROJECT_ROOT } from './init/init-paths'
import { security_updates_logic, type SecurityUpdatesStatus } from './security-updates-logic'
import { read_spawn_stdout } from './spawn-exit'

const SECURITY_FIXES_PATH = 'automated-security-fixes'
// Bounded, unlike the repository lookup: this call only decides what a report *says*, never what
// gets written, so a timeout degrades to `could not be read` and costs nothing. `josh doctor` made
// no network calls at all before joshuafolkken/kit#805, and this keeps it prompt.
const GH_TIMEOUT_MS = 5000

// Read the repository's Dependabot security-updates setting. Never throws and never propagates a
// non-zero exit: an unreadable answer is a reported status, not a command failure
// (joshuafolkken/kit#805).
function read_security_updates(repo: string): SecurityUpdatesStatus {
	const result = execaSync('gh', ['api', `repos/${repo}/${SECURITY_FIXES_PATH}`], {
		cwd: PROJECT_ROOT,
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})

	return security_updates_logic.classify_security_updates(
		result.exitCode ?? 1,
		read_spawn_stdout(result),
	)
}

// Report the repository's setting. A repository that cannot be resolved (no `gh`, not a GitHub
// remote) reports `unreadable` rather than skipping the check silently — the whole point of
// joshuafolkken/kit#805 is that an absent answer must not look like a clean one.
//
// `repo` is always supplied by the caller — deliberately not a default parameter. A default fires
// on an explicitly-passed `undefined`, so `josh sync` handing over a failed lookup would silently
// spawn `gh repo view` a second time, defeating the hoist in exactly the path where `gh` is already
// known to be failing.
function report_security_updates(repo: string | undefined): SecurityUpdatesStatus {
	const status = repo === undefined ? 'unreadable' : read_security_updates(repo)

	for (const line of security_updates_logic.format_security_updates_report(status, repo)) {
		console.info(line)
	}

	return status
}

// The blank-line-separated report block, shared by every caller so the separator, the ordering
// contract and any future timeout live in one place. `repo` is resolved by the caller: `josh init`
// and `josh sync` already resolve it for the Sonar config, and re-resolving here would spawn a
// second `gh repo view` (joshuafolkken/kit#805).
function report_security_updates_section(repo: string | undefined): SecurityUpdatesStatus {
	console.info('')

	return report_security_updates(repo)
}

const security_updates = {
	GH_TIMEOUT_MS,
	read_security_updates,
	report_security_updates,
	report_security_updates_section,
}

export { security_updates }
