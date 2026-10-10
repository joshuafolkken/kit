import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { josh_command } from '#scripts/josh/josh-run'
import { afterEach, expect, test, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_epic } from './backlog-drive-epic'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_offer } from './backlog-offer'

const ACTIVE = new Date().toISOString()
const EPIC = '3406'
const CHILD = '3556'
const REPO = 'joshuafolkken/kit'
const OWNER = String(process.pid)
const HANDED_BACK = 'epic #3406'

function answer(out: string, code = 0): void {
	vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code, out })
}

async function offer_of(in_flight: Array<string> = [], retries = 0): Promise<OfferRead> {
	const state = { ...backlog_drive.initial_state(in_flight, ACTIVE), retries }

	return await backlog_drive_epic.offer(EPIC, state, OWNER)
}

async function verdict_of(in_flight: Array<string> = []): Promise<string> {
	const offer = await offer_of(in_flight)

	return offer.verdict
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3558: a child filed into the epic mid-run, never `run:add`ed, is dispatched by the
// loop itself once `epic:next` reads it runnable.
test('offers the child epic:next reads runnable, asked of the epic itself', async () => {
	answer(`${CHILD}\n`)
	const state = backlog_drive.initial_state([], ACTIVE)

	expect(await backlog_drive_epic.offer(EPIC, state, OWNER)).toMatchObject({
		verdict: 'run',
		issues: [CHILD],
	})
	expect(josh_command.josh_run).toHaveBeenCalledWith(
		['epic:next', EPIC, '--repo', REPO, '--lanes'],
		true,
	)
})

test('offers the next listed child past one already in flight', async () => {
	answer(`${CHILD}\n3557\n`)
	const state = backlog_drive.initial_state([CHILD], ACTIVE)

	expect(await backlog_drive_epic.offer(EPIC, state, OWNER)).toMatchObject({
		verdict: 'run',
		issues: ['3557'],
	})
})

test('waits rather than launching a child already in flight', async () => {
	answer(`${CHILD}\n`)

	expect(await verdict_of([CHILD])).toBe('wait')
})

// joshuafolkken/kit#3597: `0` and a leading zero are not issue numbers, so neither is launched as a child.
test.each(['0\n', '05\n'])('refuses to offer %j as a child of the epic', async (out) => {
	answer(out)

	expect(await offer_of()).toMatchObject({ verdict: 'wait', issues: [] })
})

test('waits while every open child is behind an open dependency', async () => {
	answer('wait\n')

	expect(await verdict_of()).toBe('wait')
})

test('books the epic done once epic:next reads it complete', async () => {
	answer('complete\n')
	const mark_done = vi.spyOn(backlog_drive_named, 'mark_done').mockResolvedValue()

	expect(await verdict_of()).toBe('wait')
	expect(mark_done).toHaveBeenCalledWith(
		EPIC,
		expect.objectContaining({ outcome: 'merged' }),
		OWNER,
	)
})

test('hands the epic to a judgment session when only a person can move it', async () => {
	answer('stop\n')

	expect(await verdict_of()).toBe(HANDED_BACK)
})

test('waits for the next pass when epic:next cannot be read, counting the failure', async () => {
	answer('', 1)

	expect(await offer_of()).toMatchObject({ verdict: 'wait', retries: 1 })
})

// A broken graph fails epic:next on every pass, so the consecutive-failure limit hands it to a person
// instead of waiting out the idle budget.
test('hands the epic to a judgment session once epic:next keeps failing', async () => {
	answer('', 1)

	expect(await offer_of([], backlog_offer.RETRY_LIMIT - 1)).toMatchObject({ verdict: HANDED_BACK })
})

test('resets the failure count once epic:next answers again', async () => {
	answer('wait\n')

	expect(await offer_of([], 1)).toMatchObject({ verdict: 'wait', retries: 0 })
})
