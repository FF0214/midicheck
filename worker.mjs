import { parseMidi, inspectMidi, repairMidi } from './midi.mjs';
let midi = null;
const serializable = report => {
  const { secondsAt, ...rest } = report;
  return rest;
};
self.onmessage = ({ data }) => {
  const { job, type } = data;
  try {
    if (type === 'inspect') {
      midi = parseMidi(data.bytes);
      self.postMessage({ job, type, report: serializable(inspectMidi(midi)) });
    } else if (type === 'preview') {
      if (!midi) throw new Error('Load a MIDI file first');
      const result = repairMidi(midi, data.ids);
      self.postMessage({ job, type, bytes: result.bytes, applied: result.applied, report: serializable(result.report) }, [result.bytes.buffer]);
    }
  } catch (error) { self.postMessage({ job, type: 'error', message: error.message }); }
};
