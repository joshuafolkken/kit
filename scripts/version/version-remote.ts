import { execaSync } from 'execa'

const GH_API_PATH = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'

function fetch_latest_version(): string {
	const { stdout } = execaSync('gh', ['api', GH_API_PATH, '--jq', '.[0].name'])

	return stdout.trim()
}

export { fetch_latest_version }
