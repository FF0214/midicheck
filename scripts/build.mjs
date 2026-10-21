import { mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });
await copyFile('src/midi.mjs', 'dist/midi.mjs');
await writeFile('dist/.nojekyll', '');
console.log('Built static app in dist/');
