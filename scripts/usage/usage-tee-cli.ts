#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { usage_tee } from './usage-tee'

if (process.argv[1] === fileURLToPath(import.meta.url)) await usage_tee.run()
