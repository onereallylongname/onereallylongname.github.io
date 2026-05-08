// CONCEPTS PANEL TOGGLE
document.getElementById("conceptsBtn").addEventListener("click", () => {
  document.getElementById("conceptPanel").classList.toggle("hidden");
});

/* --------------------------------------------------------------------------
  Shortcuts
--------------------------------------------------------------------------*/

document.addEventListener("keydown", (e) => {
  // --------------------------
  // CTRL + ? → toggle help menu
  // --------------------------
  if (e.ctrlKey && e.key === "?") {
    e.preventDefault();
    document.getElementById("conceptPanel").classList.toggle("hidden");
    return;
  }
});
