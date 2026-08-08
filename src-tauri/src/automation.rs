use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};

const GRID_SIZE: f64 = 23.0;
const CANVAS_CELLS: usize = 24;
const FAILSAFE_EDGE: i32 = 8;
const WHITE_PALETTE_ROW: usize = 1;
const WHITE_PALETTE_COLUMN: usize = 4;

#[derive(Clone, Default)]
pub struct AutomationState {
    running: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
    stop_requested: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibration {
    canvas_top_left: ScreenPoint,
    canvas_bottom_right: ScreenPoint,
    palette_top_left: ScreenPoint,
    palette_top_row5_col4: ScreenPoint,
    palette_bottom_row6_col1: ScreenPoint,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellPoint {
    x: usize,
    y: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stroke {
    from: CellPoint,
    to: CellPoint,
    length: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionGroup {
    palette_row: usize,
    palette_column: usize,
    strokes: Vec<Stroke>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    calibration: Calibration,
    groups: Vec<ExecutionGroup>,
    delay_ms: u64,
    countdown_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputAccess {
    granted: bool,
    platform: &'static str,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStatus {
    running: bool,
    paused: bool,
    stop_requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    phase: &'static str,
    completed: usize,
    total: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
    completed: usize,
    stopped: bool,
}

pub fn check_input_access(prompt: bool) -> InputAccess {
    let mut settings = Settings::default();
    settings.open_prompt_to_get_permissions = prompt;
    match Enigo::new(&settings) {
        Ok(_) => InputAccess {
            granted: true,
            platform: std::env::consts::OS,
            message: "鼠标控制权限已就绪。".to_string(),
        },
        Err(error) => InputAccess {
            granted: false,
            platform: std::env::consts::OS,
            message: format!("无法取得鼠标控制权限：{error}"),
        },
    }
}

pub async fn capture_pointer(delay_ms: u64) -> Result<ScreenPoint, String> {
    tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(delay_ms.clamp(250, 10_000)));
        let enigo = create_enigo(false)?;
        let (x, y) = enigo.location().map_err(input_error)?;
        Ok(ScreenPoint { x, y })
    })
    .await
    .map_err(|error| format!("坐标采集任务失败：{error}"))?
}

pub async fn test_cell(
    calibration: Calibration,
    palette_row: usize,
    palette_column: usize,
    cell: CellPoint,
    delay_ms: u64,
    countdown_ms: u64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_calibration(&calibration)?;
        validate_palette(palette_row, palette_column)?;
        validate_cell(&cell)?;
        thread::sleep(Duration::from_millis(countdown_ms.clamp(1_000, 10_000)));
        let mut enigo = create_enigo(true)?;
        let delay = delay_ms.clamp(20, 1_000);

        normalize_palette_top(&mut enigo, &calibration, delay)?;
        if palette_row > 5 {
            scroll_palette_bottom(&mut enigo, &calibration, delay)?;
        }
        select_palette(&mut enigo, &calibration, palette_row, palette_column, delay)?;
        click_point(&mut enigo, canvas_point(&calibration, &cell), delay)?;
        Ok(())
    })
    .await
    .map_err(|error| format!("单格测试任务失败：{error}"))?
}

pub async fn execute(
    app: AppHandle,
    state: State<'_, AutomationState>,
    request: ExecutionRequest,
) -> Result<ExecutionResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("已有绘制任务正在运行。".to_string());
    }
    state.paused.store(false, Ordering::SeqCst);
    state.stop_requested.store(false, Ordering::SeqCst);

    let shared_state = state.inner().clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || run_execution(&app, &shared_state, request))
            .await
            .map_err(|error| format!("绘制任务异常结束：{error}"))?;

    state.running.store(false, Ordering::SeqCst);
    state.paused.store(false, Ordering::SeqCst);
    result
}

pub fn set_paused(state: State<'_, AutomationState>, paused: bool) -> AutomationStatus {
    if state.running.load(Ordering::SeqCst) {
        state.paused.store(paused, Ordering::SeqCst);
    }
    status(state)
}

pub fn request_stop(state: State<'_, AutomationState>) -> AutomationStatus {
    state.stop_requested.store(true, Ordering::SeqCst);
    state.paused.store(false, Ordering::SeqCst);
    status(state)
}

pub fn status(state: State<'_, AutomationState>) -> AutomationStatus {
    AutomationStatus {
        running: state.running.load(Ordering::SeqCst),
        paused: state.paused.load(Ordering::SeqCst),
        stop_requested: state.stop_requested.load(Ordering::SeqCst),
    }
}

