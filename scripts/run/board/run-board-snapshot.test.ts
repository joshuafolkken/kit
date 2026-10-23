import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { run_board_snapshot, type Snapshot } from './run-board-snapshot'

const { file_store } = run_board_snapshot
const FILE_NAME = 'snapshot.json'

const SNAPSHOT: Snapshot = {
	run_started_ms: Date.parse('2026-10-22T05:00:00.000Z'),
	titles: new Map([[4466, 'Persist the board']]),
	labels: new Map([[4466, ['enhancement']]]),
	closed: new Map([
		[
			4479,
			{
				title: 'Closed child',
				labels: ['bug'],
				closed_ms: Date.parse('2026-10-22T05:52:00.000Z'),
				is_merged: true,
				is_not_planned: false,
			},
		],
	]),
}

// A directory of the test's own, removed once it finishes.
function scratch(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'run-board-snapshot-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return directory
}

describe('run_board_snapshot.file_store — what it keeps', () => {
	it('loads what it saved', () => {
		const store = file_store(path.join(scratch(), FILE_NAME))

		store.save(SNAPSHOT)

		expect(store.load()).toStrictEqual(SNAPSHOT)
	})

	it('keeps a closed child with no close time', () => {
		const store = file_store(path.join(scratch(), FILE_NAME))
		const withdrawn = {
			title: 'x',
			labels: [],
			closed_ms: undefined,
			is_merged: false,
			is_not_planned: true,
		}

		store.save({ ...SNAPSHOT, closed: new Map([[1, withdrawn]]) })

		expect(store.load()?.closed.get(1)).toStrictEqual(withdrawn)
	})

	it('rewrites the snapshot whole', () => {
		const store = file_store(path.join(scratch(), FILE_NAME))

		store.save(SNAPSHOT)
		store.save({ ...SNAPSHOT, titles: new Map([[1, 'Other']]) })

		expect(store.load()?.titles).toStrictEqual(new Map([[1, 'Other']]))
	})
})

describe('run_board_snapshot.file_store — what it never stops on', () => {
	it('answers no snapshot where none was written', () => {
		const store = file_store(path.join(scratch(), FILE_NAME))

		expect(store.load()).toBeUndefined()
	})

	it.each(['{not json', '{"run_started_ms":"soon"}', '[]'])(
		'answers no snapshot for a malformed file %s',
		(text) => {
			const target = path.join(scratch(), FILE_NAME)

			writeFileSync(target, text)

			expect(file_store(target).load()).toBeUndefined()
		},
	)

	it('drops a write that fails rather than throwing', () => {
		const store = file_store(path.join(scratch(), 'missing', FILE_NAME))

		expect(() => {
			store.save(SNAPSHOT)
		}).not.toThrow()
	})
})
