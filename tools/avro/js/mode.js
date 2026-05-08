/* ============================================================
DARK MODE TOGGLE LOGIC
============================================================ */

const themeBtn = document.getElementById("themeToggle");

function applyTheme(mode) {
  document.body.classList.remove("dark", "light");

  if (mode === "dark") {
    document.body.classList.add("dark");
    themeBtn.textContent = "☀️";
  } else if (mode === "light") {
    document.body.classList.add("light");
    themeBtn.textContent = "🌙";
  }
  localStorage.setItem("mode", mode);
}
const saved = localStorage.getItem("mode");

// Add event listener to update theme when selected
themeBtn.addEventListener("click", () => {
  let selectedTheme = !document.body.classList.contains("dark")
    ? "dark"
    : "light";
  applyTheme(selectedTheme);
});

if (saved === "dark" || saved === "light") {
  applyTheme(saved);
} else {
  applyTheme("dark");
}
