import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const make_directory = temporary_directory()
const INSTALLER = '#!/bin/sh\nset -e\ncurl binary\necho installed\n'
const CURL = `#!/bin/sh
set -e
cat "$CURL_HOME/.curlrc" >> "$RUNNER_TEMP/settings"
if [ "$1" = binary ]; then
  exit "$BINARY_STATUS"
fi
while [ "$1" != -o ]; do shift; done
cp "$RUNNER_TEMP/source" "$2"
`
const RETRY_SETTINGS = 'retry = 3\nretry-delay = 2\nretry-max-time = 60\n'

function setup(): string {
	const directory = make_directory('safe-chain-download-')

	writeFileSync(path.join(directory, 'source'), INSTALLER)
	writeFileSync(path.join(directory, 'curl'), CURL, { mode: 0o755 })

	return directory
}

function run_setup(directory: string, digest: string, binary_status: string): number | null {
	const step = ci_yml_fixture
		.load_action(ci_yml_fixture.SETUP_PNPM_ACTION)
		.runs.steps.find((candidate) => candidate.name === 'Setup safe-chain')

	return spawnSync('bash', ['-eo', 'pipefail', '-c', step?.run ?? 'exit 1'], {
		env: {
			...process.env,
			PATH: `${directory}:${process.env['PATH'] ?? ''}`,
			RUNNER_TEMP: directory,
			SAFE_CHAIN_INSTALLER_VERSION: 'test',
			SAFE_CHAIN_INSTALLER_SHA256: digest,
			BINARY_STATUS: binary_status,
		},
	}).status
}

it('passes bounded download retries to both the installer and its binary fetch', () => {
	const directory = setup()
	const digest = createHash('sha256').update(INSTALLER).digest('hex')

	expect(run_setup(directory, digest, '0')).toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS.repeat(2))
})

it('stops before running an installer whose hash does not match', () => {
	const directory = setup()
	const digest = createHash('sha256').update('different installer').digest('hex')

	expect(run_setup(directory, digest, '0')).not.toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS)
})

it('fails setup when the binary download still fails after curl retries', () => {
	const directory = setup()
	const digest = createHash('sha256').update(INSTALLER).digest('hex')

	expect(run_setup(directory, digest, '22')).not.toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS.repeat(2))
})
