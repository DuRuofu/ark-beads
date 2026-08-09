export const ARK_PALETTE = [
  "#222222", "#B4B4B4", "#EBE7DF", "#FFFFFF",
  "#D42F36", "#9C0802", "#D60C4B", "#E5968D",
  "#FE9873", "#F8D0BF", "#FDEFEA", "#FBF6E8",
  "#DCD1C8", "#E3CEAA", "#D66323", "#D58B42",
  "#F19900", "#F9C932", "#FCE498", "#B4B47B",
  "#C2DA70", "#686B00", "#B19155", "#AA8E73",
  "#AA9228", "#3F2B10", "#74491E", "#534559",
  "#2A2446", "#3A4599", "#5A459C", "#BAA4D6",
  "#B6BCDF", "#AAACBD", "#62ABBA", "#B4D1DC",
  "#91D8E7", "#47AE9F", "#B6D2C8", "#273662",
] as const;

export type ConversionPreset = "balanced" | "crisp" | "smooth" | "detail";
export type ResizeAlgorithm = "nearest" | "box" | "bilinear";
export type FitMode = "contain" | "cover" | "stretch";

export interface ConversionSettings {
  algorithm: ResizeAlgorithm;
  fit: FitMode;
  contrast: number;
  saturation: number;
  edgeStrength: number;
  dither: boolean;
}

export interface GeneratedTemplate {
  json: string;
  colors: string[];
  paletteIndices: number[];
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface SourceImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const GRID_SIZE = 24;
const MAX_SOURCE_SIZE = 512;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const PALETTE_RGB = ARK_PALETTE.map(hexToRgb);

export const CONVERSION_PRESETS: Record<ConversionPreset, ConversionSettings> = {
  balanced: { algorithm: "box", fit: "contain", contrast: 8, saturation: 8, edgeStrength: 45, dither: false },
  crisp: { algorithm: "nearest", fit: "contain", contrast: 16, saturation: 10, edgeStrength: 75, dither: false },
  smooth: { algorithm: "bilinear", fit: "contain", contrast: 4, saturation: 5, edgeStrength: 20, dither: false },
  detail: { algorithm: "box", fit: "contain", contrast: 12, saturation: 10, edgeStrength: 60, dither: true },
};

export async function loadImage(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith("image/")) throw new Error("请选择 PNG、JPEG、WebP 等常见图片文件。");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尺寸无效。");
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function convertImage(image: HTMLImageElement, settings: ConversionSettings): GeneratedTemplate {
  const source = readSource(image);
  const sampled = sampleGrid(source, settings);
  const adjusted = sharpenGrid(sampled.map((color) => adjustColor(color, settings)), settings.edgeStrength);
  const paletteIndices = quantize(adjusted, settings.dither);
  return createTemplateFromPaletteIndices(paletteIndices);
}

export function createTemplateFromPaletteIndices(paletteIndices: number[]): GeneratedTemplate {
  if (paletteIndices.length !== GRID_SIZE * GRID_SIZE) throw new Error("像素模板必须包含 576 个格子。");
  if (paletteIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= ARK_PALETTE.length)) throw new Error("像素模板包含无效色板位置。");
  const colors = paletteIndices.map((index) => ARK_PALETTE[index]);
  const cells = paletteIndices.map((paletteIndex, index) => {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    return {
      x,
      y,
      seq: index + 1,
      region: Math.floor(y / 12) * 2 + Math.floor(x / 12) + 1,
      hex: ARK_PALETTE[paletteIndex],
      palPos: `第${Math.floor(paletteIndex / 4) + 1}行第${paletteIndex % 4 + 1}列`,
    };
  });
  return { json: JSON.stringify({ size: GRID_SIZE, cells }, null, 2), colors, paletteIndices };
}

