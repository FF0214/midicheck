import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import independentMidi from 'midi-file';
import { parseMidi, inspectMidi, repairMidi, encodeMidi, createDemo, vlq, MidiError, jsonReport } from '../src/midi.mjs';

const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => Array.from(p)));
const int32 = n => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const track = payload => bytes([77, 84, 114, 107], int32(payload.length), payload);
const EOT = [0, 255, 47, 0];
function smf(payloads, { format = payloads.length > 1 ? 1 : 0, division = 480, extra = [] } = {}) {
  return bytes([77, 84, 104, 100, 0, 0, 0, 6, 0, format, 0, payloads.length, division >> 8, division & 255], extra, ...payloads.map(track));
}
const normal = () => smf([[0, 0x90, 60, 80, 0x83, 0x60, 0x80, 60, 0, ...EOT]]);
const duplicate = (middle = []) => smf([[0, 0x90, 60, 80, 0, 0x90, 60, 80, ...middle, 0x83, 0x60, 0x80, 60, 0, 0, 0x80, 60, 0, ...EOT]]);
const reportOf = input => inspectMidi(parseMidi(input));
const code = (report, key) => report.issues.filter(i => i.code === key);
function fixAll(input) { const midi = parseMidi(input); return repairMidi(midi, inspectMidi(midi).issues.filter(i => i.fixable).map(i => i.id)); }
function canonical(input) {
  const p = independentMidi.parseMidi(input);
  return { header: p.header, tracks: p.tracks.map(events => { let tick = 0; return events.map(({ deltaTime, running, byte9, ...rest }) => ({ tick: tick += deltaTime, ...rest })); }) };
}

