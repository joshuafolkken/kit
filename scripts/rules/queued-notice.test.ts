import { describe, expect, it } from 'vitest'
import { queued_notice } from './queued-notice'

// joshuafolkken/kit#7749: a lane's turn ended in the second between a completion notice's enqueue and
// its delivery, and the Stop hook released its hold (#7703). These pin which notices are still queued.

const TIMESTAMP = '2026-11-17T06:27:32.996Z'
const ID = 'b1'

function notice(id: string): string {
	return `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>`
}

function queue_line(operation: string, content?: string): string {
	return JSON.stringify({ type: 'queue-operation', operation, timestamp: TIMESTAMP, content })
}

function delivered_line(id: string): string {
	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content: notice(id) } })
}

function queued(...lines: ReadonlyArray<string>): ReadonlyArray<string> {
	return queued_notice.queued_notice_ids(lines.join('\n'))
}

const ENQUEUED = queue_line('enqueue', notice(ID))

describe('queued_notice.queued_notice_ids', () => {
	it('reads a notice enqueued at the end of the tail as queued', () => {
		expect(queued(ENQUEUED)).toEqual([ID])
	})

	it.each([
		['dequeued', queue_line('dequeue')],
		['removed', queue_line('remove', notice(ID))],
		['delivered', delivered_line(ID)],
	])('reads a notice %s afterwards as no longer queued', (_label, after) => {
		expect(queued(ENQUEUED, after)).toEqual([])
	})

	it('keeps a notice queued behind a dequeued prompt', () => {
		const dequeued = queued(queue_line('enqueue', 'a prompt'), ENQUEUED, queue_line('dequeue'))

		expect(dequeued).toEqual([ID])
	})

	it('reads a tail with no queue operation as nothing queued', () => {
		expect(queued(delivered_line(ID), '')).toEqual([])
	})
})
