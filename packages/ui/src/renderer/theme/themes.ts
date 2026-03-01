/* ─── Theme system ───────────────────────────────────────────────── */

export interface ThemePalette {
  base: string;
  mantle: string;
  crust: string;
  surface0: string;
  surface1: string;
  surface2: string;
  overlay0: string;
  overlay1: string;
  overlay2: string;
  text: string;
  subtext0: string;
  subtext1: string;
  mauve: string;
  blue: string;
  green: string;
  red: string;
  yellow: string;
  peach: string;
  teal: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  contributor: string;
  description?: string;
  palette: ThemePalette;
}

export interface CustomTheme extends ThemeDefinition {
  contributor: "custom";
}

/* ─── Built-in themes ────────────────────────────────────────────── */

export const catppuccinMocha: ThemeDefinition = {
  id: "catppuccin-mocha",
  name: "Mocha",
  contributor: "Catppuccin",
  description: "The original warm dark theme. Default for Solix.",
  palette: {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    surface0: "#313244",
    surface1: "#45475a",
    surface2: "#585b70",
    overlay0: "#6c7086",
    overlay1: "#7f849c",
    overlay2: "#9399b2",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    subtext1: "#bac2de",
    mauve: "#cba6f7",
    blue: "#89b4fa",
    green: "#a6e3a1",
    red: "#f38ba8",
    yellow: "#f9e2af",
    peach: "#fab387",
    teal: "#94e2d5",
  },
};

export const catppuccinMacchiato: ThemeDefinition = {
  id: "catppuccin-macchiato",
  name: "Macchiato",
  contributor: "Catppuccin",
  description: "A slightly warmer dark palette with deeper hues.",
  palette: {
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
    surface0: "#363a4f",
    surface1: "#494d64",
    surface2: "#5b6078",
    overlay0: "#6e738d",
    overlay1: "#8087a2",
    overlay2: "#939ab7",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    subtext1: "#b8c0e0",
    mauve: "#c6a0f6",
    blue: "#8aadf4",
    green: "#a6da95",
    red: "#ed8796",
    yellow: "#eed49f",
    peach: "#f5a97f",
    teal: "#8bd5ca",
  },
};

export const catppuccinFrappe: ThemeDefinition = {
  id: "catppuccin-frappe",
  name: "Frappé",
  contributor: "Catppuccin",
  description: "A cool-toned mid-dark palette.",
  palette: {
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
    surface0: "#414559",
    surface1: "#51576d",
    surface2: "#626880",
    overlay0: "#737994",
    overlay1: "#838ba7",
    overlay2: "#949cbb",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    subtext1: "#b5bfe2",
    mauve: "#ca9ee6",
    blue: "#8caaee",
    green: "#a6d189",
    red: "#e78284",
    yellow: "#e5c890",
    peach: "#ef9f76",
    teal: "#81c8be",
  },
};

export const catppuccinLatte: ThemeDefinition = {
  id: "catppuccin-latte",
  name: "Latte",
  contributor: "Catppuccin",
  description: "A bright, airy light theme.",
  palette: {
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
    surface0: "#ccd0da",
    surface1: "#bcc0cc",
    surface2: "#acb0be",
    overlay0: "#9ca0b0",
    overlay1: "#8c8fa1",
    overlay2: "#7c7f93",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    subtext1: "#5c5f77",
    mauve: "#8839ef",
    blue: "#1e66f5",
    green: "#40a02b",
    red: "#d20f39",
    yellow: "#df8e1d",
    peach: "#fe640b",
    teal: "#179299",
  },
};

export const dracula: ThemeDefinition = {
  id: "dracula",
  name: "Dracula",
  contributor: "Dracula",
  description: "The classic dark theme with vivid accents.",
  palette: {
    base: "#282a36",
    mantle: "#21222c",
    crust: "#191a21",
    surface0: "#44475a",
    surface1: "#4d5066",
    surface2: "#565973",
    overlay0: "#6272a4",
    overlay1: "#7283b5",
    overlay2: "#8294c6",
    text: "#f8f8f2",
    subtext0: "#c0c0b8",
    subtext1: "#dcdcd3",
    mauve: "#bd93f9",
    blue: "#8be9fd",
    green: "#50fa7b",
    red: "#ff5555",
    yellow: "#f1fa8c",
    peach: "#ffb86c",
    teal: "#8be9fd",
  },
};

