import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { verified_download } from './verified-download'

const PAYLOAD = 'verified bytes'
const DIGEST = createHash('sha256').update(PAYLOAD).digest('hex')
const ctx = { directory: '' }
const make_directory = temporary_directory()

function run_download(curl: string): { status: number | null; stdout: string } {
	const command = verified_download.command(
		'https://example.invalid/artifact',
		DIGEST,
		'cat "$installer"',
	)

	return spawnSync('bash', ['-c', `${curl}; false || ${command}`], {
		env: { ...process.env, TMPDIR: ctx.directory },
		encoding: 'utf8',
	})
}

beforeEach(() => {
	ctx.directory = make_directory('verified-download-')
})

describe('verified_download.command', () => {
	it('passes verified bytes to the caller and removes the temporary download', () => {
		const result = run_download(`curl() { printf '%s' '${PAYLOAD}' > "$6"; }`)

		expect(result.status).toBe(0)
		expect(result.stdout).toContain(PAYLOAD)
		expect(readdirSync(ctx.directory)).toEqual([])
	})

	it.each(['curl() { return 1; }', 'curl() { printf tampered > "$6"; }'])(
		'refuses the caller and cleans up after %s',
		(curl) => {
			const result = run_download(curl)

			expect(result.status).not.toBe(0)
			expect(result.stdout).not.toContain(PAYLOAD)
			expect(readdirSync(ctx.directory)).toEqual([])
		},
	)
})
