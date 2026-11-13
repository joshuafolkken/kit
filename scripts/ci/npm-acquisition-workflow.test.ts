import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const make_directory = temporary_directory()
const AUTH = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const NPM = '@joshuafolkken:registry=https://registry.npmjs.org/\n'
const GITHUB = '@other:registry=https://npm.pkg.github.com/\n'
const REQUIRED = 'required=true\n'
const WORKFLOWS = [
	'.github/workflows/ci.yml',
	'.github/workflows/pr-classification.yml',
	'.github/workflows/sonar-qube.yml',
	'templates/workflows/ci.yml',
	'templates/workflows/github-release.yml',
]

function run_registry(root: string, environment: NodeJS.ProcessEnv): void {
	const { steps } = ci_yml_fixture.load_action(ci_yml_fixture.SETUP_PNPM_ACTION).runs
	const result = spawnSync(
		'bash',
		['-e', '-c', steps.find((step) => step.id === 'registry-auth')?.run ?? 'exit 1'],
		{
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env, ...environment },
		},
	)

	expect(result.status, result.stderr).toBe(0)
}

function registry_path(home: string, custom: boolean): string {
	return path.join(home, custom ? 'custom.npmrc' : '.npmrc')
}

function configure_registry(
	npmrc?: string,
	home_npmrc = '',
	custom = false,
): { auth: string; output: string } {
	const root = make_directory('workflow-registry-')
	const home = make_directory('workflow-home-')
	const userconfig = registry_path(home, custom)
	const output = path.join(root, 'output')

	writeFileSync(userconfig, home_npmrc)
	if (npmrc !== undefined) writeFileSync(path.join(root, '.npmrc'), npmrc)
	writeFileSync(output, '')
	run_registry(root, {
		HOME: home,
		GITHUB_OUTPUT: output,
		NPM_CONFIG_USERCONFIG: custom ? userconfig : '',
	})

	return { auth: readFileSync(userconfig, 'utf8'), output: readFileSync(output, 'utf8') }
}

describe('npm acquisition in workflows', () => {
	it.each(WORKFLOWS)('installs without unconditional registry credentials in %s', (file) => {
		const content = ci_yml_fixture.read_workflow(file)

		expect(content).not.toContain(AUTH)
		expect(content).not.toContain('node-auth-token:')
		expect(content).not.toContain("registry-url: 'https://npm.pkg.github.com'")
	})

	it.each([undefined, NPM, `${NPM}${AUTH}\n`, '# @other:registry=https://npm.pkg.github.com/\n'])(
		'leaves npm-only installs unauthenticated with %s',
		(npmrc) => {
			expect(configure_registry(npmrc)).toEqual({ auth: '', output: '' })
		},
	)

	it.each([GITHUB, `${NPM}${GITHUB}`, '@joshuafolkken:registry=https://npm.pkg.github.com\n'])(
		'preserves authentication for configured GitHub scopes',
		(npmrc) => {
			expect(configure_registry(npmrc)).toEqual({ auth: `\n${AUTH}\n`, output: REQUIRED })
		},
	)

	it('preserves a custom user credential needed by another GitHub scope', () => {
		const existing = '//npm.pkg.github.com/:_authToken=${PRIVATE_PACKAGES_TOKEN}\n'

		expect(configure_registry(`${NPM}${GITHUB}`, existing)).toEqual({
			auth: existing,
			output: REQUIRED,
		})
	})

	it('passes credentials only to installs that need them while retaining explicit overrides', () => {
		const { steps } = ci_yml_fixture.load_action(ci_yml_fixture.SETUP_PNPM_ACTION).runs
		const install = steps.find((step) => step.name === 'Install dependencies')

		expect(install?.env?.['NODE_AUTH_TOKEN']).toBe(
			"${{ inputs.node-auth-token || env.NODE_AUTH_TOKEN || (steps.registry-auth.outputs.required == 'true' && github.token) || '' }}",
		)
	})
})

describe('GitHub registry authentication line boundaries', () => {
	it('separates authentication from an existing user setting without a final newline', () => {
		const existing = 'registry=https://registry.npmjs.org/'

		expect(configure_registry(GITHUB, existing)).toEqual({
			auth: `${existing}\n${AUTH}\n`,
			output: REQUIRED,
		})
	})
})

describe('effective user registry configuration', () => {
	it.each([false, true])('reads user-only scopes with custom config %s', (custom) => {
		expect(configure_registry(NPM, GITHUB, custom)).toEqual({
			auth: `${GITHUB}\n${AUTH}\n`,
			output: REQUIRED,
		})
	})

	it.each([false, true])(
		'keeps npm-only user settings unauthenticated with custom config %s',
		(custom) => {
			expect(configure_registry(undefined, NPM, custom)).toEqual({ auth: NPM, output: '' })
		},
	)

	it('lets a project mapping override the same user scope', () => {
		const project = '@other:registry=https://registry.npmjs.org/\n'

		expect(configure_registry(project, GITHUB)).toEqual({ auth: GITHUB, output: '' })
	})

	it.each([false, true])('preserves a user-only credential with custom config %s', (custom) => {
		const existing = `${GITHUB}//npm.pkg.github.com/:_authToken=existing-token\n`

		expect(configure_registry(NPM, existing, custom)).toEqual({ auth: existing, output: REQUIRED })
	})

	it('preserves a project credential instead of appending user authentication', () => {
		expect(configure_registry(`${GITHUB}${AUTH}\n`)).toEqual({ auth: '', output: REQUIRED })
	})
})
