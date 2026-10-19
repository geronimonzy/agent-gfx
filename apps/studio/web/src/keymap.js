import { wslSetupOpen, closeWslSetup } from './wslsetup.js';
// The studio's shortcut table (docs/KEYS.md). Every keyboard shortcut lives here; keys.js dispatches it.
import { S, emit, undo, redo, removeCue, duration } from './store.js';
import { toggle, seek, step, transport } from './transport.js';
import { fitView, toggleMute, toggleSolo, ensureVisible } from './timeline.js';
import { newNote, createComment, closePop, popOpen, openCommentId, previewOpen, closePreview } from './notes.js';
import { getTool, setTool, baseTool, toggleCommentsShown } from './viewer.js';
import { isDrawing, stopDraw, startDraw, undoStroke, curveActive, finishCurve, cancelCurve, hasStrokeSel, deleteSelStroke, deselectStroke } from './draw.js';
import { deleteComment } from './comments.js';
import { liveOn, toggleLive, clearSel, walk, nudgeSel, L as liveState } from './live.js';
import { pinSelected } from './paths.js';
import { askOpen, closeAsk, askToTerminal } from './ask.js';
import { settingsOpen, closeSettings, toggleSettings, settingsEscape, focusSearch } from './settings.js';
import { openWelcome } from './api.js';
import * as renderMod from './render.js';
import { toggleDock, termCopy, termPaste } from './terminal.js';
import { register, defineContext, addDialogProbe, isTyping } from './keys.js';
import { toggleHelp, helpOpen, closeHelp } from './keys-help.js';
import { diffOpen, closeDiff } from './diff.js';
import { visualDiffOpen, closeVisualDiff, vdiffKeys } from './vdiff.js';
import { versionRowFocused, versionRowKeyDown } from './versions.js';
import { licenceOpen, closeLicence } from './about.js';
import { zoomUi } from './layout.js';

const hasSel = () => !!(S.sel.cue || S.sel.note);
const frame = (n) => () => { step(n); ensureVisible(transport.time()); };
const nudge = (dx, dy, n) => () => nudgeSel(dx * n, dy * n);
const nudgeOk = () => !!liveState.sel && getTool() === 'select';

async function drawTool() {
  const id = openCommentId() || (S.meta ? await createComment() : null);
  if (id) startDraw(id);
}

