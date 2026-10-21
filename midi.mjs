/** MIDI Check, MIT. All processing is local. No dependencies or network access. */
export const VERSION = '0.1.0';
export const LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, events: 500000, tracks: 4096 });

export class MidiError extends Error {
  constructor(message, offset = null) {
    super(`${message}${offset === null ? '' : ` (byte ${offset})`}`);
    this.name = 'MidiError';
    this.offset = offset;
  }
}

const ascii = bytes => String.fromCharCode(...bytes);
const decoder = new TextDecoder('utf-8', { fatal: false });
const u16 = (b, p) => b[p] * 256 + b[p + 1];
const u32 = (b, p) => b[p] * 16777216 + b[p + 1] * 65536 + b[p + 2] * 256 + b[p + 3];
const concat = parts => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const int32 = n => Uint8Array.of(n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255);

export function vlq(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new MidiError('Delta time is outside the four-byte SMF range');
  const out = [value & 127];
  while ((value = Math.floor(value / 128))) out.unshift((value & 127) | 128);
  return Uint8Array.from(out);
}

/** Parse SMF 0/1. SMF 2, UMP, RMID and malformed streams are explicitly rejected. */
export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > LIMITS.bytes) throw new MidiError('File exceeds the 20 MiB limit');
  if (bytes.length < 14 || ascii(bytes.subarray(0, 4)) !== 'MThd') throw new MidiError('Expected a Standard MIDI File (MThd header)', 0);
  const headerLength = u32(bytes, 4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) throw new MidiError('Invalid or truncated MIDI header', 4);
  const format = u16(bytes, 8), trackCount = u16(bytes, 10), division = u16(bytes, 12);
  if (format > 1) throw new MidiError('Only synchronous SMF formats 0 and 1 are supported', 8);
  if (!trackCount || trackCount > LIMITS.tracks || (format === 0 && trackCount !== 1)) throw new MidiError('Invalid track count for this MIDI format', 10);
  if (!division) throw new MidiError('MIDI time division cannot be zero', 12);
  const header = { format, trackCount, division, ticksPerBeat: null, smpte: null };
  if (division & 0x8000) {
    const fpsCode = 256 - (division >> 8), ticksPerFrame = division & 255;
    if (![24, 25, 29, 30].includes(fpsCode) || !ticksPerFrame) throw new MidiError('Invalid SMPTE time division', 12);
    header.smpte = { fps: fpsCode === 29 ? 30000 / 1001 : fpsCode, fpsCode, ticksPerFrame };
  } else header.ticksPerBeat = division;
  const tracks = [], chunks = [];
  let at = 8 + headerLength, eventCount = 0;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) throw new MidiError('Truncated chunk header', at);
    const chunkStart = at, type = ascii(bytes.subarray(at, at + 4)), length = u32(bytes, at + 4);
    at += 8;
    const end = at + length;
    if (end > bytes.length) throw new MidiError('Chunk length exceeds the file', chunkStart + 4);
    if (type !== 'MTrk') { chunks.push({ type, raw: bytes.slice(chunkStart, end) }); at = end; continue; }
    if (tracks.length >= trackCount) throw new MidiError('More track chunks than declared', chunkStart);
    const track = { index: tracks.length, name: '', events: [], endTick: 0, hasEnd: false };
    let tick = 0, running = null;
    const readVLQ = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) {
        if (at >= end) throw new MidiError('Truncated variable-length quantity', at);
        const b = bytes[at++];
        value = value * 128 + (b & 127);
        if (!(b & 128)) return value;
      }
      throw new MidiError('Variable-length quantity exceeds four bytes', at - 4);
    };
    while (at < end) {
      tick += readVLQ();
      if (!Number.isSafeInteger(tick)) throw new MidiError('Track tick position exceeds safe integer precision', at);
      if (at >= end) throw new MidiError('Missing MIDI event after delta time', at);
      const offset = at;
      let status = bytes[at];
      if (status < 128) {
        if (running === null) throw new MidiError('Running status without a preceding channel message', at);
        status = running;
      } else at++;
      const event = { id: `t${track.index}e${track.events.length}`, tick, offset, status };
      if (status >= 0x80 && status <= 0xef) {
        running = status;
        const size = [0xc, 0xd].includes(status >> 4) ? 1 : 2;
        if (at + size > end) throw new MidiError('Truncated channel event', at);
        event.type = 'channel'; event.channel = status & 15;
        event.data = bytes.slice(at, at + size);
        if (event.data.some(b => b > 127)) throw new MidiError('Channel data byte must be less than 128', at);
        at += size;
      } else if (status === 0xff || status === 0xf0 || status === 0xf7) {
        running = null;
        event.type = status === 0xff ? 'meta' : 'sysex';
        if (status === 0xff) {
          if (at >= end) throw new MidiError('Missing meta-event type', at);
          event.metaType = bytes[at++];
          if (event.metaType > 127) throw new MidiError('Invalid meta-event type', at - 1);
        }
        const size = readVLQ();
        if (at + size > end) throw new MidiError('Truncated meta or SysEx payload', at);
        event.data = bytes.slice(at, at + size); at += size;
        if (event.metaType === 0x03 && !track.name) track.name = decoder.decode(event.data);
        const expected = { 0x20: 1, 0x21: 1, 0x2f: 0, 0x51: 3, 0x54: 5, 0x58: 4, 0x59: 2 }[event.metaType];
        if (expected !== undefined && size !== expected) throw new MidiError('Invalid length for a standard meta-event', offset);
        if (event.metaType === 0x2f) {
          if (at !== end) throw new MidiError('End-of-track must be the final event in its track', at);
          track.hasEnd = true;
        }
      } else throw new MidiError('Unsupported status byte in a Standard MIDI File', offset);
      if (++eventCount > LIMITS.events) throw new MidiError('File exceeds the 500,000 event limit', at);
      track.events.push(event);
    }
    track.endTick = tick;
    tracks.push(track); chunks.push({ type, trackIndex: track.index });
  }
  if (tracks.length !== trackCount) throw new MidiError('Fewer track chunks than declared', at);
  return { header, tracks, chunks, headerBytes: bytes.slice(0, 8 + headerLength), originalBytes: bytes.slice(), eventCount };
}

