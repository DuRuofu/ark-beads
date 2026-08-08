use serde::{Deserialize, Serialize};
use std::fmt::{Display, Formatter};

const GRID_SIZE: usize = 24;
const CELL_COUNT: usize = GRID_SIZE * GRID_SIZE;
const WHITE: &str = "#FFFFFF";

pub const PALETTE: [&str; 40] = [
    "#222222", "#B4B4B4", "#EBE7DF", "#FFFFFF", "#D42F36", "#9C0802", "#D60C4B", "#E5968D",
    "#FE9873", "#F8D0BF", "#FDEFEA", "#FBF6E8", "#DCD1C8", "#E3CEAA", "#D66323", "#D58B42",
    "#F19900", "#F9C932", "#FCE498", "#B4B47B", "#C2DA70", "#686B00", "#B19155", "#AA8E73",
    "#AA9228", "#3F2B10", "#74491E", "#534559", "#2A2446", "#3A4599", "#5A459C", "#BAA4D6",
    "#B6BCDF", "#AAACBD", "#62ABBA", "#B4D1DC", "#91D8E7", "#47AE9F", "#B6D2C8", "#273662",
];

#[derive(Debug, Deserialize, Serialize)]
struct RawTemplate {
    size: usize,
    cells: Vec<RawCell>,
}

