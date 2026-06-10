import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_version_schema, pnpm_ls_global_schema } from '#scripts/schemas'
import { execaSync } from 'execa'

const PACKAGE_NAME = '@joshuafolkken/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const PNPM_LS_ARGUMENTS = ['ls', '-g', '--json', PACKAGE_NAME] as const

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

const version_targets = {
	parse_global_version,
	parse_project_version,
	read_global_version,
	read_project_version,
	project_package_path,
}

export { version_targets }