export function encodeMidi(midi, replacements = new Map()) {
  const chunks = midi.chunks.map(chunk => {
    if (chunk.type !== 'MTrk') return chunk.raw;
    const track = midi.tracks[chunk.trackIndex];
    const events = replacements.get(track.index) ?? track.events;
    let previousTick = 0;
    const pieces = [];
    for (const event of events) {
      if (event.tick < previousTick) throw new MidiError('Events must remain in chronological order');
      pieces.push(vlq(event.tick - previousTick)); previousTick = event.tick;
      if (event.type === 'channel') pieces.push(Uint8Array.of(event.status), event.data);
      else if (event.type === 'meta') pieces.push(Uint8Array.of(0xff, event.metaType), vlq(event.data.length), event.data);
      else pieces.push(Uint8Array.of(event.status), vlq(event.data.length), event.data);
    }
    const data = concat(pieces);
    return concat([Uint8Array.of(77, 84, 114, 107), int32(data.length), data]);
  });
  return concat([midi.headerBytes, ...chunks]);
}

export function noteName(pitch) {
  return `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function makeTimeline(midi) {
  const tempoEvents = midi.tracks.flatMap(t => t.events.filter(e => e.metaType === 0x51)
    .map(e => ({ tick: e.tick, tempo: e.data[0] * 65536 + e.data[1] * 256 + e.data[2], track: t.index })))
    .sort((a, b) => a.tick - b.tick || a.track - b.track);
  const segments = [{ tick: 0, seconds: 0, tempo: 500000 }];
  for (const event of tempoEvents) {
    if (!event.tempo) throw new MidiError('Tempo must be greater than zero');
    const last = segments.at(-1);
    if (event.tick === last.tick) last.tempo = event.tempo;
    else segments.push({ tick: event.tick, seconds: midi.header.smpte ? 0 : last.seconds + (event.tick - last.tick) * last.tempo / midi.header.ticksPerBeat / 1e6, tempo: event.tempo });
  }
  const secondsAt = tick => {
    if (midi.header.smpte) return tick / midi.header.smpte.fps / midi.header.smpte.ticksPerFrame;
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (segments[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const s = segments[lo];
    return s.seconds + (tick - s.tick) * s.tempo / midi.header.ticksPerBeat / 1e6;
  };
  return { secondsAt, tempoEvents, initialBpm: midi.header.smpte ? null : 60000000 / segments[0].tempo };
}

/** Findings are observations, not a verdict on musical intent. Note pairing is FIFO per track/port/channel/pitch. */
export function inspectMidi(midi) {
  const { secondsAt, tempoEvents, initialBpm } = makeTimeline(midi);
  const issues = [], notes = [], routes = new Map();
  const add = (code, track, tick, detail = {}, fix = null) => {
    issues.push({ id: `i${issues.length}`, code, severity: code === 'ORPHAN_NOTE_OFF' || code === 'SHARED_CHANNEL' ? 'info' : 'warning', track, tick, seconds: secondsAt(tick), ...detail, fixable: !!fix, fix });
  };
  for (const track of midi.tracks) {
    let port = 0;
    const active = new Map(), pedal = new Map();
    for (const event of track.events) {
      if (event.metaType === 0x21) { port = event.data[0]; continue; }
      if (event.type !== 'channel') continue;
      const kind = event.status >> 4, [a, b] = event.data, route = `${port}:${event.channel}`;
      const key = `${route}:${a}`;
      if (kind === 0x9 && b > 0) {
        if (!routes.has(route)) routes.set(route, new Set());
        routes.get(route).add(track.index);
        const n = { id: event.id, track: track.index, port, channel: event.channel, pitch: a, velocity: b, start: event.tick, end: null, onId: event.id, offId: null, route, releaseVelocity: null };
        if (!active.has(key)) active.set(key, { items: [], head: 0 });
        active.get(key).items.push(n); notes.push(n);
      } else if (kind === 0x8 || (kind === 0x9 && b === 0)) {
        const queue = active.get(key);
        if (!queue || queue.head >= queue.items.length) add('ORPHAN_NOTE_OFF', track.index, event.tick, { pitch: a, channel: event.channel, port });
        else {
          const n = queue.items[queue.head++];
          n.end = event.tick; n.offId = event.id; n.releaseVelocity = kind === 0x8 ? b : 0;
          if (n.end === n.start) add('ZERO_LENGTH_NOTE', track.index, n.start, { pitch: a, channel: event.channel, port, noteIds: [n.id] });
        }
      } else if (kind === 0xb && a === 64) pedal.set(route, { on: b >= 64, tick: event.tick, channel: event.channel, port });
      else if (kind === 0xb && a === 121) pedal.delete(route);
      // All Notes Off / All Sound Off have device- and pedal-dependent semantics.
      // Keep events untouched and surface unmatched notes conservatively.
    }
    for (const queue of active.values()) for (let j = queue.head; j < queue.items.length; j++) {
      const n = queue.items[j];
      add('MISSING_NOTE_OFF', track.index, n.start, { pitch: n.pitch, channel: n.channel, port: n.port, noteIds: [n.id] });
    }
    for (const state of pedal.values()) if (state.on) add('SUSTAIN_LEFT_ON', track.index, state.tick, { channel: state.channel, port: state.port });
    if (!track.hasEnd) add('MISSING_END_OF_TRACK', track.index, track.endTick, {}, { kind: 'appendEnd', track: track.index });
  }
  for (const [route, trackSet] of routes) if (trackSet.size > 1) {
    const [port, channel] = route.split(':').map(Number);
    add('SHARED_CHANNEL', [...trackSet][0], 0, { channel, port, tracks: [...trackSet] });
  }
  const byKey = new Map();
  for (const n of notes) {
    const key = `${n.track}:${n.port}:${n.channel}:${n.pitch}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(n);
  }
  const controllerTicks = midi.tracks.map(t => {
    const channels = new Map();
    for (const e of t.events) if (e.type === 'channel' && (e.status >> 4) === 0xb) {
      if (!channels.has(e.channel)) channels.set(e.channel, []);
      channels.get(e.channel).push(e.tick);
    }
    return channels;
  });
  const hasController = (n, end) => {
    const ticks = controllerTicks[n.track].get(n.channel) ?? [];
    let lo = 0, hi = ticks.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (ticks[m] < n.start) lo = m + 1; else hi = m; }
    return lo < ticks.length && ticks[lo] <= end;
  };
  for (const group of byKey.values()) {
    const exact = new Map();
    const signature = n => n.end === null ? n.id : `${n.start}:${n.end}:${n.velocity}:${n.releaseVelocity}`;
    for (const n of group) {
      const key = signature(n);
      if (!exact.has(key)) exact.set(key, []);
      exact.get(key).push(n);
    }
    const intervals = [...exact.values()].sort((a, b) => a[0].start - b[0].start);
    let previousEnd = -1;
    for (let index = 0; index < intervals.length; index++) {
      const same = intervals[index], first = same[0];
      const ambiguous = previousEnd > first.start || (index + 1 < intervals.length && intervals[index + 1][0].start < (first.end ?? Infinity));
      previousEnd = Math.max(previousEnd, first.end ?? Infinity);
      if (same.length < 2 || first.end === null || first.end <= first.start) continue;
      const shared = routes.get(first.route).size > 1;
      // Controller changes inside a repeated-note span can alter voice allocation.
      const controllers = hasController(first, first.end);
      const fix = !ambiguous && !shared && !controllers ? { kind: 'removeEvents', track: first.track, eventIds: same.slice(1).flatMap(n => [n.onId, n.offId]) } : null;
      add('DUPLICATE_NOTE', first.track, first.start, { pitch: first.pitch, channel: first.channel, port: first.port, count: same.length, noteIds: same.map(n => n.id), blockedReason: shared ? 'shared_channel' : ambiguous ? 'ambiguous_pairing' : controllers ? 'controller_events' : null }, fix);
    }
    // The two longest intervals with distinct signatures suffice to detect an
    // earlier overlap without quadratic scans on dense or malformed MIDI data.
    let longest = { end: -1, key: null }, second = { end: -1, key: null };
    for (const n of group) {
      const key = signature(n), end = n.end ?? Infinity;
      if ((longest.key === key ? second.end : longest.end) > n.start) add('SAME_PITCH_OVERLAP', n.track, n.start, { pitch: n.pitch, channel: n.channel, port: n.port, noteIds: [n.id] });
      if (longest.key === key) longest.end = Math.max(longest.end, end);
      else if (second.key === key) { second.end = Math.max(second.end, end); if (second.end > longest.end) [longest, second] = [second, longest]; }
      else if (end > longest.end) { second = longest; longest = { key, end }; }
      else if (end > second.end) second = { key, end };
    }
  }
  const tempoAtTick = new Map();
  for (const t of tempoEvents) {
    if (tempoAtTick.has(t.tick) && tempoAtTick.get(t.tick) !== t.tempo) add('CONFLICTING_TEMPO', t.track, t.tick);
    tempoAtTick.set(t.tick, t.tempo);
  }
  issues.sort((a, b) => a.tick - b.tick || a.track - b.track);
  const endTick = Math.max(...midi.tracks.map(t => t.endTick));
  const trackNoteCounts = new Array(midi.tracks.length).fill(0);
  for (const n of notes) trackNoteCounts[n.track]++;
  return {
    version: VERSION, format: midi.header.format, division: midi.header.division, ticksPerBeat: midi.header.ticksPerBeat,
    smpte: midi.header.smpte, duration: secondsAt(endTick), endTick, initialBpm, eventCount: midi.eventCount,
    tracks: midi.tracks.map(t => ({ index: t.index, name: t.name, events: t.events.length, endTick: t.endTick, notes: trackNoteCounts[t.index] })),
    notes, issues, fixableCount: issues.filter(i => i.fixable).length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    secondsAt
  };
}

