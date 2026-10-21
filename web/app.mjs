import { createDemo, noteName, jsonReport, LIMITS } from './midi.mjs';

const $ = id => document.getElementById(id);
const originalText = new Map([...document.querySelectorAll('[data-i18n]')].map(el => [el, el.innerHTML]));
const en = {
  local: 'PROCESSED LOCALLY', title: 'Between the notes.<br><span>Nothing overlooked.</span>', intro: 'Drop in your MIDI. See the details hiding underneath.<br>Understand each finding. Choose what to change.',
  drop: 'Drop your MIDI files here', formats: 'or click to browse · .mid / .midi · up to 20 MiB each', 'no-file': 'No MIDI at hand?', 'try-demo': 'Explore the demo ↗', 'upload-note': 'Your files stay in your browser. Never uploaded.',
  files: 'FILE QUEUE', 'sidebar-note': 'Inspect each file. Repairs export a separate copy. Your originals stay untouched.', inspection: 'MIDI INSPECTION', 'export-report': 'Export report ↓',
  'piano-roll': 'NOTE OVERVIEW', 'roll-hint': 'Findings highlighted in amber', notes: 'Notes', findings: 'Review', 'findings-title': 'A closer look', all: 'All', fixable: 'Optional fixes', review: 'Manual review', more: 'Show more',
  'repair-note': 'Only selected events are changed. Musical intent stays yours.', preview: 'Preview changes →', comparison: 'BEFORE / AFTER', download: 'Download repaired copy ↓', cancel: 'Close preview',
  feature1: 'See the details', feature1p: 'Exact duplicates, same-pitch overlaps, missing note endings and pedal state. Every finding comes with a position and an explanation.', feature2: 'Keep your judgment', feature2p: 'Legato and overlap can be intentional. Findings invite a closer look; they do not automatically label expression as an error.', feature3: 'Know what changes', feature3p: 'Compare first, then export a separate copy. Tempo, lyrics, controllers and other events keep their original tick positions.',
  'limits-title': 'Supported formats and inspection method', limits: 'Supports MIDI 1.0 SMF 0/1 with PPQ and SMPTE timing. SMF 2, RIFF/RMID and UMP are not supported. Notes are paired FIFO within each track, port, channel and pitch; overlapping note intent can be ambiguous. Shared channels, controllers or ambiguous overlaps block note repairs. Text is displayed as UTF-8; older encodings may look incorrect, but their original bytes are preserved.',
  footer: 'A little more clarity, before you deliver.', 'no-tracking': 'No tracking · No accounts · No uploads'
};
const messages = {
  DUPLICATE_NOTE: ['完全相同的音符事件对', 'Exact duplicate note pairs', '同轨、同端口、同通道、相同时间、力度和释放力度的音符。可选择保留一组；请先确认是否为刻意叠加。', 'Same track, port, channel, timing, velocity and release velocity. You may keep one pair; confirm the repetition is not intentional first.'],
  SAME_PITCH_OVERLAP: ['同音高的音符发生重叠', 'Same-pitch note overlap', '音符配对采用先进先出。连奏、叠音或音源行为都可能造成此情况，需要人工判断；不会自动裁切。', 'FIFO pairing finds overlapping notes of the same pitch. This can be intentional legato or device-specific voice behavior. No automatic trimming.'],
  MISSING_NOTE_OFF: ['未找到对应的音符结束事件', 'No matching note ending', '本轨中未找到对应的 Note Off。跨轨事件或 All Notes Off 也可能影响播放，需回到原工程确认。', 'No matching Note Off in this track. Cross-track messages or All Notes Off may affect playback; check the source project.'],
  ORPHAN_NOTE_OFF: ['结束事件没有匹配的起始事件', 'Note ending without a matching start', '可能来自跨轨通道、截取片段或防止挂音的保护事件。仅提示，保留原事件。', 'May come from cross-track routing, a cropped region or a protective note-off. Informational only; the event is preserved.'],
  ZERO_LENGTH_NOTE: ['起始与结束位于同一 tick', 'Zero-length note', '这可能是打击乐触发、极短音符或导出结果。保留原事件，由你决定。', 'May be a percussion trigger, a very short note or an export artifact. The event is preserved for your judgment.'],
  SUSTAIN_LEFT_ON: ['轨道结束时延音踏板仍为按下状态', 'Sustain pedal remains on', '最后的 CC64 为按下状态，且未检测到后续松开或控制器重置。请检查预期的尾音。', 'The final CC64 is on with no later release or controller reset. Check the intended tail.'],
  MISSING_END_OF_TRACK: ['缺少轨道结束标记', 'Missing end-of-track marker', '可在该轨最后一个事件的原 tick 位置补入标准结束标记，不移动其他事件。', 'A standard end marker can be appended at the existing final tick without moving other events.'],
  SHARED_CHANNEL: ['多个轨道共享同一 MIDI 端口与通道', 'Tracks share a MIDI port and channel', '接收设备可能合并这些事件，跨轨配对存在歧义。本工具按轨道分析，并禁止相关音符自动修复。', 'A receiver may merge these events. Cross-track note pairing is ambiguous. Inspection is per track and related note repairs are blocked.'],
  CONFLICTING_TEMPO: ['同一 tick 有互相冲突的速度事件', 'Conflicting tempos at the same tick', '时长估算按轨道顺序采用最后一个速度事件，实际播放器可能不同。请在原工程确认。', 'Duration uses the last tempo in track order. Players may resolve this differently. Review in the source project.']
};
let language = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
let entries = [], current = null, report = null, previewResult = null, busy = false, filter = 'all', visibleCount = 100, nextJob = 0;
const selected = new Set(), pending = new Map();
const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
const t = (zh, english) => language === 'zh' ? zh : english;
worker.onmessage = ({ data }) => {
  const promise = pending.get(data.job);
  if (!promise) return;
  pending.delete(data.job);
  if (data.type === 'error') promise.reject(new Error(data.message)); else promise.resolve(data);
};
worker.onerror = () => { for (const p of pending.values()) p.reject(new Error(t('处理线程未能启动，请通过 HTTP(S) 打开本工具。', 'Processing worker unavailable. Open this app over HTTP(S).'))); pending.clear(); };
const run = (type, data = {}) => new Promise((resolve, reject) => {
  const job = ++nextJob; pending.set(job, { resolve, reject });
  const transfer = data.bytes ? [data.bytes.buffer] : [];
  worker.postMessage({ job, type, ...data }, transfer);
});
function status(text = '', error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function setBusy(value) {
  busy = value; $('demo').disabled = value; $('file-input').disabled = value;
  $('dropzone').setAttribute('aria-disabled', String(value));
  $('json').disabled = value || !report;
  for (const b of $('file-list').querySelectorAll('button')) b.disabled = value;
  for (const c of $('issue-list').querySelectorAll('input')) c.disabled = value;
  $('preview').disabled = value || !selected.size;
  $('download').disabled = value;
}
function setLanguage() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  for (const [el, zh] of originalText) el.innerHTML = language === 'zh' ? zh : (en[el.dataset.i18n] ?? zh);
  $('language').textContent = language === 'zh' ? 'EN' : '中文';
  renderFiles();
  if (report) { renderReport(false); if (previewResult) renderComparison(); }
}
function element(tag, text, className = '') {
  const e = document.createElement(tag); e.textContent = text; e.className = className; return e;
}
function renderFiles() {
  $('file-count').textContent = entries.length;
  $('file-list').replaceChildren();
  for (const entry of entries) {
    const button = element('button', '', `file-item${entry === current ? ' active' : ''}${entry.error ? ' failed' : ''}`);
    button.type = 'button'; button.disabled = busy; button.setAttribute('aria-pressed', String(entry === current));
    button.append(element('strong', entry.name));
    button.append(element('small', entry.error ? t('无法读取', 'Cannot read') : entry.summary ? t(`${entry.summary.notes} 音符 · ${entry.summary.issues} 提示`, `${entry.summary.notes} notes · ${entry.summary.issues} findings`) : t('待检查', 'Queued')));
    button.addEventListener('click', async () => { if (busy || (entry === current && report)) return; setBusy(true); await inspectEntry(entry); setBusy(false); });
    $('file-list').append(button);
  }
}
async function inspectEntry(entry) {
  current = entry; report = null; selected.clear(); previewResult = null; $('comparison').hidden = true;
  $('workspace').hidden = false; document.body.classList.add('has-files');
  $('filename').textContent = entry.name;
  status(t(`正在检查 ${entry.name}…`, `Inspecting ${entry.name}…`));
  renderFiles();
  try {
    const bytes = entry.demo ? createDemo() : new Uint8Array(await entry.file.arrayBuffer());
    const result = await run('inspect', { bytes });
    report = result.report; entry.error = null; entry.summary = { notes: report.notes.length, issues: report.issues.length };
    filter = 'all'; visibleCount = 100; renderReport();
    status(t('检查完成。文件未被修改。', 'Inspection complete. Your file has not been modified.'));
  } catch (error) {
    entry.error = error.message; renderFiles(); $('metrics').replaceChildren(); $('issue-list').replaceChildren(element('div', error.message, 'empty-result'));
    $('issue-count').textContent = '—'; $('selected-label').textContent = t('无法检查此文件', 'This file could not be inspected');
    const canvas = $('roll'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    $('track-select').replaceChildren(); $('roll-count').textContent = ''; $('more').hidden = true;
    status(error.message, true);
  }
}
async function addFiles(files) {
  if (busy) return;
  const incoming = [...files];
  if (entries.length + incoming.length > 8) { status(t('最多保留 8 个文件。刷新页面可开始新的一组检查。', 'Up to 8 files per session. Refresh to start a new batch.'), true); return; }
  if (incoming.some(f => f.size > LIMITS.bytes)) { status(t('有文件超过 20 MiB 上限。', 'A file exceeds the 20 MiB limit.'), true); return; }
  const total = entries.reduce((n, e) => n + (e.file?.size ?? 0), 0) + incoming.reduce((n, f) => n + f.size, 0);
  if (total > 40 * 1024 * 1024) { status(t('本组文件总大小不能超过 40 MiB。', 'Total batch size cannot exceed 40 MiB.'), true); return; }
  const fresh = incoming.map(file => ({ file, name: file.name, summary: null }));
  entries.push(...fresh); setBusy(true);
  // One worker and one full report in memory; completed files retain only summary counts.
  for (const entry of fresh) await inspectEntry(entry);
  setBusy(false); $('file-input').value = '';
}
function metric(value, label, accent = false) {
  const el = element('div', '', `metric${accent ? ' accent' : ''}`); el.append(element('strong', value), element('span', label)); return el;
}
function renderReport(resetTrack = true) {
  renderFiles();
  $('metrics').replaceChildren(metric(report.notes.length.toLocaleString(), t('音符', 'NOTES')), metric(report.tracks.length, t('轨道', 'TRACKS')), metric(`${report.duration.toFixed(2)}s`, t('时长估算', 'EST. DURATION')), metric(report.issues.length, t('检查提示', 'FINDINGS'), report.issues.length > 0));
  const previous = $('track-select').value;
  $('track-select').replaceChildren(new Option(t('所有轨道', 'All tracks'), 'all'));
  for (const track of report.tracks) $('track-select').add(new Option(`${track.index + 1} · ${track.name || t('未命名轨道', 'Untitled')}`, String(track.index)));
  if (!resetTrack && [...$('track-select').options].some(o => o.value === previous)) $('track-select').value = previous;
  $('issue-count').textContent = report.issues.length;
  renderIssues(); drawRoll(); updateSelection();
}
function renderIssues() {
  if (!report) return;
  const list = report.issues.filter(i => filter === 'all' || (filter === 'fixable' ? i.fixable : !i.fixable));
  $('issue-list').replaceChildren();
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  if (!list.length) {
    const e = element('div', report.issues.length ? t('此分类下没有提示。', 'No findings in this category.') : t('未发现已覆盖规则中的异常。', 'No findings under the implemented rules.'), 'empty-result');
    e.append(element('p', t('检查不评价旋律、编曲或演奏质量。', 'This inspection does not judge composition, arrangement or performance quality.'))); $('issue-list').append(e);
  }
  for (const issue of list.slice(0, visibleCount)) {
    const row = element('article', '', 'issue');
    const m = messages[issue.code] ?? [issue.code, issue.code, '', ''];
    const label = `${m[language === 'zh' ? 0 : 1]} · ${t('轨道', 'Track')} ${issue.track + 1} · tick ${issue.tick}`;
    if (issue.fixable) {
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(issue.id); check.disabled = busy; check.setAttribute('aria-label', label);
      check.addEventListener('change', () => { if (check.checked) selected.add(issue.id); else selected.delete(issue.id); previewResult = null; $('comparison').hidden = true; updateSelection(); }); row.append(check);
    } else row.append(element('span', issue.severity === 'info' ? 'i' : '·', 'issue-icon'));
    const body = element('div', ''); body.append(element('h4', m[language === 'zh' ? 0 : 1]), element('p', m[language === 'zh' ? 2 : 3]));
    const trackName = report.tracks[issue.track].name;
    body.append(element('div', `${t('轨道', 'Track')} ${issue.track + 1}${trackName ? ` · ${trackName}` : ''} / tick ${issue.tick} / ${issue.seconds.toFixed(3)}s${issue.pitch === undefined ? '' : ` / ${noteName(issue.pitch)} (${issue.pitch})`}${issue.channel === undefined ? '' : ` / CH ${issue.channel + 1}`}`, 'position'));
    if (issue.blockedReason) body.append(element('p', t('该组存在路由、控制器或配对歧义，保留原事件。', 'Routing, controller or pairing ambiguity blocks this repair. Original events are preserved.')));
    row.append(body, element('span', issue.fixable ? t('可选修复', 'OPT-IN FIX') : t('人工判断', 'REVIEW'), `issue-badge${issue.fixable ? '' : ' manual'}`));
    $('issue-list').append(row);
  }
  $('more').hidden = list.length <= visibleCount;
}
function updateSelection() {
  $('selected-label').textContent = t(`已选择 ${selected.size} 项修复 · ${report?.fixableCount ?? 0} 项可选`, `${selected.size} selected · ${report?.fixableCount ?? 0} optional fixes`);
  $('preview').disabled = busy || !selected.size;
}
function drawRoll() {
  if (!report) return;
  const canvas = $('roll'), ctx = canvas.getContext('2d');
  const width = canvas.clientWidth, height = 210, dpr = Math.min(devicePixelRatio || 1, 2);
  if (!width) return;
  canvas.width = Math.round(width * dpr); canvas.height = height * dpr; ctx.scale(dpr, dpr);
  const track = $('track-select').value;
  const visible = report.notes.filter(n => track === 'all' || n.track === Number(track));
  const highlighted = new Set(report.issues.flatMap(i => i.noteIds ?? []));
  let min = 48, max = 84;
  for (const n of visible) { min = Math.min(min, n.pitch - 2); max = Math.max(max, n.pitch + 2); }
  min = Math.max(0, min); max = Math.min(127, max);
  const left = 35, top = 15, row = (height - 36) / (max - min + 1), scale = (width - left - 14) / Math.max(report.endTick, 1);
  ctx.font = '8px monospace';
  for (let pitch = min; pitch <= max; pitch++) {
    const y = top + (max - pitch) * row;
    ctx.fillStyle = [1, 3, 6, 8, 10].includes(pitch % 12) ? '#ffffff02' : '#ffffff04'; ctx.fillRect(left, y, width - left, row - .3);
    if (pitch % 12 === 0) { ctx.fillStyle = '#726a85'; ctx.fillText(noteName(pitch), 7, y + Math.max(6, row - 1)); }
  }
  for (let i = 0; i <= 8; i++) {
    const x = left + (width - left - 14) * i / 8; ctx.strokeStyle = '#ffffff0a'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, height - 22); ctx.stroke();
    ctx.fillStyle = '#696279'; ctx.fillText(String(Math.round(report.endTick * i / 8)), x, height - 8);
  }
  const step = Math.max(1, Math.ceil(visible.length / 40000));
  for (let j = 0; j < visible.length; j += step) {
    const n = visible[j], end = n.end ?? report.endTick, x = left + n.start * scale, y = top + (max - n.pitch) * row;
    ctx.fillStyle = highlighted.has(n.id) ? '#edb67b' : ['#9b8aca', '#859da4', '#b29ac4', '#93a287'][n.track % 4];
    ctx.globalAlpha = highlighted.has(n.id) ? .9 : .7;
    ctx.fillRect(x, y + .4, Math.max(2, (end - n.start) * scale), Math.max(2, row - 1.4));
  }
  ctx.globalAlpha = 1;
  $('roll-count').textContent = t(`${visible.length.toLocaleString()} 音符${step > 1 ? ' · 抽样显示' : ''} · 横轴 tick`, `${visible.length.toLocaleString()} notes${step > 1 ? ' · sampled' : ''} · x: ticks`);
}
function renderComparison() {
  const after = previewResult.report;
  $('compare-metrics').replaceChildren();
  for (const [label, value] of [[t('音符', 'Notes'), `${report.notes.length} → ${after.notes.length}`], [t('提示', 'Findings'), `${report.issues.length} → ${after.issues.length}`], [t('时长', 'Duration'), `${report.duration.toFixed(3)}s → ${after.duration.toFixed(3)}s`]]) {
    const el = element('div', label + ' '); el.append(element('strong', value)); $('compare-metrics').append(el);
  }
  $('compare-detail').textContent = t(`应用 ${previewResult.applied.length} 项选择。已重新解析验证：轨道数量和结束 tick 保持不变。尚需人工判断的提示仍会保留。`, `${previewResult.applied.length} selected changes. Output re-parsed: track count and final tick unchanged. Findings requiring manual review remain.`);
  $('comparison').hidden = false;
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('demo').addEventListener('click', async () => {
  if (busy) return;
  let entry = entries.find(e => e.demo);
  if (!entry) { if (entries.length >= 8) { status(t('队列已满。刷新页面可开始新的一组检查。', 'Queue full. Refresh to start a new batch.'), true); return; } entry = { demo: true, name: 'midicheck-demo.mid' }; entries.push(entry); }
  setBusy(true); await inspectEntry(entry); setBusy(false);
});
$('language').addEventListener('click', () => { language = language === 'zh' ? 'en' : 'zh'; setLanguage(); });
$('dropzone').addEventListener('click', () => { if (!busy) $('file-input').click(); });
$('dropzone').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) $('file-input').click(); } });
$('file-input').addEventListener('change', e => addFiles(e.target.files));
for (const type of ['dragenter', 'dragover']) $('dropzone').addEventListener(type, e => { e.preventDefault(); if (!busy) $('dropzone').classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) $('dropzone').addEventListener(type, e => { e.preventDefault(); $('dropzone').classList.remove('dragging'); if (type === 'drop') addFiles(e.dataTransfer.files); });
document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; visibleCount = 100; renderIssues(); }));
$('more').addEventListener('click', () => { visibleCount += 100; renderIssues(); });
$('track-select').addEventListener('change', drawRoll);
new ResizeObserver(drawRoll).observe($('roll'));
$('preview').addEventListener('click', async () => {
  if (busy || !selected.size || !report) return;
  setBusy(true); status(t('正在验证修复副本…', 'Verifying repair copy…'));
  try { previewResult = await run('preview', { ids: [...selected] }); renderComparison(); status(t('预览已就绪，尚未导出。', 'Preview ready. No file has been exported.')); }
  catch (error) { status(error.message, true); }
  finally { setBusy(false); }
});
$('download').addEventListener('click', () => {
  if (busy || !previewResult || !current) return;
  const name = current.name.replace(/\.(mid|midi)$/i, '') + '.checked.mid';
  download(previewResult.bytes, name, 'audio/midi'); status(t(`已下载 ${name}。原文件未被修改。`, `Downloaded ${name}. Original unchanged.`));
});
$('cancel').addEventListener('click', () => { previewResult = null; $('comparison').hidden = true; });
$('json').addEventListener('click', () => {
  if (busy || !report) return;
  const output = { ...jsonReport(report, current.name), ...(previewResult ? { repairPreview: { applied: previewResult.applied, after: jsonReport(previewResult.report, current.name + '.checked.mid') } } : {}) };
  download(JSON.stringify(output, null, 2), current.name.replace(/\.(mid|midi)$/i, '') + '.report.json', 'application/json');
});
setLanguage();
