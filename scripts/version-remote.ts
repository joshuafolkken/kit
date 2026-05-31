import { execFileSync } from 'node:child_process'

const GH_API_PATH = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'

function fetch_latest_version(): string {
	const output = execFileSync('gh', ['api', GH_API_PATH, '--jq', '.[0].name'])

	return output.toString().trim()
}

export { fetch_latest_version }