export function initKeymap({ saveDraft, toggleLoop, setMode, saveCode, codeOn }) {
  defineContext('versions', versionRowFocused);
  defineContext('draw', () => isDrawing());
  defineContext('comment', () => popOpen() || getTool() === 'comment');
  defineContext('live', () => liveOn());
  defineContext('code', () => codeOn());
  addDialogProbe(() => settingsOpen() || helpOpen() || licenceOpen());

  register([
    // ---- Versions list (only the row itself, not its nested controls)
    { id: 'versions.rows', keys: ['Up', 'Down', 'Enter', 'Space'], context: 'versions', group: 'Code & Versions', label: 'Version history: previous / next row, open diff, select / deselect', scene: false, when: versionRowFocused, run: versionRowKeyDown },

    // ---- dialogs (Esc closes the topmost; one at a time)
    { id: 'dlg.preview', keys: ['Esc'], context: 'dialog', group: 'Edit / File', label: 'Close the image preview', scene: false, typing: true, when: previewOpen, run: closePreview },
    { id: 'dlg.diff', keys: ['Esc'], context: 'dialog', group: 'Code & Versions', label: 'Close the diff', scene: false, typing: true, when: diffOpen, run: closeDiff },
    { id: 'dlg.vdiff', keys: ['Esc'], context: 'dialog', group: 'Code & Versions', label: 'Close Compare visually', scene: false, typing: true, when: visualDiffOpen, run: closeVisualDiff },
    { id: 'vdiff.play', keys: ['Space'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: play / pause', scene: false, when: visualDiffOpen, run: () => vdiffKeys.togglePlay() },
    { id: 'vdiff.prev', keys: ['Left'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: previous frame', scene: false, when: visualDiffOpen, run: () => vdiffKeys.step(-1) },
    { id: 'vdiff.next', keys: ['Right'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: next frame', scene: false, when: visualDiffOpen, run: () => vdiffKeys.step(1) },
    { id: 'vdiff.side', keys: ['1'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: side by side', scene: false, when: visualDiffOpen, run: () => vdiffKeys.setMode('side') },
    { id: 'vdiff.wipe', keys: ['2'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: wipe (drag the line, or ↑/↓ on the picture)', scene: false, when: visualDiffOpen, run: () => vdiffKeys.setMode('wipe') },
    { id: 'vdiff.diff', keys: ['3'], context: 'dialog', group: 'Code & Versions', label: 'Compare visually: difference', scene: false, when: visualDiffOpen, run: () => vdiffKeys.setMode('diff') },
    { id: 'dlg.licence', keys: ['Esc'], context: 'dialog', group: 'Settings', label: 'Close the licence text', scene: false, typing: true, when: licenceOpen, run: closeLicence },
    { id: 'dlg.help', keys: ['Esc'], context: 'dialog', group: 'Edit / File', label: 'Close the shortcut help', scene: false, typing: true, when: helpOpen, run: closeHelp },
    { id: 'dlg.ask', keys: ['Esc'], context: 'dialog', group: 'Terminal & Claude', label: 'Close the Ask Claude dialog', scene: false, typing: true, when: askOpen, run: closeAsk },
    { id: 'dlg.wslsetup', keys: ['Esc'], context: 'dialog', group: 'Settings', label: 'Close WSL engine setup', scene: false, typing: true, when: wslSetupOpen, run: closeWslSetup },
    { id: 'dlg.settings', keys: ['Esc'], context: 'dialog', group: 'Settings', label: 'Settings: back to the workspace (in a field: leave the field; in the search: clear it)', scene: false, typing: true, when: settingsOpen, run: (e) => settingsEscape(e) },
    { id: 'dlg.settings.close', keys: ['Ctrl+,'], context: 'dialog', group: 'Settings', label: 'Close Settings', hidden: true, scene: false, typing: true, when: settingsOpen, run: closeSettings },
    { id: 'settings.search', keys: ['Ctrl+F', '/'], context: 'dialog', group: 'Settings', label: 'Settings: search', scene: false, typing: true, when: (e) => settingsOpen() && !(e.key === '/' && isTyping(e.target)), run: focusSearch },
    { id: 'settings.results', keys: ['↑ ↓', 'Enter'], context: 'dialog', group: 'Settings', label: 'Settings search: move through the results / jump to the setting', doc: true },
    { id: 'ask.send', keys: ['Ctrl+Enter'], context: 'dialog', group: 'Terminal & Claude', label: 'Ask Claude: paste the brief into the terminal', scene: false, typing: true, when: askOpen, run: askToTerminal },

    // ---- drawing on a comment
    { id: 'draw.curve.done', when: curveActive, keys: ['Enter'], context: 'draw', group: 'Comments & Draw', label: 'Curve tool: finish the curve (or double-click)', run: finishCurve },
    { id: 'draw.curve.cancel', when: curveActive, keys: ['Esc'], context: 'draw', group: 'Comments & Draw', label: 'Curve tool: cancel the curve being drawn', run: cancelCurve },
    { id: 'draw.sel.delete', when: isDrawing, keys: ['Delete', 'Backspace'], context: 'draw', group: 'Comments & Draw', label: 'Delete the selected drawing (draw Select tool)', run: deleteSelStroke },
    { id: 'draw.sel.clear', when: hasStrokeSel, keys: ['Esc'], context: 'draw', group: 'Comments & Draw', label: 'Deselect the drawing', run: deselectStroke },
    { id: 'draw.done', when: isDrawing, keys: ['Enter', 'D', 'Esc'], context: 'draw', group: 'Comments & Draw', label: 'Finish drawing', run: stopDraw },
    { id: 'draw.undo', when: isDrawing, keys: ['Ctrl+Z'], context: 'draw', group: 'Comments & Draw', label: 'Undo the last drawing change (stroke, move / scale / rotate, delete)', run: undoStroke },
    { id: 'draw.noredo', when: isDrawing, keys: ['Ctrl+Shift+Z', 'Ctrl+Y', 'C'], context: 'draw', group: 'Comments & Draw', label: 'Swallowed while drawing', hidden: true, run: () => {} },

    // ---- Code mode (the editor's own keys - search Ctrl+F, multi-cursor, folding - stay in CodeMirror)
    { id: 'code.save', keys: ['Ctrl+S'], context: 'code', group: 'Code & Versions', label: 'Save the file (Code mode)', scene: false, typing: true, when: () => codeOn(), run: () => { saveCode(); } },
    { id: 'code.find', keys: ['Ctrl+F'], context: 'code', group: 'Code & Versions', label: 'Find / replace in the file (editor focused)', doc: true },
    { id: 'code.multi', keys: ['Ctrl+D', 'Alt+Click'], context: 'code', group: 'Code & Versions', label: 'Add the next match / a cursor (editor)', doc: true },
    { id: 'code.blocks', keys: ['Alt+↓', 'Alt+↑'], context: 'code', group: 'Code & Versions', label: 'Object view: next / previous block of the object', doc: true },

    // ---- comment popover / comment tool
    { id: 'comment.close', keys: ['Esc'], context: 'comment', group: 'Comments & Draw', label: 'Close the comment popover', typing: true, when: (e) => popOpen() && (!isTyping(e.target) || !!e.target.closest('#note-pop')), run: () => closePop() },
    { id: 'comment.enter', keys: ['Enter'], context: 'comment', group: 'Comments & Draw', label: 'Save and close the comment (Shift+Enter = new line)', typing: true, when: (e) => popOpen() && e.target.id === 'np-text', run: () => closePop() },

    // ---- Live / Select
    { id: 'live.select', keys: ['V'], context: 'live', group: 'Live / Select', label: 'Select tool on / off (Live: Select is the default)', run: () => setTool(getTool() === 'select' ? 'view' : 'select') },
    { id: 'live.up', keys: ['['], context: 'live', group: 'Live / Select', label: 'Select the element above in the stack', when: () => !!liveState.sel, run: () => walk(1) },
    { id: 'live.down', keys: [']'], context: 'live', group: 'Live / Select', label: 'Select the element below in the stack', when: () => !!liveState.sel, run: () => walk(-1) },
    { id: 'live.nudge.l', keys: ['ArrowLeft'], context: 'live', group: 'Live / Select', label: 'Nudge the selection 1 px (arrows)', when: nudgeOk, run: nudge(-1, 0, 1) },
    { id: 'live.nudge.r', keys: ['ArrowRight'], context: 'live', group: 'Live / Select', label: 'Nudge right', hidden: true, when: nudgeOk, run: nudge(1, 0, 1) },
    { id: 'live.nudge.u', keys: ['ArrowUp'], context: 'live', group: 'Live / Select', label: 'Nudge up', hidden: true, when: nudgeOk, run: nudge(0, -1, 1) },
    { id: 'live.nudge.d', keys: ['ArrowDown'], context: 'live', group: 'Live / Select', label: 'Nudge down', hidden: true, when: nudgeOk, run: nudge(0, 1, 1) },
    { id: 'live.nudge10.l', keys: ['Shift+ArrowLeft'], context: 'live', group: 'Live / Select', label: 'Nudge the selection 10 px (Shift+arrows)', when: nudgeOk, run: nudge(-1, 0, 10) },
    { id: 'live.nudge10.r', keys: ['Shift+ArrowRight'], context: 'live', group: 'Live / Select', label: 'Nudge right 10 px', hidden: true, when: nudgeOk, run: nudge(1, 0, 10) },
    { id: 'live.nudge10.u', keys: ['Shift+ArrowUp'], context: 'live', group: 'Live / Select', label: 'Nudge up 10 px', hidden: true, when: nudgeOk, run: nudge(0, -1, 10) },
    { id: 'live.nudge10.d', keys: ['Shift+ArrowDown'], context: 'live', group: 'Live / Select', label: 'Nudge down 10 px', hidden: true, when: nudgeOk, run: nudge(0, 1, 10) },
    { id: 'live.deselect', keys: ['Esc'], context: 'live', group: 'Live / Select', label: 'Deselect the element', when: () => !!liveState.sel, run: clearSel },

    // ---- viewer tools
    { id: 'viewer.live', keys: ['L'], context: 'viewer', group: 'Viewer tools', label: 'Live scene view on / off', run: toggleLive },
    { id: 'viewer.comments', keys: ['H'], context: 'viewer', group: 'Viewer tools', label: 'Show / hide comments on the picture (pins + drawings; the Comments tab stays)', run: toggleCommentsShown },
    { id: 'viewer.comment', keys: ['C'], context: 'viewer', group: 'Viewer tools', label: 'Comment tool on / off (click the picture to pin)', run: () => setTool(getTool() === 'comment' ? baseTool() : 'comment') },
    { id: 'viewer.draw', keys: ['D'], context: 'viewer', group: 'Comments & Draw', label: 'Draw tool: draw on the open comment, or on a new comment at the playhead', when: () => !isDrawing(), run: drawTool },
    { id: 'viewer.path', keys: ['P'], context: 'viewer', group: 'Layers & Paths', label: 'Pin / unpin the motion path of the selected element', run: pinSelected },
    { id: 'viewer.reset', keys: ['Esc'], context: 'viewer', group: 'Viewer tools', label: 'Back to the default tool (Select in Live, else View)', when: () => getTool() !== baseTool(), run: () => setTool(baseTool()) },
    { id: 'viewer.altpick', keys: ['Alt+Click'], context: 'live', group: 'Live / Select', label: 'Select the exact element under the cursor', doc: true },
    { id: 'layers.solo', keys: ['Alt+Click eye'], context: 'live', group: 'Layers & Paths', label: 'Solo a layer (view only)', doc: true },

    // ---- timeline / cues
    { id: 'tl.note', keys: ['N'], context: 'timeline', group: 'Comments & Draw', label: 'Timeline comment at the playhead (or on the selected cue)', run: () => newNote() },
    { id: 'tl.mute', keys: ['M'], context: 'timeline', group: 'Timeline', label: 'Mute the active lane', when: () => !!S.lane, run: () => toggleMute(S.lane) },
    { id: 'tl.solo', keys: ['S'], context: 'timeline', group: 'Timeline', label: 'Solo the active lane', when: () => !!S.lane, run: () => toggleSolo(S.lane) },
    { id: 'tl.fit', keys: ['F'], context: 'timeline', group: 'Timeline', label: 'Fit the timeline to the scene', run: fitView },
    { id: 'tl.delete', keys: ['Delete', 'Backspace'], context: 'timeline', group: 'Timeline', label: 'Delete the selected cue (original cues mute) or comment', when: hasSel,
      run: () => { if (S.sel.cue) removeCue(S.sel.cue); else if (S.sel.note) deleteComment(S.sel.note); } },
    { id: 'tl.deselect', keys: ['Esc'], context: 'timeline', group: 'Timeline', label: 'Deselect cue / comment', when: hasSel, run: () => { S.sel.cue = null; S.sel.note = null; emit('selection'); } },
    { id: 'tl.zoom', keys: ['Ctrl+Wheel'], context: 'timeline', group: 'Timeline', label: 'Zoom the timeline around the cursor', doc: true },
    { id: 'tl.scroll', keys: ['Wheel'], context: 'timeline', group: 'Timeline', label: 'Scroll the timeline (Shift = sideways)', doc: true },
    { id: 'tl.loop', keys: ['Shift+Drag ruler'], context: 'timeline', group: 'Timeline', label: 'Drag a loop region on the ruler', doc: true },
    { id: 'tl.addcue', keys: ['Double-click lane'], context: 'timeline', group: 'Timeline', label: 'Add a cue on that lane', doc: true },

    // ---- terminal (xterm's own key handler)
    { id: 'term.copy', keys: ['Ctrl+Shift+C'], context: 'terminal', group: 'Terminal & Claude', label: 'Copy the terminal selection', scene: false, run: (e, t) => termCopy(t) },
    { id: 'term.paste', keys: ['Ctrl+Shift+V'], context: 'terminal', group: 'Terminal & Claude', label: 'Paste into the terminal', scene: false, run: (e, t) => termPaste(t) },

    // ---- global
    { id: 'play', keys: ['Space'], group: 'Playback', label: 'Play / pause', run: () => { toggle(); } },
    { id: 'frame.prev', keys: ['ArrowLeft', 'Ctrl+ArrowLeft'], group: 'Playback', label: 'Back 1 frame', run: frame(-1) },
    { id: 'frame.next', keys: ['ArrowRight', 'Ctrl+ArrowRight'], group: 'Playback', label: 'Forward 1 frame', run: frame(1) },
    { id: 'frame.prev10', keys: ['Shift+ArrowLeft', 'Ctrl+Shift+ArrowLeft'], group: 'Playback', label: 'Back 10 frames', run: frame(-10) },
    { id: 'frame.next10', keys: ['Shift+ArrowRight', 'Ctrl+Shift+ArrowRight'], group: 'Playback', label: 'Forward 10 frames', run: frame(10) },
    { id: 'seek.start', keys: ['Home'], group: 'Playback', label: 'Go to the start', run: () => { seek(0); ensureVisible(0); } },
    { id: 'seek.end', keys: ['End'], group: 'Playback', label: 'Go to the end', run: () => { seek(duration()); ensureVisible(duration()); } },
    { id: 'loop', keys: ['Shift+L'], group: 'Playback', label: 'Loop on / off (whole scene unless a region is set)', run: toggleLoop },
    { id: 'ab', keys: ['A'], group: 'Playback', label: 'Audition: Original / Draft', run: () => setMode(S.mode === 'draft' ? 'original' : 'draft') },
    { id: 'undo', keys: ['Ctrl+Z'], group: 'Edit / File', label: 'Undo', run: undo },
    { id: 'redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], group: 'Edit / File', label: 'Redo', run: redo },
    { id: 'save', keys: ['Ctrl+S'], group: 'Edit / File', label: 'Save the draft', scene: false, typing: true, run: saveDraft },
    { id: 'render', keys: ['Ctrl+R'], group: 'Render', label: 'Open the Render panel (not in a terminal: Ctrl+R there is the shell\'s reverse search)', scene: false, typing: true, run: () => { if (S.name) renderMod.toggleRender(true); } },
    { id: 'render.quick', keys: ['Shift+Click Render'], group: 'Render', label: 'Quick render: mp4 + audio at scene size (Fast mode)', doc: true },
    { id: 'terminal', keys: ['Ctrl+`'], group: 'Terminal & Claude', label: 'Open / focus the terminal panel (in the terminal: back to the timeline)', scene: false, typing: true, inDialog: true, inTerminal: true, run: () => { closeSettings(); toggleDock(); } },
    // ---- settings / projects (docs/HOME-SETTINGS.md)
    { id: 'settings', keys: ['Ctrl+,'], group: 'Settings', label: 'Settings', scene: false, typing: true, run: () => { toggleSettings(); } },
    { id: 'welcome', keys: ['Ctrl+Shift+O'], group: 'Settings', label: 'Open the welcome window (projects)', scene: false, typing: true, inDialog: true, run: () => { openWelcome().catch(() => {}); } },
    // ---- layout (docs/LAYOUT.md §4)
    { id: 'ui.zoomin', keys: ['Ctrl+='], group: 'Layout', label: 'Larger UI (whole window)', scene: false, typing: true, inDialog: true, inTerminal: true, run: () => { zoomUi(1); } },
    { id: 'ui.zoomout', keys: ['Ctrl+-'], group: 'Layout', label: 'Smaller UI (whole window)', scene: false, typing: true, inDialog: true, inTerminal: true, run: () => { zoomUi(-1); } },
    { id: 'ui.zoomreset', keys: ['Ctrl+0'], group: 'Layout', label: 'UI scale back to 100 %', scene: false, typing: true, inDialog: true, inTerminal: true, run: () => { zoomUi(0); } },
    { id: 'layout.panelmenu', keys: ['Right-click tab', '⋯'], group: 'Layout', label: 'Panel menu: scale this panel, pop it out, close it', doc: true },
    { id: 'layout.drag', keys: ['Drag header'], group: 'Layout', label: 'Move a panel: drag its tab or the bar at its top edge onto another panel / edge', doc: true },
    { id: 'help', keys: ['?'], group: 'Edit / File', label: 'Keyboard shortcuts', scene: false, run: toggleHelp },
    { id: 'blur', keys: ['Esc'], group: 'Edit / File', label: 'Leave the text field', scene: false, typing: true, hidden: true, when: (e) => isTyping(e.target) && !e.target.closest?.('.cm-editor'), run: (e) => e.target.blur() },
  ]);
}
