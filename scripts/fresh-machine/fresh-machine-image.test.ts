import { readFileSync } from 'node:fs'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { fresh_machine_image } from './fresh-machine-image'

const PREREQUISITES = 'docs/setup/prerequisites.md'
const LINUX_HEADING = '### Linux and macOS'
const FENCE = '```'

// The command lines of the guide's Linux route: the first fenced block under its heading, without
// the comment that tells the reader to open a new terminal.
function guide_commands(): Array<string> {
	const [, after_heading = ''] = readFileSync(package_path(PREREQUISITES), 'utf8').split(
		LINUX_HEADING,
	)
	const [, block = ''] = after_heading.split(FENCE)

	return block
		.split('\n')
		.slice(1)
		.filter((line) => line.trim() !== '' && !line.startsWith('#'))
}

describe('fresh_machine_image.dockerfile', () => {
	it('reads at least the three commands of the guide', () => {
		expect(guide_commands()).toHaveLength(3)
	})

	it.each(guide_commands())('runs the guide line `%s`', (command) => {
		expect(fresh_machine_image.dockerfile(false)).toContain(command)
	})

	it('runs the guide as a normal user, after the user is created', () => {
		const lines = fresh_machine_image.dockerfile(false).split('\n')
		const user_line = lines.indexOf('USER dev')
		const [first_command = ''] = guide_commands()

		expect(user_line).toBeGreaterThan(0)
		expect(lines.indexOf(`RUN ${first_command}`)).toBeGreaterThan(user_line)
	})

	it('sets SHELL, which a container build leaves unset', () => {
		expect(fresh_machine_image.dockerfile(false)).toContain('ENV SHELL=/bin/bash')
	})

	it('leaves git and gh off the machine a scenario without GitHub runs on', () => {
		const dockerfile = fresh_machine_image.dockerfile(false)

		expect(dockerfile).not.toContain('apt-get')
		expect(dockerfile).not.toContain('git')
	})

	it('installs git and gh as root, before the user exists, for a GitHub scenario', () => {
		const lines = fresh_machine_image.dockerfile(true).split('\n')
		const tools_line = lines.findIndex((line) => line.includes('apt-get install -y gh'))

		expect(lines[tools_line]).toContain('apt-get install -y git')
		expect(tools_line).toBeLessThan(lines.indexOf('USER dev'))
	})

	it('carries no token into either image', () => {
		expect(fresh_machine_image.dockerfile(true)).not.toMatch(/TOKEN/u)
	})
})

describe('fresh_machine_image.tag', () => {
	it('names the two machines apart', () => {
		expect(fresh_machine_image.tag(false)).toBe('josh-fresh-machine:base')
		expect(fresh_machine_image.tag(true)).toBe('josh-fresh-machine:github')
	})
})
