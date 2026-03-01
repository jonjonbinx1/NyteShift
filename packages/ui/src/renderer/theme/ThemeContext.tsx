import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  type ThemePalette,
  type ThemeDefinition,
  type CustomTheme,
} from "./themes.js";

/* ─── Context shape ──────────────────────────────────────────────── */

interface ThemeContextValue {
  /** Current resolved palette (always present). */
  palette: ThemePalette;
  /** Currently selected theme definition. */
  current: ThemeDefinition;
  /** All available themes (built-in + custom). */
  allThemes: ThemeDefinition[];
  /** Custom themes created by the user. */
  customThemes: CustomTheme[];
  /** Switch to a theme by id. */
  setThemeById: (id: string) => void;
  /** Save/update a custom theme. */
  saveCustomTheme: (theme: CustomTheme) => void;
  /** Delete a custom theme by id. Falls back to default if it was active. */
  deleteCustomTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ─── Provider ───────────────────────────────────────────────────── */

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [loaded, setLoaded] = useState(false);

  /* ── Load persisted theme on mount ─────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.solixApi?.readConfig();
        if (cfg?.themeId && typeof cfg.themeId === "string") {
          setThemeId(cfg.themeId);
        }
        if (Array.isArray(cfg?.customThemes)) {
          setCustomThemes(cfg.customThemes as CustomTheme[]);
        }
      } catch {
        /* first run – no config yet */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  /* ── Persist whenever themeId or customThemes change ───────────── */
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        const cfg = (await window.solixApi?.readConfig()) ?? {};
        await window.solixApi?.writeConfig({
          ...cfg,
          themeId,
          customThemes,
        });
      } catch {
        /* ignore */
      }
    })();
  }, [themeId, customThemes, loaded]);

  /* ── Derived values ────────────────────────────────────────────── */
  const allThemes = useMemo(
    () => [...BUILTIN_THEMES, ...customThemes],
    [customThemes],
  );

  const current = useMemo(
    () =>
      allThemes.find((t) => t.id === themeId) ??
      BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!,
    [themeId, allThemes],
  );

  const palette = current.palette;

  /* ── Inject CSS custom properties on <html> ────────────────────── */
  useEffect(() => {
    const el = document.documentElement;
    for (const [key, value] of Object.entries(palette)) {
      el.style.setProperty(`--solix-${key}`, value);
    }
  }, [palette]);

  /* ── Mutators ──────────────────────────────────────────────────── */
  const setThemeById = useCallback(
    (id: string) => {
      if (allThemes.some((t) => t.id === id)) {
        setThemeId(id);
      }
    },
    [allThemes],
  );

  const saveCustomTheme = useCallback((theme: CustomTheme) => {
    setCustomThemes((prev) => {
      const idx = prev.findIndex((t) => t.id === theme.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = theme;
        return next;
      }
      return [...prev, theme];
    });
  }, []);

  const deleteCustomTheme = useCallback(
    (id: string) => {
      setCustomThemes((prev) => prev.filter((t) => t.id !== id));
      if (themeId === id) setThemeId(DEFAULT_THEME_ID);
    },
    [themeId],
  );

  /* ── Render ────────────────────────────────────────────────────── */
  const value = useMemo<ThemeContextValue>(
    () => ({
      palette,
      current,
      allThemes,
      customThemes,
      setThemeById,
      saveCustomTheme,
      deleteCustomTheme,
    }),
    [
      palette,
      current,
      allThemes,
      customThemes,
      setThemeById,
      saveCustomTheme,
      deleteCustomTheme,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/* ─── Hook ───────────────────────────────────────────────────────── */

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
