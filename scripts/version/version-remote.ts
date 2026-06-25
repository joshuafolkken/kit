import { execaSync } from 'execa'

// Fetch the latest published version from a GitHub Packages versions endpoint. The endpoint is
// supplied per package (e.g. `/users/joshuafolkken/packages/npm/kit/versions?per_page=1`) so the
// same fetcher serves kit, jgame, and app-kit.
function fetch_latest_version(versions_endpoint: string): string {
	const { stdout } = execaSync('gh', ['api', versions_endpoint, '--jq', '.[0].name'])

	return stdout.trim()
}

export { fetch_latest_version }
