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
  /** Vision model provider config (also used for selection) */
  vision: {
    provider: 'openrouter' | 'local';
    apiKey?: string;
    model?: string;  // e.g. "qwen/qwen3.7-flash"
    baseUrl?: string;
  };
  /** Optional: separate config for selection model */
  selection?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
}
