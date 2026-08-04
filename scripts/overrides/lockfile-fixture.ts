// The importer shape kit #744 reproduced: a dependency that pnpm-workspace.yaml overrides, whose
// package.json range sits above the override. Shared so the pure comparison tests and the
// `josh latest` integration tests assert against one document rather than two drifting copies.
const OVERRIDDEN_NAME = 'svelte'
const OVERRIDE_RANGE = '^5.55.7'
const RAW_MANIFEST_RANGE = '^5.56.8'
const RESOLVED_VERSION = '5.56.8'

const DEFAULT_GROUP = 'devDependencies'

function make_lockfile(specifier: string, group: string = DEFAULT_GROUP): string {
	return [
		"lockfileVersion: '9.0'",
		'',
		'importers:',
		'',
		'  .:',
		`    ${group}:`,
		`      ${OVERRIDDEN_NAME}:`,
		`        specifier: ${specifier}`,
		`        version: ${RESOLVED_VERSION}`,
		'',
	].join('\n')
}

const lockfile_fixture = {
	make_lockfile,
	OVERRIDDEN_NAME,
	OVERRIDE_RANGE,
	RAW_MANIFEST_RANGE,
	RESOLVED_VERSION,
}

export { lockfile_fixture }
