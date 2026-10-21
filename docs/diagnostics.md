# Diagnostic policy

Findings are observations under an explicit interpretation, not a score of musical quality. In particular, same-pitch overlap is valid in some workflows and does not identify the user's intention.

## Pairing and timing

1. Process events in their original order within each track. Read MIDI Port metadata (`FF 21`) as it changes.
2. Pair nonzero-velocity Note On with Note Off or zero-velocity Note On, FIFO by track/port/channel/pitch.
3. Do not pair across tracks. Disclose shared port/channel routes when two tracks contain note starts on that route.
4. A note-off without a local note-on is informational. All Notes Off / All Sound Off are retained and are not substituted for individual note-off events. A related unclosed-note observation may therefore be intentional.
5. Integrate PPQ tempo changes in tick order (default 500,000 μs per quarter note). At the same tick, the last event in track order wins; conflicting values produce a warning. SMPTE ignores tempo for elapsed time. UI horizontal positions are ticks, not bars.

## Optional repairs

### Exact duplicate pairs

All of the following must match: track, port, channel, pitch, start tick, end tick, attack velocity and release velocity. The duration must be positive. Keep the first pair in original event order and remove the additional matched on/off pairs.

Block the repair if:

- A separate same-key note overlaps the interval, making FIFO pairing ambiguous.
- Another track has note starts on the same MIDI port/channel.
- Any CC event for that channel occurs from the start through end tick inclusive. This intentionally conservative rule also blocks benign CCs.

The listener can still interpret repeated Note On events differently. The repair requires explicit selection in the UI and should be auditioned in the receiving DAW. Do not describe it as universally safe.

### Missing end-of-track

Append `FF 2F 00` at the track's original final tick. Other events remain untouched.

## Preservation and verification

Repair selection is revalidated against a freshly computed report, not a caller-supplied deletion plan. Invalid or manual-only IDs are rejected. Output is serialized and re-parsed, and its track count and overall end tick are compared with the original. Selecting nothing returns an exact byte copy.

The writer preserves event tick positions, event data, header extension bytes and unknown chunks. Explicit channel status bytes replace running status where needed. It does not quantize, transpose, change tempo, normalize velocities, reset pedals or rewrite lyrics. Binary identity is not promised for a repaired file.

## Resource limits and privacy

Per file: 20 MiB, 500,000 events and 4,096 tracks. Excessive/truncated lengths, malformed data bytes and unsupported formats are rejected. The browser uses one worker and retains one full report at a time; inactive files keep summary counts only. Large piano rolls are sampled at 40,000 drawn notes; analysis still includes every event within limits. Findings display 100 at a time.

No telemetry, network-based MIDI processing or file persistence is implemented. The page includes `connect-src 'none'`. Hosting providers necessarily serve app assets and may log page requests; they do not receive the selected MIDI through this app.
