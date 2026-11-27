import { describe, expect, it, vi } from 'vitest'

vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('./git-command', () => ({ git_command: { status: vi.fn() } }))

const { git_checkpoint_tip } = await import('./git-checkpoint-tip')
const { git_spawn } = await import('./git-spawn')
const { git_command } = await import('./git-command')

const SUBJECT = 'WIP checkpoint: theme colors'
const CHECKPOINT_SUBJECT = `${SUBJECT}\n`
const SHORT_SUBJECT = 'WIP checkpoint: x'

function arrange(subject: string, status: string): void {
	vi.mocked(git_spawn.read).mockResolvedValue(subject)
	vi.mocked(git_command.status).mockResolvedValue(status)
}

describe('git_checkpoint_tip.problem', () => {
	it('reports a clean tree whose tip is a checkpoint', async () => {
		arrange(CHECKPOINT_SUBJECT, '')

		await expect(git_checkpoint_tip.problem()).resolves.toContain(SUBJECT)
	})

	it('passes a checkpoint tip with changes left for the final commit', async () => {
		arrange(CHECKPOINT_SUBJECT, ' M src/theme.ts\n')

		await expect(git_checkpoint_tip.problem()).resolves.toBeUndefined()
	})

	it('passes a final commit without reading the status', async () => {
		arrange('Add theme colors #42\n', '')

		await expect(git_checkpoint_tip.problem()).resolves.toBeUndefined()
		expect(git_command.status).not.toHaveBeenCalled()
	})
})

describe('git_checkpoint_tip.is_checkpoint_subject', () => {
	it.each([
		[SHORT_SUBJECT, true],
		[`  ${SHORT_SUBJECT}`, true],
		[`Add ${SHORT_SUBJECT}`, false],
		['wip checkpoint: x', false],
	])('reads `%s` as %s', (subject, expected) => {
		expect(git_checkpoint_tip.is_checkpoint_subject(subject)).toBe(expected)
	})
})
