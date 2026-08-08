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
async fn capture_pointer(delay_ms: u64) -> Result<ScreenPoint, String> {
    automation::capture_pointer(delay_ms).await
}

#[tauri::command]
async fn test_cell(
    calibration: Calibration,
    palette_row: usize,
    palette_column: usize,
    cell: CellPoint,
    delay_ms: u64,
) -> Result<(), String> {
    automation::test_cell(calibration, palette_row, palette_column, cell, delay_ms).await
}

#[tauri::command]
async fn start_automation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AutomationState>,
    request: ExecutionRequest,
) -> Result<ExecutionResult, String> {
    automation::execute(app, state, request).await
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
