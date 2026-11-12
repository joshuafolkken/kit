import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run_board_quota_read } from './run-board-quota-read'

const make_directory = temporary_directory()

const { claude_files, claude_reading, codex_files } = run_board_quota_read
const NOW_MS = Date.parse('2026-10-29T12:00:00')
const EARLIER = '2026-10-28T03:00:00Z'
const CLAUDE_EVENT = JSON.stringify({
	type: 'rate_limit_event',
	rate_limit_info: {
		unifiedWindows: {
			five_hour: { utilization: 0.42, resetsAt: 1_761_730_000 },
			seven_day: { utilization: 0.68, resetsAt: 1_761_730_000 },
		},
	},
})

async function written(file: string, seconds: number): Promise<string> {
	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, '')
	await utimes(file, seconds, seconds)

	return file
}

// A lane log's launch header as `detached_launch` writes it, with the profile suffix naming `provider`.
function header(provider: string): string {
	return `=== ${EARLIER} · started by process 1 · claude · provider=${provider} role=worker model=m effort=medium ===`
}

const ANTHROPIC = header('anthropic')
const OPENAI = header('openai')

async function launched(
	file: string,
	seconds: number,
	lines: ReadonlyArray<string>,
): Promise<string> {
	await writeFile(file, `\n${lines.join('\n')}\n`)
	await utimes(file, seconds, seconds)

	return file
}

// A fresh directory per test, removed after it; read through the returned getter.
function temporary_root(): () => string {
	let root = ''

	beforeEach(() => {
		root = make_directory('quota-read-')
	})

	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	return () => root
}

function lane_log(root: string, name: number): string {
	return path.join(root, `josh-lane-dispatch-${String(name)}.log`)
}

describe('run_board_quota_read.claude_files by provider', () => {
	const root_of = temporary_root()

	it('reads rate limit events from a handoff log', async () => {
		const file = path.join(root_of(), 'josh-run-handoff-log-6318-fullrun-1.log')
		const handoff = await launched(file, 100, [ANTHROPIC, CLAUDE_EVENT])
		const found = await claude_files(root_of())

		expect(found.map((entry) => entry.path)).toEqual([handoff])
		expect(claude_reading(await readFile(handoff, 'utf8'))?.windows).toHaveLength(2)
	})

	it('passes over logs whose last launch ran Codex, so an older Claude log still reads', async () => {
		const root = root_of()
		const claude = await launched(lane_log(root, 1), 100, [ANTHROPIC, CLAUDE_EVENT])

		await launched(lane_log(root, 2), 200, [OPENAI])
		await launched(lane_log(root, 3), 300, [OPENAI])
		await launched(lane_log(root, 4), 400, [OPENAI])
		const found = await claude_files(root)
		const text = await readFile(claude, 'utf8')

		expect(found.map((file) => file.path)).toEqual([claude])
		expect(claude_reading(text)?.windows.map((window) => window.used_percent)).toEqual([42, 68])
	})

	it("judges a relaunched log by its last header's provider", async () => {
		const root = root_of()
		const to_claude = await launched(lane_log(root, 1), 100, [OPENAI, ANTHROPIC])

		await launched(lane_log(root, 2), 200, [ANTHROPIC, OPENAI])
		const found = await claude_files(root)

		expect(found.map((file) => file.path)).toEqual([to_claude])
	})

	it('keeps a log whose header predates the provider suffix as Claude', async () => {
		const root = root_of()
		const legacy = `=== ${EARLIER} · started by process 1 · claude ===`
		const unnamed = await launched(lane_log(root, 1), 100, [legacy])
		const found = await claude_files(root)

		expect(found.map((file) => file.path)).toEqual([unnamed])
	})
})

describe('run_board_quota_read.claude_files bound', () => {
	const root_of = temporary_root()

	it('finds Claude windows beyond FILES_SCANNED newer Codex logs', async () => {
		const root = root_of()
		const { FILES_SCANNED } = run_board_quota_read
		const claude = await launched(lane_log(root, 1), 100, [ANTHROPIC, CLAUDE_EVENT])
		const codex = Array.from({ length: FILES_SCANNED }, async (_, index) => {
			await launched(lane_log(root, index + 2), 200 + index, [OPENAI])
		})

		await Promise.all(codex)
		const found = await claude_files(root)

		expect(found.map((file) => file.path)).toEqual([claude])
		expect(claude_reading(await readFile(found[0]?.path ?? '', 'utf8'))?.windows).toHaveLength(2)
	})

	it('reads no further than FILES_LIMIT lane logs when none ran Claude', async () => {
		const root = root_of()
		const { FILES_LIMIT } = run_board_quota_read
		const codex = Array.from({ length: FILES_LIMIT }, async (_, index) => {
			await launched(lane_log(root, index + 2), 200 + index, [OPENAI])
		})

		await launched(lane_log(root, 1), 100, [ANTHROPIC])
		await Promise.all(codex)

		expect(await claude_files(root)).toEqual([])
	})
})