fn run_execution(
    app: &AppHandle,
    state: &AutomationState,
    request: ExecutionRequest,
) -> Result<ExecutionResult, String> {
    validate_calibration(&request.calibration)?;
    if request.groups.is_empty() {
        return Err("绘制任务为空。".to_string());
    }

    let total = CANVAS_CELLS
        + request
            .groups
            .iter()
            .map(|group| group.strokes.len())
            .sum::<usize>();
    let delay = request.delay_ms.clamp(20, 1_000);
    let mut enigo = create_enigo(true)?;
    emit_progress(app, "countdown", 0, total, "请切换到游戏窗口…");
    thread::sleep(Duration::from_millis(
        request.countdown_ms.clamp(1_000, 10_000),
    ));

    normalize_palette_top(&mut enigo, &request.calibration, delay)?;
    let mut lower_palette = false;
    let mut completed = 0;

    select_palette(
        &mut enigo,
        &request.calibration,
        WHITE_PALETTE_ROW,
        WHITE_PALETTE_COLUMN,
        delay,
    )?;
    for row in 0..CANVAS_CELLS {
        wait_if_paused(&enigo, state)?;
        if should_stop(&enigo, state)? {
            emit_progress(app, "stopped", completed, total, "绘制已安全停止");
            return Ok(ExecutionResult {
                completed,
                stopped: true,
            });
        }
        let stroke = if row % 2 == 0 {
            Stroke {
                from: CellPoint { x: 0, y: row },
                to: CellPoint { x: 23, y: row },
                length: CANVAS_CELLS,
            }
        } else {
            Stroke {
                from: CellPoint { x: 23, y: row },
                to: CellPoint { x: 0, y: row },
                length: CANVAS_CELLS,
            }
        };
        draw_stroke(&mut enigo, &request.calibration, &stroke, delay)?;
        click_point(
            &mut enigo,
            canvas_point(&request.calibration, &CellPoint { x: 0, y: row }),
            delay,
        )?;
        click_point(
            &mut enigo,
            canvas_point(&request.calibration, &CellPoint { x: 23, y: row }),
            delay,
        )?;
        completed += 1;
        emit_progress(app, "prefill", completed, total, "正在铺设白色底层");
    }

    for group in request.groups {
        validate_palette(group.palette_row, group.palette_column)?;
        if should_stop(&enigo, state)? {
            emit_progress(app, "stopped", completed, total, "绘制已安全停止");
            return Ok(ExecutionResult {
                completed,
                stopped: true,
            });
        }

        if group.palette_row > 5 && !lower_palette {
            scroll_palette_bottom(&mut enigo, &request.calibration, delay)?;
            lower_palette = true;
        }
        select_palette(
            &mut enigo,
            &request.calibration,
            group.palette_row,
            group.palette_column,
            delay,
        )?;

        for stroke in group.strokes {
            wait_if_paused(&enigo, state)?;
            if should_stop(&enigo, state)? {
                emit_progress(app, "stopped", completed, total, "绘制已安全停止");
                return Ok(ExecutionResult {
                    completed,
                    stopped: true,
                });
            }
            draw_stroke(&mut enigo, &request.calibration, &stroke, delay)?;
            completed += 1;
            emit_progress(app, "drawing", completed, total, "正在绘制模板");
        }
    }

    emit_progress(
        app,
        "completed",
        completed,
        total,
        "绘制完成，请检查后手动保存",
    );
    Ok(ExecutionResult {
        completed,
        stopped: false,
    })
}

fn create_enigo(prompt: bool) -> Result<Enigo, String> {
    let mut settings = Settings::default();
    settings.open_prompt_to_get_permissions = prompt;
    Enigo::new(&settings).map_err(|error| format!("无法初始化鼠标控制：{error}"))
}

fn validate_calibration(calibration: &Calibration) -> Result<(), String> {
    if calibration.canvas_bottom_right.x <= calibration.canvas_top_left.x
        || calibration.canvas_bottom_right.y <= calibration.canvas_top_left.y
    {
        return Err("画布校准点顺序不正确。".to_string());
    }
    if calibration.palette_top_row5_col4.x <= calibration.palette_top_left.x
        || calibration.palette_top_row5_col4.y <= calibration.palette_top_left.y
    {
        return Err("调色板顶部参考点顺序不正确。".to_string());
    }
    Ok(())
}

fn validate_palette(row: usize, column: usize) -> Result<(), String> {
    if !(1..=10).contains(&row) || !(1..=4).contains(&column) {
        return Err(format!("调色板位置越界：第{row}行第{column}列。"));
    }
    Ok(())
}

