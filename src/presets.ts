interface PaletteColor {
  hex: string;
  row: number;
  column: number;
}

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  json: string;
}

const COLORS = {
  white: { hex: "#FFFFFF", row: 1, column: 4 },
  black: { hex: "#222222", row: 1, column: 1 },
  red: { hex: "#D42F36", row: 2, column: 1 },
  pink: { hex: "#E5968D", row: 2, column: 4 },
  yellow: { hex: "#F9C932", row: 5, column: 2 },
  tan: { hex: "#B19155", row: 6, column: 3 },
  brown: { hex: "#AA8E73", row: 6, column: 4 },
  navy: { hex: "#273662", row: 10, column: 4 },
  blue: { hex: "#3A4599", row: 8, column: 2 },
  purple: { hex: "#5A459C", row: 8, column: 3 },
  cyan: { hex: "#91D8E7", row: 10, column: 1 },
  teal: { hex: "#47AE9F", row: 10, column: 2 },
} satisfies Record<string, PaletteColor>;

type ColorName = keyof typeof COLORS;
type Grid = ColorName[][];

function blankGrid(): Grid {
  return Array.from({ length: 24 }, () => Array<ColorName>(24).fill("white"));
}

function insideEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

function paintMask(grid: Grid, mask: boolean[][], fill: ColorName, outline: ColorName): void {
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      if (!mask[y][x]) continue;
      const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || nx >= 24 || ny < 0 || ny >= 24 || !mask[ny][nx];
      });
      grid[y][x] = edge ? outline : fill;
    }
  }
}

function maskFrom(test: (x: number, y: number) => boolean): boolean[][] {
  return Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => test(x, y)));
}

function heart(): Grid {
  const grid = blankGrid();
  const mask = maskFrom((x, y) => {
    const lobes = insideEllipse(x, y, 7.5, 8, 5, 4.5) || insideEllipse(x, y, 15.5, 8, 5, 4.5);
    const point = y >= 7 && y <= 20 && Math.abs(x - 11.5) <= (20 - y) * 0.78;
    return lobes || point;
  });
  paintMask(grid, mask, "red", "black");
  grid[7][7] = "pink";
  grid[8][6] = "pink";
  return grid;
}

function bunny(): Grid {
  const grid = blankGrid();
  const mask = maskFrom((x, y) =>
    insideEllipse(x, y, 7.5, 6.5, 3.2, 6.5)
    || insideEllipse(x, y, 15.5, 6.5, 3.2, 6.5)
    || insideEllipse(x, y, 11.5, 14.5, 8.5, 7.5));
  paintMask(grid, mask, "brown", "black");
  for (let y = 3; y <= 8; y += 1) {
    if (insideEllipse(8, y, 8, 6, 1.2, 4)) grid[y][8] = "pink";
    if (insideEllipse(15, y, 15, 6, 1.2, 4)) grid[y][15] = "pink";
  }
  grid[14][8] = "black";
  grid[14][15] = "black";
  grid[17][11] = "black";
  grid[17][12] = "black";
  grid[18][10] = "pink";
  grid[18][13] = "pink";
  return grid;
}

function penguin(): Grid {
  const grid = blankGrid();
  const body = maskFrom((x, y) => insideEllipse(x, y, 11.5, 12.5, 8, 10));
  paintMask(grid, body, "black", "navy");
  for (let y = 8; y <= 20; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      if (insideEllipse(x, y, 11.5, 14.5, 5.5, 7) && body[y][x]) grid[y][x] = "white";
    }
  }
  grid[8][8] = "white";
  grid[8][15] = "white";
  grid[8][9] = "black";
  grid[8][14] = "black";
  grid[10][11] = "yellow";
  grid[10][12] = "yellow";
  grid[11][10] = "yellow";
  grid[11][11] = "yellow";
  grid[11][12] = "yellow";
  grid[11][13] = "yellow";
  return grid;
}

function crystal(): Grid {
  const grid = blankGrid();
  for (let y = 2; y <= 21; y += 1) {
    for (let x = 2; x <= 21; x += 1) {
      const distance = Math.abs(x - 11.5) + Math.abs(y - 11.5);
      if (distance <= 10) grid[y][x] = distance >= 8.5 ? "navy" : distance >= 6 ? "blue" : "cyan";
    }
  }
  for (let y = 7; y <= 16; y += 1) {
    grid[y][11] = "white";
    grid[y][12] = "white";
  }
  for (let x = 7; x <= 16; x += 1) {
    grid[11][x] = "white";
    grid[12][x] = "white";
  }
  grid[11][11] = "teal";
  grid[11][12] = "teal";
  grid[12][11] = "teal";
  grid[12][12] = "teal";
  return grid;
}

function toJson(grid: Grid): string {
  const cells = grid.flatMap((row, y) => row.map((name, x) => {
    const color = COLORS[name];
    return {
      x,
      y,
      seq: y * 24 + x + 1,
      region: (y < 12 ? 0 : 2) + (x < 12 ? 1 : 2),
      hex: color.hex,
      palPos: `第${color.row}行第${color.column}列`,
    };
  }));
  return JSON.stringify({ size: 24, cells }, null, 2);
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  { id: "heart", name: "赤色爱心", description: "红 / 黑 / 粉", json: toJson(heart()) },
  { id: "bunny", name: "罗德岛兔兔", description: "棕 / 粉 / 黑", json: toJson(bunny()) },
  { id: "penguin", name: "企鹅信使", description: "黑 / 白 / 黄", json: toJson(penguin()) },
  { id: "crystal", name: "源石晶体", description: "蓝 / 青 / 深蓝", json: toJson(crystal()) },
];
