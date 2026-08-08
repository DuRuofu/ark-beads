import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";
import type {
  AutomationProgress,
  Calibration,
  ColorGroup,
  ExecutionResult,
  InputAccess,
  ScreenPoint,
  TemplateAnalysis,
} from "./types";

type Step = "import" | "calibrate" | "execute";
type CalibrationKey = keyof Calibration;

const CALIBRATION_KEY = "ark-beads.calibration.v1";
const THEME_KEY = "ark-beads.theme";
const calibrationItems: Array<{ key: CalibrationKey; index: string; title: string; detail: string }> = [
  { key: "canvasTopLeft", index: "A1", title: "画布左上格中心", detail: "第 1 行第 1 列中心" },
  { key: "canvasBottomRight", index: "A2", title: "画布右下格中心", detail: "第 24 行第 24 列中心" },
  { key: "paletteTopLeft", index: "P1", title: "色板第 1 行第 1 列", detail: "先将色板滚动到最顶端" },
  { key: "paletteTopRow5Col4", index: "P2", title: "色板第 5 行第 4 列", detail: "用于计算行列间距" },
  { key: "paletteBottomRow6Col1", index: "P3", title: "色板第 6 行第 1 列", detail: "将色板滚到底后采集" },
];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("无法初始化应用界面");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><p class="eyebrow">RHODES ISLAND / FIELD TOOL 01</p><h1>ARK <strong>BEADS</strong></h1></div>
      </div>
      <div class="topbar-actions">
        <button id="theme-toggle" class="icon-button" type="button" aria-label="切换明暗主题"><span>◐</span><b>THEME</b></button>
        <div class="platform-badge"><i></i> macOS · LOCAL</div>
      </div>
    </header>

    <nav class="workflow" aria-label="工作流程">
      <button data-step="import" class="workflow-step is-active" type="button"><b>01</b><span>导入模板</span></button>
      <i></i>
      <button data-step="calibrate" class="workflow-step" type="button"><b>02</b><span>校准界面</span></button>
      <i></i>
      <button data-step="execute" class="workflow-step" type="button"><b>03</b><span>执行绘制</span></button>
    </nav>

    <section class="workspace">
      <article class="preview-panel panel">
        <div class="panel-heading">
          <div><p class="panel-index">CANVAS MONITOR / 24×24</p><h2>模板预览</h2></div>
          <span id="template-status" class="status-chip">等待导入</span>
        </div>
        <div id="drop-zone" class="drop-zone">
          <canvas id="preview" width="576" height="576" aria-label="拼豆模板预览"></canvas>
          <div id="empty-state" class="empty-state">
            <div class="file-glyph" aria-hidden="true">JSON</div>
            <strong>拖入模板文件</strong><span>或点击选择网站导出的 JSON</span>
          </div>
          <input id="file-input" type="file" accept="application/json,.json" />
        </div>
        <footer class="preview-footer"><span>白色与透明格保持空白</span><button id="choose-file" class="text-button" type="button">选择文件 ↗</button></footer>
      </article>

      <aside class="control-panel panel">
        <div id="message" class="message is-info">导入来自 prts.chongxi.us 的 24×24 模板。</div>

        <section class="step-view is-active" data-view="import">
          <div class="panel-heading compact"><div><p class="panel-index">MISSION DATA</p><h2>绘制任务</h2></div></div>
          <dl class="metrics">
            <div><dt>有效格子</dt><dd id="painted-count">—</dd></div><div><dt>使用颜色</dt><dd id="color-count">—</dd></div>
            <div><dt>预计操作</dt><dd id="stroke-count">—</dd></div><div><dt>连续拖动</dt><dd id="drag-count">—</dd></div>
          </dl>
          <div class="section-label"><span>调色板任务</span><i></i></div>
          <div id="color-groups" class="color-groups"><p class="placeholder-copy">导入后按调色板顺序生成任务</p></div>
          <div class="safety-note"><b>NOTICE</b><span>请从全新空白画布开始。程序不会点击保存或发布。</span></div>
          <button id="to-calibration" class="primary-button" type="button" disabled><span>下一步：校准界面</span><b>LOCKED</b></button>
        </section>

        <section class="step-view" data-view="calibrate">
          <div class="panel-heading compact"><div><p class="panel-index">POSITION REGISTER</p><h2>五点手动校准</h2></div><button id="permission-button" class="mini-button" type="button">检查权限</button></div>
          <p class="instruction">点“采集”后，在 3 秒内把鼠标移到游戏中的目标中心并保持不动。游戏窗口位置改变后需重新校准。</p>
          <div id="calibration-list" class="calibration-list"></div>
          <div class="safety-note"><b>FAILSAFE</b><span>绘制中将鼠标移至屏幕左上角即可紧急停止。</span></div>
          <div class="button-row"><button id="back-import" class="secondary-button" type="button">返回</button><button id="to-execute" class="primary-button" type="button" disabled><span>校准完成</span><b>05 / 05</b></button></div>
        </section>

        <section class="step-view" data-view="execute">
          <div class="panel-heading compact"><div><p class="panel-index">AUTOMATION CONTROL</p><h2>执行绘制</h2></div><span id="run-state" class="status-chip">待命</span></div>
          <div class="execution-summary"><span>当前任务</span><strong id="execution-name">尚未导入</strong><small id="execution-detail">—</small></div>
          <label class="speed-control"><span>每格间隔 <b id="speed-label">55 ms</b></span><input id="speed" type="range" min="25" max="160" value="55" step="5" /></label>
          <div class="progress-block"><div><span id="progress-label">等待启动</span><b id="progress-count">0 / 0</b></div><progress id="progress" value="0" max="1"></progress></div>
          <button id="test-cell" class="secondary-button full" type="button" disabled>单格试点（执行前推荐）</button>
          <button id="start" class="primary-button start-button" type="button" disabled><span>开始自动绘制</span><b>4 SEC</b></button>
          <div class="run-controls"><button id="pause" class="secondary-button" type="button" disabled>暂停</button><button id="stop" class="danger-button" type="button" disabled>停止</button></div>
          <div class="safety-note"><b>CHECK</b><span>单格试点会实际填色；确认坐标正确后，请先在游戏中撤销该格再正式开始。</span></div>
          <button id="back-calibration" class="text-button back-link" type="button">← 返回校准</button>
        </section>
      </aside>
    </section>
  </main>