fn validate_cell(cell: &CellPoint) -> Result<(), String> {
    if cell.x >= 24 || cell.y >= 24 {
        return Err(format!("画布坐标越界：({}, {})。", cell.x, cell.y));
    }
    Ok(())
}

fn palette_spacing(calibration: &Calibration) -> (f64, f64) {
    (
        f64::from(calibration.palette_top_row5_col4.x - calibration.palette_top_left.x) / 3.0,
        f64::from(calibration.palette_top_row5_col4.y - calibration.palette_top_left.y) / 4.0,
    )
}

fn palette_point(calibration: &Calibration, row: usize, column: usize) -> ScreenPoint {
    let (column_step, row_step) = palette_spacing(calibration);
    if row <= 5 {
        ScreenPoint {
            x: (f64::from(calibration.palette_top_left.x) + (column - 1) as f64 * column_step)
                .round() as i32,
            y: (f64::from(calibration.palette_top_left.y) + (row - 1) as f64 * row_step).round()
                as i32,
        }
    } else {
        ScreenPoint {
            x: (f64::from(calibration.palette_bottom_row6_col1.x)
                + (column - 1) as f64 * column_step)
                .round() as i32,
            y: (f64::from(calibration.palette_bottom_row6_col1.y) + (row - 6) as f64 * row_step)
                .round() as i32,
        }
    }
}

fn canvas_point(calibration: &Calibration, cell: &CellPoint) -> ScreenPoint {
    ScreenPoint {
        x: (f64::from(calibration.canvas_top_left.x)
            + cell.x as f64 / GRID_SIZE
                * f64::from(calibration.canvas_bottom_right.x - calibration.canvas_top_left.x))
        .round() as i32,
        y: (f64::from(calibration.canvas_top_left.y)
            + cell.y as f64 / GRID_SIZE
                * f64::from(calibration.canvas_bottom_right.y - calibration.canvas_top_left.y))
        .round() as i32,
    }
}

fn select_palette(
    enigo: &mut Enigo,
    calibration: &Calibration,
    row: usize,
    column: usize,
    delay: u64,
) -> Result<(), String> {
    release_left_button(enigo)?;
    click_point(
        enigo,
        palette_point(calibration, row, column),
        delay.saturating_mul(2),
    )
}

fn normalize_palette_top(
    enigo: &mut Enigo,
    calibration: &Calibration,
    delay: u64,
) -> Result<(), String> {
    let (_, row_step) = palette_spacing(calibration);
    let x = calibration.palette_top_left.x;
    let from = ScreenPoint {
        x,
        y: (f64::from(calibration.palette_top_left.y) + row_step).round() as i32,
    };
    let to = ScreenPoint {
        x,
        y: (f64::from(calibration.palette_top_left.y) + row_step * 4.0).round() as i32,
    };
    for _ in 0..3 {
        drag_between(enigo, from, to, delay)?;
    }
    Ok(())
}

fn scroll_palette_bottom(
    enigo: &mut Enigo,
    calibration: &Calibration,
    delay: u64,
) -> Result<(), String> {
    let (_, row_step) = palette_spacing(calibration);
    let x = calibration.palette_top_left.x;
    let from = ScreenPoint {
        x,
        y: (f64::from(calibration.palette_top_left.y) + row_step * 4.0).round() as i32,
    };
    let to = ScreenPoint {
        x,
        y: (f64::from(calibration.palette_top_left.y) + row_step).round() as i32,
    };
    for _ in 0..3 {
        drag_between(enigo, from, to, delay)?;
    }
    Ok(())
}

fn draw_stroke(
    enigo: &mut Enigo,
    calibration: &Calibration,
    stroke: &Stroke,
    delay: u64,
) -> Result<(), String> {
    validate_cell(&stroke.from)?;
    validate_cell(&stroke.to)?;
    if stroke.from.y != stroke.to.y {
        return Err("当前版本仅支持横向连续笔画。".to_string());
    }
    let expected_length = stroke.from.x.abs_diff(stroke.to.x) + 1;
    if stroke.length != expected_length {
        return Err("连续笔画长度校验失败。".to_string());
    }
    if stroke.length == 1 {
        return click_point(enigo, canvas_point(calibration, &stroke.from), delay);
    }

    let direction: i32 = if stroke.to.x >= stroke.from.x { 1 } else { -1 };
    let mut x = stroke.from.x as i32;
    let end = stroke.to.x as i32;
    move_to(enigo, canvas_point(calibration, &stroke.from))?;
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(input_error)?;
    thread::sleep(Duration::from_millis(delay));
    let movement_result = (|| {
        while x != end {
            x += direction;
            let cell = CellPoint {
                x: x as usize,
                y: stroke.from.y,
            };
            move_to(enigo, canvas_point(calibration, &cell))?;
            thread::sleep(Duration::from_millis(delay));
        }
        thread::sleep(Duration::from_millis(delay));
        Ok(())
    })();
    let release_result = release_left_button(enigo);
    thread::sleep(Duration::from_millis(delay.saturating_mul(2)));
    movement_result.and(release_result)
}

