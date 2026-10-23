import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { time_density_cli } from './time-density-cli'

// Past the command's own sample-size floor, so the one transcript counts as a lane.
const LONG_TURNS = 40
const ONE_CALL = 1

const roots: Array<string> = []

function fresh_root(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'density-'))

	roots.push(root)

	return root
}

afterEach(() => {
	vi.restoreAllMocks()
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A lane worktree under `root` whose `.git` file points into `root/main`.
function lane_of(root: string): string {
	const lane = path.join(root, 'lane')

	mkdirSync(lane)
	writeFileSync(
		path.join(lane, '.git'),
		`gitdir: ${path.join(root, 'main', '.git', 'worktrees', '9')}\n`,
	)

	return lane
}

describe('time_density_cli.measured_checkout', () => {
	it('resolves a lane worktree to its main checkout', () => {
		const root = fresh_root()

		expect(time_density_cli.measured_checkout(undefined, lane_of(root))).toBe(
			path.join(root, 'main'),
		)
	})

	it('leaves a main checkout as it is', () => {
		const root = fresh_root()

		expect(time_density_cli.measured_checkout(undefined, root)).toBe(root)
	})
})

// One qualifying transcript filed under the main checkout's slug, where a lane's sessions are filed.
function write_main_session(root: string, home: string): void {
	const slug = cost_transcript.project_slug(path.join(root, 'main'))
	const directory = path.join(home, cost_transcript.TRANSCRIPT_ROOT, slug)
	const text = time_transcript_fixture.density_text(LONG_TURNS, ONE_CALL)

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `s1${cost_transcript.TRANSCRIPT_EXTENSION}`), text)
}

describe('time_density_cli.run', () => {
	it('measures the main checkout’s lanes when run from a lane worktree', () => {
		const root = fresh_root()
		const home = path.join(root, 'home')
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		write_main_session(root, home)

		expect(time_density_cli.run([], lane_of(root), home)).toBe(0)
		expect(info.mock.calls[0]?.[0]).toMatch(/^lanes=1 /u)
	})
})
