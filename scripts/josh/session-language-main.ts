#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from './josh-environment-file'
import { session_language_cli } from './session-language-cli'

// The `josh session:lang` entry and the `session-lang` hook bundle, kept apart from
// `session-language-cli.ts` because `metrics-logic.ts` imports that one: a bundle is one file, so a
// main guard there would fire for every command that carries it (joshuafolkken/kit#4186). `.env` is
// read here, inside the guard, so a developer's own `.env` cannot decide what the unit tests see.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	await session_language_cli.print_prompt_lines()
}
