import { expect, it } from 'vitest'
import { backlog_drive_seats } from './backlog-drive-seats'

const KEPT = '3869'

function ports(free: number): Parameters<typeof backlog_drive_seats.seated>[1] {
	return { free_lanes: async () => free, has_lane: async (issue) => issue === KEPT }
}

it('seats an issue holding a kept lane first and the rest up to the free lanes', async () => {
	expect(await backlog_drive_seats.seated(['3870', KEPT, '3874'], ports(1))).toStrictEqual([
		KEPT,
		'3870',
	])
})

it('seats a kept-lane issue even when no lane is free', async () => {
	expect(await backlog_drive_seats.seated(['3870', KEPT], ports(0))).toStrictEqual([KEPT])
})
