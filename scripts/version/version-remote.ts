import { execaSync } from 'execa'

const GH_FAILURE_FALLBACK = 'gh api failed'

// Guard an undefined/empty endpoint before it reaches `gh api` — otherwise the CLI would run
// `gh api undefined` and surface a raw 404 ExecaSyncError. Narrows to a concrete string.
function require_endpoint(versions_endpoint: string | undefined, package_name: string): string {
	if (versions_endpoint !== undefined && versions_endpoint.trim() !== '') return versions_endpoint

	throw new Error(
		`Could not derive a versions endpoint for ${package_name}; check its version-command config.`,
	)
}

// Turn a failed `gh api` result into a concise detail line: prefer gh's own stderr
// (e.g. "gh: Not Found (HTTP 404)"), falling back to execa's short message.
function describe_failure(result: { stderr: string; shortMessage?: string | undefined }): string {
	const stderr = result.stderr.trim()

	if (stderr !== '') return stderr

	return result.shortMessage ?? GH_FAILURE_FALLBACK
}

// Fetch the latest published version from a GitHub Packages versions endpoint. The endpoint is
// supplied per package (e.g. `/users/joshuafolkken/packages/npm/kit/versions?per_page=1`) so the
// same fetcher serves kit, jgame, and app-kit. Guards an undefined/empty endpoint and wraps
// `gh api` failures with an actionable message instead of a raw ExecaSyncError stack.
function fetch_latest_version(versions_endpoint: string | undefined, package_name: string): string {
	const endpoint = require_endpoint(versions_endpoint, package_name)
	const result = execaSync('gh', ['api', endpoint, '--jq', '.[0].name'], { reject: false })

	if (result.exitCode === 0) return result.stdout.trim()

	throw new Error(
		`Failed to fetch latest version for ${package_name} via ${endpoint}: ${describe_failure(result)}`,
	)
}

export { fetch_latest_version }
