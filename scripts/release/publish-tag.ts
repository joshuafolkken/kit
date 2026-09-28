import semver from 'semver'

function publish_tag(version: string, latest: string): string {
	if (!semver.valid(version) || !semver.valid(latest)) {
		throw new Error('Both package versions must be valid semantic versions')
	}

	return semver.gt(version, latest) ? 'latest' : 'backfill'
}

export { publish_tag }