/** Recompute the report so callers cannot inject arbitrary event-deletion plans. */
export function repairMidi(midi, selectedIssueIds) {
  const before = inspectMidi(midi), selected = new Set(selectedIssueIds);
  const accepted = before.issues.filter(i => selected.has(i.id));
  if (accepted.length !== selected.size) throw new MidiError('One or more selected findings do not exist');
  if (accepted.some(i => !i.fixable)) throw new MidiError('A selected finding requires manual review');
  if (!accepted.length) return { bytes: midi.originalBytes.slice(), report: before, applied: [] };
  const replacements = new Map();
  for (const track of midi.tracks) {
    const fixes = accepted.filter(i => i.fix.track === track.index);
    if (!fixes.length) continue;
    const remove = new Set(fixes.flatMap(i => i.fix.eventIds ?? []));
    const events = track.events.filter(e => !remove.has(e.id));
    if (fixes.some(i => i.fix.kind === 'appendEnd')) events.push({ tick: track.endTick, type: 'meta', status: 0xff, metaType: 0x2f, data: new Uint8Array() });
    replacements.set(track.index, events);
  }
  const bytes = encodeMidi(midi, replacements), parsed = parseMidi(bytes), report = inspectMidi(parsed);
  if (report.endTick !== before.endTick || parsed.tracks.length !== midi.tracks.length) throw new MidiError('Repair verification failed: timing or track count changed');
  return { bytes, report, applied: accepted.map(i => ({ id: i.id, code: i.code, track: i.track, tick: i.tick, removedEvents: i.fix.eventIds?.length ?? 0 })) };
}

