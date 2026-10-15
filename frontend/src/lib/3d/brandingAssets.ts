/**
 * enerzyAI 3D Branding Font Provider
 *
 * Provides self-contained typeface geometry font for Three.js TextGeometry.
 * Uses modern, clean sans-serif typeface (Helvetiker Bold).
 * 100% offline, self-contained, no external URLs or image files.
 */

import { FontLoader, type Font } from "three/examples/jsm/loaders/FontLoader.js";
import helvetikerBoldData from "three/examples/fonts/helvetiker_bold.typeface.json";

let cachedFont: Font | null = null;

export const BRANDING_TEXT = "enerzyAI";

/**
 * Get or initialize the cached Font instance for 3D text generation.
 */
export function getEnerzyAIFont(): Font {
  if (!cachedFont) {
    const loader = new FontLoader();
    cachedFont = loader.parse(helvetikerBoldData);
  }
  return cachedFont;
}
