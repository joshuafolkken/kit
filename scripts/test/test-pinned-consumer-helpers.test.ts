import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { init_logic } from '#scripts/init/init-logic'
import { package_path } from '#scripts/init/init-paths'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { afterEach, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_record } from './test-pinned-record'
import { test_pinned_snapshot } from './test-pinned-snapshot'
import { test_red } from './test-red'

const TIMEOUT_MS = 240_000
const GATE_DIRECTORY = 'scripts/gate'
const SYNCED = init_logic
	.get_ai_copy_files()
	.filter((file) => file.startsWith(`${GATE_DIRECTORY}/`))
const SOURCES = SYNCED.map((file) => [file, package_path(file)] as const)
const TSCONFIG =
	'{"compilerOptions":{"module":"esnext","moduleResolution":"bundler","allowImportingTsExtensions":true}}'
const fixture: { current?: FixtureWorkspace } = {}

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function sync_consumer(): Promise<void> {
	fixture.current = git_fixture_workspace.open_workspace('consumer-ci-helpers-')
	process.chdir(fixture.current.workspace)
	await test_pinned_fixture.build_base()
	await test_pinned_fixture.git(['switch', '-c', 'sync-helpers'])
	await test_pinned_fixture.link_node_modules()
	await test_pinned_fixture.write('tsconfig.json', TSCONFIG)
	await mkdir(GATE_DIRECTORY, { recursive: true })
	await Promise.all(SOURCES.map(([file, source]) => copyFile(source, file)))
}

it(
	'pins every synced CI helper function in a consumer tree (ac-ab269ec0)',
	async () => {
		await sync_consumer()
		const baseline = await test_pinned_snapshot.with_snapshot(async () => {
			const tree = process.cwd()

			return await test_red.probe_in({ tree, parent: path.dirname(tree) }, ['run', GATE_DIRECTORY])
		})

		expect(baseline).toMatchObject({ verdict: 'green', failed: [] })
		const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		expect(test_pinned_logic.format(report)).toBe('')
		expect(report.has_runner).toBe(true)
		expect(
			await run_review_pinned_accepted.judge(test_pinned_record.summary_of(report), undefined),
		).toMatchObject({ kind: 'clear' })
	},
	TIMEOUT_MS,
)