`;

const $ = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const fileInput = $("#file-input") as HTMLInputElement;
const dropZone = $("#drop-zone") as HTMLDivElement;
const canvas = $("#preview") as HTMLCanvasElement;
const emptyState = $("#empty-state") as HTMLDivElement;
const message = $("#message") as HTMLDivElement;
const templateStatus = $("#template-status") as HTMLSpanElement;
const primaryImport = $("#to-calibration") as HTMLButtonElement;
const toExecute = $("#to-execute") as HTMLButtonElement;
const startButton = $("#start") as HTMLButtonElement;
const testButton = $("#test-cell") as HTMLButtonElement;
const pauseButton = $("#pause") as HTMLButtonElement;
const stopButton = $("#stop") as HTMLButtonElement;
const speed = $("#speed") as HTMLInputElement;
const progress = $("#progress") as HTMLProgressElement;

let analysis: TemplateAnalysis | null = null;
let calibration: Partial<Calibration> = loadCalibration();
let running = false;
let paused = false;

function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  $("#theme-toggle span").textContent = theme === "dark" ? "☀" : "◐";
}

const storedTheme = localStorage.getItem(THEME_KEY);
setTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

function setMessage(text: string, kind: "info" | "success" | "error"): void {
  message.textContent = text;
  message.className = `message is-${kind}`;
}

function setStep(step: Step): void {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((node) => node.classList.toggle("is-active", node.dataset.step === step));
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((node) => node.classList.toggle("is-active", node.dataset.view === step));
  if (step === "calibrate") setMessage("依次采集五个中心点；坐标仅保存在这台电脑。", "info");
  if (step === "execute") setMessage("先做单格试点。正式启动后有 4 秒切换回游戏窗口。", "info");
}

function loadCalibration(): Partial<Calibration> {
  try { return JSON.parse(localStorage.getItem(CALIBRATION_KEY) ?? "{}"); } catch { return {}; }
}

function calibrationReady(): boolean {
  return calibrationItems.every(({ key }) => calibration[key] !== undefined);
}

function renderCalibration(): void {
  $("#calibration-list").innerHTML = calibrationItems.map(({ key, index, title, detail }) => {
    const point = calibration[key];
    return `<div class="calibration-item ${point ? "is-set" : ""}"><b>${index}</b><div><strong>${title}</strong><span>${point ? `X ${point.x} · Y ${point.y}` : detail}</span></div><button class="mini-button capture-button" data-key="${key}" type="button">${point ? "重采" : "采集"}</button></div>`;
  }).join("");
  toExecute.disabled = !calibrationReady();
  document.querySelectorAll<HTMLButtonElement>(".capture-button").forEach((button) => button.addEventListener("click", () => void captureCalibration(button)));
}

async function captureCalibration(button: HTMLButtonElement): Promise<void> {
  const key = button.dataset.key as CalibrationKey;
  document.querySelectorAll<HTMLButtonElement>(".capture-button").forEach((item) => { item.disabled = true; });
  for (let count = 3; count > 0; count -= 1) {
    setMessage(`${count} 秒后读取鼠标位置：请移到游戏目标中心…`, "info");
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  try {
    calibration[key] = await invoke<ScreenPoint>("capture_pointer", { delayMs: 250 });
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration));
    renderCalibration();
    setMessage("坐标已记录。继续采集下一点。", "success");
  } catch (error) {
    setMessage(String(error), "error");
    renderCalibration();
  }
}

function renderPreview(result: TemplateAnalysis): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const cellSize = canvas.width / result.size;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  result.preview.forEach((color, index) => {
    if (!color || color.toUpperCase() === "#FFFFFF") return;
    context.fillStyle = color;
    context.fillRect((index % result.size) * cellSize, Math.floor(index / result.size) * cellSize, cellSize, cellSize);
  });
  context.strokeStyle = "rgba(18, 22, 25, .12)";
  context.lineWidth = 1;
  for (let index = 1; index < result.size; index += 1) {
    const point = index * cellSize;
    context.beginPath(); context.moveTo(point, 0); context.lineTo(point, canvas.height); context.moveTo(0, point); context.lineTo(canvas.width, point); context.stroke();
  }
  context.strokeStyle = "#18bbb7";
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(canvas.width / 2, 0); context.lineTo(canvas.width / 2, canvas.height); context.moveTo(0, canvas.height / 2); context.lineTo(canvas.width, canvas.height / 2); context.stroke();
}

function groupMarkup(group: ColorGroup): string {
  return `<div class="color-task"><i style="--swatch:${group.hex}"></i><div><b>色板 ${group.paletteRow}-${group.paletteColumn}</b><span>${group.cellCount} 格 · ${group.strokes.length} 次操作</span></div><code>${group.hex}</code></div>`;
}

function renderAnalysis(fileName: string, result: TemplateAnalysis): void {
  analysis = result;
  emptyState.hidden = true;
  canvas.classList.add("is-visible");
  templateStatus.textContent = "校验通过";
  templateStatus.className = "status-chip is-ready";
  $("#painted-count").textContent = String(result.paintedCells);
  $("#color-count").textContent = String(result.colorCount);
  $("#stroke-count").textContent = String(result.strokeCount);
  $("#drag-count").textContent = String(result.dragStrokeCount);
  $("#color-groups").innerHTML = result.groups.map(groupMarkup).join("");
  $("#execution-name").textContent = fileName;
  $("#execution-detail").textContent = `${result.paintedCells} 格 · ${result.colorCount} 色 · ${result.strokeCount} 次操作`;
  primaryImport.disabled = false;
  primaryImport.querySelector("b")!.textContent = "READY";
  testButton.disabled = !calibrationReady();
  startButton.disabled = !calibrationReady();
  setMessage(`${fileName} 已载入；已跳过 ${result.skippedWhite} 个白色格。`, "success");
  renderPreview(result);
}

async function loadTemplate(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) return setMessage("请选择 JSON 模板文件。", "error");
  setMessage("正在校验模板并生成绘制任务…", "info");
  try { renderAnalysis(file.name, await invoke<TemplateAnalysis>("analyze_template", { json: await file.text() })); }
  catch (error) { templateStatus.textContent = "模板无效"; templateStatus.className = "status-chip is-error"; setMessage(String(error), "error"); }
}

async function checkPermission(): Promise<void> {
  try {
    const access = await invoke<InputAccess>("check_input_access", { prompt: true });
    setMessage(access.message, access.granted ? "success" : "error");
  } catch (error) { setMessage(String(error), "error"); }
}

async function testCell(): Promise<void> {
  if (!analysis || !calibrationReady()) return;
  const group = analysis.groups[0];
  const cell = group?.strokes[0]?.from;
  if (!group || !cell) return setMessage("模板中没有需要绘制的格子。", "error");
  testButton.disabled = true;
  setMessage("3 秒后执行单格试点，请切换到游戏…", "info");
  await new Promise((resolve) => window.setTimeout(resolve, 3000));
  try {
    await invoke("test_cell", { calibration: calibration as Calibration, paletteRow: group.paletteRow, paletteColumn: group.paletteColumn, cell, delayMs: Number(speed.value) });
    setMessage(`已试点画布第 ${cell.y + 1} 行第 ${cell.x + 1} 列。确认后请在游戏中撤销该格。`, "success");
  } catch (error) { setMessage(String(error), "error"); }
  finally { testButton.disabled = false; }
}

function setRunning(value: boolean): void {
  running = value;
  startButton.disabled = value || !analysis || !calibrationReady();
  testButton.disabled = value || !analysis || !calibrationReady();
  pauseButton.disabled = !value;
  stopButton.disabled = !value;
  $("#run-state").textContent = value ? "运行中" : "待命";
  $("#run-state").className = value ? "status-chip is-ready" : "status-chip";
}

async function startAutomation(): Promise<void> {
  if (!analysis || !calibrationReady() || running) return;
  setRunning(true);
  paused = false;
  pauseButton.textContent = "暂停";
  setMessage("倒计时开始，请立即切换到游戏窗口并勿触碰鼠标。", "info");
  try {
    const result = await invoke<ExecutionResult>("start_automation", {
      request: { calibration: calibration as Calibration, groups: analysis.groups, delayMs: Number(speed.value), countdownMs: 4000 },
    });
    setMessage(result.stopped ? `任务已停止，完成 ${result.completed} 次操作。` : "绘制完成，请在游戏内检查并手动保存。", result.stopped ? "info" : "success");
  } catch (error) { setMessage(String(error), "error"); }
  finally { setRunning(false); }
}

async function togglePause(): Promise<void> {
  if (!running) return;
  paused = !paused;
  await invoke("set_automation_paused", { paused });
  pauseButton.textContent = paused ? "继续" : "暂停";
  $("#run-state").textContent = paused ? "已暂停" : "运行中";
}

async function stopAutomation(): Promise<void> {
  if (!running) return;
  await invoke("stop_automation");
  setMessage("正在安全停止，将在当前笔画结束后退出。", "info");
}

if ("__TAURI_INTERNALS__" in window) {
  void listen<AutomationProgress>("automation-progress", ({ payload }) => {
    progress.max = Math.max(payload.total, 1);
    progress.value = payload.completed;
    $("#progress-label").textContent = payload.message;
    $("#progress-count").textContent = `${payload.completed} / ${payload.total}`;
  });
}

$("#choose-file").addEventListener("click", () => fileInput.click());
dropZone.addEventListener("click", (event) => { if (event.target !== canvas) fileInput.click(); });
fileInput.addEventListener("change", () => { const file = fileInput.files?.[0]; if (file) void loadTemplate(file); });
for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); });
dropZone.addEventListener("drop", (event) => { const file = event.dataTransfer?.files[0]; if (file) void loadTemplate(file); });
document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.step as Step;
  if (target === "import" || (target === "calibrate" && analysis) || (target === "execute" && analysis && calibrationReady())) setStep(target);
}));
primaryImport.addEventListener("click", () => setStep("calibrate"));
$("#back-import").addEventListener("click", () => setStep("import"));
toExecute.addEventListener("click", () => { testButton.disabled = !analysis; startButton.disabled = !analysis; setStep("execute"); });
$("#back-calibration").addEventListener("click", () => setStep("calibrate"));
$("#permission-button").addEventListener("click", () => void checkPermission());
testButton.addEventListener("click", () => void testCell());
startButton.addEventListener("click", () => void startAutomation());
pauseButton.addEventListener("click", () => void togglePause());
stopButton.addEventListener("click", () => void stopAutomation());
speed.addEventListener("input", () => { $("#speed-label").textContent = `${speed.value} ms`; });

renderCalibration();
