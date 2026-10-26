import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

// joshuafolkken/kit#5040: the digest is derived from the checkout's transcript, not from the record's
// temp path, and carried in the implementation cut's record.

const { ISSUE, REPOSITORY, WITH_HANDOFF, own_digest, target } = run_cut_cli_fixture

run_cut_cli_fixture.install()

const DIGEST = { read: ['scripts/a.ts'], decisions: [] }

describe('the implementation cut carries the session digest', () => {
	it('derives it from the checkout and writes it into the record', async () => {
		own_digest.mockReturnValueOnce(DIGEST)

		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		const read = run_cut.read_cut(target())

		expect(own_digest).toHaveBeenCalledWith(REPOSITORY)
		expect(read.kind === 'carried' ? read.cut.digest : undefined).toStrictEqual(DIGEST)
	})

	it('derives none for the pre-gate cut', async () => {
		await run_cut_cli.run([ISSUE])

		expect(own_digest).not.toHaveBeenCalled()
	})
})
