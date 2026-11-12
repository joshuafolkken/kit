import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_command } from './epic'

// joshuafolkken/kit#5846: `run:split` creates its epic through `epic_command.create`, which answers
// what happened rather than an exit code — a refusal apart from a created epic and its number.

const refusal_of = vi.hoisted(() => vi.fn())
const create_epic_number = vi.hoisted(() => vi.fn())

vi.mock('./epic-split-reach', () => ({ epic_split_reach: { refusal_of } }))
vi.mock('./epic-run', () => ({ epic_run: { create_epic_number } }))
vi.mock('./epic-notify', () => ({ epic_notify: { announce: async () => undefined } }))

const TITLE = 'Split work'
const ARGV = [TITLE, '10', '11']

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	refusal_of.mockReset().mockResolvedValue(undefined)
	create_epic_number.mockReset().mockResolvedValue(30)
})

describe('epic_command.create', () => {
	it('answers the created epic and its number', async () => {
		expect(await epic_command.create(ARGV)).toStrictEqual({ kind: 'created', epic: 30 })
	})

	it('refuses without a child, creating nothing', async () => {
		expect(await epic_command.create([TITLE])).toStrictEqual({ kind: 'refused' })
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('refuses a split whose children the reach check strands, creating nothing', async () => {
		refusal_of.mockResolvedValue('✖ stranded')

		expect(await epic_command.create(ARGV)).toStrictEqual({ kind: 'refused' })
		expect(create_epic_number).not.toHaveBeenCalled()
	})

	it('answers 1 from `run` on a refusal', async () => {
		expect(await epic_command.run([TITLE])).toBe(1)
	})
})