export const nord: ThemeDefinition = {
  id: "nord",
  name: "Nord",
  contributor: "Arctic",
  description: "An arctic, north-bluish clean palette.",
  palette: {
    base: "#2e3440",
    mantle: "#282e39",
    crust: "#222730",
    surface0: "#3b4252",
    surface1: "#434c5e",
    surface2: "#4c566a",
    overlay0: "#616e88",
    overlay1: "#6e7a94",
    overlay2: "#7b87a0",
    text: "#eceff4",
    subtext0: "#d8dee9",
    subtext1: "#e0e5ed",
    mauve: "#b48ead",
    blue: "#81a1c1",
    green: "#a3be8c",
    red: "#bf616a",
    yellow: "#ebcb8b",
    peach: "#d08770",
    teal: "#88c0d0",
  },
};

export const tokyoNight: ThemeDefinition = {
  id: "tokyo-night",
  name: "Tokyo Night",
  contributor: "Tokyo Night",
  description: "A clean dark theme inspired by Tokyo city lights.",
  palette: {
    base: "#1a1b26",
    mantle: "#16161e",
    crust: "#13131a",
    surface0: "#292e42",
    surface1: "#33384e",
    surface2: "#3d425a",
    overlay0: "#545c7e",
    overlay1: "#636da6",
    overlay2: "#737aa2",
    text: "#c0caf5",
    subtext0: "#a9b1d6",
    subtext1: "#b4bcde",
    mauve: "#bb9af7",
    blue: "#7aa2f7",
    green: "#9ece6a",
    red: "#f7768e",
    yellow: "#e0af68",
    peach: "#ff9e64",
    teal: "#73daca",
  },
};

export const tokyoNightStorm: ThemeDefinition = {
  id: "tokyo-night-storm",
  name: "Tokyo Night Storm",
  contributor: "Tokyo Night",
  description: "A storm variant with a deeper background.",
  palette: {
    base: "#24283b",
    mantle: "#1f2335",
    crust: "#1a1e30",
    surface0: "#2f334d",
    surface1: "#3a3e59",
    surface2: "#454965",
    overlay0: "#545c7e",
    overlay1: "#636da6",
    overlay2: "#737aa2",
    text: "#c0caf5",
    subtext0: "#a9b1d6",
    subtext1: "#b4bcde",
    mauve: "#bb9af7",
    blue: "#7aa2f7",
    green: "#9ece6a",
    red: "#f7768e",
    yellow: "#e0af68",
    peach: "#ff9e64",
    teal: "#73daca",
  },
};

export const oneDark: ThemeDefinition = {
  id: "one-dark",
  name: "One Dark",
  contributor: "Atom",
  description: "The beloved Atom One Dark theme.",
  palette: {
    base: "#282c34",
    mantle: "#21252b",
    crust: "#1b1f27",
    surface0: "#31353f",
    surface1: "#393d47",
    surface2: "#4b5263",
    overlay0: "#636d83",
    overlay1: "#717b91",
    overlay2: "#7f899f",
    text: "#abb2bf",
    subtext0: "#8b929e",
    subtext1: "#9da4b0",
    mauve: "#c678dd",
    blue: "#61afef",
    green: "#98c379",
    red: "#e06c75",
    yellow: "#e5c07b",
    peach: "#d19a66",
    teal: "#56b6c2",
  },
};

export const gruvboxDark: ThemeDefinition = {
  id: "gruvbox-dark",
  name: "Gruvbox Dark",
  contributor: "Gruvbox",
  description: "Retro groove color scheme with warm, earthy tones.",
  palette: {
    base: "#282828",
    mantle: "#1d2021",
    crust: "#141617",
    surface0: "#3c3836",
    surface1: "#504945",
    surface2: "#665c54",
    overlay0: "#7c6f64",
    overlay1: "#928374",
    overlay2: "#a89984",
    text: "#ebdbb2",
    subtext0: "#d5c4a1",
    subtext1: "#ddc9a8",
    mauve: "#d3869b",
    blue: "#83a598",
    green: "#b8bb26",
    red: "#fb4934",
    yellow: "#fabd2f",
    peach: "#fe8019",
    teal: "#8ec07c",
  },
};

export const gruvboxLight: ThemeDefinition = {
  id: "gruvbox-light",
  name: "Gruvbox Light",
  contributor: "Gruvbox",
  description: "The retro groove scheme in a light variant.",
  palette: {
    base: "#fbf1c7",
    mantle: "#f2e5bc",
    crust: "#ebdbb2",
    surface0: "#d5c4a1",
    surface1: "#bdae93",
    surface2: "#a89984",
    overlay0: "#928374",
    overlay1: "#7c6f64",
    overlay2: "#665c54",
    text: "#3c3836",
    subtext0: "#504945",
    subtext1: "#45403a",
    mauve: "#b16286",
    blue: "#458588",
    green: "#79740e",
    red: "#cc241d",
    yellow: "#d79921",
    peach: "#d65d0e",
    teal: "#689d6a",
  },
};

