import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { HumanStopKey } from '#scripts/issue/issue-human-stops'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { confirmation_ledger, type ConfirmationEntry } from './confirmation-ledger'

const make_directory = temporary_directory('suite')
const scratch = make_directory('confirmation-ledger-test-')
const HERE = '/lanes/7889'
const ELSEWHERE = '/lanes/7890'
const ISSUE = '7889'
const STOPPED: HumanStopKey = 'run-stopped'
const ANSWERED_AT = new Date('2099-01-01T00:00:00.000Z')
const LATER = new Date('2099-06-01T00:00:00.000Z')
const EPOCH = new Date(0)

function context_of(cwd: string): ReturnType<typeof hook_context_fixture.of> {
	return hook_context_fixture.of(cwd, {})
}

function day_path(directory: string): string {
	return path.join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`)
}

async function read_all(directory: string): Promise<Array<ConfirmationEntry>> {
	return await confirmation_ledger.read(directory, EPOCH)
}

describe('confirmation_ledger.record', () => {
	it('appends one line naming the reason, the Issue, the checkout and when it was asked', async () => {
		const directory = path.join(scratch, 'record')

		await confirmation_ledger.record({ reason: STOPPED, issue: ISSUE }, directory, context_of(HERE))
		const [entry] = await read_all(directory)

		expect(entry).toMatchObject({ reason: STOPPED, issue: ISSUE, checkout: HERE })
		expect(entry?.answered_at).toBeUndefined()
		expect(Number.isNaN(Date.parse(entry?.asked_at ?? ''))).toBe(false)
	})

	it('writes nothing when there is no ledger directory', async () => {
		await expect(
			confirmation_ledger.record({ reason: STOPPED }, undefined, context_of(HERE)),
		).resolves.toBeUndefined()
	})
})

describe('confirmation_ledger.record_sent', () => {
	it('records a confirmation that names no reason as needs-decision', async () => {
		const directory = path.join(scratch, 'sent')

		await confirmation_ledger.record_sent(
			{ task_type: 'confirmation' },
			directory,
			context_of(HERE),
		)

		expect(await read_all(directory)).toMatchObject([{ reason: 'needs-decision' }])
	})

	it('records nothing for a send that is not a confirmation', async () => {
		const directory = path.join(scratch, 'not-sent')

		await confirmation_ledger.record_sent({ task_type: 'completion' }, directory, context_of(HERE))

		expect(await read_all(directory)).toEqual([])
	})
})

describe('confirmation_ledger.answer', () => {
	it("closes only this checkout's confirmations, at the first answer after each", async () => {
		const directory = path.join(scratch, 'answer')

		await confirmation_ledger.record({ reason: STOPPED }, directory, context_of(HERE))
		await confirmation_ledger.record({ reason: 'run-handoff' }, directory, context_of(ELSEWHERE))
		await confirmation_ledger.answer(directory, context_of(HERE), LATER)
		await confirmation_ledger.answer(directory, context_of(HERE), ANSWERED_AT)
		const entries = await read_all(directory)

		expect(entries.find((entry) => entry.checkout === HERE)?.answered_at).toBe(
			ANSWERED_AT.toISOString(),
		)
		expect(entries.find((entry) => entry.checkout === ELSEWHERE)?.answered_at).toBeUndefined()
	})

	it('leaves a confirmation asked after the answer open', async () => {
		const directory = path.join(scratch, 'answer-before')

		await confirmation_ledger.answer(directory, context_of(HERE), EPOCH)
		await confirmation_ledger.record({ reason: STOPPED }, directory, context_of(HERE))

		const [entry] = await read_all(directory)

		expect(entry?.answered_at).toBeUndefined()
	})

	it('appends its line and never rewrites the lines already there', async () => {
		const directory = path.join(scratch, 'append-only')

		await confirmation_ledger.record({ reason: STOPPED }, directory, context_of(HERE))
		const before = readFileSync(day_path(directory), 'utf8')

		await confirmation_ledger.answer(directory, context_of(HERE))

		expect(readFileSync(day_path(directory), 'utf8').startsWith(before)).toBe(true)
	})
})

describe('confirmation_ledger.answer — without a writable ledger', () => {
	it('answers nothing when there is no ledger directory', async () => {
		await expect(confirmation_ledger.answer(undefined, context_of(HERE))).resolves.toBeUndefined()
	})

	it('does not throw when the ledger cannot be written', async () => {
		const blocked = path.join(scratch, 'blocked-file')

		writeFileSync(blocked, '')

		await expect(confirmation_ledger.answer(blocked, context_of(HERE))).resolves.toBeUndefined()
	})
})

describe('confirmation_ledger.read', () => {
	it('skips a broken line', async () => {
		const directory = path.join(scratch, 'broken')

		await confirmation_ledger.record({ reason: STOPPED }, directory, context_of(HERE))
		appendFileSync(day_path(directory), '{"torn\n')

		expect(await read_all(directory)).toHaveLength(1)
	})

	it('returns only the lines asked at or after the start of the period', async () => {
		const directory = path.join(scratch, 'period')

		await confirmation_ledger.record({ reason: STOPPED }, directory, context_of(HERE))

		expect(await confirmation_ledger.read(directory, ANSWERED_AT)).toEqual([])
		expect(await read_all(directory)).toHaveLength(1)
	})

	it('reads an empty list from a directory that does not exist', async () => {
		expect(await read_all(path.join(scratch, 'missing'))).toEqual([])
	})
})
