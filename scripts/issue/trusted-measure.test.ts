import { execSync } from 'node:child_process'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trusted_measure, type TrustedBody } from './trusted-measure'
import { trusted_measure_source, type MeasureSource } from './trusted-measure-source'

vi.mock('node:child_process', () => ({ execSync: vi.fn() }))
vi.mock('#scripts/gh/gh-author-association', () => ({
	gh_author_association: { is_trusted: vi.fn() },
}))
vi.mock('./trusted-measure-source', () => ({ trusted_measure_source: { read: vi.fn() } }))

const COMMAND = 'echo 3'
const EDITED_AT = '2026-11-04T00:00:00Z'
const SOURCE: MeasureSource = {
	body: `## ベースライン\n- \`${COMMAND}\` → 3`,
	authorAssociation: 'OWNER',
	author: { login: 'author' },
	// eslint-disable-next-line unicorn/no-null -- GraphQL explicitly returns null for an unedited issue
	lastEditedAt: null,
	// eslint-disable-next-line unicorn/no-null -- GraphQL explicitly returns null for an unedited issue
	editor: null,
}
const TRUSTED: TrustedBody = {
	kind: 'trusted',
	body: SOURCE.body,
	issue: '6246',
	author: 'author',
	editor: 'editor',
}

beforeEach(() => {
	vi.mocked(trusted_measure_source.read).mockResolvedValue(SOURCE)
	vi.mocked(gh_author_association.is_trusted).mockResolvedValue(true)
	vi.mocked(execSync).mockReturnValue(' 3 \n')
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('trusted_measure execution boundary', () => {
	it('logs the issue, author, editor and command before executing a declared baseline', () => {
		expect(trusted_measure.run_command(COMMAND, TRUSTED)).toStrictEqual({ kind: 'ok', output: '3' })
		expect(console.error).toHaveBeenCalledWith(
			JSON.stringify({
				event: 'trusted-measure',
				issue: '6246',
				author: 'author',
				editor: 'editor',
				command: COMMAND,
			}),
		)
		expect(vi.mocked(console.error).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(execSync).mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('runs an explicit measurement declaration', () => {
		const source = { ...TRUSTED, body: `## 背景\n- 計測宣言: \`${COMMAND}\` <= 5` }

		expect(trusted_measure.run_command(COMMAND, source).kind).toBe('ok')
	})

	// joshuafolkken/kit#7022: `lane:plan` re-runs a premise through the same boundary.
	it('runs a declared premise', () => {
		const source = { ...TRUSTED, body: `## 背景\n- 前提: \`${COMMAND}\` <= 5` }

		expect(trusted_measure.run_command(COMMAND, source).kind).toBe('ok')
	})
})

describe('trusted_measure execution refusal and failure', () => {
	it.each(['echo evil', '`echo evil`', '```sh\necho evil\n```'])(
		'refuses commands found only outside declarations: %s',
		(body) => {
			expect(trusted_measure.run_command('echo evil', { ...TRUSTED, body }).kind).toBe('failed')
			expect(execSync).not.toHaveBeenCalled()
		},
	)

	it('retains the audit entry when a declared command fails or times out', () => {
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error('timed out')
		})
		const run = trusted_measure.run_command(COMMAND, TRUSTED)

		expect(trusted_measure.text_of(run)).toBe('(command failed: timed out)')
		expect(console.error).toHaveBeenCalledTimes(1)
	})
})

describe('trusted_measure provenance', () => {
	it('uses the trusted author as editor for an unedited issue', async () => {
		await expect(trusted_measure.read_trusted_body('6246')).resolves.toStrictEqual({
			...TRUSTED,
			editor: 'author',
		})
	})

	it('checks the last editor write permission independently of the author', async () => {
		vi.mocked(trusted_measure_source.read).mockResolvedValue({
			...SOURCE,
			editor: { login: 'editor' },
			lastEditedAt: EDITED_AT,
		})

		await expect(trusted_measure.read_trusted_body('6246')).resolves.toStrictEqual(TRUSTED)
		expect(gh_author_association.is_trusted).toHaveBeenLastCalledWith({
			login: 'editor',
			association: 'COLLABORATOR',
		})
	})
})

describe('trusted_measure untrusted editor', () => {
	it('refuses an untrusted editor', async () => {
		vi.mocked(trusted_measure_source.read).mockResolvedValue({
			...SOURCE,
			editor: { login: 'reader' },
			lastEditedAt: EDITED_AT,
		})
		vi.mocked(gh_author_association.is_trusted)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)

		await expect(trusted_measure.read_trusted_body('6246')).resolves.toMatchObject({
			kind: 'refused',
		})
		expect(execSync).not.toHaveBeenCalled()
	})

	it('refuses an edited issue whose editor is unavailable', async () => {
		vi.mocked(trusted_measure_source.read).mockResolvedValue({
			...SOURCE,
			lastEditedAt: EDITED_AT,
		})
		vi.mocked(gh_author_association.is_trusted)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)

		await expect(trusted_measure.read_trusted_body('6246')).resolves.toMatchObject({
			kind: 'refused',
		})
	})
})

describe('trusted_measure unavailable provenance', () => {
	it('refuses a failed source read', async () => {
		vi.mocked(trusted_measure_source.read).mockResolvedValue(undefined)

		await expect(trusted_measure.read_trusted_body('6246')).resolves.toMatchObject({
			kind: 'refused',
		})
	})

	it('refuses a missing author', async () => {
		// eslint-disable-next-line unicorn/no-null -- GraphQL returns null for an unavailable author
		vi.mocked(trusted_measure_source.read).mockResolvedValue({ ...SOURCE, author: null })

		await expect(trusted_measure.read_trusted_body('6246')).resolves.toMatchObject({
			kind: 'refused',
		})
	})
})
