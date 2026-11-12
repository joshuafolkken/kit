import { npm_registry } from '#scripts/version/npm-registry'
import { PROJECT_ROOT } from './init-paths'
import type { ProjectShape } from './project-profile'

// kit's own publish workflow, copied as it is: it reads the package and tarball names from
// package.json, so kit and every published kit run the one file. Only a repository npm already
// carries under kit's scope receives it (`npm_registry.published_package_name`); any other is left
// alone, an existing file included. Kept out of the static copy list because the answer needs the
// registry.
const PUBLISH_WORKFLOW = '.github/workflows/publish.yml'

// A basic project and one without GitHub take no workflow, so the registry is not asked for them.
function can_take_workflow(shape?: ProjectShape): boolean {
	return shape?.profile !== 'basic' && shape?.has_github !== false
}

function files(shape?: ProjectShape): ReadonlyArray<string> {
	if (!can_take_workflow(shape)) return []

	return npm_registry.published_package_name(PROJECT_ROOT) === undefined ? [] : [PUBLISH_WORKFLOW]
}

const npm_publish_files = { files, PUBLISH_WORKFLOW }

export { npm_publish_files }