describe('run_board_quota_read.claude_files widening', () => {
	const root_of = temporary_root()

	it('caps Claude matches and keeps a narrower result at the front of a wider result', async () => {
		const root = root_of()
		const oldest = await launched(lane_log(root, 1), 100, [ANTHROPIC])
		const newest = await launched(lane_log(root, 2), 200, [ANTHROPIC])

		await launched(lane_log(root, 3), 300, [OPENAI])
		const narrow = await claude_files(root, 1)
		const wide = await claude_files(root, 2)

		expect(narrow.map((file) => file.path)).toEqual([newest])
		expect(wide.map((file) => file.path)).toEqual([newest, oldest])
		expect(wide.slice(0, narrow.length)).toEqual(narrow)
	})

	it('stops reading launch headers once enough Claude logs are found', async () => {
		const root = root_of()
		const oldest = await launched(lane_log(root, 1), 100, [ANTHROPIC])
		const newest = await launched(lane_log(root, 2), 200, [ANTHROPIC])

		const narrow = await claude_files(root, 1)

		expect(narrow.map((file) => file.path)).toEqual([newest])
		await launched(oldest, 100, [OPENAI])
		const wide = await claude_files(root, 2)

		expect(wide.map((file) => file.path)).toEqual([newest])
	})
})

describe('run_board_quota_read.claude_files cache', () => {
	const root_of = temporary_root()

	it('judges a log by its launch once per write, by its path and mtime', async () => {
		const root = root_of()
		const log = await launched(lane_log(root, 1), 100, [ANTHROPIC])

		await claude_files(root)
		await launched(log, 100, [OPENAI])
		const cached = await claude_files(root)

		expect(cached.map((file) => file.path)).toEqual([log])
		await launched(log, 200, [OPENAI])
		expect(await claude_files(root)).toEqual([])
	})
})

describe('run_board_quota_read files', () => {
	const root_of = temporary_root()

	it('finds the lane logs newest first, past the newest three, and none in a missing directory', async () => {
		const root = root_of()
		const oldest = await written(lane_log(root, 1), 100)
		const older = await written(lane_log(root, 2), 200)
		const newer = await written(lane_log(root, 3), 300)
		const newest = await written(lane_log(root, 4), 400)

		await written(path.join(root, 'josh-other-5.log'), 500)
		const found = await claude_files(root)

		expect(found.map((file) => file.path)).toEqual([newest, newer, older, oldest])
		expect(await claude_files(path.join(root, 'missing'))).toEqual([])
	})

	it('finds the newest rollout files of the last seven days, never older days', async () => {
		const root = root_of()
		const sessions = path.join(root, 'sessions', '2026', '10')
		const yesterday = await written(path.join(sessions, '28', 'rollout-a.jsonl'), 200)
		const today = await written(path.join(sessions, '29', 'rollout-c.jsonl'), 100)
		const week = await written(path.join(sessions, '23', 'rollout-b.jsonl'), 50)

		await written(path.join(sessions, '22', 'rollout-d.jsonl'), 300)
		const found = await codex_files(NOW_MS, root)

		expect(found.map((file) => file.path)).toEqual([yesterday, today, week])
		expect(await codex_files(NOW_MS, path.join(root, 'missing'))).toEqual([])
	})
})

describe('run_board_quota_read.read_head', () => {
	it("reads a file's first bytes, and the whole of a shorter one", async () => {
		const root = make_directory('quota-head-')
		const file = path.join(root, 'head.log')

		await writeFile(file, 'abcdef')

		expect(await run_board_quota_read.read_head(file, 3)).toBe('abc')
		expect(await run_board_quota_read.read_head(file)).toBe('abcdef')
		await rm(root, { recursive: true, force: true })
	})
})
