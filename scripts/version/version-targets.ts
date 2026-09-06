import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_version_schema, pnpm_ls_global_schema } from '#scripts/schemas'
import { execaSync } from 'execa'
import { safe_json_parse } from './parse-json'

const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'

// Build the `pnpm ls -g --json <package>` arguments for the package being checked.
function build_pnpm_ls_arguments(package_name: string): Array<string> {
	return ['ls', '-g', '--json', package_name]
}

// Read the globally installed version from `pnpm ls -g --json` output. Returns undefined when
// the package is absent or the output cannot be parsed (e.g. pnpm missing, empty stdout).
function parse_global_version(stdout: string, package_name: string): string | undefined {
	const parsed = pnpm_ls_global_schema.safeParse(safe_json_parse(stdout))
	if (!parsed.success) return undefined

	return parsed.data[0]?.dependencies?.[package_name]?.version
}

// Read the project-local version from a node_modules package.json string. Undefined when the
// file is missing (raw is undefined) or malformed.
function parse_project_version(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined
	const parsed = package_version_schema.safeParse(safe_json_parse(raw))

	return parsed.success ? parsed.data.version : undefined
}

function read_global_version(package_name: string): string | undefined {
	const result = execaSync('pnpm', build_pnpm_ls_arguments(package_name), { reject: false })

	return parse_global_version(result.stdout, package_name)
}

function project_package_path(cwd: string, package_name: string): string {
	return path.join(cwd, NODE_MODULES, package_name, PACKAGE_JSON)
}

function read_project_version(cwd: string, package_name: string): string | undefined {
	const package_path = project_package_path(cwd, package_name)
	const raw = existsSync(package_path) ? readFileSync(package_path, 'utf8') : undefined

	return parse_project_version(raw)
}

// Read the current project's own declared version from <cwd>/package.json. This is the version
// that `josh bump` increments — distinct from read_project_version, which reads the installed kit
// package version under node_modules.
function read_workspace_version(cwd: string): string | undefined {
	const package_path = path.join(cwd, PACKAGE_JSON)
	const raw = existsSync(package_path) ? readFileSync(package_path, 'utf8') : undefined

	return parse_project_version(raw)
}

// `format_project_version_line` / `project_version_line` lived here and formatted
// `📦 project version: <v>` for the end of a workflow. Both are gone (joshuafolkken/kit#1486): a
// child no longer bumps, so the local manifest names the *previous* release rather than what the run
// ships, and every caller now prints the count of unreleased merges instead
// (`scripts/git/git-followup-pending.ts`). Removed rather than left unused, so nothing reaches for
// the misleading reading again.

const version_targets = {
	build_pnpm_ls_arguments,
	parse_global_version,
	parse_project_version,
	read_global_version,
	read_project_version,
	project_package_path,
	read_workspace_version,
	// The manifest's filename. Exported rather than re-declared in each of `josh release`'s two
	// halves (joshuafolkken/kit#1169): the module that already owns "where the project's manifest is"
	// is where the name belongs.
	PACKAGE_JSON,
}

export { version_targets }
