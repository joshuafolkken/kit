import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { timed_fetch } from '#scripts/lib/timed-fetch'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { npm_registry } from '#scripts/version/npm-registry'
import { execaSync } from 'execa'
import { migrate_files } from './migrate-files'
import { migrate_lock, type LockedArtifact } from './migrate-lock'

interface PublicArtifact {
	name: string
	version: string
	dist: { tarball: string; integrity: string }
}

interface MigrationDependencies {
	publication: (name: string, version: string) => PublicArtifact | undefined
	download: (url: string) => Promise<Uint8Array>
	resolve: (directory: string) => void
	pnpm_version: () => string
}

async function download(url: string): Promise<Uint8Array> {
	if (!url.startsWith(migrate_lock.REGISTRY)) throw new Error(`Non-npm artifact refused: ${url}`)
	const response = await timed_fetch(url, {
		redirect: 'error',
	})

	if (!response.ok) {
		throw new Error(`npm artifact request failed: ${String(response.status)} ${url}`)
	}

	return new Uint8Array(await response.arrayBuffer())
}

function resolve(directory: string): void {
	execaSync(
		'pnpm',
		[
			'update',
			'--patches',
			'--lockfile-only',
			'--ignore-scripts',
			'--ignore-pnpmfile',
			'--lockfile-dir',
			realpathSync(directory),
		],
		{
			cwd: directory,
			timeout: COMMAND_TIMEOUT_MS,
			stdio: 'pipe',
		},
	)
}

function pnpm_version(): string {
	return execaSync('pnpm', ['--version'], { timeout: COMMAND_TIMEOUT_MS }).stdout.trim()
}

function assert_lockfile_directory(root: string): void {
	const directory = execaSync('pnpm', ['config', 'get', 'lockfile-dir'], {
		cwd: root,
		timeout: COMMAND_TIMEOUT_MS,
	}).stdout.trim()
	if (directory === 'undefined') return
	const configured = path.resolve(root, directory)

	if (!existsSync(configured) || realpathSync(configured) !== realpathSync(root)) {
		throw new Error('Nonstandard lockfile directory refused; no files changed')
	}
}

const defaults: MigrationDependencies = {
	publication: npm_registry.read_public_version,
	download,
	resolve,
	pnpm_version,
}
const LOCKFILE = 'pnpm-lock.yaml'
const WORKSPACE = 'pnpm-workspace.yaml'
const MANIFEST = 'package.json'

function assert_workspace_root(root: string): void {
	for (
		let parent = path.dirname(root);
		parent !== path.dirname(parent);
		parent = path.dirname(parent)
	) {
		if (existsSync(path.join(parent, WORKSPACE))) {
			throw new Error('Run from the pnpm workspace root; no files changed')
		}
	}
}

function assert_inputs(root: string, staged: string): void {
	const lock = migrate_files.read(staged, LOCKFILE).content ?? ''
	const files = new Set([MANIFEST, WORKSPACE, ...migrate_lock.importer_manifests(lock)])

	for (const file of files) {
		if (migrate_files.read(root, file).content !== migrate_files.read(staged, file).content) {
			throw new Error(`Resolution input changed: ${file}; no files changed`)
		}
	}
}

function sha512(bytes: Uint8Array): string {
	return `sha512-${createHash('sha512').update(bytes).digest('base64')}`
}

async function verify(locked: LockedArtifact, dependencies: MigrationDependencies): Promise<void> {
	const spec = `${locked.name}@${locked.version}`
	const publication = dependencies.publication(locked.name, locked.version)
	if (publication === undefined) throw new Error(`npm publication missing or unreachable: ${spec}`)
	const integrity = sha512(await dependencies.download(publication.dist.tarball))

	if (integrity !== publication.dist.integrity) {
		throw new Error(`npm artifact integrity mismatch: ${spec}`)
	}

	if (locked.integrity !== undefined && integrity !== locked.integrity) {
		throw new Error(
			`Artifact differs from locked bytes: ${spec}; independently verify both distributions before migrating`,
		)
	}
}

async function verification_error(
	artifact: LockedArtifact,
	dependencies: MigrationDependencies,
): Promise<string | undefined> {
	try {
		await verify(artifact, dependencies)

		return undefined
	} catch (error) {
		return `${artifact.name}@${artifact.version}: ${error_text.message_of(error)}`
	}
}

async function verify_all(
	content: string,
	version: string,
	dependencies: MigrationDependencies,
): Promise<void> {
	const artifacts = migrate_lock.scoped_artifacts(content)
	const missing = artifacts.find((artifact) => artifact.integrity === undefined)

	if (missing !== undefined) {
		throw new Error(`Missing locked integrity: ${missing.name}@${missing.version}`)
	}

	artifacts.push({ name: migrate_lock.KIT, version, integrity: undefined })
	const results = await Promise.all(
		artifacts.map(async (artifact) => await verification_error(artifact, dependencies)),
	)
	const failures = results.filter((result) => result !== undefined)
	if (failures.length > 0) throw new Error(failures.join('\n'))
}

function validate(root: string, version: string, dependencies: MigrationDependencies): void {
	assert_workspace_root(root)

	if (npm_registry.valid_version(version) === undefined) {
		throw new Error('Supply an exact target kit version')
	}

	if (!existsSync(path.join(root, MANIFEST))) {
		throw new Error('Run from the project root containing package.json')
	}

	const actual = dependencies.pnpm_version()

	if (actual !== migrate_lock.PNPM_VERSION) {
		throw new Error(
			`Verified pnpm version: ${migrate_lock.PNPM_VERSION}; actual: ${actual}; no files changed`,
		)
	}

	assert_lockfile_directory(root)
}

async function prepare(
	root: string,
	version: string,
	dependencies: MigrationDependencies,
): Promise<void> {
	const before = migrate_files.read(root, LOCKFILE).content ?? ''

	await verify_all(before, version, dependencies)
	writeFileSync(
		path.join(root, '.npmrc'),
		migrate_lock.npmrc(migrate_files.read(root, '.npmrc').content ?? ''),
	)
	dependencies.resolve(root)
	const after = readFileSync(path.join(root, LOCKFILE), 'utf8')

	migrate_lock.assert_preserved(before, after)
	migrate_lock.assert_npm_sources(after)
	await verify_all(after, version, dependencies)
}

async function migrate(
	root: string,
	version: string,
	is_dry_run = false,
	dependencies: MigrationDependencies = defaults,
): Promise<Array<string>> {
	validate(root, version, dependencies)
	const originals = migrate_files.snapshot(root)
	const staged = migrate_files.stage(root)

	try {
		await prepare(staged, version, dependencies)
		assert_inputs(root, staged)

		if (is_dry_run) {
			return originals
				.filter((file) => migrate_files.read(staged, file.name).content !== file.content)
				.map((file) => file.name)
		}

		return migrate_files.commit(root, originals, staged)
	} finally {
		rmSync(staged, { recursive: true, force: true })
	}
}

export { download, migrate, pnpm_version, resolve, sha512 }
export type { MigrationDependencies }
