import path from 'node:path'
import { file_reader } from '#scripts/lib/read-file'
import { yaml_document } from '#scripts/lib/yaml-document'
import { z } from 'zod'
import { release_age } from './release-age'

// The release-age window a workspace declares — its minutes and the packages exempt from it. This is
// the one reading every mirror of the window derives from: Safe Chain's `.aikido` and Dependabot's
// `cooldown` both take it from here rather than parsing `pnpm-workspace.yaml` themselves.
const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const exclusions_schema = z.object({ minimumReleaseAgeExclude: z.array(z.string()).optional() })

// The window a project without a declared one is held to, in minutes (three days). kit's own
// `pnpm-workspace.yaml` declares the same value.
const DEFAULT_RELEASE_AGE_MINUTES = 4320

interface ReleaseWindow {
	minutes: number | undefined
	exclusions: ReadonlyArray<string>
}

function parse_release_window(workspace: string): ReleaseWindow {
	const exclusions = exclusions_schema.parse(yaml_document.parse_yaml(workspace))

	return {
		minutes: release_age.parse_declared_minimum_release_age(workspace),
		exclusions: exclusions.minimumReleaseAgeExclude ?? [],
	}
}

// An absent workspace file reads as an empty one: no declared window and no exclusions.
function read_release_window(root: string): ReleaseWindow {
	return parse_release_window(file_reader.read_file_or_empty(path.join(root, WORKSPACE_FILE)))
}

const release_window = { parse_release_window, read_release_window }

export { DEFAULT_RELEASE_AGE_MINUTES, release_window, type ReleaseWindow }
