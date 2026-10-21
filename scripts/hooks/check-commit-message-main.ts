#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_check } from './check-commit-message'

// The `josh check-commit-message` entry, kept apart from `check-commit-message.ts` because
// `main-merge.ts` imports that one: a bundle is one file, so a main guard there would fire for every
// command that carries it (joshuafolkken/kit#4186). The message file is read from `process.argv`.
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await run_check()
