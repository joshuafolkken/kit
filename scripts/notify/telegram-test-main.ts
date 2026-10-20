#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { telegram_test } from './telegram-test'

// The `josh notify` entry, kept apart from `telegram-test.ts` because the stop hook and
// `run-stop-notify.ts` import that one: a bundle is one file, so a main guard there would fire for
// every command that carries it (joshuafolkken/kit#4186). The flags are read from `process.argv`.
if (process.argv[1] === fileURLToPath(import.meta.url)) await telegram_test.run_cli()
