import { epic_bundle_referenced } from '#scripts/epic/epic-bundle-referenced'
import { issue_read_cli } from '#scripts/issue/issue-read-cli'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GH_SPAWN_CONCURRENCY, git_gh_exec } from './git-gh-exec'
import { git_gh_issue_list } from './git-gh-issue-list'
import {
	BLOCKED_BY_SEGMENT,
	ISSUE_NUMBER,
	rest_blockers,
	rest_dependencies_summary,
	rest_issue_page,
} from './git-gh-issue-rest-fixture'

// joshuafolkken/kit#6627: these callers fan out with no width of their own, so the `gh` layer's
// shared spawn limit is the only bound. Each drives a burst three times the width through the real
// layer, and the spawn mock counts how many `gh` processes ran at once.

interface SpawnResult {
	stdout: string
}

const mocked_execa = vi.hoisted(() =>
	vi.fn<(file: string, args: ReadonlyArray<string>) => Promise<SpawnResult>>(),
)

vi.mock('execa', () => ({
	execa: mocked_execa,
	execaSync: vi.fn(() => ({ stdout: '', exitCode: 0 })),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

// The listing's page reads go through `exec_gh_api` here, as in `git-gh-issue-list-relations.test.ts`.
vi.mock('./git-gh-etag-read', () => ({
	git_gh_etag_read: { read: async (path: string) => await git_gh_exec.exec_gh_api({ path }) },
}))

const BURST = GH_SPAWN_CONCURRENCY * 3
const SPAWN_MS = 2
const REPO = 'o/r'

const flight = { current: 0, peak: 0 }

function blocked_rows(): Array<Record<string, unknown>> {
	return Array.from({ length: BURST }, (_, index) => ({
		number: ISSUE_NUMBER + index,
		...rest_dependencies_summary(1),
	}))
}

// The listing is REST's: a GraphQL query is refused, not retried, the blocker reads answer one open
// blocker, and every other path is the one listing page. The other callers only need a spawn that
// takes time.
function answer(args: ReadonlyArray<string>): string {
	const line = args.join(' ')

	if (line.includes('graphql')) {
		throw Object.assign(new Error('gh exited 1'), { stderr: 'gh: Bad Request (HTTP 400)' })
	}

	if (line.includes(BLOCKED_BY_SEGMENT)) return rest_blockers('open')

	return rest_issue_page(blocked_rows())
}

async function timed_spawn(args: ReadonlyArray<string>): Promise<SpawnResult> {
	flight.current += 1
	flight.peak = Math.max(flight.peak, flight.current)
	await new Promise((resolve) => setTimeout(resolve, SPAWN_MS))
	flight.current -= 1

	return { stdout: answer(args) }
}

function issue_numbers(): Array<string> {
	return Array.from({ length: BURST }, (_, index) => String(ISSUE_NUMBER + index))
}

beforeEach(() => {
	flight.current = 0
	flight.peak = 0
	mocked_execa.mockReset()
	mocked_execa.mockImplementation(async (_file, args) => await timed_spawn(args))
	vi.spyOn(console, 'log').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('callers bounded only by the gh spawn limit', () => {
	it('issue:state never runs more gh spawns at once than the width', async () => {
		await issue_state_cli.run([...issue_numbers(), '--repo', REPO])

		expect(flight.peak).toBe(GH_SPAWN_CONCURRENCY)
	})

	it('issue:read never runs more gh spawns at once than the width', async () => {
		await issue_read_cli.run([...issue_numbers(), '--repo', REPO])

		expect(flight.peak).toBe(GH_SPAWN_CONCURRENCY)
	})

	it("epic:bundle's referenced reads never run more gh spawns at once than the width", async () => {
		await epic_bundle_referenced.fetch_referenced(issue_numbers().map(Number))

		expect(flight.peak).toBe(GH_SPAWN_CONCURRENCY)
	})

	it("the listing's blocker reads never run more gh spawns at once than the width", async () => {
		await git_gh_issue_list.issue_list({ json_fields: 'number,blockedBy', limit: BURST })

		expect(
			mocked_execa.mock.calls.filter(([, args]) => args.join(' ').includes(BLOCKED_BY_SEGMENT)),
		).toHaveLength(BURST)
		expect(flight.peak).toBe(GH_SPAWN_CONCURRENCY)
	})
})