export function jsonReport(report, filename = '') {
  const { secondsAt, notes, ...plain } = report;
  return { tool: 'MIDI Check', filename, ...plain, noteCount: notes.length, pairing: 'FIFO per track, MIDI port, channel and pitch. Overlaps are not necessarily errors.', privacy: 'Processed locally; no MIDI data uploaded.' };
}

/** Original synthetic fixture, CC0. Contains both musical content and deliberate diagnostics. */
export function createDemo() {
  const text = s => new TextEncoder().encode(s);
  const channel = (tick, status, a, b) => ({ tick, type: 'channel', status, data: Uint8Array.of(a, b) });
  const meta = (tick, metaType, data) => ({ tick, type: 'meta', status: 0xff, metaType, data });
  const tracks = [
    { events: [meta(0, 3, text('Tempo')), meta(0, 0x51, Uint8Array.of(7, 161, 32)), meta(0, 0x58, Uint8Array.of(4, 2, 24, 8)), meta(7680, 0x2f, new Uint8Array())] },
    { events: [meta(0, 3, text('Keys - duplicate + overlap'))] },
    { events: [meta(0, 3, text('Lead - hanging note + pedal'))] }
  ];
  for (let bar = 0; bar < 4; bar++) for (const pitch of [48 + (bar % 2) * 5, 55 + (bar % 2) * 5, 60 + (bar % 2) * 5]) {
    const start = bar * 1920;
    tracks[1].events.push(channel(start, 0x90, pitch, 76), channel(start + 1680, 0x80, pitch, 0));
  }
  tracks[1].events.push(channel(0, 0x90, 60, 76), channel(1680, 0x80, 60, 0));
  tracks[1].events.push(channel(2160, 0x90, 72, 90), channel(2400, 0x90, 72, 72), channel(2760, 0x80, 72, 0), channel(3000, 0x80, 72, 0));
  for (const [start, pitch] of [[0, 72], [720, 76], [1440, 79], [2880, 76], [4320, 74], [5040, 72]]) {
    tracks[2].events.push(channel(start, 0x91, pitch, 88), channel(start + 420, 0x81, pitch, 0));
  }
  tracks[2].events.push(channel(5760, 0xb1, 64, 127), channel(6000, 0x91, 79, 88));
  for (const t of tracks) {
    if (!t.events.some(e => e.metaType === 0x2f)) t.events.push(meta(7680, 0x2f, new Uint8Array()));
    t.events.sort((a, b) => a.tick - b.tick);
  }
  const midi = { headerBytes: Uint8Array.of(77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, 3, 1, 224), tracks, chunks: tracks.map((_, i) => ({ type: 'MTrk', trackIndex: i })) };
  return encodeMidi(midi);
}
