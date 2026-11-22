import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { github_link } from './github-link'

const make_directory = temporary_directory()
const GITHUB_ORIGIN = 'git@github.com:joshuafolkken/kit.git'
const OTHER_ORIGIN = 'https://gitlab.com/joshuafolkken/kit.git'
const SIGNED_IN_HOSTS = 'github.com:\n    git_protocol: ssh\n    user: joshuafolkken\n'

interface Fixture {
	repository: string
	environment: Record<string, string>
}

interface FixtureOptions {
	gh?: boolean
	hosts?: string
	origin?: string | undefined
}

function make_repository(root: string, origin: string | undefined): string {
	const repository = path.join(root, 'repo')
	const remote = origin === undefined ? '' : `[remote "origin"]\n\turl = ${origin}\n`

	mkdirSync(path.join(repository, '.git'), { recursive: true })
	writeFileSync(path.join(repository, '.git', 'config'), `[core]\n\tbare = false\n${remote}`)

	return repository
}

const DEFAULT_OPTIONS: FixtureOptions = { gh: true, hosts: SIGNED_IN_HOSTS, origin: GITHUB_ORIGIN }

function make_fixture(overrides: FixtureOptions = {}): Fixture {
	const options = { ...DEFAULT_OPTIONS, ...overrides }
	const root = make_directory('josh-github-link-test-')
	const bin = path.join(root, 'bin')
	const config = path.join(root, 'gh-config')

	mkdirSync(bin)
	mkdirSync(config)
	if (options.gh === true) writeFileSync(path.join(bin, 'gh'), '')
	writeFileSync(path.join(config, 'hosts.yml'), options.hosts ?? '')

	return {
		repository: make_repository(root, options.origin),
		environment: { PATH: bin, GH_CONFIG_DIR: config },
	}
}

function is_linked(fixture: Fixture): boolean {
	return github_link.is_linked({
		repository_path: fixture.repository,
		environment: fixture.environment,
	})
}

describe('github_link.is_linked', () => {
	it('answers linked when gh is on PATH, signed in and origin is on GitHub', () => {
		expect(is_linked(make_fixture())).toBe(true)
	})

	it('answers unlinked when gh is not on PATH', () => {
		expect(is_linked(make_fixture({ gh: false }))).toBe(false)
	})

	it('answers unlinked when gh has no github.com sign-in', () => {
		expect(is_linked(make_fixture({ hosts: '' }))).toBe(false)
	})

	it('answers unlinked when the repository has no origin remote', () => {
		expect(is_linked(make_fixture({ origin: undefined }))).toBe(false)
	})

	it('answers unlinked when origin points at a host other than GitHub', () => {
		expect(is_linked(make_fixture({ origin: OTHER_ORIGIN }))).toBe(false)
	})
})

describe('github_link.is_signed_in', () => {
	it('counts a token variable as signed in without a hosts.yml entry', () => {
		const fixture = make_fixture({ hosts: '' })

		expect(github_link.is_signed_in({ ...fixture.environment, GH_TOKEN: 'x' })).toBe(true)
	})

	it('ignores an empty token variable', () => {
		const fixture = make_fixture({ hosts: '' })

		expect(github_link.is_signed_in({ ...fixture.environment, GITHUB_TOKEN: '' })).toBe(false)
	})

	it('reads hosts.yml from XDG_CONFIG_HOME/gh', () => {
		const xdg = make_directory('josh-github-link-xdg-')

		mkdirSync(path.join(xdg, 'gh'))
		writeFileSync(path.join(xdg, 'gh', 'hosts.yml'), SIGNED_IN_HOSTS)

		expect(github_link.is_signed_in({ XDG_CONFIG_HOME: xdg })).toBe(true)
	})

	it('reads hosts.yml from APPDATA/GitHub CLI', () => {
		const appdata = make_directory('josh-github-link-appdata-')

		const config = path.join(appdata, 'GitHub CLI')

		mkdirSync(config)
		writeFileSync(path.join(config, 'hosts.yml'), SIGNED_IN_HOSTS)

		expect(github_link.is_signed_in({ APPDATA: appdata })).toBe(true)
	})

	it('reads hosts.yml from HOME when no gh config directory variable is set', () => {
		const home = make_directory('josh-github-link-home-')

		mkdirSync(path.join(home, '.config', 'gh'), { recursive: true })
		writeFileSync(path.join(home, '.config', 'gh', 'hosts.yml'), SIGNED_IN_HOSTS)

		expect(github_link.is_signed_in({ HOME: home })).toBe(true)
	})
})
