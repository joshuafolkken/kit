#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { pr_classification } from './pr-classification'

// The `josh pr:classification` entry, kept apart from `pr-classification.ts` because other modules
// import that one: a bundle is one file, so a main guard there would fire for every command that
// carries it (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const event_path = process.env['GITHUB_EVENT_PATH']
	if (!event_path) throw new Error('GITHUB_EVENT_PATH is required')

	const error = pr_classification.check_event(event_path)

	if (error) {
		console.error(`::error::${error}`)
		process.exitCode = 1
	}
}
