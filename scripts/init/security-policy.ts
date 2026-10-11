import path from 'node:path'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { file_reader } from '#scripts/lib/read-file'

// A consumer's `SECURITY.md` is its own policy, not kit's: the advisory and release links have to
// name the repository the file lands in, and kit's account of its own published package is not a
// fact about that repository. So the consumer copy is written from a template of its own, with the
// repository filled in, and kit's root `SECURITY.md` stays kit's.
const SECURITY_MD = 'SECURITY.md'
const SECURITY_TEMPLATE = 'templates/SECURITY.md'
const REPOSITORY_PLACEHOLDER = '{{REPOSITORY}}'
const KIT_ADVISORY_URL = 'https://github.com/joshuafolkken/kit/security/advisories/new'
const UNRESOLVED_REASON = '`origin` is not a GitHub repository `owner/repo` can be read from'

// Read from the local `origin` rather than asked of GitHub: the basic profile decides whether to
// write the file from the same remote, and a policy file must not depend on `gh` being signed in.
function repository_at(root: string): string | undefined {
	const url = git_spawn_sync.origin_url(root)
	const identity = url === undefined ? undefined : repo_origin.parse_origin_url(url)

	return identity === undefined ? undefined : `${identity.owner}/${identity.repo}`
}

function apply_repository(content: string, repository: string): string {
	return content.replaceAll(REPOSITORY_PLACEHOLDER, () => repository)
}

// Throws rather than writing the placeholder through: both copy paths ask `did_skip_unresolved`
// first, so reaching here without a repository is a caller that skipped the question.
function apply_repository_for_destination(destination_path: string, content: string): string {
	if (path.basename(destination_path) !== SECURITY_MD) return content
	const repository = repository_at(path.dirname(destination_path))

	if (repository === undefined) {
		throw new Error(`${SECURITY_MD} needs a GitHub origin to name the repository it reports to`)
	}

	return apply_repository(content, repository)
}

// A full project synced before the template existed holds kit's own policy under this name, and the
// skip leaves that file on disk — still sending its readers to kit's advisory form.
function does_report_to_kit(root: string): boolean {
	const existing = file_reader.read_if_readable(path.join(root, SECURITY_MD))

	return existing?.includes(KIT_ADVISORY_URL) === true
}

function unresolved_warning(root: string): string {
	if (!does_report_to_kit(root)) return `  ⚠ skipped   ${SECURITY_MD} (${UNRESOLVED_REASON})`

	return `  ⚠ stale     ${SECURITY_MD} still reports vulnerabilities to joshuafolkken/kit — replace it with your own policy or delete it (${UNRESOLVED_REASON})`
}

// Without a GitHub `origin` there is no repository for the advisory link to name, so the file is
// left unwritten — the next `josh sync` after the remote is added writes it.
function did_skip_unresolved(filename: string, root: string): boolean {
	if (filename !== SECURITY_MD || repository_at(root) !== undefined) return false

	console.warn(unresolved_warning(root))

	return true
}

const security_policy = {
	SECURITY_MD,
	SECURITY_TEMPLATE,
	REPOSITORY_PLACEHOLDER,
	KIT_ADVISORY_URL,
	repository_at,
	apply_repository_for_destination,
	did_skip_unresolved,
}

export { security_policy }