test('reads a hand-encoded normal file at 480 PPQ and default 120 BPM', () => {
  const r = reportOf(normal());
  assert.equal(r.notes.length, 1); assert.equal(r.duration, .5); assert.equal(r.issues.length, 0);
  assert.equal(r.initialBpm, 120); assert.equal(r.notes[0].end, 480);
});
test('running status and velocity-zero note-off are supported', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 0x83, 0x60, 60, 0, ...EOT]]));
  assert.equal(r.notes[0].end, 480); assert.equal(r.issues.length, 0);
});
test('different channels and pitches are paired separately', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 0, 0x91, 60, 80, 1, 0x81, 60, 0, 1, 0x80, 60, 0, ...EOT]]));
  assert.deepEqual(r.notes.map(n => n.end), [2, 1]); assert.equal(r.issues.length, 0);
});
test('exact duplicate pairs have one opt-in repair; a new copy retains timing', () => {
  const p = parseMidi(duplicate()), before = p.originalBytes.slice(), r = inspectMidi(p);
  assert.equal(code(r, 'DUPLICATE_NOTE').length, 1); assert.equal(r.fixableCount, 1);
  const result = repairMidi(p, r.issues.filter(i => i.fixable).map(i => i.id));
  assert.equal(result.report.notes.length, 1); assert.equal(result.report.issues.length, 0);
  assert.equal(result.report.duration, r.duration); assert.equal(result.applied[0].removedEvents, 2);
  assert.deepEqual(p.originalBytes, before);
});
test('no selection is a byte-identical, independent copy', () => {
  const original = duplicate(), result = repairMidi(parseMidi(original), []);
  assert.deepEqual(result.bytes, original); assert.notEqual(result.bytes, original); assert.equal(result.applied.length, 0);
});
test('unselected findings survive partial repair', () => {
  const r = fixAll(createDemo());
  assert.equal(code(r.report, 'DUPLICATE_NOTE').length, 0);
  for (const c of ['SAME_PITCH_OVERLAP', 'MISSING_NOTE_OFF', 'SUSTAIN_LEFT_ON']) assert.equal(code(r.report, c).length, 1);
});
test('same pitch with different velocities is not labeled an exact duplicate', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 0, 0x90, 60, 81, 2, 0x80, 60, 0, 0, 0x80, 60, 0, ...EOT]]));
  assert.equal(code(r, 'DUPLICATE_NOTE').length, 0); assert.equal(code(r, 'SAME_PITCH_OVERLAP').length, 1); assert.equal(r.fixableCount, 0);
});
test('overlaps use documented FIFO pairing and are never auto-trimmed', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 1, 0x90, 60, 80, 1, 0x80, 60, 0, 1, 0x80, 60, 0, ...EOT]]));
  assert.deepEqual(r.notes.map(n => [n.start, n.end]), [[0, 2], [1, 3]]); assert.equal(r.fixableCount, 0);
});
test('duplicates overlapping a separate note are blocked from repair', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 0, 0x90, 60, 80, 1, 0x90, 60, 90, 1, 0x80, 60, 0, 0, 0x80, 60, 0, 1, 0x80, 60, 0, ...EOT]]));
  assert.equal(code(r, 'DUPLICATE_NOTE')[0].fixable, false);
});
test('any CC in a duplicate span blocks automatic note repair', () => {
  const r = reportOf(duplicate([0, 0xb0, 64, 127]));
  assert.equal(code(r, 'DUPLICATE_NOTE')[0].blockedReason, 'controller_events'); assert.equal(r.fixableCount, 0);
});
test('shared track port/channel blocks exact-duplicate repair', () => {
  const p = parseMidi(duplicate());
  const first = p.originalBytes.slice(22);
  const second = [0, 0x90, 67, 80, 1, 0x80, 67, 0, ...EOT];
  const r = reportOf(smf([first, second]));
  assert.equal(code(r, 'SHARED_CHANNEL').length, 1); assert.equal(code(r, 'DUPLICATE_NOTE')[0].fixable, false);
});
test('MIDI port metadata separates shared channels', () => {
  const r = reportOf(smf([[0, 255, 33, 1, 0, 0, 0x90, 60, 80, 1, 0x80, 60, 0, ...EOT], [0, 255, 33, 1, 1, 0, 0x90, 60, 80, 1, 0x80, 60, 0, ...EOT]]));
  assert.equal(code(r, 'SHARED_CHANNEL').length, 0); assert.equal(r.notes.length, 2);
});
test('unclosed notes and orphan endings are observations, not automatic edits', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 1, 0x80, 65, 0, ...EOT]]));
  assert.equal(code(r, 'MISSING_NOTE_OFF').length, 1); assert.equal(code(r, 'ORPHAN_NOTE_OFF').length, 1); assert.equal(r.fixableCount, 0);
});
test('CC64 release and CC121 reset clear the final pedal observation', () => {
  for (const release of [[0xb0, 64, 0], [0xb0, 121, 0]]) {
    const r = reportOf(smf([[0, 0xb0, 64, 127, 1, ...release, ...EOT]]));
    assert.equal(code(r, 'SUSTAIN_LEFT_ON').length, 0);
  }
});
test('zero-length notes are not silently removed', () => {
  const input = smf([[0, 0x90, 60, 80, 0, 0x80, 60, 0, ...EOT]]);
  assert.equal(code(reportOf(input), 'ZERO_LENGTH_NOTE').length, 1); assert.deepEqual(fixAll(input).bytes, input);
});
test('missing EOT is appended at the original last tick', () => {
  const result = fixAll(smf([[0, 0x90, 60, 80, 10, 0x80, 60, 0]]));
  const p = parseMidi(result.bytes); assert.equal(p.tracks[0].events.at(-1).metaType, 47); assert.equal(p.tracks[0].endTick, 10); assert.equal(result.report.issues.length, 0);
});
test('changing tempo is integrated piecewise', () => {
  const r = reportOf(smf([[0, 0x90, 60, 80, 0x83, 0x60, 255, 81, 3, 15, 66, 64, 0x83, 0x60, 0x80, 60, 0, ...EOT]]));
  assert.equal(r.duration, 1.5); assert.equal(r.secondsAt(480), .5); assert.equal(r.secondsAt(960), 1.5);
});
test('conflicting simultaneous tempos are disclosed', () => {
  const r = reportOf(smf([[0, 255, 81, 3, 7, 161, 32, ...EOT], [0, 255, 81, 3, 15, 66, 64, ...EOT]]));
  assert.equal(code(r, 'CONFLICTING_TEMPO').length, 1); assert.equal(r.initialBpm, 60);
});
test('SMPTE timing ignores tempo changes', () => {
  const input = smf([[0, 255, 81, 3, 15, 66, 64, 0, 0x90, 60, 80, 0x87, 0x68, 0x80, 60, 0, ...EOT]], { division: 0xe728 });
  const r = reportOf(input); assert.equal(r.duration, 1); assert.equal(r.initialBpm, null); assert.equal(r.smpte.fps, 25);
});
test('29.97 drop-frame time division is represented as 30000/1001', () => {
  assert.equal(reportOf(smf([EOT], { division: 0xe328 })).smpte.fps, 30000 / 1001);
});
test('unrecognized chunks and extended header bytes survive edits', () => {
  const unknown = bytes([74, 85, 78, 75], int32(3), [7, 8, 9]);
  const input = smf([parseMidi(duplicate()).originalBytes.slice(22)], { extra: unknown });
  const output = fixAll(input).bytes;
  assert.deepEqual(output.slice(14, 25), unknown); assert.equal(reportOf(output).notes.length, 1);
  const extended = bytes(input.slice(0, 7), [8], input.slice(8, 14), [19, 20], input.slice(14));
  assert.deepEqual(fixAll(extended).bytes.slice(0, 16), extended.slice(0, 16));
});
test('text, lyrics, SysEx, pitch bend, program and expression retain data and ticks', () => {
  const input = smf([[0, 255, 3, 3, 65, 66, 67, 0, 255, 5, 3, 228, 189, 160, 0, 0xf0, 4, 0x7e, 0x7f, 9, 0xf7, 0, 0xc0, 4, 0, 0xe0, 0, 64, 0, 0xb0, 11, 100, 0, 0x90, 60, 80, 0, 0x90, 60, 80, 10, 0x80, 60, 0, 0, 0x80, 60, 0, ...EOT]]);
  // The CC lies at note start and conservatively blocks note repair. Move it to
  // before the notes to verify the writer independently without removing it.
  const p = parseMidi(input); p.tracks[0].events.filter(e => e.type === 'channel' && [8, 9].includes(e.status >> 4)).forEach(e => e.tick += 1); p.tracks[0].events.at(-1).tick += 1;
  const normalized = encodeMidi(p), output = fixAll(normalized).bytes;
  const before = canonical(normalized), after = canonical(output);
  assert.deepEqual(after.header, before.header);
  const nonNotes = e => !['noteOn', 'noteOff'].includes(e.type);
  assert.deepEqual(after.tracks[0].filter(nonNotes), before.tracks[0].filter(nonNotes));
  assert.equal(after.tracks[0].filter(e => e.type === 'noteOn').length, 1);
});
test('round-trip is accepted by an independent SMF parser with identical event semantics', () => {
  const original = createDemo(); assert.deepEqual(canonical(encodeMidi(parseMidi(original))), canonical(original));
});
test('rejects unsupported formats and invalid header fields', () => {
  for (const input of [new Uint8Array(), Uint8Array.of(82, 73, 70, 70), smf([EOT], { format: 2 }), smf([EOT, EOT], { format: 0 }), smf([EOT], { division: 0 }), smf([EOT], { division: 0xe700 })]) assert.throws(() => parseMidi(input), MidiError);
});
test('every truncated prefix of a declared complete track is rejected', () => {
  const input = normal(); for (let n = 0; n < input.length; n++) assert.throws(() => parseMidi(input.slice(0, n)), MidiError);
});
test('rejects excessive VLQ, status-less running data, invalid data bytes and bad meta length', () => {
  for (const data of [[255, 255, 255, 255, 0, 255, 47, 0], [0, 60, 80], [0, 0x90, 60, 255], [0, 255, 81, 2, 0, 1], [0, 255, 47, 0, 0, 0x90, 60, 80]]) assert.throws(() => parseMidi(smf([data])), MidiError);
});
test('meta and SysEx cancel running status', () => {
  for (const interrupt of [[0, 255, 1, 0], [0, 240, 1, 247]]) assert.throws(() => parseMidi(smf([[0, 144, 60, 80, ...interrupt, 0, 60, 0, ...EOT]])), /Running status/);
});
test('repair revalidates selected IDs instead of trusting caller-supplied fixes', () => {
  const p = parseMidi(normal()); assert.throws(() => repairMidi(p, ['unknown']), /do not exist/);
  const q = parseMidi(createDemo()), r = inspectMidi(q), manual = r.issues.find(i => !i.fixable);
  assert.throws(() => repairMidi(q, [manual.id]), /manual review/);
});
test('JSON export contains no functions or binary MIDI payloads', () => {
  const r = JSON.parse(JSON.stringify(jsonReport(reportOf(createDemo()), 'demo.mid')));
  assert.equal(r.noteCount, 22); assert.equal(r.notes, undefined); assert.equal(r.secondsAt, undefined);
});
test('large same-pitch unclosed-note input is bounded and does not recurse', () => {
  const data = [];
  for (let n = 0; n < 10000; n++) data.push(n ? 1 : 0, 0x90, 60, 80);
  data.push(...EOT);
  const r = reportOf(smf([data])); assert.equal(r.notes.length, 10000); assert.equal(code(r, 'MISSING_NOTE_OFF').length, 10000);
});
test('VLQ boundaries encode correctly and reject overflow', () => {
  assert.deepEqual([...vlq(0)], [0]); assert.deepEqual([...vlq(127)], [127]); assert.deepEqual([...vlq(128)], [129, 0]); assert.deepEqual([...vlq(0x0fffffff)], [255, 255, 255, 127]);
  assert.throws(() => vlq(-1)); assert.throws(() => vlq(0x10000000));
});
test('CLI exports JSON, refuses overwrites and leaves original bytes untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'midicheck-test-'));
  try {
    const input = join(dir, 'input.mid'), output = join(dir, 'output.mid'), original = duplicate(); await writeFile(input, original);
    const cwd = resolve(import.meta.dirname, '..');
    const first = spawnSync(process.execPath, ['cli.mjs', input, '--json', '--repair-copy', output], { cwd, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr); assert.equal(JSON.parse(first.stdout).applied.length, 1);
    assert.deepEqual(new Uint8Array(await readFile(input)), original);
    const again = spawnSync(process.execPath, ['cli.mjs', input, '--repair-copy', output], { cwd, encoding: 'utf8' }); assert.equal(again.status, 1);
    const same = spawnSync(process.execPath, ['cli.mjs', input, '--repair-copy', input], { cwd, encoding: 'utf8' }); assert.equal(same.status, 1);
  } finally {
    assert.equal(resolve(dirname(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith('midicheck-test-')); await rm(dir, { recursive: true });
  }
});
