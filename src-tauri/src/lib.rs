mod automation;
pub mod template;

use automation::{
    AutomationState, AutomationStatus, Calibration, CellPoint, ExecutionRequest, ExecutionResult,
    InputAccess, ScreenPoint,
};
use template::TemplateAnalysis;

#[tauri::command]
fn analyze_template(json: String) -> Result<TemplateAnalysis, String> {
    template::analyze(&json).map_err(|error| error.to_string())
}

#[tauri::command]
fn check_input_access(prompt: bool) -> InputAccess {
    automation::check_input_access(prompt)
}

#[tauri::command]
async fn capture_pointer(
    window: tauri::WebviewWindow,
    delay_ms: u64,
) -> Result<ScreenPoint, String> {
    hide_window(&window)?;
    let result = automation::capture_pointer(delay_ms).await;
    restore_window(&window, result)
}

#[tauri::command]
async fn test_cell(
    window: tauri::WebviewWindow,
    calibration: Calibration,
    palette_row: usize,
    palette_column: usize,
    cell: CellPoint,
    delay_ms: u64,
    countdown_ms: u64,
) -> Result<(), String> {
    hide_window(&window)?;
    let result = automation::test_cell(
        calibration,
        palette_row,
        palette_column,
        cell,
        delay_ms,
        countdown_ms,
    )
    .await;
    restore_window(&window, result)
}

#[tauri::command]
async fn start_automation(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AutomationState>,
    request: ExecutionRequest,
) -> Result<ExecutionResult, String> {
    hide_window(&window)?;
    let result = automation::execute(app, window.clone(), state, request).await;
    restore_window(&window, result)
}

#[cfg(target_os = "windows")]
fn hide_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .minimize()
        .map_err(|error| format!("无法暂时最小化 Ark Beads：{error}"))
}

#[cfg(not(target_os = "windows"))]
fn hide_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .hide()
        .map_err(|error| format!("无法暂时隐藏 Ark Beads：{error}"))
}

#[cfg(target_os = "windows")]
fn show_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
}

#[cfg(not(target_os = "windows"))]
fn show_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.show().and_then(|_| window.set_focus())
}

fn restore_window<T>(
    window: &tauri::WebviewWindow,
    result: Result<T, String>,
) -> Result<T, String> {
    let restore_result =
        show_window(window).map_err(|error| format!("无法恢复 Ark Beads 窗口：{error}"));

    match (result, restore_result) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(value), Ok(())) => Ok(value),
    }
}

#[tauri::command]
fn set_automation_paused(
    state: tauri::State<'_, AutomationState>,
    paused: bool,
) -> AutomationStatus {
    automation::set_paused(state, paused)
}

#[tauri::command]
fn stop_automation(state: tauri::State<'_, AutomationState>) -> AutomationStatus {
    automation::request_stop(state)
}

#[tauri::command]
fn automation_status(state: tauri::State<'_, AutomationState>) -> AutomationStatus {
    automation::status(state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AutomationState::default())
        .invoke_handler(tauri::generate_handler![
            analyze_template,
            check_input_access,
            capture_pointer,
            test_cell,
            start_automation,
            set_automation_paused,
            stop_automation,
            automation_status
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ark Beads");
}
