import { json_value } from '#scripts/lib/json-value'
import { FETCH_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { migrate_logic } from '#scripts/registry-migration/migrate-logic'
import { execaSync } from 'execa'
import semver from 'semver'
import { z } from 'zod'
import { release_age } from './release-age'

// The public npm registry, read without credentials so a consumer who installed from public npm
// can see the latest release without a `read:packages` GitHub token. The
// GitHub Packages versions API stays the source for a scope routed there, and the fallback for a
// package public npm does not carry.
const PUBLIC_REGISTRY = 'https://registry.npmjs.org'
// The abbreviated packument carries `dist-tags` without every version's full manifest.
const ABBREVIATED_ACCEPT = 'application/vnd.npm.install-v1+json'
const FULL_ACCEPT = 'application/json'
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

// A registry-supplied version is used only when it is exactly a semver version — it ends up inside an
// install command, so `1.0.0;curl…|sh` or any other text is refused at the source, not downstream.
const version_schema = z.string().refine((value) => semver.valid(value) === value)
const latest_schema = z.looseObject({ 'dist-tags': z.looseObject({ latest: version_schema }) })
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
		{ reject: false, timeout: FETCH_TIMEOUT_MS },
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
		timeout: FETCH_TIMEOUT_MS,
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

// Whether public npm already carries `<name>@<version>`. **Asked of public npm regardless of how this
// checkout routes the scope**, unlike the two readers above: `josh release` waits for `publish.yml`'s
// `publish-npm` job and links the npmjs.com page, so GitHub Packages answering would not be the
// question it asks.
function has_public_version(package_name: string, version: string): boolean {
	const parsed = times_schema.safeParse(read_packument(package_name, FULL_ACCEPT))

	return parsed.success && parsed.data.time[version] !== undefined
}

// The version itself, or nothing when it is not exactly a semver version.
function valid_version(value: string): string | undefined {
	return version_schema.safeParse(value).success ? value : undefined
}

const npm_registry = {
	has_public_version,
	packument_url,
	read_latest,
	read_release_times,
	valid_version,
}

export { npm_registry }
