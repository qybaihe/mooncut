import { ThemeMode } from '../models/AppModels';

export interface ThemeTokens {
  mode: ThemeMode;
  canvas: string;
  surface: string;
  inset: string;
  elevated: string;
  hairline: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  videoWell: string;
  stickerYellow: string;
  stickerPink: string;
  stickerCyan: string;
  stickerMint: string;
  ink: string;
  cardRadius: number;
  usesMemphisChrome: boolean;
}

const LIGHT: ThemeTokens = {
  mode: ThemeMode.LIGHT,
  canvas: '#F6F5F4', surface: '#FFFFFF', inset: '#F1F0EE', elevated: '#FFFFFF', hairline: '#14000000',
  textPrimary: '#1F2126', textSecondary: '#595E66', textTertiary: '#8C8F94', accent: '#1F61C7', accentSoft: '#E6F0FC',
  success: '#1F8557', warning: '#C27A1A', danger: '#C7382E', videoWell: '#14171C', stickerYellow: '#00000000',
  stickerPink: '#00000000', stickerCyan: '#00000000', stickerMint: '#00000000', ink: '#1F2126', cardRadius: 16,
  usesMemphisChrome: false
};

const DARK: ThemeTokens = {
  mode: ThemeMode.DARK,
  canvas: '#17181C', surface: '#212429', inset: '#2B2E33', elevated: '#292B30', hairline: '#1AFFFFFF',
  textPrimary: '#EDF0F2', textSecondary: '#B8BDC2', textTertiary: '#8C9199', accent: '#739EEB', accentSoft: '#2E3D57',
  success: '#59B885', warning: '#E6AD4D', danger: '#EB6B61', videoWell: '#000000', stickerYellow: '#00000000',
  stickerPink: '#00000000', stickerCyan: '#00000000', stickerMint: '#00000000', ink: '#EDF0F2', cardRadius: 16,
  usesMemphisChrome: false
};

const MEMPHIS: ThemeTokens = {
  mode: ThemeMode.MEMPHIS,
  canvas: '#FBF1E0', surface: '#FFFCF4', inset: '#F5E6CC', elevated: '#FFFEF7', hairline: '#E01A140F',
  textPrimary: '#1A140F', textSecondary: '#4D4238', textTertiary: '#7A6B5C', accent: '#146B85', accentSoft: '#DBF2EB',
  success: '#2E9466', warning: '#F0B31A', danger: '#E0424D', videoWell: '#14120F', stickerYellow: '#FFD61F',
  stickerPink: '#FF7AA8', stickerCyan: '#47CCE6', stickerMint: '#66E6AD', ink: '#140F0D', cardRadius: 12,
  usesMemphisChrome: true
};

const MEMPHIS_DARK: ThemeTokens = {
  mode: ThemeMode.MEMPHIS,
  canvas: '#29211C', surface: '#382E26', inset: '#42382E', elevated: '#3D3329', hairline: '#29FFFFFF',
  textPrimary: '#F7F0E6', textSecondary: '#CCBDAD', textTertiary: '#998C7A', accent: '#4DC7D1', accentSoft: '#384D47',
  success: '#2E9466', warning: '#EFB31A', danger: '#E0424D', videoWell: '#14120F', stickerYellow: '#FFD61F',
  stickerPink: '#FF7AA8', stickerCyan: '#47CCE6', stickerMint: '#66E6AD', ink: '#F7F0E6', cardRadius: 12,
  usesMemphisChrome: true
};

let systemDarkMode: boolean = false;

export function setThemeSystemDarkMode(isDark: boolean): void { systemDarkMode = isDark; }

export function themeTokensForSystem(mode: ThemeMode, isSystemDark: boolean): ThemeTokens {
  if (mode === ThemeMode.DARK) return DARK;
  if (mode === ThemeMode.MEMPHIS) return isSystemDark ? MEMPHIS_DARK : MEMPHIS;
  return LIGHT;
}

export function themeTokens(mode: ThemeMode): ThemeTokens { return themeTokensForSystem(mode, systemDarkMode); }
