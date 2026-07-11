import {ref, watch} from "vue";
import type {StudioTheme} from "@mooncut/studio-shared";

const STORAGE_KEY = "mooncut-studio:theme";
const VALID: readonly StudioTheme[] = ["light", "dark", "memphis"];

function isTheme(value: unknown): value is StudioTheme {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

function readStored(): StudioTheme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

const currentTheme = ref<StudioTheme>(readStored());

if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", currentTheme.value);
}

function setTheme(value: StudioTheme) {
  currentTheme.value = value;
}

watch(currentTheme, (value) => {
  document.documentElement.setAttribute("data-theme", value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute(
      "content",
      value === "memphis" ? "#fff8e8" : value === "dark" ? "#191919" : "#ffffff",
    );
  }
});

export function useTheme() {
  return {currentTheme, setTheme};
}
