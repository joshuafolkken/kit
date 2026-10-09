import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { init_basic } from './init-basic'
import { init_install, type InstallStep } from './init-install'
import { init_logic_workspace } from './init-logic-workspace'
import { project_profile } from './project-profile'

const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
// The basic template lists exactly the build scripts kit's own dependency tree carries, which is
// what installing kit alone needs approved.
const KIT_BUILDS_TEMPLATE = 'templates/pnpm-workspace.basic.yaml'
const HANDOFF_FAILURE = 'josh init from the project-installed kit failed — see the output above'
// Set on the handed-off run, so a kit that still does not find itself installed in the project — pnpm
// put it somewhere else — stops instead of installing and handing off again without end.
const HANDOFF_ENV = 'JOSH_INIT_HANDED_OFF'
const REPEATED_HANDOFF = `the kit this project installed is not at ${NODE_MODULES}/${KIT_PACKAGE_NAME} — run \`pnpm exec josh init\` where it is`

const dependency_fields_schema = z.looseObject({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
})

function real_directory(directory: string): string | undefined {
	return existsSync(directory) ? realpathSync(directory) : undefined
}

// A `pnpm dlx` (or global) run executes whatever kit its cache held, which may be days behind the
// registry — and `init` pins the kit it runs as, so a stale cache used to leave its version and its
// templates in the project for good. Only the kit the project itself installs
// does the setup. Compared by real path, so a global virtual store shared with the project still
// reads as the project's own kit.
function is_project_kit(package_directory: string, project_root: string): boolean {
	const installed = real_directory(path.join(project_root, NODE_MODULES, KIT_PACKAGE_NAME))

	return installed !== undefined && installed === real_directory(package_directory)
}

function kit_build_flags(template: string): Array<string> {
	return [...init_logic_workspace.template_build_values(template)]
		.filter(([, value]) => value === 'true')
		.map(([name]) => `--allow-build=${name}`)
}

function has_kit_dependency(project_root: string): boolean {
	const manifest_path = path.join(project_root, PACKAGE_JSON)
	if (!existsSync(manifest_path)) return false
	const parsed: unknown = JSON.parse(readFileSync(manifest_path, 'utf8'))
	const manifest = dependency_fields_schema.parse(parsed)
	const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })

	return names.includes(KIT_PACKAGE_NAME)
}

// A project that already lists kit keeps the version it chose; otherwise pnpm picks it, under the
// project's own `minimumReleaseAge`, so the version installed is never the cache's decision.
function kit_install_step(has_kit: boolean, template: string): InstallStep {
	if (has_kit) return { label: 'pnpm install', command: 'pnpm', args: ['install'] }
	const args = ['add', '-D', ...kit_build_flags(template), KIT_PACKAGE_NAME]

	return { label: `pnpm ${args.join(' ')}`, command: 'pnpm', args }
}

function handoff_step(args: ReadonlyArray<string>): InstallStep {
	const handoff_args = ['exec', 'josh', 'init', ...project_profile.with_legacy_profile_names(args)]

	return {
		label: `pnpm ${handoff_args.join(' ')}`,
		command: 'pnpm',
		args: handoff_args,
		env: { [HANDOFF_ENV]: '1' },
	}
}

// pnpm walks up to the nearest `package.json`, so without one here it installs kit into whatever
// project an ancestor directory holds and rewrites that project's files.
function ensure_project_manifest(project_root: string): void {
	const manifest_path = path.join(project_root, PACKAGE_JSON)

	if (!existsSync(manifest_path)) writeFileSync(manifest_path, init_basic.initial_manifest())
}

// Returns the failure to report, or undefined once the project-installed kit finished the setup.
function hand_off(
	package_directory: string,
	project_root: string,
	args: ReadonlyArray<string>,
): string | undefined {
	if (process.env[HANDOFF_ENV] !== undefined) return REPEATED_HANDOFF
	console.info('\n🚀 Installing @joshuafolkken/kit into the project, then running its josh init')
	const template = readFileSync(path.join(package_directory, KIT_BUILDS_TEMPLATE), 'utf8')
	const install = kit_install_step(has_kit_dependency(project_root), template)

	ensure_project_manifest(project_root)
	if (!init_install.did_step_succeed(install, project_root)) return `${install.label} failed`
	if (!init_install.did_step_succeed(handoff_step(args), project_root)) return HANDOFF_FAILURE

	return undefined
}

const init_bootstrap = { is_project_kit, kit_build_flags, hand_off }
export { init_bootstrap }
