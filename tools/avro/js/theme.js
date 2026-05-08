const THEME_NAMES = Object.freeze({
  "one-light": "One Light",
  "one-dark-pro": "One Dark Pro",
  "tokyo-night": "Tokyo Night",
  "catppuccin-mocha": "Catppuccin Mocha",
  dracula: "Dracula",
  gruvbox: "Gruvbox",
  "vscode-light": "VS Code Light",
  "rose-pine": "Rose Pine",
});
let lastTheme;

function applyTheme(theme) {
  if (lastTheme) document.body.classList.remove(lastTheme);
  document.body.classList.add(theme);
  lastTheme = theme;
  localStorage.setItem("theme", theme);
}

function setUpThemes() {
  // Get the theme picker dropdown
  const themePicker = document.getElementById("theme-picker");

  for (const [key, value] of Object.entries(THEME_NAMES)) {
    var opt = document.createElement("option");
    opt.value = key;
    opt.innerHTML = value;
    themePicker.appendChild(opt);
  }

  // Add event listener to update theme when selected
  themePicker.addEventListener("change", (e) => {
    const selectedTheme = e.target.value;
    applyTheme(selectedTheme);
  });

  /* Remember the theme and apply */
  const saved = localStorage.getItem("theme");

  let themeNames = Object.keys(THEME_NAMES);
  if (themeNames.includes(saved)) {
    themePicker.value = saved;
    applyTheme(saved);
  } else {
    applyTheme(themeNames[0]);
  }
}

setUpThemes();
