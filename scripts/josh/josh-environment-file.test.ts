import { describe, expect, it } from 'vitest'
import { hook_decision } from './hook-decision'
import { josh_environment_file } from './josh-environment-file'

// joshuafolkken/kit#1491: the loader was `hook-decision.ts`'s alone until a command outside the
// hooks needed the same thing — `epic:next`, which an unattended run polls every sixty seconds and
// which therefore cannot pay the tsx start that `tsx_arguments` would add.

describe('josh_environment_file.load_environment_file', () => {
	// The one property a caller depends on: a project with no `.env` reads from the environment
	// alone, exactly as it did before any file existed.
	it('swallows a missing or unreadable file', () => {
		expect(() => {
			josh_environment_file.load_environment_file()
		}).not.toThrow()
	})

	// Single-sourced rather than copied: two try/catches around `process.loadEnvFile` would be two
	// places to keep node's precedence and the swallow rule correct in.
	it('is the same loader the hooks use', () => {
		expect(hook_decision.load_environment_file).toBe(josh_environment_file.load_environment_file)
	})
})