function readSource(image: HTMLImageElement): SourceImage {
  const scale = Math.min(1, MAX_SOURCE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取图片像素。");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { data: context.getImageData(0, 0, width, height).data, width, height };
}

function sampleGrid(source: SourceImage, settings: ConversionSettings): Rgb[] {
  const scale = settings.fit === "stretch"
    ? null
    : settings.fit === "contain"
      ? Math.min(GRID_SIZE / source.width, GRID_SIZE / source.height)
      : Math.max(GRID_SIZE / source.width, GRID_SIZE / source.height);
  const renderedWidth = scale === null ? GRID_SIZE : source.width * scale;
  const renderedHeight = scale === null ? GRID_SIZE : source.height * scale;
  const offsetX = (GRID_SIZE - renderedWidth) / 2;
  const offsetY = (GRID_SIZE - renderedHeight) / 2;
  const footprintX = settings.fit === "stretch" ? source.width / GRID_SIZE : 1 / scale!;
  const footprintY = settings.fit === "stretch" ? source.height / GRID_SIZE : 1 / scale!;

  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    const sourceX = settings.fit === "stretch"
      ? (x + 0.5) / GRID_SIZE * source.width - 0.5
      : (x + 0.5 - offsetX) / scale! - 0.5;
    const sourceY = settings.fit === "stretch"
      ? (y + 0.5) / GRID_SIZE * source.height - 0.5
      : (y + 0.5 - offsetY) / scale! - 0.5;
    if (sourceX < -0.5 || sourceX >= source.width - 0.5 || sourceY < -0.5 || sourceY >= source.height - 0.5) return { ...WHITE };
    if (settings.algorithm === "nearest") return sampleNearest(source, sourceX, sourceY);
    if (settings.algorithm === "bilinear") return sampleBilinear(source, sourceX, sourceY);
    return sampleBox(source, sourceX, sourceY, footprintX, footprintY);
  });
}

function sampleNearest(source: SourceImage, x: number, y: number): Rgb {
  return sourcePixel(source, Math.round(x), Math.round(y));
}

function sampleBilinear(source: SourceImage, x: number, y: number): Rgb {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const top = mix(sourcePixel(source, x0, y0), sourcePixel(source, x0 + 1, y0), tx);
  const bottom = mix(sourcePixel(source, x0, y0 + 1), sourcePixel(source, x0 + 1, y0 + 1), tx);
  return mix(top, bottom, ty);
}

function sampleBox(source: SourceImage, centerX: number, centerY: number, width: number, height: number): Rgb {
  const left = centerX - width / 2;
  const right = centerX + width / 2;
  const top = centerY - height / 2;
  const bottom = centerY + height / 2;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let y = Math.floor(top); y <= Math.ceil(bottom); y += 1) {
    const verticalWeight = Math.max(0, Math.min(bottom, y + 0.5) - Math.max(top, y - 0.5));
    for (let x = Math.floor(left); x <= Math.ceil(right); x += 1) {
      const horizontalWeight = Math.max(0, Math.min(right, x + 0.5) - Math.max(left, x - 0.5));
      const contribution = horizontalWeight * verticalWeight;
      if (!contribution) continue;
      const color = sourcePixel(source, x, y);
      red += color.r * contribution;
      green += color.g * contribution;
      blue += color.b * contribution;
      weight += contribution;
    }
  }
  return weight ? { r: red / weight, g: green / weight, b: blue / weight } : { ...WHITE };
}

function sourcePixel(source: SourceImage, x: number, y: number): Rgb {
  const clampedX = clamp(Math.round(x), 0, source.width - 1);
  const clampedY = clamp(Math.round(y), 0, source.height - 1);
  const index = (clampedY * source.width + clampedX) * 4;
  const alpha = source.data[index + 3] / 255;
  return {
    r: source.data[index] * alpha + 255 * (1 - alpha),
    g: source.data[index + 1] * alpha + 255 * (1 - alpha),
    b: source.data[index + 2] * alpha + 255 * (1 - alpha),
  };
}