#[derive(Debug, Deserialize, Serialize)]
struct RawCell {
    x: usize,
    y: usize,
    seq: usize,
    region: usize,
    hex: Option<String>,
    #[serde(rename = "palPos")]
    pal_pos: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPoint {
    x: usize,
    y: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    from: CellPoint,
    to: CellPoint,
    length: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorGroup {
    palette_index: usize,
    palette_row: usize,
    palette_column: usize,
    hex: &'static str,
    cell_count: usize,
    strokes: Vec<Stroke>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateAnalysis {
    size: usize,
    painted_cells: usize,
    skipped_white: usize,
    skipped_transparent: usize,
    color_count: usize,
    stroke_count: usize,
    drag_stroke_count: usize,
    preview: Vec<Option<String>>,
    groups: Vec<ColorGroup>,
}

#[derive(Debug, PartialEq)]
pub struct TemplateError(String);

impl TemplateError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl Display for TemplateError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for TemplateError {}

pub fn analyze(json: &str) -> Result<TemplateAnalysis, TemplateError> {
    let raw: RawTemplate = serde_json::from_str(json)
        .map_err(|error| TemplateError::new(format!("JSON 格式错误：{error}")))?;

    if raw.size != GRID_SIZE {
        return Err(TemplateError::new(format!(
            "模板尺寸必须是 24×24，当前 size 为 {}。",
            raw.size
        )));
    }
    if raw.cells.len() != CELL_COUNT {
        return Err(TemplateError::new(format!(
            "模板必须包含 576 个格子，当前包含 {} 个。",
            raw.cells.len()
        )));
    }

    let mut seen = [false; CELL_COUNT];
    let mut preview = vec![None; CELL_COUNT];
    let mut palette_cells: Vec<Vec<CellPoint>> = (0..PALETTE.len()).map(|_| Vec::new()).collect();
    let mut skipped_white = 0;
    let mut skipped_transparent = 0;

    for cell in raw.cells {
        validate_position(&cell, &mut seen)?;
        let preview_index = cell.y * GRID_SIZE + cell.x;

        match (cell.hex, cell.pal_pos) {
            (None, None) => {
                skipped_transparent += 1;
            }
            (Some(hex), Some(palette_position)) => {
                let palette_index = parse_palette_position(&palette_position)?;
                let expected_hex = PALETTE[palette_index];
                if !hex.eq_ignore_ascii_case(expected_hex) {
                    return Err(TemplateError::new(format!(
                        "第 {} 格颜色不一致：{} 应对应 {}，实际为 {}。",
                        cell.seq, palette_position, expected_hex, hex
                    )));
                }

                preview[preview_index] = Some(expected_hex.to_string());
                if expected_hex == WHITE {
                    skipped_white += 1;
                } else {
                    palette_cells[palette_index].push(CellPoint {
                        x: cell.x,
                        y: cell.y,
                    });
                }
            }
            _ => {
                return Err(TemplateError::new(format!(
                    "第 {} 格的 hex 与 palPos 必须同时存在或同时为 null。",
                    cell.seq
                )));
            }
        }
    }

    let mut groups = Vec::new();
    for (palette_index, cells) in palette_cells.into_iter().enumerate() {
        if cells.is_empty() {
            continue;
        }
        let strokes = build_horizontal_strokes(&cells);
        groups.push(ColorGroup {
            palette_index,
            palette_row: palette_index / 4 + 1,
            palette_column: palette_index % 4 + 1,
            hex: PALETTE[palette_index],
            cell_count: cells.len(),
            strokes,
        });
    }

    let painted_cells = groups.iter().map(|group| group.cell_count).sum();
    let stroke_count = groups.iter().map(|group| group.strokes.len()).sum();
    let drag_stroke_count = groups
        .iter()
        .flat_map(|group| &group.strokes)
        .filter(|stroke| stroke.length > 1)
        .count();

    Ok(TemplateAnalysis {
        size: GRID_SIZE,
        painted_cells,
        skipped_white,
        skipped_transparent,
        color_count: groups.len(),
        stroke_count,
        drag_stroke_count,
        preview,
        groups,
    })
}

fn validate_position(cell: &RawCell, seen: &mut [bool; CELL_COUNT]) -> Result<(), TemplateError> {
    if cell.x >= GRID_SIZE || cell.y >= GRID_SIZE {
        return Err(TemplateError::new(format!(
            "第 {} 格坐标越界：({}, {})。",
            cell.seq, cell.x, cell.y
        )));
    }

    let index = cell.y * GRID_SIZE + cell.x;
    if seen[index] {
        return Err(TemplateError::new(format!(
            "坐标 ({}, {}) 重复出现。",
            cell.x, cell.y
        )));
    }
    seen[index] = true;

    let expected_seq = index + 1;
    if cell.seq != expected_seq {
        return Err(TemplateError::new(format!(
            "坐标 ({}, {}) 的 seq 应为 {}，实际为 {}。",
            cell.x, cell.y, expected_seq, cell.seq
        )));
    }

    let expected_region = (cell.y / 12) * 2 + (cell.x / 12) + 1;
    if cell.region != expected_region {
        return Err(TemplateError::new(format!(
            "第 {} 格的 region 应为 {}，实际为 {}。",
            cell.seq, expected_region, cell.region
        )));
    }

    Ok(())
}

fn parse_palette_position(position: &str) -> Result<usize, TemplateError> {
    let value = position
        .strip_prefix('第')
        .ok_or_else(|| TemplateError::new(format!("无法识别调色板位置：{position}")))?;
    let (row, column) = value
        .split_once("行第")
        .ok_or_else(|| TemplateError::new(format!("无法识别调色板位置：{position}")))?;
    let column = column
        .strip_suffix('列')
        .ok_or_else(|| TemplateError::new(format!("无法识别调色板位置：{position}")))?;
    let row: usize = row
        .parse()
        .map_err(|_| TemplateError::new(format!("无法识别调色板行号：{position}")))?;
    let column: usize = column
        .parse()
        .map_err(|_| TemplateError::new(format!("无法识别调色板列号：{position}")))?;

    if !(1..=10).contains(&row) || !(1..=4).contains(&column) {
        return Err(TemplateError::new(format!(
            "调色板位置超出 10×4 范围：{position}"
        )));
    }

    Ok((row - 1) * 4 + column - 1)
}

fn build_horizontal_strokes(cells: &[CellPoint]) -> Vec<Stroke> {
    let mut rows: Vec<Vec<usize>> = (0..GRID_SIZE).map(|_| Vec::new()).collect();
    for cell in cells {
        rows[cell.y].push(cell.x);
    }

    let mut strokes = Vec::new();
    for (y, mut columns) in rows.into_iter().enumerate() {
        if columns.is_empty() {
            continue;
        }
        columns.sort_unstable();

        let mut runs = Vec::new();
        let mut start = columns[0];
        let mut end = columns[0];
        for column in columns.into_iter().skip(1) {
            if column == end + 1 {
                end = column;
            } else {
                runs.push((start, end));
                start = column;
                end = column;
            }
        }
        runs.push((start, end));

        if y % 2 == 1 {
            runs.reverse();
        }
        for (start, end) in runs {
            let (from_x, to_x) = if y % 2 == 0 {
                (start, end)
            } else {
                (end, start)
            };
            strokes.push(Stroke {
                from: CellPoint { x: from_x, y },
                to: CellPoint { x: to_x, y },
                length: end - start + 1,
            });
        }
    }
    strokes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn white_template() -> RawTemplate {
        RawTemplate {
            size: GRID_SIZE,
            cells: (0..CELL_COUNT)
                .map(|index| {
                    let x = index % GRID_SIZE;
                    let y = index / GRID_SIZE;
                    RawCell {
                        x,
                        y,
                        seq: index + 1,
                        region: (y / 12) * 2 + (x / 12) + 1,
                        hex: Some(WHITE.to_string()),
                        pal_pos: Some("第1行第4列".to_string()),
                    }
                })
                .collect(),
        }
    }

    #[test]
    fn skips_white_and_transparent_cells_and_builds_strokes() {
        let mut template = white_template();
        for index in [0, 1, 3, 26] {
            template.cells[index].hex = Some(PALETTE[0].to_string());
            template.cells[index].pal_pos = Some("第1行第1列".to_string());
        }
        template.cells[575].hex = None;
        template.cells[575].pal_pos = None;

        let analysis = analyze(&serde_json::to_string(&template).unwrap()).unwrap();
        assert_eq!(analysis.painted_cells, 4);
        assert_eq!(analysis.skipped_white, 571);
        assert_eq!(analysis.skipped_transparent, 1);
        assert_eq!(analysis.color_count, 1);
        assert_eq!(analysis.stroke_count, 3);
        assert_eq!(analysis.drag_stroke_count, 1);
    }

    #[test]
    fn rejects_wrong_size() {
        let mut template = white_template();
        template.size = 32;
        let error = analyze(&serde_json::to_string(&template).unwrap()).unwrap_err();
        assert!(error.to_string().contains("24×24"));
    }

    #[test]
    fn rejects_color_that_does_not_match_palette_position() {
        let mut template = white_template();
        template.cells[0].hex = Some("#222222".to_string());
        let error = analyze(&serde_json::to_string(&template).unwrap()).unwrap_err();
        assert!(error.to_string().contains("颜色不一致"));
    }

    #[test]
    fn rejects_duplicate_coordinates() {
        let mut template = white_template();
        template.cells[1].x = 0;
        template.cells[1].seq = 1;
        let error = analyze(&serde_json::to_string(&template).unwrap()).unwrap_err();
        assert!(error.to_string().contains("重复"));
    }
}
