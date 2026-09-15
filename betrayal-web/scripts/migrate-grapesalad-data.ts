import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { migrateGrapeSalad } from '../packages/content/src/migrate-grapesalad.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      output: { type: 'string', default: 'content' },
    },
    strict: true,
  });
  if (!values.source) throw new Error('--source is required');

  const sourcePath = path.resolve(process.cwd(), values.source);
  const outputPath = path.resolve(process.cwd(), values.output ?? 'content');
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
  const migrated = migrateGrapeSalad(source);
  const characters = `${JSON.stringify({ characters: migrated.characters }, null, 2)}\n`;
  const tiles = `${JSON.stringify({ tiles: migrated.tiles, house: migrated.house }, null, 2)}\n`;

  await mkdir(outputPath, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputPath, 'characters.json'), characters),
    writeFile(path.join(outputPath, 'tiles.json'), tiles),
  ]);

  console.log(
    `${migrated.characters.length} characters, ${migrated.tiles.length} tiles, ${migrated.tiles.length - migrated.house.layout.length} drawable, ${migrated.house.layout.length} starting`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
