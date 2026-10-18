import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { lane_background } from '#scripts/rules/lane-background'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_hooks, HOOK_BUNDLES, OUT_DIR, outfile_for } from './build-hooks'

const { STAMP_NAME } = hook_bundle_stamp
const BUILD_SCRIPT = 'scripts/build/build-hooks.ts'
const BUILD_TIMEOUT_MS = 60_000
const STOP_BUNDLE = path.resolve('dist/hooks/stop-guard.js')
const SELF_INVOKE = /process\.argv\[1\] ===/gu
const LANE_ISSUE = '4242'
const BACKGROUND_ID = 'bxj18z032'

// A lane child's directory (`<root>/.kit-lanes/<N>`), its own empty repository outside this checkout,
// so no hold, carry record or git state of this checkout reaches the stop decision.
const created = mkdtempSync(path.join(tmpdir(), 'build-hooks-self-invoke-'))
const root = realpathSync(created)
const lane = path.join(root, '.kit-lanes', LANE_ISSUE)

function launch_line(id: string): string {
	const content = [
		{
			type: 'tool_result',
			tool_use_id: 'toolu_1',
			content: `running in background with ID: ${id}`,
		},
	]

	return JSON.stringify({
		type: 'user',
		timestamp: '2026-10-18T00:00:00.000Z',
		message: { content },
	})
}

function transcript_with(lines: ReadonlyArray<string>): string {
	const transcript_path = path.join(root, `t-${String(lines.length)}.jsonl`)

	writeFileSync(transcript_path, lines.map((line) => `${line}\n`).join(''))

	return transcript_path
}

async function stop_stdout(transcript_path: string): Promise<string> {
	const payload = { transcript_path, stop_hook_active: false, last_assistant_message: 'x' }
	const { stdout } = await execa('node', [STOP_BUNDLE], {
		cwd: lane,
		input: JSON.stringify(payload),
		extendEnv: false,
		env: { PATH: process.env['PATH'], HOME: root, JOSH_LANE_CHILD: LANE_ISSUE },
		reject: false,
	})

	return stdout
}

beforeAll(async () => {
	mkdirSync(lane, { recursive: true })
	await execa('git', ['init', '--quiet'], { cwd: lane })
	await build_hooks()
}, BUILD_TIMEOUT_MS)

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

// joshuafolkken/kit#4123: a module inlined into a hook bundle shares the entry's `import.meta.url`, so
// its self-invoke ran its main on every launch and wrote ahead of the decision envelope.
describe('hook bundles run only their own main', () => {
	it('keeps at most one live self-invoke in each entry bundle', () => {
		for (const bundle of HOOK_BUNDLES) {
			const guards = readFileSync(outfile_for(bundle), 'utf8').match(SELF_INVOKE) ?? []

			expect(guards.length, bundle.out).toBeLessThanOrEqual(1)
		}
	})

	it('stamps the build script as an input, so a change to it rebuilds the bundles', () => {
		const stamp = readFileSync(path.join(OUT_DIR, STAMP_NAME), 'utf8')

		expect(stamp).toContain(JSON.stringify(BUILD_SCRIPT))
	})

	it('writes nothing to stdout on an ordinary stop', async () => {
		expect(await stop_stdout(path.join(root, 'absent.jsonl'))).toBe('')
	})

	it('writes only the block envelope while a lane background task runs', async () => {
		const stdout = await stop_stdout(transcript_with([launch_line(BACKGROUND_ID)]))
		const lines = stdout.split('\n')

		expect(lines).toHaveLength(1)
		expect(JSON.parse(lines[0] ?? '')).toMatchObject({ decision: 'block' })
		expect(stdout).toContain(lane_background.LANE_BACKGROUND_STOP_REASON)
	})
})