export const solarizedDark: ThemeDefinition = {
  id: "solarized-dark",
  name: "Solarized Dark",
  contributor: "Solarized",
  description: "Precision-crafted color scheme with dark background.",
  palette: {
    base: "#002b36",
    mantle: "#00242e",
    crust: "#001e27",
    surface0: "#073642",
    surface1: "#094352",
    surface2: "#0b5062",
    overlay0: "#586e75",
    overlay1: "#657b83",
    overlay2: "#839496",
    text: "#fdf6e3",
    subtext0: "#eee8d5",
    subtext1: "#f5efe2",
    mauve: "#6c71c4",
    blue: "#268bd2",
    green: "#859900",
    red: "#dc322f",
    yellow: "#b58900",
    peach: "#cb4b16",
    teal: "#2aa198",
  },
};

export const solarizedLight: ThemeDefinition = {
  id: "solarized-light",
  name: "Solarized Light",
  contributor: "Solarized",
  description: "Precision-crafted color scheme with light background.",
  palette: {
    base: "#fdf6e3",
    mantle: "#eee8d5",
    crust: "#e4ddc8",
    surface0: "#ddd6c1",
    surface1: "#d0c9b4",
    surface2: "#b8b2a0",
    overlay0: "#93a1a1",
    overlay1: "#839496",
    overlay2: "#657b83",
    text: "#002b36",
    subtext0: "#073642",
    subtext1: "#034b52",
    mauve: "#6c71c4",
    blue: "#268bd2",
    green: "#859900",
    red: "#dc322f",
    yellow: "#b58900",
    peach: "#cb4b16",
    teal: "#2aa198",
  },
};

export const rosePine: ThemeDefinition = {
  id: "rose-pine",
  name: "Rosé Pine",
  contributor: "Rosé Pine",
  description: "All natural pine, faux fur and a bit of soho vibes.",
  palette: {
    base: "#191724",
    mantle: "#1f1d2e",
    crust: "#16141f",
    surface0: "#26233a",
    surface1: "#2a2740",
    surface2: "#393552",
    overlay0: "#6e6a86",
    overlay1: "#7a7692",
    overlay2: "#908caa",
    text: "#e0def4",
    subtext0: "#c4c0d9",
    subtext1: "#d2cfea",
    mauve: "#c4a7e7",
    blue: "#31748f",
    green: "#9ccfd8",
    red: "#eb6f92",
    yellow: "#f6c177",
    peach: "#ebbcba",
    teal: "#9ccfd8",
  },
};

export const rosePineMoon: ThemeDefinition = {
  id: "rose-pine-moon",
  name: "Rosé Pine Moon",
  contributor: "Rosé Pine",
  description: "Rosé Pine variant for the moonlight.",
  palette: {
    base: "#232136",
    mantle: "#2a273f",
    crust: "#1d1a2d",
    surface0: "#2a283e",
    surface1: "#302d45",
    surface2: "#44415a",
    overlay0: "#6e6a86",
    overlay1: "#7a7692",
    overlay2: "#908caa",
    text: "#e0def4",
    subtext0: "#c4c0d9",
    subtext1: "#d2cfea",
    mauve: "#c4a7e7",
    blue: "#3e8fb0",
    green: "#9ccfd8",
    red: "#eb6f92",
    yellow: "#f6c177",
    peach: "#ea9a97",
    teal: "#9ccfd8",
  },
};

/* ─── Aggregates ─────────────────────────────────────────────────── */

export const BUILTIN_THEMES: ThemeDefinition[] = [
  catppuccinMocha,
  catppuccinMacchiato,
  catppuccinFrappe,
  catppuccinLatte,
  tokyoNight,
  tokyoNightStorm,
  dracula,
  nord,
  oneDark,
  gruvboxDark,
  gruvboxLight,
  solarizedDark,
  solarizedLight,
  rosePine,
  rosePineMoon,
];

export const DEFAULT_THEME_ID = "catppuccin-mocha";

/** Group built-in themes by contributor for the contributor-first UI. */
export function groupByContributor(
  themes: ThemeDefinition[],
): Record<string, ThemeDefinition[]> {
  const groups: Record<string, ThemeDefinition[]> = {};
  for (const t of themes) {
    (groups[t.contributor] ??= []).push(t);
  }
  return groups;
}

/** Create a blank custom theme based on Catppuccin Mocha as starting point. */
export function createBlankCustomTheme(name: string): CustomTheme {
  return {
    id: `custom-${Date.now()}`,
    name,
    contributor: "custom",
    description: "A user-created custom theme.",
    palette: { ...catppuccinMocha.palette },
  };
}
