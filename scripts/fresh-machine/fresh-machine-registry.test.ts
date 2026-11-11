import { describe, expect, it } from 'vitest'
import { fresh_machine_registry } from './fresh-machine-registry'

const { COMMANDS } = fresh_machine_registry
const REGISTRY = 'http://localhost:4873/'
const STORAGE = '"$HOME/registry"/storage'
const PUBLISH_KIT = 'pnpm publish "$PACKAGE_TARBALL"'

function index_of(fragment: string): number {
	return COMMANDS.findIndex((command) => command.includes(fragment))
}

describe('fresh_machine_registry.COMMANDS', () => {
	it('serves kit from the registry alone and proxies every other package to npm', () => {
		const [config = ''] = COMMANDS

		expect(config).toMatch(
			/"@joshuafolkken\/kit":\n {4}access: \$all\n {4}publish: \$all\n {2}"\*\*":/u,
		)
		expect(config).toContain('    proxy: npmjs')
		expect(config).not.toMatch(/'[@*]/u)
	})

	it('fetches verdaccio before starting it in the background, and waits until it answers', () => {
		const fetch = index_of('verdaccio@6 --version')
		const start = index_of('verdaccio@6 --config')

		expect(fetch).toBeLessThan(start)
		expect(COMMANDS[start]).toMatch(/&\)$/u)
		expect(COMMANDS[start + 1]).toContain(`curl -fs ${REGISTRY}-/ping`)
	})

	it('points pnpm at the registry before publishing to it', () => {
		const use = index_of(`pnpm config set registry ${REGISTRY}`)

		expect(use).toBeGreaterThan(index_of('-/ping'))
		expect(use).toBeLessThan(index_of(PUBLISH_KIT))
	})

	it('dates kit past the wait and the next run-parallel inside it, each after its publish', () => {
		const kit = index_of(`${STORAGE}/@joshuafolkken/kit/package.json 10`)
		const fresh = index_of(`${STORAGE}/run-parallel/package.json 2`)

		expect(kit).toBe(index_of(PUBLISH_KIT) + 1)
		expect(fresh).toBe(index_of('patch + 1') + 1)
		expect(fresh).toBe(COMMANDS.length - 1)
	})

	it('publishes the next run-parallel in a subshell, so the project stays the directory', () => {
		const publish = COMMANDS[index_of('patch + 1')] ?? ''

		expect(publish).toMatch(/^\(.*pnpm publish --no-git-checks\)$/u)
		expect(publish).toContain(`${REGISTRY}run-parallel/latest`)
	})
})
