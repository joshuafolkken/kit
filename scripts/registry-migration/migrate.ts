import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { z } from 'zod'
import { migrate_logic, type MigrationPlan } from './migrate-logic'
import { user_npmrc } from './user-npmrc'

const NPMRC = '.npmrc'
const LOCKFILE = 'pnpm-lock.yaml'
const WORKSPACE = 'pnpm-workspace.yaml'
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'
const FETCH_TIMEOUT_MS = 10_000
const SCOPE = '@joshuafolkken/'
const manifest_schema = z.looseObject({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
	optionalDependencies: z.record(z.string(), z.string()).optional(),
	peerDependencies: z.record(z.string(), z.string()).optional(),
})
const version_schema = z.looseObject({
	dist: z.looseObject({ integrity: z.string(), tarball: z.string() }),
})

interface VersionCheck {
	missing: ReadonlyArray<string>
	integrities: ReadonlyMap<string, string>
}

async function probe_integrity(
	name: string,
	version: string,
	probe_version: MigrationDependencies['fetch_version'],
): Promise<string | undefined> {
	if (!version) return undefined

	return await probe_version(name, version)
}

interface MigrationDependencies {
	fetch_version: (name: string, version: string) => Promise<string | undefined>
	install: (cwd: string) => Promise<void>
	effective_registry: (cwd: string) => Promise<string>
	user_npmrc: string
	environment: NodeJS.ProcessEnv
}

interface MigrationContext {
	cwd: string
	npmrc_path: string
	lockfile_path: string
	workspace_path: string
	original_npmrc: string
	original_lockfile: string
	original_workspace: string
	has_npmrc: boolean
	has_lockfile: boolean
	has_workspace: boolean
	plan: MigrationPlan
}

function read_file(file_path: string): string {
	return existsSync(file_path) ? readFileSync(file_path, 'utf8') : ''
}

function has_registry_override(environment: NodeJS.ProcessEnv): boolean {
	return Object.keys(environment).some((key) =>
		/^(?:npm|pnpm)_config_.*(?:joshuafolkken.*registry|userconfig)/iu.test(key),
	)
}

function manifest_packages(content: string): ReadonlyArray<string> {
	const manifest = manifest_schema.parse(JSON.parse(content))
	const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

	return sections.flatMap((section) => {
		const value: unknown = Reflect.get(manifest, section)
		if (typeof value !== 'object' || value === null) return []

		return Object.keys(value).filter((name) => name.startsWith(SCOPE))
	})
}

function restore(context: MigrationContext): void {
	if (context.has_npmrc) writeFileSync(context.npmrc_path, context.original_npmrc)
	else rmSync(context.npmrc_path, { force: true })
	writeFileSync(context.lockfile_path, context.original_lockfile)
	if (context.has_workspace) writeFileSync(context.workspace_path, context.original_workspace)
	else rmSync(context.workspace_path, { force: true })
}

async function verify_public_versions(
	lockfile: string,
	probe_version: MigrationDependencies['fetch_version'],
): Promise<VersionCheck> {
	const missing: Array<string> = []
	const integrities = new Map<string, string>()

	for (const [name, version] of migrate_logic.scoped_versions(lockfile)) {
		const integrity = await probe_integrity(name, version, probe_version)
		if (integrity === undefined) missing.push(`${name}@${version}`)
		else integrities.set(version, integrity)
	}

	return { missing, integrities }
}

function report_context(context: MigrationContext): void {
	console.info(`Current registry and planned change: ${context.plan.change}`)
	console.info(`Installed scoped packages: ${context.plan.packages.join(', ') || '(none)'}`)
}

function create_context(cwd: string, dependencies: MigrationDependencies): MigrationContext {
	const npmrc_path = path.join(cwd, NPMRC)
	const lockfile_path = path.join(cwd, LOCKFILE)
	const workspace_path = path.join(cwd, WORKSPACE)
	const original_npmrc = read_file(npmrc_path)
	const original_lockfile = read_file(lockfile_path)
	const original_workspace = read_file(workspace_path)
	const plan = migrate_logic.plan(original_npmrc, dependencies.user_npmrc, original_lockfile)

	return {
		cwd,
		npmrc_path,
		lockfile_path,
		workspace_path,
		original_npmrc,
		original_lockfile,
		original_workspace,
		plan,
		has_npmrc: existsSync(npmrc_path),
		has_lockfile: existsSync(lockfile_path),
		has_workspace: existsSync(workspace_path),
	}
}

