import { git_command } from './git-command'
import { git_spawn } from './git-spawn'

// A no-filing producer's checkpoint commit starts with this subject (`producer-checkpoint.ts`). A
// checkpoint is the producer's own save point, not finished work, so the ship refuses a clean tree
// whose tip carries it. A dirty tree passes: the ship's own commit becomes the final one. The gate
// does not refuse it, since the gate runs before that final commit.
const CHECKPOINT_PREFIX = 'WIP checkpoint:'

function is_checkpoint_subject(subject: string): boolean {
	return subject.trimStart().startsWith(CHECKPOINT_PREFIX)
}

async function head_subject(): Promise<string> {
	const subject = await git_spawn.read(['log', '-1', '--format=%s'])

	return subject.trim()
}

// Why the current tip cannot be shipped, or `undefined` when a final commit is on it or still to come.
async function problem(): Promise<string | undefined> {
	const subject = await head_subject()
	if (!is_checkpoint_subject(subject)) return undefined
	const status = await git_command.status()
	if (status.trim() !== '') return undefined

	return `the branch tip is a checkpoint ("${subject}") and nothing is left to commit; a checkpoint is not a finish — make the final commit after the tests, the gate and the pre-commit review`
}

const git_checkpoint_tip = { is_checkpoint_subject, problem }

export { git_checkpoint_tip }
