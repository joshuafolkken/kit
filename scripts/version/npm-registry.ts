import { json_value } from '#scripts/lib/json-value'
import { migrate_logic } from '#scripts/registry-migration/migrate-logic'
import { execaSync } from 'execa'
import { z } from 'zod'
import { release_age } from './release-age'

// The public npm registry, read without credentials so a consumer who installed from public npm
// can see the latest release without a `read:packages` GitHub token (joshuafolkken/kit#2882). The
// GitHub Packages versions API stays the source for a scope routed there, and the fallback for a
// package public npm does not carry.
const PUBLIC_REGISTRY = 'https://registry.npmjs.org'
// The abbreviated packument carries `dist-tags` without every version's full manifest.
const ABBREVIATED_ACCEPT = 'application/vnd.npm.install-v1+json'
const FULL_ACCEPT = 'application/json'
const REQUEST_TIMEOUT_MS = 10_000
const SCOPE_SEPARATOR = '/'
const ENCODED_SCOPE_SEPARATOR = '%2f'
const SCOPE_PATTERN = /^@[^/]+(?=\/)/u
const SCOPE_REGISTRY_SUFFIX = ':registry'
const github_scopes = new Map<string, boolean>()

// The version commands are synchronous end to end and exported that way to consumers, so the
// request runs in a child Node process rather than turning the whole chain async. Node's own
// `fetch` needs no external binary, and a non-2xx answer exits non-zero so it reads as "no answer".
const FETCH_SCRIPT = [
	'const [url, accept] = process.argv.slice(1)',
	'const response = await fetch(url, { headers: { accept } })',
	'if (!response.ok) process.exit(1)',
	'process.stdout.write(await response.text())',
].join('\n')

const latest_schema = z.looseObject({ 'dist-tags': z.looseObject({ latest: z.string() }) })
const times_schema = z.looseObject({ time: release_age.release_times_schema })

// The packument URL for a package name; a scoped name keeps its `@` and encodes the separator, the
// form the registry documents for scoped packages.
function packument_url(package_name: string): string {
	return `${PUBLIC_REGISTRY}/${package_name.replace(SCOPE_SEPARATOR, () => ENCODED_SCOPE_SEPARATOR)}`
}

function read_packument(package_name: string, accept: string): unknown {
	const result = execaSync(
		process.execPath,
		['--input-type=module', '-e', FETCH_SCRIPT, packument_url(package_name), accept],
		{ reject: false, timeout: REQUEST_TIMEOUT_MS },
	)
	if (result.exitCode !== 0) return undefined

	return json_value.parse_or_undefined(result.stdout)
}

// Whether this checkout installs the package's scope from GitHub Packages, read with the same
// `pnpm config get` `josh registry:migrate` uses (project `.npmrc` over user `~/.npmrc`). The two
// registries are published by parallel jobs and can drift, so a consumer routed to GitHub Packages
// keeps reading it: public npm could otherwise offer a release its registry does not carry yet.
// Memoized per scope — kit and app-kit share one, and one report asks for both packages.
function is_github_scope(scope: string): boolean {
	const is_cached_github = github_scopes.get(scope)
	if (is_cached_github !== undefined) return is_cached_github
	const result = execaSync('pnpm', ['config', 'get', `${scope}${SCOPE_REGISTRY_SUFFIX}`], {
		reject: false,
		timeout: REQUEST_TIMEOUT_MS,
	})
	const is_github = result.exitCode === 0 && migrate_logic.is_github_tarball(result.stdout.trim())

	github_scopes.set(scope, is_github)

	return is_github
}

function is_public_source(package_name: string): boolean {
	const scope = SCOPE_PATTERN.exec(package_name)?.[0]

	return scope === undefined || !is_github_scope(scope)
}

// The `latest` dist-tag on public npm, or nothing when the package is not installed from there or
// the registry cannot answer for it (offline, timed out, or not published there).
function read_latest(package_name: string): string | undefined {
	if (!is_public_source(package_name)) return undefined
	const parsed = latest_schema.safeParse(read_packument(package_name, ABBREVIATED_ACCEPT))

	return parsed.success ? parsed.data['dist-tags'].latest : undefined
}

// The version → publish-date map from public npm, under the same source rule as `read_latest`. It
// also carries `created` / `modified` keys, which the release-age selector skips as non-semver.
function read_release_times(package_name: string): Record<string, string> | undefined {
	if (!is_public_source(package_name)) return undefined
	const parsed = times_schema.safeParse(read_packument(package_name, FULL_ACCEPT))

	return parsed.success ? parsed.data.time : undefined
}

const npm_registry = { packument_url, read_latest, read_release_times }

export { npm_registry }