function initial_block(
	context: MigrationContext,
	dependencies: MigrationDependencies,
): string | undefined {
	if (!context.has_lockfile) return 'No lockfile; run pnpm install before migrating.'
	const manifest = manifest_packages(read_file(path.join(context.cwd, 'package.json')))
	const missing_lock = manifest.filter((name) => !context.plan.packages.includes(name))
	const blocked = [...context.plan.blocked, ...missing_lock]
	if (!context.plan.packages.includes(`${SCOPE}kit`)) blocked.push('kit is absent from lockfile')
	if (has_registry_override(dependencies.environment)) blocked.push('registry environment override')
	if (blocked.length === 0) return undefined

	return `Migration blocked: ${blocked.join(', ')}. Keep GitHub Packages until every package is available on npm.`
}

async function verify_resolution(
	context: MigrationContext,
	dependencies: MigrationDependencies,
	integrities: ReadonlyMap<string, string>,
): Promise<void> {
	await dependencies.install(context.cwd)

	if (read_file(context.workspace_path) !== context.original_workspace) {
		throw new Error('pnpm changed pnpm-workspace.yaml outside the migration')
	}

	const actual = await dependencies.effective_registry(context.cwd)
	if (!actual.startsWith(PUBLIC_REGISTRY)) throw new Error(`effective registry is ${actual}`)
	const lockfile = read_file(context.lockfile_path)
	const old_tarballs = migrate_logic.github_tarballs(lockfile)
	if (old_tarballs.length > 0) throw new Error(`GitHub tarballs remain: ${old_tarballs.join(', ')}`)

	if (migrate_logic.rewrite_kit_lockfile(lockfile, integrities) !== lockfile) {
		throw new Error('lockfile integrity does not match public npm')
	}
}

async function apply(
	context: MigrationContext,
	dependencies: MigrationDependencies,
	integrities: ReadonlyMap<string, string>,
): Promise<string> {
	try {
		writeFileSync(context.npmrc_path, context.plan.content)
		writeFileSync(
			context.lockfile_path,
			migrate_logic.rewrite_kit_lockfile(context.original_lockfile, integrities),
		)
		await verify_resolution(context, dependencies, integrities)
	} catch (error) {
		restore(context)

		return `Migration blocked; original settings restored: ${String(error)}`
	}

	return 'Migrated to public npm. The project registry and lockfile now resolve from npm.'
}

function is_already_migrated(
	context: MigrationContext,
	integrities: ReadonlyMap<string, string>,
): boolean {
	return (
		context.plan.content === context.original_npmrc &&
		migrate_logic.rewrite_kit_lockfile(context.original_lockfile, integrities) ===
			context.original_lockfile
	)
}

async function migrate(cwd: string, dependencies: MigrationDependencies): Promise<string> {
	const context = create_context(cwd, dependencies)

	report_context(context)
	const block = initial_block(context, dependencies)
	if (block !== undefined) return block
	const version_check = await verify_public_versions(
		context.original_lockfile,
		dependencies.fetch_version,
	)

	if (version_check.missing.length > 0) {
		return `Migration blocked: unpublished on npm: ${version_check.missing.join(', ')}.`
	}

	if (is_already_migrated(context, version_check.integrities)) {
		return 'Already using public npm; no changes made.'
	}

	return await apply(context, dependencies, version_check.integrities)
}

async function fetch_version(name: string, version: string): Promise<string | undefined> {
	const encoded = encodeURIComponent(name)
	const response = await fetch(`${PUBLIC_REGISTRY}${encoded}/${encodeURIComponent(version)}`, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})

	if (!response.ok) return undefined
	const parsed = version_schema.safeParse(await response.json())
	if (!parsed.success || !parsed.data.dist.tarball.startsWith(PUBLIC_REGISTRY)) return undefined

	return parsed.data.dist.integrity
}

async function install(cwd: string): Promise<void> {
	await execa('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--force'], { cwd })
}

async function effective_registry(cwd: string): Promise<string> {
	const result = await execa('pnpm', ['config', 'get', '@joshuafolkken:registry'], { cwd })

	return result.stdout.trim()
}

async function main(): Promise<void> {
	const result = await migrate(process.cwd(), {
		fetch_version,
		install,
		effective_registry,
		user_npmrc: user_npmrc.read(),
		environment: process.env,
	})

	console.info(result)

	if (result.startsWith('Migration blocked') || result.startsWith('No lockfile')) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const registry_migration = { migrate }

export { registry_migration }
export type { MigrationDependencies }
