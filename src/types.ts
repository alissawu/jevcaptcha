/**
 * Shared types for jevcaptcha
 */

export interface TileDescription {
  index: number;
  description: string;
  confidence?: number;
}

export interface GridChallenge {
  /** The prompt, e.g. "Select all images with buses" */
  prompt: string;
  /** Base64 PNG of the full grid */
  imageBase64: string;
  /** Grid dimensions */
  rows: number;
  cols: number;
}

export interface GridSolution {
  /** 0-indexed tile indices to click */
  tiles: number[];
  /** Per-tile reasoning from JEV */
  reasoning?: string[];
}

export interface SliderChallenge {
  /** Base64 PNG of the background with gap */
  backgroundBase64: string;
  /** Base64 PNG of the puzzle piece */
  pieceBase64?: string;
  /** Canvas width in pixels */
  canvasWidth: number;
}

export interface SliderSolution {
  /** X position to drag to (pixels from left) */
  targetX: number;
  confidence: number;
}

export interface SolverConfig {
  /** TypeSafe/JEV API key */
  jevApiKey: string;
  /** Vision model provider config */
  vision: {
    provider: 'openrouter' | 'local';
    apiKey?: string;
    model?: string;  // e.g. "qwen/qwen-2.5-vl-7b-instruct" or "openai/gpt-4o-mini"
    baseUrl?: string;
  };
}
