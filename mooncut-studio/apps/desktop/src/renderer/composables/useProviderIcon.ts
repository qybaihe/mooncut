/**
 * Resolve brand icons for model providers (assets from Cherry Studio icon set).
 * Paths live under public/provider-icons/{light|dark}/
 */
import {computed} from "vue";
import {useTheme} from "./useTheme";
import {providerIconId} from "../lib/providerIconId.js";

export {providerIconId};

export function useProviderIcon() {
  const {currentTheme} = useTheme();
  const variant = computed(() => (currentTheme.value === "dark" ? "dark" : "light"));

  function iconUrl(provider: {id: string; catalogId?: string}): string {
    const base = (import.meta.env.BASE_URL || "./").replace(/\/?$/u, "/");
    const id = providerIconId(provider);
    return `${base}provider-icons/${variant.value}/${id}.svg`;
  }

  function initial(name: string): string {
    const t = name.trim();
    if (!t) return "?";
    return Array.from(t)[0] ?? "?";
  }

  return {iconUrl, initial, variant};
}
