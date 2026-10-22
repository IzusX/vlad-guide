"use client";
import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const THEME_CHANGE_EVENT = "vlad-guide:theme-change";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
  // System mode uses the prefers-color-scheme media query.
}

function readSavedTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Theme selection still works when browser storage is unavailable.
  }
  return "system";
}

function getThemeSnapshot(): Theme {
  const root = document.documentElement;
  if (root.classList.contains("light")) return "light";
  if (root.classList.contains("dark")) return "dark";
  return "system";
}

function getServerSnapshot(): null {
  return null;
}

function subscribeTheme(onChange: () => void) {
  applyTheme(readSavedTheme());

  function handleStorage(event: StorageEvent) {
    if (event.key === "theme" || event.key === null) {
      applyTheme(readSavedTheme());
      onChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerSnapshot);

  function cycle() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    applyTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Keep the selection for the current page even without persistence.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  if (theme === null) {
    return (
      <button
        aria-label="Переключить тему"
        className="grid size-8 place-items-center rounded-full border text-sm opacity-50"
        disabled
      >
        ◐
      </button>
    );
  }

  const label = theme === "system" ? "Авто" : theme === "light" ? "День" : "Ночь";
  const icon = theme === "system" ? "◐" : theme === "light" ? "☀" : "☾";

  return (
    <button
      onClick={cycle}
      aria-label={`Тема: ${label}. Нажми чтобы переключить.`}
      title={`Тема: ${label} (Авто → День → Ночь)`}
      className="inline-flex items-center gap-1.5 rounded-4xl border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/30"
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
