import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_startup } from './run-startup'
import type { StartupEntry } from './run-startup-schema'
import { run_startup_store } from './run-startup-store'

const make_directory = temporary_directory()
const START: StartupEntry = {
	kind: 'startup',
	run: 'run',
	attempt: 'attempt',
	id: 'span',
	at: '2026-11-13T00:00:00Z',
	phase: 'launch',
	edge: 'start',
}

afterEach(() => vi.restoreAllMocks())

function compacted_events(target: string): void {
	const { SETUP, NOTE } = run_event_stream.EVENT_KIND
	const lines = Array.from({ length: run_event_stream.EVENT_CAP }, (_, pos) =>
		JSON.stringify({ pos, kind: pos === 0 ? SETUP : NOTE, text: 'fixture', at: START.at }),
	)

	writeFileSync(target, lines.join('\n'))
	run_event_stream.append(target, NOTE, 'new', START.at)
}

describe('startup durable ledger', () => {
	it('retains phase accounting after setup events are compacted away', async () => {
		const directory = make_directory('startup-ledger-')
		const ledger = path.join(directory, 'ledger.jsonl')
		const events = path.join(directory, 'events.jsonl')

		vi.spyOn(run_startup_store, 'record').mockImplementation(
			async (row) => await lane_ledger_write.record(row, ledger),
		)
		await run_startup.within(
			{ run: 'run', attempt: 'attempt' },
			async () => await run_startup.phase('install', async () => true),
		)
		compacted_events(events)
		expect(
			run_event_stream
				.read_events(events)
				.some((row) => row.kind === run_event_stream.EVENT_KIND.SETUP),
		).toBe(false)
		const rows = lane_ledger.read_entries(ledger).filter((row) => row.kind === 'startup')

		expect(run_startup_store.summarize(rows)[0]).toMatchObject({
			status: 'done',
			elapsed_ms: expect.any(Number),
		})
	})
})

describe('startup precise overlap', () => {
	it('detects sub-millisecond overlap across attempts and excludes touching fills', () => {
		const first = { ...START, edge: 'cache' as const, metric: 'fill', key: 'same', at_ms: 0.2 }
		const second = { ...first, id: 'second', attempt: 'other', at_ms: 1.2 }
		const done = { ...START, edge: 'done' as const, at_ms: 1.8 }
		const ending = { ...done, id: 'second', attempt: 'other', at_ms: 3.3 }

		expect(run_startup_store.concurrent_misses([first, second, done, ending])).toEqual([
			first,
			second,
		])
		expect(
			run_startup_store.concurrent_misses([first, { ...second, at_ms: done.at_ms }, done, ending]),
		).toEqual([])
	})
})

describe('startup summaries', () => {
	it('excludes sequential fills sharing a millisecond and includes only positive overlap', () => {
		const first = { ...START, edge: 'cache' as const, metric: 'fill', key: 'same' }
		const second = { ...first, id: 'second' }
		const done = { ...START, edge: 'done' as const }

		expect(
			run_startup_store.concurrent_misses([first, done, second, { ...done, id: 'second' }]),
		).toEqual([])
		const end = '2026-11-13T00:00:01Z'

		expect(
			run_startup_store.concurrent_misses([
				first,
				second,
				{ ...done, at: end },
				{ ...done, id: 'second', at: end },
			]),
		).toEqual([first, second])
	})

	it('keeps interrupted spans incomplete and failures separate', () => {
		const [interrupted] = run_startup_store.summarize([START])

		expect(interrupted).toMatchObject({ status: 'incomplete', elapsed_ms: undefined })
		const [failed] = run_startup_store.summarize([
			START,
			{ ...START, edge: 'failed', elapsed_ms: 1 },
		])

		expect(failed).toMatchObject({ status: 'failed', elapsed_ms: 1 })
	})

	it('counts calls per span without merging simultaneous attempts', () => {
		const other = { ...START, id: 'other', attempt: 'retry' }
		const rows = [START, other, { ...START, edge: 'api' as const, metric: 'rest' }]

		expect(run_startup_store.summarize(rows).map((row) => row.api)).toEqual([{ rest: 1 }, {}])
	})
})
