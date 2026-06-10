import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_version_schema, pnpm_ls_global_schema } from '#scripts/schemas'
import { execaSync } from 'execa'

const PACKAGE_NAME = '@joshuafolkken/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const PNPM_LS_ARGUMENTS = ['ls', '-g', '--json', PACKAGE_NAME] as const
const PROJECT_VERSION_ICON = '📦'

function safe_json_parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

// Read the globally installed version from `pnpm ls -g --json` output. Returns undefined when
// the package is absent or the output cannot be parsed (e.g. pnpm missing, empty stdout).
function parse_global_version(stdout: string): string | undefined {
	const parsed = pnpm_ls_global_schema.safeParse(safe_json_parse(stdout))
	if (!parsed.success) return undefined

	return parsed.data[0]?.dependencies?.[PACKAGE_NAME]?.version
}

// Read the project-local version from a node_modules package.json string. Undefined when the
// file is missing (raw is undefined) or malformed.
function parse_project_version(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined
	const parsed = package_version_schema.safeParse(safe_json_parse(raw))

	return parsed.success ? parsed.data.version : undefined
}

function read_global_version(): string | undefined {
	const result = execaSync('pnpm', [...PNPM_LS_ARGUMENTS], { reject: false })

	return parse_global_version(result.stdout)
}

function project_package_path(cwd: string): string {
	return path.join(cwd, NODE_MODULES, PACKAGE_NAME, PACKAGE_JSON)
}

function read_project_version(cwd: string): string | undefined {
	const package_path = project_package_path(cwd)
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

// Format the project version as a display line, or undefined when the version is unknown.
function format_project_version_line(version: string | undefined): string | undefined {
	if (version === undefined) return undefined

	return `${PROJECT_VERSION_ICON} project version: ${version}`
}

// Read and format the current project's version line for display at workflow completion.
// Undefined when <cwd>/package.json is missing or malformed.
function project_version_line(cwd: string): string | undefined {
	return format_project_version_line(read_workspace_version(cwd))
}

const version_targets = {
	parse_global_version,
	parse_project_version,
	read_global_version,
	read_project_version,
	project_package_path,
	read_workspace_version,
	format_project_version_line,
	project_version_line,
}

export { version_targets }
