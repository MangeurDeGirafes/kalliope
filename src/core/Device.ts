import { QUALITY_PRESETS } from '../config';
import type { QualityPreset } from '../config';

/**
 * Détection de l'appareil : écran tactile principal (téléphone / tablette) ou non.
 * Forçable via l'URL : `?touch=1` ou `?touch=0`.
 */
function detectTouch(): boolean {
  try {
    const forced = new URLSearchParams(window.location.search).get('touch');
    if (forced === '1') return true;
    if (forced === '0') return false;
  } catch {
    /* URL inaccessible : détection automatique */
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  return (coarse && noHover) || (coarse && navigator.maxTouchPoints > 0);
}

export const IS_TOUCH: boolean = detectTouch();

export const QUALITY: QualityPreset = IS_TOUCH ? QUALITY_PRESETS.mobile : QUALITY_PRESETS.desktop;

/** Petite vibration (Android) — ignorée silencieusement ailleurs. */
export function vibrate(ms: number): void {
  if (!IS_TOUCH) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* API non disponible */
  }
}
