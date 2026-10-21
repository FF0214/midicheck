#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseMidi, inspectMidi, repairMidi, jsonReport, noteName } from './src/midi.mjs';
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('MIDI Check v0.1.0\n\nnode cli.mjs file.mid [--json] [--repair-copy output.mid]\n\nRead-only by default. --repair-copy applies all eligible exact duplicate/EOT fixes\nto a NEW file, never overwrites an existing file, and prints each applied change.\nIt does not change overlapping, hanging, or shared-channel notes.');
  process.exit(0);
}
try {
  const input = args[0], rest = args.slice(1);
  let json = false, output = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json') json = true;
    else if (rest[i] === '--repair-copy' && rest[i + 1]) output = rest[++i];
    else throw new Error(`Unknown or incomplete option: ${rest[i]}`);
  }
  const midi = parseMidi(await readFile(input)), report = inspectMidi(midi);
  let applied = [];
  if (output) {
    if (resolve(input).toLowerCase() === resolve(output).toLowerCase()) throw new Error('Output must be different from the input');
    const result = repairMidi(midi, report.issues.filter(i => i.fixable).map(i => i.id));
    await writeFile(output, result.bytes, { flag: 'wx' });
    applied = result.applied;
  }
  if (json) console.log(JSON.stringify({ ...jsonReport(report, input), ...(output ? { output, applied } : {}) }, null, 2));
  else {
    console.log(`${input}: ${report.tracks.length} tracks, ${report.notes.length} notes, ${report.duration.toFixed(3)} s`);
    for (const i of report.issues) console.log(`${i.fixable ? '[opt-in fix]' : `[${i.severity}]`} ${i.code} | track ${i.track + 1} | tick ${i.tick}${i.pitch === undefined ? '' : ` | ${noteName(i.pitch)}`}`);
    if (output) console.log(`Wrote ${output}; ${applied.length} changes; input left untouched.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
