import type { BusyRead } from '#scripts/epic/epic-busy'
import { open_issue_schema } from '#scripts/git/git-schemas'
import type { HoldRead } from '#scripts/run/hold/run-hold'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StalePorts } from './run-stale'

const REPO = 'owner/repo'
const ROOT = '/repo'
const LANE = '/lanes/42'
const ISSUE = 42

const mocks = vi.hoisted(() => ({
	repo_name: vi.fn<() => Promise<string | undefined>>(),
	read_repository: vi.fn<() => Promise<BusyRead>>(),
	list_lanes: vi.fn<() => Promise<Array<{ issue: string; directory: string }>>>(),
	read_hold: vi.fn<() => HoldRead>(),
	git_read: vi.fn(async (argv: ReadonlyArray<string>) => `${argv[1] ?? ''}/.git`),
	run: vi.fn<(ports: StalePorts) => Promise<number>>(),
	residents: vi.fn<() => Array<number> | undefined>(),
}))

vi.mock('#scripts/lane/lane-residents', () => ({
	lane_residents: { residents: mocks.residents },
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: mocks.repo_name },
}))
vi.mock('#scripts/epic/epic-busy', () => ({
	epic_busy: { read_repository: mocks.read_repository },
}))
vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { list_lanes: mocks.list_lanes } }))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { repository_root: vi.fn(async () => ROOT) },
}))
vi.mock('#scripts/discovery/repo-discovery', () => ({
	repo_discovery: { main_worktree: (root: string) => root },
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: mocks.git_read } }))
vi.mock('#scripts/run/hold/run-hold', () => ({
	run_hold: { read_hold: mocks.read_hold, hold_path: (directory: string) => directory },
}))
vi.mock('./run-stale', () => ({ run_stale: { run: mocks.run } }))

const { run_stale_cli } = await import('./run-stale-cli')

function held(issue: number): HoldRead {
	return { kind: 'held', hold: { issue: String(issue), taken_at: '', pid: 1 } }
}

async function live_ports(): Promise<StalePorts> {
	await run_stale_cli.run()

	const ports = mocks.run.mock.calls[0]?.[0]
	if (ports === undefined) throw new Error('run_stale.run was not called')

	return ports
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.repo_name.mockResolvedValue(REPO)
	mocks.list_lanes.mockResolvedValue([])
	mocks.read_hold.mockReturnValue({ kind: 'free' })
	mocks.run.mockResolvedValue(0)
})

describe('run_stale_cli — the listing', () => {
	it('reads the busy issues by number', async () => {
		const issue = open_issue_schema.parse({ number: ISSUE, title: 't', createdAt: '' })

		mocks.read_repository.mockResolvedValue({ kind: 'busy', issues: [issue] })
		const ports = await live_ports()

		expect(await ports.read_holders()).toEqual([ISSUE])
	})

	it('reads an idle repository as no holders and a truncated one as unreadable', async () => {
		const ports = await live_ports()

		mocks.read_repository.mockResolvedValueOnce({ kind: 'idle' })
		expect(await ports.read_holders()).toEqual([])
		mocks.read_repository.mockResolvedValueOnce({ kind: 'truncated' })
		expect(await ports.read_holders()).toBeUndefined()
	})

	it('reads an unnamed repository as unreadable', async () => {
		mocks.repo_name.mockResolvedValue(undefined)
		const ports = await live_ports()

		expect(await ports.read_holders()).toBeUndefined()
		expect(mocks.read_repository).not.toHaveBeenCalled()
	})
})

describe('run_stale_cli — the checkout', () => {
	it('answers the issue’s lane first', async () => {
		mocks.list_lanes.mockResolvedValue([{ issue: String(ISSUE), directory: LANE }])
		const ports = await live_ports()

		expect(await ports.checkout_of(ISSUE)).toBe(LANE)
	})

	it('answers the primary checkout when its record names the issue', async () => {
		mocks.read_hold.mockReturnValue(held(ISSUE))
		const ports = await live_ports()

		expect(await ports.checkout_of(ISSUE)).toBe(ROOT)
	})

	it('answers the primary checkout when its record cannot be read', async () => {
		mocks.read_hold.mockReturnValue({ kind: 'unreadable' })
		const ports = await live_ports()

		expect(await ports.checkout_of(ISSUE)).toBe(ROOT)
	})

	it('answers none when the primary checkout holds another issue', async () => {
		mocks.read_hold.mockReturnValue(held(ISSUE + 1))
		const ports = await live_ports()

		expect(await ports.checkout_of(ISSUE)).toBeUndefined()
	})
})

describe('run_stale_cli — the checkout’s holders', () => {
	it('counts a running process, or an unreadable listing, as a resident', async () => {
		const ports = await live_ports()

		mocks.residents.mockReturnValueOnce([])
		expect(ports.has_residents(ISSUE, LANE)).toBe(false)
		mocks.residents.mockReturnValueOnce([ISSUE])
		expect(ports.has_residents(ISSUE, LANE)).toBe(true)
		mocks.residents.mockReturnValueOnce(undefined)
		expect(ports.has_residents(ISSUE, LANE)).toBe(true)
	})

	it('reads a checkout whose git directory cannot be resolved as unreadable', async () => {
		mocks.git_read.mockRejectedValueOnce(new Error('not a repository'))
		const ports = await live_ports()

		expect(await ports.read_hold(LANE)).toEqual({ kind: 'unreadable' })
	})
})
