import { describe, expect, it } from 'vitest'
import { fresh_machine_docker, type ContainerRun } from './fresh-machine-docker'

const IMAGE = 'josh-fresh-machine:github'
const TOKEN = 'gho_exampleTokenValue'
const ENV_FLAG = '--env'
const BASE: ContainerRun = {
	image: IMAGE,
	run_name: 'kit-test-html-start-2',
	script: 'exit 0',
	seed_directory: '/stage/seed',
	pack_directory: '/stage/pack',
	tarball: undefined,
	package_version: '1.1387.0',
	secret_names: ['GH_TOKEN'],
}

function variables(container: ContainerRun): Array<string> {
	const run_arguments = fresh_machine_docker.run_arguments(container)

	return run_arguments.filter((_argument, index) => run_arguments[index - 1] === ENV_FLAG)
}

describe('fresh_machine_docker.build_arguments', () => {
	it('reads the Dockerfile from stdin, so the build has no context', () => {
		expect(fresh_machine_docker.build_arguments(IMAGE, false)).toStrictEqual([
			'build',
			'--progress',
			'plain',
			'--tag',
			IMAGE,
			'-',
		])
	})

	it('drops the layer cache on a rebuild', () => {
		expect(fresh_machine_docker.build_arguments(IMAGE, true)).toContain('--no-cache')
	})
})

describe('fresh_machine_docker.run_arguments', () => {
	it('passes the token by name only, never by value', () => {
		expect(variables(BASE)).toContain('GH_TOKEN')
		expect(fresh_machine_docker.run_arguments(BASE).join(' ')).not.toContain(TOKEN)
	})

	it('names no secret for a scenario without any', () => {
		expect(variables({ ...BASE, secret_names: [] })).not.toContain('GH_TOKEN')
	})

	it('passes every secret a spec names by name, after the token', () => {
		const container = { ...BASE, secret_names: ['GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] }

		expect(variables(container).slice(-2)).toStrictEqual(['GH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
	})

	it('names the run and the published version', () => {
		expect(variables(BASE)).toStrictEqual([
			'RUN_NAME=kit-test-html-start-2',
			'PACKAGE_TARBALL=',
			'PACKAGE_VERSION=1.1387.0',
			'GH_TOKEN',
		])
	})

	it('points the tarball at its place under the read-only pack mount', () => {
		const container = { ...BASE, tarball: 'kit-1.0.0.tgz', package_version: undefined }

		expect(variables(container)).toContain('PACKAGE_TARBALL=/pack/kit-1.0.0.tgz')
		expect(variables(container)).toContain('PACKAGE_VERSION=')
		expect(fresh_machine_docker.run_arguments(container)).toContain('/stage/pack:/pack:ro')
	})

	it('removes the container and runs the script in an interactive bash', () => {
		const run_arguments = fresh_machine_docker.run_arguments(BASE)

		expect(run_arguments.slice(0, 2)).toStrictEqual(['run', '--rm'])
		expect(run_arguments.slice(-4)).toStrictEqual([IMAGE, 'bash', '-ic', 'exit 0'])
	})
})
