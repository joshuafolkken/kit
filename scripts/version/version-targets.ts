import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { package_manifest } from '#scripts/lib/package-manifest'
import { package_version_schema, pnpm_ls_global_schema } from '#scripts/lib/schemas'
import { execaSync } from 'execa'

const NODE_MODULES = 'node_modules'

// Build the `pnpm ls -g --json <package>` arguments for the package being checked.
function build_pnpm_ls_arguments(package_name: string): Array<string> {
	return ['ls', '-g', '--json', package_name]
}

// Read the globally installed version from `pnpm ls -g --json` output. Returns undefined when
// the package is absent or the output cannot be parsed (e.g. pnpm missing, empty stdout).
function parse_global_version(stdout: string, package_name: string): string | undefined {
	const parsed = pnpm_ls_global_schema.safeParse(json_value.parse_or_undefined(stdout))
	if (!parsed.success) return undefined

	return parsed.data[0]?.dependencies?.[package_name]?.version
}

function read_global_version(package_name: string): string | undefined {
	const result = execaSync('pnpm', build_pnpm_ls_arguments(package_name), { reject: false })

	return parse_global_version(result.stdout, package_name)
}

// Read the project-local version from <cwd>/node_modules/<package>/package.json. Undefined when the
// file is missing or malformed.
function read_project_version(cwd: string, package_name: string): string | undefined {
	const package_directory = path.join(cwd, NODE_MODULES, package_name)

	return package_manifest.read_manifest_if_valid(package_directory, package_version_schema)?.version
}

// Read the current project's own declared version from <cwd>/package.json. This is the version
// that `josh bump` increments — distinct from read_project_version, which reads the installed kit
// package version under node_modules.
function read_workspace_version(cwd: string): string | undefined {
	return package_manifest.read_manifest_if_valid(cwd, package_version_schema)?.version
}

// `format_project_version_line` / `project_version_line` lived here and formatted
// `📦 project version: <v>` for the end of a workflow. Both are gone: a
// child no longer bumps, so the local manifest names the *previous* release rather than what the run
// ships, and every caller now prints the count of unreleased merges instead
// (`scripts/followup/git-followup-pending.ts`). Removed rather than left unused, so nothing reaches for
// the misleading reading again.

const version_targets = {
	build_pnpm_ls_arguments,
	parse_global_version,
	read_global_version,
	read_project_version,
	read_workspace_version,
}

export { version_targets }
