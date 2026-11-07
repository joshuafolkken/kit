import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GH_SPAWN_CONCURRENCY, git_gh_exec } from './git-gh-exec'

interface SpawnResult {
	stdout: string
}

// Typed as the one call shape this layer makes, so the held spawn below needs no cast to execa's
// overloads.
const mocked_execa = vi.hoisted(() =>
	vi.fn<(file: string, args: ReadonlyArray<string>) => Promise<SpawnResult>>(),
)

vi.mock('execa', () => ({
	execa: mocked_execa,
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const RATE_LIMITED = 'gh: API rate limit exceeded (HTTP 403)'

// Every spawn the mock received, held open until the test answers it — "how many `gh` processes
// run at once" is then the count of unanswered spawns rather than a timing race.
interface HeldSpawn {
	args: ReadonlyArray<string>
	answer: () => void
	refuse: (stderr: string) => void
}

const spawns: { held: Array<HeldSpawn>; peak: number } = { held: [], peak: 0 }

async function hold_spawn(args: ReadonlyArray<string>): Promise<SpawnResult> {
	return await new Promise((resolve, reject) => {
		spawns.held.push({
			args,
			answer: () => {
				resolve({ stdout: args.join(' ') })
			},
			refuse: (stderr) => {
				reject(Object.assign(new Error('gh failed'), { stderr, stdout: '' }))
			},
		})
		spawns.peak = Math.max(spawns.peak, spawns.held.length)
	})
}

// One event-loop turn: every queued microtask — a freed slot handed on, the next spawn started — has run.
async function next_tick(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve)
	})
}

async function answer_all(): Promise<void> {
	for (let held = spawns.held.shift(); held !== undefined; held = spawns.held.shift()) {
		held.answer()
		// eslint-disable-next-line no-await-in-loop -- each answer frees one slot, which the next waiter must take before the next one is answered
		await next_tick()
	}
}

// The four `backlog:next` fan-outs reach GitHub through all three asynchronous entries, so the
// burst mixes them: the cap is one width for the process, not one per entry.
function fan_out(count: number): Array<Promise<unknown>> {
	return Array.from({ length: count }, async (_, index) => {
		const path = `repos/o/r/issues/${String(index)}`

		if (index % 3 === 0) return await git_gh_exec.exec_gh_api({ path, should_retry: false })
		if (index % 3 === 1) return await git_gh_exec.exec_gh_api_status(path)

		return await git_gh_exec.exec_gh_command(['api', path])
	})
}

beforeEach(() => {
	spawns.held = []
	spawns.peak = 0
	mocked_execa.mockReset()
	mocked_execa.mockImplementation(async (_file, args) => await hold_spawn(args))
})

describe('git_gh_exec spawn width', () => {
	it('never has more gh spawns in flight than the width, across every entry', async () => {
		const burst = fan_out(GH_SPAWN_CONCURRENCY * 3)

		await next_tick()

		expect(spawns.held).toHaveLength(GH_SPAWN_CONCURRENCY)

		await answer_all()
		await Promise.all(burst)

		expect(spawns.peak).toBe(GH_SPAWN_CONCURRENCY)
		expect(mocked_execa).toHaveBeenCalledTimes(GH_SPAWN_CONCURRENCY * 3)
	})

	// What `backlog:next` decides from — each read's own answer, and a failed read's own error for
	// the wait / retry verdict — must come back unchanged through the queue.
	it('hands each queued caller its own answer and its own failure', async () => {
		const first = git_gh_exec.exec_gh_command(['api', 'repos/o/r/issues/1'])
		const burst = fan_out(GH_SPAWN_CONCURRENCY)
		const queued = git_gh_exec.exec_gh_command(['api', 'repos/o/r/issues/2'])

		await next_tick()
		spawns.held.shift()?.refuse(RATE_LIMITED)

		await expect(first).rejects.toThrow(RATE_LIMITED)

		await answer_all()
		await Promise.all(burst)

		await expect(queued).resolves.toBe('api repos/o/r/issues/2')
	})
})