fn click_point(enigo: &mut Enigo, point: ScreenPoint, delay: u64) -> Result<(), String> {
    move_to(enigo, point)?;
    thread::sleep(Duration::from_millis(delay));
    enigo
        .button(Button::Left, Direction::Click)
        .map_err(input_error)?;
    thread::sleep(Duration::from_millis(delay));
    Ok(())
}

fn drag_between(
    enigo: &mut Enigo,
    from: ScreenPoint,
    to: ScreenPoint,
    delay: u64,
) -> Result<(), String> {
    move_to(enigo, from)?;
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(input_error)?;
    thread::sleep(Duration::from_millis(delay));
    let movement_result = (|| {
        for step in 1..=8 {
            let x = from.x + (to.x - from.x) * step / 8;
            let y = from.y + (to.y - from.y) * step / 8;
            move_to(enigo, ScreenPoint { x, y })?;
            thread::sleep(Duration::from_millis(delay));
        }
        Ok(())
    })();
    let release_result = release_left_button(enigo);
    thread::sleep(Duration::from_millis(delay.saturating_mul(2)));
    movement_result.and(release_result)
}

fn release_left_button(enigo: &mut Enigo) -> Result<(), String> {
    enigo
        .button(Button::Left, Direction::Release)
        .map_err(input_error)
}

fn move_to(enigo: &mut Enigo, point: ScreenPoint) -> Result<(), String> {
    enigo
        .move_mouse(point.x, point.y, Coordinate::Abs)
        .map_err(input_error)
}

fn wait_if_paused(enigo: &Enigo, state: &AutomationState) -> Result<(), String> {
    while state.paused.load(Ordering::SeqCst) {
        if state.stop_requested.load(Ordering::SeqCst) || pointer_in_failsafe(enigo)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(80));
    }
    Ok(())
}

fn should_stop(enigo: &Enigo, state: &AutomationState) -> Result<bool, String> {
    Ok(state.stop_requested.load(Ordering::SeqCst) || pointer_in_failsafe(enigo)?)
}

fn pointer_in_failsafe(enigo: &Enigo) -> Result<bool, String> {
    let (x, y) = enigo.location().map_err(input_error)?;
    Ok(x <= FAILSAFE_EDGE && y <= FAILSAFE_EDGE)
}

fn input_error(error: impl std::fmt::Display) -> String {
    format!("鼠标操作失败：{error}")
}

fn emit_progress(
    app: &AppHandle,
    phase: &'static str,
    completed: usize,
    total: usize,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "automation-progress",
        ProgressEvent {
            phase,
            completed,
            total,
            message: message.into(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn calibration() -> Calibration {
        Calibration {
            canvas_top_left: ScreenPoint { x: 100, y: 200 },
            canvas_bottom_right: ScreenPoint { x: 560, y: 660 },
            palette_top_left: ScreenPoint { x: 700, y: 200 },
            palette_top_row5_col4: ScreenPoint { x: 820, y: 360 },
            palette_bottom_row6_col1: ScreenPoint { x: 700, y: 240 },
        }
    }

    #[test]
    fn maps_canvas_corner_centres() {
        let calibration = calibration();
        assert_eq!(
            canvas_point(&calibration, &CellPoint { x: 0, y: 0 }),
            ScreenPoint { x: 100, y: 200 }
        );
        assert_eq!(
            canvas_point(&calibration, &CellPoint { x: 23, y: 23 }),
            ScreenPoint { x: 560, y: 660 }
        );
    }

    #[test]
    fn derives_palette_grid_from_reference_points() {
        let calibration = calibration();
        assert_eq!(
            palette_point(&calibration, 3, 2),
            ScreenPoint { x: 740, y: 280 }
        );
        assert_eq!(
            palette_point(&calibration, 10, 4),
            ScreenPoint { x: 820, y: 400 }
        );
    }
}
