import type { ReleaseSettings } from './github-release'

interface ReleaseInput {
	token: string
	tag: string
	settings: ReleaseSettings
}

type Environment = Readonly<Record<string, string | undefined>>

// A workflow expression renders an unset input as the empty string, so empty means "not given".
function optional(value: string | undefined): string | undefined {
	return value === undefined || value === '' ? undefined : value
}

function job_names(value: string | undefined): ReadonlyArray<string> {
	return (optional(value) ?? '')
		.split(',')
		.map((name) => name.trim())
		.filter((name) => name !== '')
}

function read_release_input(environment: Environment): ReleaseInput {
	const token = optional(environment['GH_TOKEN'])
	const tag = optional(environment['RELEASE_TAG'])
	const repository = optional(environment['GITHUB_REPOSITORY'])

	if (!token || !tag || !repository) {
		throw new Error('GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY are required')
	}

	return {
		token,
		tag,
		settings: {
			repository,
			start_tag: optional(environment['RELEASE_START_TAG']),
			workflow: optional(environment['RELEASE_WORKFLOW']),
			jobs: job_names(environment['RELEASE_JOBS']),
		},
	}
}

const github_release_environment = { read_release_input }

export { github_release_environment }
