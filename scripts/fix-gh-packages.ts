import { execSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { z } from 'zod'
import { fix_gh_packages_logic } from './fix-gh-packages-logic'

const LOCKFILE = 'pnpm-lock.yaml'
const NPMRC = '.npmrc'
const GH_PACKAGES_HOST = 'npm.pkg.github.com'
const FETCH_TIMEOUT_MS = 10_000
const GH_CLI_TIMEOUT_MS = 5000

const npm_distribution_schema = z.looseObject({ tarball: z.string().optional() })
const npm_version_schema = z.looseObject({ dist: npm_distribution_schema.optional() })
const npm_packument_schema = z.looseObject({
	versions: z.record(z.string(), npm_version_schema).optional(),
})

const lockfile_resolution_schema = z.looseObject({
	integrity: z.string().optional(),
	tarball: z.string().optional(),
})
const lockfile_package_schema = z.looseObject({
	resolution: lockfile_resolution_schema.optional(),
})
const lockfile_schema = z.looseObject({
	packages: z.record(z.string(), lockfile_package_schema).optional(),
})

type ParsedPackages = NonNullable<z.infer<typeof lockfile_schema>['packages']>

function read_file(file_path: string): string {
	return existsSync(file_path) ? readFileSync(file_path, 'utf8') : ''
}

function get_gh_cli_token(): string | undefined {
	try {
		const token = execSync('gh auth token', { encoding: 'utf8', timeout: GH_CLI_TIMEOUT_MS }).trim()

		return token.length > 0 ? token : undefined
	} catch {
		return undefined
	}
}

function get_effective_auth_token(npmrc: string): string | undefined {
	const environment_token = process.env['NODE_AUTH_TOKEN']?.trim()
	const npmrc_token = fix_gh_packages_logic.parse_npmrc_auth_token(npmrc)

	return fix_gh_packages_logic.resolve_token(environment_token, npmrc_token, get_gh_cli_token)
}

async function fetch_tarball_url(
	package_path: string,
	version: string,
	token: string,
): Promise<string | undefined> {
	const url = `https://${GH_PACKAGES_HOST}/${package_path}`
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})

	if (!response.ok) {
		console.warn(`fix-gh-packages: fetch failed for ${package_path} (${String(response.status)})`)

		return undefined
	}

	const packument = npm_packument_schema.parse(await response.json())

	return packument.versions?.[version]?.dist?.tarball
}

async function process_package_entry(
	key: string,
	entry: z.infer<typeof lockfile_package_schema>,
	scopes: Set<string>,
	token: string,
): Promise<[string, string] | undefined> {
	if (!fix_gh_packages_logic.needs_tarball_fix(key, entry, scopes)) return undefined
	const tarball = await fetch_tarball_url(
		fix_gh_packages_logic.package_path_from_key(key),
		fix_gh_packages_logic.package_version_from_key(key),
		token,
	)

	return tarball === undefined ? undefined : [key, tarball]
}

async function collect_fixes(
	packages: ParsedPackages,
	scopes: Set<string>,
	token: string,
): Promise<Map<string, string>> {
	const fixes = new Map<string, string>()

	for (const [key, entry] of Object.entries(packages)) {
		const pair = await process_package_entry(key, entry, scopes, token)
		if (pair !== undefined) fixes.set(pair[0], pair[1])
	}

	return fixes
}

async function apply_fixes(cwd: string, scopes: Set<string>, token: string): Promise<void> {
	const lockfile_path = path.join(cwd, LOCKFILE)
	if (!existsSync(lockfile_path)) return
	const raw = readFileSync(lockfile_path, 'utf8')
	const { packages } = lockfile_schema.parse(load(raw))
	if (packages === undefined) return
	const fixes = await collect_fixes(packages, scopes, token)
	if (fixes.size === 0) return
	writeFileSync(lockfile_path, fix_gh_packages_logic.patch_lockfile(raw, fixes))
	console.info('fix-gh-packages: restored GitHub Packages tarball URLs in pnpm-lock.yaml')
}

async function run_main(cwd: string): Promise<void> {
	const npmrc = read_file(path.join(cwd, NPMRC))
	const scopes = fix_gh_packages_logic.parse_gh_scopes(npmrc)
	if (scopes.size === 0) return
	const token = get_effective_auth_token(npmrc)

	if (token === undefined) {
		console.warn(
			'fix-gh-packages: no auth token found — run `gh auth login` or set NODE_AUTH_TOKEN',
		)

		return
	}

	await apply_fixes(cwd, scopes, token)
}

async function main(): Promise<void> {
	try {
		await run_main(process.cwd())
	} catch (error) {
		console.warn(`fix-gh-packages: skipped due to error: ${String(error)}`)
	}
}

const [, argv1] = process.argv
if (argv1 !== undefined && realpathSync(argv1) === fileURLToPath(import.meta.url)) await main()
