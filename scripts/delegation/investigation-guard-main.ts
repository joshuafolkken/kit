#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { investigation_outcome } from './investigation-guard'

// The `josh investigation:guard` entry, kept apart from `investigation-guard.ts` because other
// modules import that one: a bundle is one file, so a main guard there would fire for every command
// that carries it (joshuafolkken/kit#4186). The hook payload is read from stdin.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await hook_decision.respond_from_stdin('investigation:guard', investigation_outcome)
}
