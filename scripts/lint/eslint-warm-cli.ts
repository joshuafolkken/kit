#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { eslint_warm } from './eslint-warm'

// The detached warm-up `eslint_warm.start` spawns in the checkout to warm (joshuafolkken/kit#4720).

if (process.argv[1] === fileURLToPath(import.meta.url)) await eslint_warm.warm(process.cwd())