function adjustColor(color: Rgb, settings: ConversionSettings): Rgb {
  const contrast = clamp(settings.contrast, -80, 80);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const contrasted = {
    r: clamp(factor * (color.r - 128) + 128, 0, 255),
    g: clamp(factor * (color.g - 128) + 128, 0, 255),
    b: clamp(factor * (color.b - 128) + 128, 0, 255),
  };
  const saturation = 1 + clamp(settings.saturation, -80, 80) / 100;
  const luminance = contrasted.r * 0.2126 + contrasted.g * 0.7152 + contrasted.b * 0.0722;
  return {
    r: clamp(luminance + (contrasted.r - luminance) * saturation, 0, 255),
    g: clamp(luminance + (contrasted.g - luminance) * saturation, 0, 255),
    b: clamp(luminance + (contrasted.b - luminance) * saturation, 0, 255),
  };
}

function sharpenGrid(colors: Rgb[], strengthValue: number): Rgb[] {
  const strength = clamp(strengthValue, 0, 100) / 100 * 1.35;
  if (!strength) return colors;
  return colors.map((color, index) => {
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    const neighbors: Rgb[] = [];
    if (x > 0) neighbors.push(colors[index - 1]);
    if (x < GRID_SIZE - 1) neighbors.push(colors[index + 1]);
    if (y > 0) neighbors.push(colors[index - GRID_SIZE]);
    if (y < GRID_SIZE - 1) neighbors.push(colors[index + GRID_SIZE]);
    const average = neighbors.reduce((sum, item) => ({ r: sum.r + item.r, g: sum.g + item.g, b: sum.b + item.b }), { r: 0, g: 0, b: 0 });
    average.r /= neighbors.length;
    average.g /= neighbors.length;
    average.b /= neighbors.length;
    return {
      r: clamp(color.r + (color.r - average.r) * strength, 0, 255),
      g: clamp(color.g + (color.g - average.g) * strength, 0, 255),
      b: clamp(color.b + (color.b - average.b) * strength, 0, 255),
    };
  });
}

function quantize(input: Rgb[], dither: boolean): number[] {
  const working = input.map((color) => ({ ...color }));
  const result = new Array<number>(working.length);
  for (let index = 0; index < working.length; index += 1) {
    const original = working[index];
    const paletteIndex = nearestPaletteIndex(original);
    const mapped = PALETTE_RGB[paletteIndex];
    result[index] = paletteIndex;
    if (!dither) continue;
    const x = index % GRID_SIZE;
    const y = Math.floor(index / GRID_SIZE);
    const error = { r: original.r - mapped.r, g: original.g - mapped.g, b: original.b - mapped.b };
    if (x + 1 < GRID_SIZE) diffuse(working[index + 1], error, 7 / 16);
    if (y + 1 < GRID_SIZE) {
      if (x > 0) diffuse(working[index + GRID_SIZE - 1], error, 3 / 16);
      diffuse(working[index + GRID_SIZE], error, 5 / 16);
      if (x + 1 < GRID_SIZE) diffuse(working[index + GRID_SIZE + 1], error, 1 / 16);
    }
  }
  return result;
}

function nearestPaletteIndex(color: Rgb): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  PALETTE_RGB.forEach((candidate, index) => {
    const meanRed = (color.r + candidate.r) / 2;
    const red = color.r - candidate.r;
    const green = color.g - candidate.g;
    const blue = color.b - candidate.b;
    const distance = (2 + meanRed / 256) * red ** 2 + 4 * green ** 2 + (2 + (255 - meanRed) / 256) * blue ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function diffuse(target: Rgb, error: Rgb, amount: number): void {
  target.r = clamp(target.r + error.r * amount, 0, 255);
  target.g = clamp(target.g + error.g * amount, 0, 255);
  target.b = clamp(target.b + error.b * amount, 0, 255);
}

function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function mix(left: Rgb, right: Rgb, amount: number): Rgb {
  return {
    r: left.r + (right.r - left.r) * amount,
    g: left.g + (right.g - left.g) * amount,
    b: left.b + (right.b - left.b) * amount,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
