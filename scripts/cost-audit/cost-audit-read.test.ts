import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'

const { prompt_line, request_line, record, session } = cost_audit_fixture

const GREP = { name: 'Grep', input: {} }
const EDIT = { name: 'Edit', input: {} }

describe('cost_audit_read.session_of — one transcript read into a session', () => {
	const text = [
		prompt_line(0, 'fullrun #1'),
		request_line(1, 'r1', 1, [GREP]),
		request_line(1, 'r1', 1, [EDIT]),
		request_line(2, 'r2', 1),
	].join('\n')
	const read = cost_audit_read.session_of(text, false)

	it('reads the kind off the opening prompt', () => {
		expect(read.kind).toBe('fullrun')
	})

	it('folds the lines of one request into one record', () => {
		expect(read.records.map((one) => one.request_id)).toStrictEqual(['r1', 'r2'])
	})

	it("collects every call a request's lines issued under its id", () => {
		expect(read.categories.get('r1')).toStrictEqual(['code search', 'edit'])
		expect(read.categories.has('r2')).toBe(false)
	})
})

describe('cost_audit_read.dedupe_across — a request is counted once across sessions', () => {
	it('keeps a request in the first session that holds it', () => {
		const first = session('fullrun', [record('r1', 1, 1)])
		const resumed = session('resume', [record('r1', 1, 1), record('r2', 2, 1)])
		const [kept_first, kept_resumed] = cost_audit_read.dedupe_across([first, resumed])

		expect(kept_first?.records.map((one) => one.request_id)).toStrictEqual(['r1'])
		expect(kept_resumed?.records.map((one) => one.request_id)).toStrictEqual(['r2'])
	})
})
