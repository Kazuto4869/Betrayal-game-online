import { fileURLToPath } from 'node:url';

// Protocol tests intentionally use the committed placeholder explorer IDs.
// Do not let a developer's gitignored migrated content change that contract.
process.env.CONTENT_DIR = fileURLToPath(
  new URL('../packages/content/fixtures/', import.meta.url),
);
