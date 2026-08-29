/**
 * core/history.js
 * Undo / redo stack for map edits (layers, selection, marked areas).
 *
 * map.js registers getSnapshot / applySnapshot so restore can update
 * closed-over locals until those migrate fully onto Mahp.state.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var stack = [];
  var index = -1;
  var max = typeof Mahp.HISTORY_MAX === 'number' ? Mahp.HISTORY_MAX : 50;

  /** @type {null | function(): object} */
  var getSnapshot = null;
  /** @type {null | function(object): void} */
  var applySnapshot = null;

  function configure(opts) {
    opts = opts || {};
    if (typeof opts.getSnapshot === 'function') getSnapshot = opts.getSnapshot;
    if (typeof opts.applySnapshot === 'function') applySnapshot = opts.applySnapshot;
    if (typeof opts.max === 'number') max = opts.max;
  }

  function cloneState() {
    if (!getSnapshot) {
      return JSON.parse(
        JSON.stringify({
          userLayers: (Mahp.state && Mahp.state.userLayers) || [],
          activeLayerId: Mahp.state && Mahp.state.activeLayerId,
          selectedItemIds: Mahp.state && Mahp.state.selectedItemIds
            ? Array.from(Mahp.state.selectedItemIds)
            : [],
          markedAreas: (Mahp.state && Mahp.state.markedAreas) || []
        })
      );
    }
    return JSON.parse(JSON.stringify(getSnapshot()));
  }

  function push() {
    var snap = cloneState();
    stack = stack.slice(0, index + 1);
    stack.push(snap);
    if (stack.length > max) stack.shift();
    index = stack.length - 1;
    syncToState();
  }

  function restore(snap) {
    if (!applySnapshot) {
      if (Mahp.state) {
        Mahp.state.userLayers = snap.userLayers || [];
        Mahp.state.activeLayerId = snap.activeLayerId;
        Mahp.state.selectedItemIds = new Set(snap.selectedItemIds || []);
        Mahp.state.markedAreas = snap.markedAreas || [];
      }
      return;
    }
    applySnapshot(snap);
  }

  function undo() {
    if (index <= 0) return;
    index -= 1;
    restore(JSON.parse(JSON.stringify(stack[index])));
    syncToState();
  }

  function redo() {
    if (index >= stack.length - 1) return;
    index += 1;
    restore(JSON.parse(JSON.stringify(stack[index])));
    syncToState();
  }

  function syncToState() {
    if (!Mahp.state) return;
    Mahp.state.historyStack = stack;
    Mahp.state.historyIndex = index;
  }

  function setupKeyboard() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) {
        return;
      }
      var mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        mod &&
        (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))
      ) {
        e.preventDefault();
        redo();
      }
    });
  }

  function canUndo() {
    return index > 0;
  }

  function canRedo() {
    return index < stack.length - 1;
  }

  Mahp.history = {
    configure: configure,
    push: push,
    undo: undo,
    redo: redo,
    setupKeyboard: setupKeyboard,
    canUndo: canUndo,
    canRedo: canRedo,
    // aliases used by map.js during transition
    pushHistory: push,
    setupUndoRedo: setupKeyboard
  };
})(typeof window !== 'undefined' ? window : globalThis);
