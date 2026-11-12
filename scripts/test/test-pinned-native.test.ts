import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach } from './test-pinned-reach'
import { test_pinned_snapshot } from './test-pinned-snapshot'
import { test_red } from './test-red'
import type { RedProbe } from './test-red-logic'

const RUN_TIMEOUT = 240_000
const ENTRY = 'native-entry.js'
const TEST = 'native-entry.integration.test.ts'
const OUTPUT = 'true:1.0.0'
const SOURCE = `import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

function git() {
	return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' }).trim()
}

function manifest_at() {
	return JSON.parse(readFileSync('package.json', 'utf8')).version
}

function main() {
	console.log(git() + ':' + manifest_at())
}

main()
`
const NATIVE_TEST = `import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, it } from 'vitest'

const SCRIPT = path.resolve('${ENTRY}')

it('runs the native entry', () => {
	expect(execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).trim()).toBe('${OUTPUT}')
})
`
const TSCONFIG =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-native-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await test_pinned_fixture.build_base()
	await test_pinned_fixture.git(['switch', '-c', 'change'])
	await test_pinned_fixture.link_node_modules()
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function write_native(): Promise<void> {
	await test_pinned_fixture.write('package.json', '{ "type": "module", "version": "1.0.0" }\n')
	await test_pinned_fixture.write('tsconfig.json', TSCONFIG)
	await test_pinned_fixture.write(ENTRY, SOURCE)
	await test_pinned_fixture.write(TEST, NATIVE_TEST)
}

async function baseline(): Promise<RedProbe> {
	return await test_pinned_snapshot.with_snapshot(async () => {
		const tree = process.cwd()

		return await test_red.probe_in({ tree, parent: path.dirname(tree) }, ['run', TEST])
	})
}

describe('test_pinned over a native subprocess entry', () => {
	it(
		'pins every entry function with the existing executable test alone',
		async () => {
			await write_native()
			expect(
				execFileSync(process.execPath, [path.resolve(ENTRY)], { encoding: 'utf8' }).trim(),
			).toBe(OUTPUT)
			expect(await baseline()).toMatchObject({ verdict: 'green', failed: [], ran: 1 })
			const probes = vi.spyOn(test_red, 'probe_in')
			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect(report.unpinned).toEqual([])
			expect(report.unchecked).toEqual([])
			expect(report.stopped).toEqual([])
			expect(probes).toHaveBeenCalledTimes(3)
		},
		RUN_TIMEOUT,
	)

	it('includes the native test in the related basis and reached count', async () => {
		await write_native()
		const reach = test_pinned_reach.create({
			commit: 'base',
			code: [ENTRY],
			digests: new Map(),
			test_digests: new Map(),
		})

		expect(await reach.related(ENTRY)).toEqual([TEST])
		expect(await reach.spawned(ENTRY)).toEqual([TEST])
		expect(await test_pinned_reach.reached_test_count([ENTRY])).toBe(1)
	})
})
