pub mod template;

use template::TemplateAnalysis;

#[tauri::command]
fn analyze_template(json: String) -> Result<TemplateAnalysis, String> {
    template::analyze(&json).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_template])
        .run(tauri::generate_context!())
        .expect("failed to run Ark Beads");
}
