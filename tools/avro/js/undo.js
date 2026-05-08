/* ==========================================================================
   UNDO / REDO SYSTEM (Command Pattern)
   Standalone, no dependencies, console-testable
   ========================================================================== */

/* --------------------------------------------------------------------------
   Start Variables
   --------------------------------------------------------------------------*/

const UNDO_LIMIT = 500;

// Stacks
window.undoStack = [];
window.redoStack = [];

/* --------------------------------------------------------------------------
   Command object
   --------------------------------------------------------------------------*/

class Command {
  /**
   * @param {Function} doFn   - applies the mutation
   * @param {Function} undoFn - restores the previous state
   * @param {String}   desc   - human-readable description
   */
  constructor(doFn, undoFn, after = null, desc = "") {
    this.do = doFn;
    this.undo = undoFn;
    this.after = after;
    this.desc = desc;
  }
}

window.Command = Command;

/* --------------------------------------------------------------------------
   Core executor
   --------------------------------------------------------------------------*/

window.executeCommand = function (cmd) {
  if (!(cmd instanceof Command)) {
    console.error("executeCommand requires a Command instance");
    return;
  }

  try {
    cmd.do();
    undoStack.push(cmd);
    redoStack.length = 0;

    // enforce max size
    if (undoStack.length > UNDO_LIMIT) {
      undoStack.shift(); // drop oldest command
    }

    if (cmd.after) cmd.after();
    return true;
  } catch (err) {
    console.error("Command failed:", err);
    return false;
  }
};

/* --------------------------------------------------------------------------
   Undo
   --------------------------------------------------------------------------*/

window.undo = function () {
  if (undoStack.length === 0) {
    console.log("Nothing to undo");
    return;
  }

  const cmd = undoStack.pop();
  try {
    cmd.undo();
    redoStack.push(cmd);

    if (cmd.after) cmd.after();
  } catch (err) {
    console.error("Undo failed:", err);
  }
};

/* --------------------------------------------------------------------------
   Redo
   --------------------------------------------------------------------------*/

window.redo = function () {
  if (redoStack.length === 0) {
    console.log("Nothing to redo");
    return;
  }

  const cmd = redoStack.pop();
  try {
    cmd.do();
    undoStack.push(cmd);

    if (cmd.after) cmd.after();
  } catch (err) {
    console.error("Redo failed:", err);
  }
};

/* --------------------------------------------------------------------------
   Reset
   --------------------------------------------------------------------------*/

window.resetUndo = function () {
  if (undoStack.length !== 0) {
    undoStack.splice(0, undoStack.length);
  }

  if (redoStack.length !== 0) {
    redoStack.splice(0, redoStack.length);
  }
};

/* --------------------------------------------------------------------------
   Helpers for debugging
   --------------------------------------------------------------------------*/

window.printUndoHistory = function () {
  console.table(undoStack.map((c) => c.desc));
};

window.printRedoHistory = function () {
  console.table(redoStack.map((c) => c.desc));
};

console.log("%cUndo/Redo system loaded", "color: #0a0;");
