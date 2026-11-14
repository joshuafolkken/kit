import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const AUTH = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const WORKFLOWS = [
	'.github/workflows/ci.yml',
	'.github/workflows/pr-classification.yml',
	'.github/workflows/sonar-qube.yml',
	'templates/workflows/ci.yml',
	'templates/workflows/github-release.yml',
]

describe('npm acquisition in workflows', () => {
	it.each(WORKFLOWS)('installs without unconditional registry credentials in %s', (file) => {
		const content = ci_yml_fixture.read_workflow(file)

		expect(content).not.toContain(AUTH)
		expect(content).not.toContain('node-auth-token:')
		expect(content).not.toContain("registry-url: 'https://npm.pkg.github.com'")
	})
})

describe('setup-pnpm action registry handling', () => {
	const { steps } = ci_yml_fixture.load_action(ci_yml_fixture.SETUP_PNPM_ACTION).runs

	it('does not detect or configure GitHub Packages authentication', () => {
		expect(steps.map((step) => step.name)).not.toContain(
			'Configure package registry authentication',
		)
		expect(JSON.stringify(steps)).not.toContain('npm.pkg.github.com')
	})

	it('passes only an explicit token to the install, never the workflow token', () => {
		const install = steps.find((step) => step.name === 'Install dependencies')

		expect(install?.env?.['NODE_AUTH_TOKEN']).toBe(
			'${{ inputs.node-auth-token || env.NODE_AUTH_TOKEN }}',
		)
	})
})
