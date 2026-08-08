export interface CellPoint {
  x: number;
  y: number;
}

export interface Stroke {
  from: CellPoint;
  to: CellPoint;
  length: number;
}

export interface ColorGroup {
  paletteIndex: number;
  paletteRow: number;
  paletteColumn: number;
  hex: string;
  cellCount: number;
  strokes: Stroke[];
}

export interface TemplateAnalysis {
  size: number;
  paintedCells: number;
  skippedWhite: number;
  skippedTransparent: number;
  colorCount: number;
  strokeCount: number;
  dragStrokeCount: number;
  preview: Array<string | null>;
  groups: ColorGroup[];
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Calibration {
  canvasTopLeft: ScreenPoint;
  canvasBottomRight: ScreenPoint;
  paletteTopLeft: ScreenPoint;
  paletteTopRow5Col4: ScreenPoint;
  paletteBottomRow6Col1: ScreenPoint;
}

export interface InputAccess {
  granted: boolean;
  platform: string;
  message: string;
}

export interface AutomationProgress {
  phase: "countdown" | "prefill" | "drawing" | "stopped" | "completed";
  completed: number;
  total: number;
  message: string;
}

export interface ExecutionResult {
  completed: number;
  stopped: boolean;
}
