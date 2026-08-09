import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ARK_PALETTE,
  CONVERSION_PRESETS,
  convertImage,
  createTemplateFromPaletteIndices,
  loadImage,
  type ConversionPreset,
  type ConversionSettings,
  type GeneratedTemplate,
} from "./image-converter";
import { PRESET_TEMPLATES } from "./presets";
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

const CALIBRATION_KEY = "ark-beads.calibration.v2";
const THEME_KEY = "ark-beads.theme";
const LIBRARY_KEY = "ark-beads.template-library.v1";
const MAX_SAVED_TEMPLATES = 8;
const calibrationItems: Array<{ key: CalibrationKey; index: string; title: string; detail: string }> = [
  { key: "canvasTopLeft", index: "A1", title: "画布左上格中心", detail: "第 1 行第 1 列中心" },
  { key: "canvasBottomRight", index: "A2", title: "画布右下格中心", detail: "第 24 行第 24 列中心" },
  { key: "paletteTopLeft", index: "P1", title: "色盘第一页左上色块", detail: "第 1 行第 1 列（黑色）中心" },
  { key: "paletteBottomRight", index: "P2", title: "色盘第一页右下色块", detail: "第 5 行第 4 列中心" },
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
        <div id="platform-badge" class="platform-badge"><i></i> DESKTOP · LOCAL</div>
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
            <div class="file-glyph" aria-hidden="true">24²</div>
            <strong>拖入 JSON 或图片</strong><span>模板直接校验，图片在本机转换</span>
          </div>
          <input id="file-input" type="file" accept="application/json,.json,image/png,image/jpeg,image/webp,image/gif,image/bmp" />
        </div>
        <footer class="preview-footer"><span>白色在预览中显示，执行时保持画布空白</span><div><button id="edit-template" class="text-button" type="button" disabled>编辑像素画</button><button id="choose-file" class="text-button" type="button">导入 JSON</button><button id="choose-image" class="text-button" type="button">图片转模板 ↗</button></div></footer>
      </article>

      <aside id="control-panel" class="control-panel panel" data-current-step="import">
        <div id="message" class="message is-info">导入来自 prts.chongxi.us 的 24×24 模板。</div>

        <section class="step-view is-active" data-view="import">
          <div class="panel-heading compact"><div><p class="panel-index">MISSION DATA</p><h2>绘制任务</h2></div></div>
          <div class="section-label"><span>快速模板</span><i></i><button id="export-template" class="text-button" type="button" disabled>导出当前 JSON</button></div>
          <div id="template-library" class="template-library"></div>
          <dl class="metrics">
            <div><dt>有效格子</dt><dd id="painted-count">—</dd></div><div><dt>使用颜色</dt><dd id="color-count">—</dd></div>
            <div><dt>预计单击</dt><dd id="stroke-count">—</dd></div><div><dt>连续拖动</dt><dd id="drag-count">—</dd></div>
          </dl>
          <div class="section-label"><span>调色板任务</span><i></i></div>
          <div id="color-groups" class="color-groups"><p class="placeholder-copy">导入后按调色板顺序生成任务</p></div>
          <div class="safety-note"><b>NOTICE</b><span>请从全新空白画布开始。程序不会点击保存或发布。</span></div>
          <button id="to-calibration" class="primary-button" type="button" disabled><span>下一步：校准界面</span><b>LOCKED</b></button>
        </section>

        <section class="step-view" data-view="calibrate">
          <div class="panel-heading compact"><div><p class="panel-index">POSITION REGISTER</p><h2>四点精准校准</h2></div><button id="permission-button" class="mini-button" type="button">检查权限</button></div>
          <p class="instruction">依次采集画布两个对角格，以及色盘第一页左上、右下色块的中心。四点都直接来自当前游戏窗口，不再使用固定比例推算。</p>
          <div id="calibration-list" class="calibration-list"></div>
          <div class="safety-note"><b>FAILSAFE</b><span>绘制中将鼠标移至屏幕左上角即可紧急停止。</span></div>
          <div class="button-row"><button id="back-import" class="secondary-button" type="button">返回</button><button id="to-execute" class="primary-button" type="button" disabled><span>校准完成</span><b>04 / 04</b></button></div>
        </section>

        <section class="step-view" data-view="execute">
          <div class="panel-heading compact"><div><p class="panel-index">AUTOMATION CONTROL</p><h2>执行绘制</h2></div><span id="run-state" class="status-chip">待命</span></div>
          <div class="execution-summary"><span>当前任务</span><strong id="execution-name">尚未导入</strong><small id="execution-detail">—</small></div>
          <label class="speed-control"><span>每格间隔 <b id="speed-label">65 ms</b></span><input id="speed" type="range" min="40" max="180" value="65" step="5" /></label>
          <div class="progress-block"><div><span id="progress-label">等待启动</span><b id="progress-count">0 / 0</b></div><progress id="progress" value="0" max="1"></progress></div>
          <button id="test-cell" class="secondary-button full" type="button" disabled>单格试点（执行前推荐）</button>
          <button id="start" class="primary-button start-button" type="button" disabled><span>开始自动绘制</span><b>4 SEC</b></button>
          <div class="run-controls"><button id="pause" class="secondary-button" type="button" disabled>暂停</button><button id="stop" class="danger-button" type="button" disabled>停止</button></div>
          <div class="safety-note"><b>CHECK</b><span>单格试点会实际填色；确认坐标正确后，请先在游戏中撤销该格再正式开始。</span></div>
          <button id="back-calibration" class="text-button back-link" type="button">← 返回校准</button>
        </section>
      </aside>
    </section>

    <div id="image-studio" class="studio-backdrop" hidden>
      <section class="studio-dialog" role="dialog" aria-modal="true" aria-labelledby="studio-title">
        <header class="studio-heading">
          <div><p class="panel-index">LOCAL PIXEL LAB / 24×24</p><h2 id="studio-title">图片转像素画</h2></div>
          <button id="close-studio" class="studio-close" type="button" aria-label="关闭">×</button>
        </header>
        <p id="image-source-detail" class="studio-copy">所有处理均在本机完成，不会上传原图。</p>
        <div class="studio-workspace">
          <div class="studio-preview">
            <canvas id="conversion-preview" width="576" height="576" aria-label="图片转换预览"></canvas>
            <div><b>24 × 24</b><span>ARK OFFICIAL / 40 COLORS</span></div>
          </div>
          <div class="studio-controls">
            <div class="preset-selector" aria-label="转换方案">
              <button data-conversion-preset="balanced" class="is-active" type="button"><b>均衡</b><span>通用首选</span></button>
              <button data-conversion-preset="crisp" type="button"><b>清晰轮廓</b><span>图标 / 插画</span></button>
              <button data-conversion-preset="smooth" type="button"><b>平滑过渡</b><span>照片 / 渐变</span></button>
              <button data-conversion-preset="detail" type="button"><b>细节抖动</b><span>保留层次</span></button>
            </div>
            <div class="studio-settings">
              <label><span>缩放采样</span><select id="conversion-algorithm"><option value="box">区域均值</option><option value="nearest">最近邻</option><option value="bilinear">双线性</option></select></label>
              <label><span>画面适配</span><select id="conversion-fit"><option value="contain">完整显示</option><option value="cover">居中裁切</option><option value="stretch">拉伸填满</option></select></label>
              <label class="studio-range"><span>轮廓增强 <b id="edge-label">45%</b></span><input id="conversion-edge" type="range" min="0" max="100" value="45" /></label>
              <label class="studio-range"><span>对比度 <b id="contrast-label">+8</b></span><input id="conversion-contrast" type="range" min="-40" max="40" value="8" /></label>
              <label class="studio-range"><span>饱和度 <b id="saturation-label">+8</b></span><input id="conversion-saturation" type="range" min="-40" max="40" value="8" /></label>
              <label class="dither-toggle"><input id="conversion-dither" type="checkbox" /><span><b>误差扩散</b><small>用相邻色点保留有限色板中的明暗过渡</small></span></label>
            </div>
            <div class="studio-note"><b>TIP</b><span>复杂照片适合“细节抖动”；Logo、角色立绘和线稿可先试“清晰轮廓”。</span></div>
          </div>
        </div>
        <footer class="studio-actions"><button id="cancel-conversion" class="secondary-button" type="button">取消</button><button id="edit-conversion" class="secondary-button" type="button">进入像素精修</button><button id="use-conversion" class="secondary-button" type="button">加入模板库</button><button id="save-conversion" class="primary-button" type="button"><span>保存 JSON</span><b>LOCAL</b></button></footer>
      </section>
    </div>

    <div id="pixel-editor" class="studio-backdrop editor-backdrop" hidden>
      <section class="editor-dialog" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header class="studio-heading">
          <div><p class="panel-index">PIXEL DETAIL WORKBENCH / 24×24</p><h2 id="editor-title">像素精修</h2></div>
          <button id="close-editor" class="studio-close" type="button" aria-label="关闭">×</button>
        </header>
        <div class="editor-workspace">
          <aside class="editor-palette-panel">
            <div class="editor-section-title"><b>官方色板</b><span>40 COLORS</span></div>
            <div id="editor-palette" class="editor-palette"></div>
          </aside>
          <div class="editor-canvas-panel">
            <canvas id="editor-canvas" width="720" height="720" aria-label="24×24 像素编辑画布"></canvas>
            <p>单击或按住拖动即可修改格子；吸色模式下点击画布选择已有颜色。</p>
          </div>
          <aside class="editor-tool-panel">
            <div class="editor-section-title"><b>精修工具</b><span>LOCAL</span></div>
            <div class="selected-color"><i id="selected-color-swatch"></i><div><span>当前颜色</span><b id="selected-color-name">色板 1-1</b><code id="selected-color-hex">#222222</code></div></div>
            <div class="editor-tool-grid"><button id="brush-tool" class="mini-button is-active" type="button">画笔</button><button id="picker-tool" class="mini-button" type="button">吸色</button></div>
            <div class="editor-tool-grid"><button id="undo-edit" class="mini-button" type="button" disabled>撤销</button><button id="redo-edit" class="mini-button" type="button" disabled>重做</button></div>
            <button id="reset-edit" class="secondary-button full" type="button">恢复进入编辑时的版本</button>
            <div class="studio-note"><b>WHITE</b><span>选择色板中的白色可以擦除格子；白色仍会保留在预览和 JSON 中，但执行时不会绘制。</span></div>
          </aside>
        </div>
        <footer class="editor-actions"><button id="cancel-editor" class="secondary-button" type="button">取消</button><button id="apply-editor" class="secondary-button" type="button">应用并加入模板库</button><button id="save-editor" class="primary-button" type="button"><span>应用并保存 JSON</span><b>DONE</b></button></footer>
      </section>
    </div>
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
let currentJson = "";
let currentTemplateName = "";
let calibration: Partial<Calibration> = loadCalibration();
let savedTemplates = loadSavedTemplates();
let running = false;
let paused = false;
let sourceImage: HTMLImageElement | null = null;
let sourceImageName = "";
let generatedTemplate: GeneratedTemplate | null = null;
let conversionSettings: ConversionSettings = { ...CONVERSION_PRESETS.balanced };
let conversionFrame = 0;
let editorPixels: number[] = [];
let editorOriginalPixels: number[] = [];
let editorUndo: number[][] = [];
let editorRedo: number[][] = [];
let editorSelectedColor = 0;
let editorTool: "brush" | "picker" = "brush";
let editorPainting = false;
let editorSource: "template" | "conversion" = "template";

function fitMainPreview(): void {
  const bounds = dropZone.getBoundingClientRect();
  const size = Math.max(120, Math.min(560, bounds.width - 32, bounds.height - 34));
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
}

new ResizeObserver(fitMainPreview).observe(dropZone);

function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  $("#theme-toggle span").textContent = theme === "dark" ? "☀" : "◐";
}

const storedTheme = localStorage.getItem(THEME_KEY);
setTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$("#platform-badge").lastChild!.textContent = navigator.userAgent.includes("Windows") ? " WINDOWS · LOCAL" : " macOS · LOCAL";

function setMessage(text: string, kind: "info" | "success" | "error"): void {
  message.textContent = text;
  message.className = `message is-${kind}`;
}

function setStep(step: Step): void {
  $("#control-panel").setAttribute("data-current-step", step);
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((node) => node.classList.toggle("is-active", node.dataset.step === step));
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((node) => node.classList.toggle("is-active", node.dataset.view === step));
  if (step === "calibrate") setMessage("依次采集画布两点和色盘第一页两点；坐标仅保存在这台电脑。", "info");
  if (step === "execute") setMessage("先做单格试点。正式启动后有 4 秒切换回游戏窗口。", "info");
}

function loadCalibration(): Partial<Calibration> {
  try { return JSON.parse(localStorage.getItem(CALIBRATION_KEY) ?? "{}"); } catch { return {}; }
}

interface SavedTemplate {
  id: string;
  name: string;
  json: string;
  updatedAt: number;
}

function loadSavedTemplates(): SavedTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]");
    return Array.isArray(value) ? value.slice(0, MAX_SAVED_TEMPLATES) : [];
  } catch {
    return [];
  }
}

function templateFingerprint(json: string): string {
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character]!);
}

function rememberTemplate(name: string, json: string): void {
  const id = templateFingerprint(json);
  savedTemplates = [
    { id, name: name.replace(/\.json$/i, ""), json, updatedAt: Date.now() },
    ...savedTemplates.filter((item) => item.id !== id),
  ].slice(0, MAX_SAVED_TEMPLATES);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(savedTemplates));
  renderTemplateLibrary();
}

function renderTemplateLibrary(): void {
  const builtIns = PRESET_TEMPLATES.map((item) => `
    <button class="template-card is-preset" data-preset="${item.id}" type="button">
      <b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.description)}</span><small>PRESET</small>
    </button>
  `).join("");
  const saved = savedTemplates.map((item) => `
    <div class="template-card saved-template">
      <button data-saved="${item.id}" type="button"><b>${escapeHtml(item.name)}</b><span>本机保存的导入模板</span></button>
      <button class="remove-template" data-remove="${item.id}" type="button" aria-label="删除 ${escapeHtml(item.name)}">×</button>
    </div>
  `).join("");
  $("#template-library").innerHTML = builtIns + saved;
}

function calibrationReady(): boolean {
  return calibration.canvasTopLeft !== undefined
    && calibration.canvasBottomRight !== undefined
    && calibration.paletteTopLeft !== undefined
    && calibration.paletteBottomRight !== undefined;
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
  setMessage("窗口将隐藏，3 秒后读取鼠标位置。请移到游戏目标中心并保持不动…", "info");
  try {
    calibration[key] = await invoke<ScreenPoint>("capture_pointer", { delayMs: 3000 });
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(calibration));
    renderCalibration();
    setMessage("坐标已记录。继续采集下一点。", "success");
  } catch (error) {
    setMessage(String(error), "error");
    renderCalibration();
  }
}

function renderPreview(result: TemplateAnalysis): void {
  renderPreviewColors(result.preview, result.size);
}

function renderPreviewColors(colors: Array<string | null>, size: number): void {
  drawPreview(canvas, colors, size);
}

function drawPreview(target: HTMLCanvasElement, colors: Array<string | null>, size: number): void {
  const context = target.getContext("2d");
  if (!context) return;
  const cellSize = target.width / size;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, target.width, target.height);
  colors.forEach((color, index) => {
    if (!color || color.toUpperCase() === "#FFFFFF") return;
    context.fillStyle = color;
    context.fillRect((index % size) * cellSize, Math.floor(index / size) * cellSize, cellSize, cellSize);
  });
  context.strokeStyle = "rgba(18, 22, 25, .12)";
  context.lineWidth = 1;
  for (let index = 1; index < size; index += 1) {
    const point = index * cellSize;
    context.beginPath(); context.moveTo(point, 0); context.lineTo(point, target.height); context.moveTo(0, point); context.lineTo(target.width, point); context.stroke();
  }
  context.strokeStyle = "#18bbb7";
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(target.width / 2, 0); context.lineTo(target.width / 2, target.height); context.moveTo(0, target.height / 2); context.lineTo(target.width, target.height / 2); context.stroke();
}

function setConversionControls(settings: ConversionSettings): void {
  ($("#conversion-algorithm") as HTMLSelectElement).value = settings.algorithm;
  ($("#conversion-fit") as HTMLSelectElement).value = settings.fit;
  ($("#conversion-edge") as HTMLInputElement).value = String(settings.edgeStrength);
  ($("#conversion-contrast") as HTMLInputElement).value = String(settings.contrast);
  ($("#conversion-saturation") as HTMLInputElement).value = String(settings.saturation);
  ($("#conversion-dither") as HTMLInputElement).checked = settings.dither;
  updateConversionLabels();
}

function readConversionControls(): ConversionSettings {
  return {
    algorithm: ($("#conversion-algorithm") as HTMLSelectElement).value as ConversionSettings["algorithm"],
    fit: ($("#conversion-fit") as HTMLSelectElement).value as ConversionSettings["fit"],
    edgeStrength: Number(($("#conversion-edge") as HTMLInputElement).value),
    contrast: Number(($("#conversion-contrast") as HTMLInputElement).value),
    saturation: Number(($("#conversion-saturation") as HTMLInputElement).value),
    dither: ($("#conversion-dither") as HTMLInputElement).checked,
  };
}

function signedValue(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function updateConversionLabels(): void {
  $("#edge-label").textContent = `${($("#conversion-edge") as HTMLInputElement).value}%`;
  $("#contrast-label").textContent = signedValue(Number(($("#conversion-contrast") as HTMLInputElement).value));
  $("#saturation-label").textContent = signedValue(Number(($("#conversion-saturation") as HTMLInputElement).value));
}

function renderConversionPreview(): void {
  if (!sourceImage) return;
  conversionSettings = readConversionControls();
  generatedTemplate = convertImage(sourceImage, conversionSettings);
  emptyState.hidden = true;
  canvas.classList.add("is-visible");
  templateStatus.textContent = "图片预览";
  templateStatus.className = "status-chip is-ready";
  renderPreviewColors(generatedTemplate.colors, 24);
  drawPreview($("#conversion-preview") as HTMLCanvasElement, generatedTemplate.colors, 24);
}

function queueConversionPreview(): void {
  window.cancelAnimationFrame(conversionFrame);
  conversionFrame = window.requestAnimationFrame(renderConversionPreview);
}

function closeImageStudio(restore = true): void {
  ($("#image-studio") as HTMLDivElement).hidden = true;
  sourceImage = null;
  generatedTemplate = null;
  window.cancelAnimationFrame(conversionFrame);
  if (!restore) return;
  if (analysis) {
    renderPreview(analysis);
    templateStatus.textContent = "校验通过";
    templateStatus.className = "status-chip is-ready";
  } else {
    canvas.classList.remove("is-visible");
    emptyState.hidden = false;
    templateStatus.textContent = "等待导入";
    templateStatus.className = "status-chip";
  }
}

async function openImageStudio(file: File): Promise<void> {
  setMessage("正在本机读取图片并生成 24×24 预览…", "info");
  try {
    sourceImage = await loadImage(file);
    sourceImageName = file.name.replace(/\.[^.]+$/, "") || "像素画模板";
    conversionSettings = { ...CONVERSION_PRESETS.balanced };
    generatedTemplate = null;
    setConversionControls(conversionSettings);
    document.querySelectorAll<HTMLElement>("[data-conversion-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.conversionPreset === "balanced"));
    $("#image-source-detail").textContent = `${file.name} · ${sourceImage.naturalWidth}×${sourceImage.naturalHeight} · 所有处理均在本机完成`;
    ($("#image-studio") as HTMLDivElement).hidden = false;
    renderConversionPreview();
    setMessage("调整方案和参数，左侧会实时显示官方 40 色预览。", "success");
  } catch (error) {
    sourceImage = null;
    setMessage(String(error), "error");
  }
}

async function acceptGeneratedTemplate(saveFile: boolean): Promise<void> {
  if (!generatedTemplate) return;
  const json = generatedTemplate.json;
  const fileName = `${sourceImageName || "像素画模板"}.json`;
  try {
    const result = await invoke<TemplateAnalysis>("analyze_template", { json });
    closeImageStudio(false);
    renderAnalysis(fileName, json, result);
    rememberTemplate(fileName, json);
    if (saveFile) exportCurrentTemplate();
    else setMessage(`${fileName} 已生成并加入本机模板库。`, "success");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

function templatePaletteIndices(json: string): number[] {
  const parsed = JSON.parse(json) as { cells?: Array<{ x?: number; y?: number; hex?: string | null }> };
  if (!Array.isArray(parsed.cells) || parsed.cells.length !== 576) throw new Error("模板必须包含 576 个格子。");
  const pixels = new Array<number>(576).fill(3);
  parsed.cells.forEach((cell) => {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x! < 0 || cell.x! >= 24 || cell.y! < 0 || cell.y! >= 24) throw new Error("模板中存在无效坐标。");
    const paletteIndex = cell.hex ? ARK_PALETTE.findIndex((hex) => hex.toUpperCase() === cell.hex!.toUpperCase()) : 3;
    if (paletteIndex < 0) throw new Error(`模板包含官方色板外的颜色：${cell.hex}`);
    pixels[cell.y! * 24 + cell.x!] = paletteIndex;
  });
  return pixels;
}

function renderEditorPalette(): void {
  $("#editor-palette").innerHTML = ARK_PALETTE.map((hex, index) => `
    <button class="editor-color ${index === editorSelectedColor ? "is-active" : ""}" data-editor-color="${index}" type="button" aria-label="色板 ${Math.floor(index / 4) + 1}-${index % 4 + 1} ${hex}">
      <i style="--editor-color:${hex}"></i><span>${Math.floor(index / 4) + 1}-${index % 4 + 1}</span>
    </button>
  `).join("");
}

function selectEditorColor(index: number): void {
  editorSelectedColor = index;
  const hex = ARK_PALETTE[index];
  $("#selected-color-swatch").setAttribute("style", `--editor-color:${hex}`);
  $("#selected-color-name").textContent = `色板 ${Math.floor(index / 4) + 1}-${index % 4 + 1}`;
  $("#selected-color-hex").textContent = hex;
  renderEditorPalette();
}

function setEditorTool(tool: "brush" | "picker"): void {
  editorTool = tool;
  $("#brush-tool").classList.toggle("is-active", tool === "brush");
  $("#picker-tool").classList.toggle("is-active", tool === "picker");
}

function drawEditor(): void {
  const target = $("#editor-canvas") as HTMLCanvasElement;
  const context = target.getContext("2d");
  if (!context) return;
  const cellSize = target.width / 24;
  editorPixels.forEach((paletteIndex, index) => {
    context.fillStyle = ARK_PALETTE[paletteIndex];
    context.fillRect((index % 24) * cellSize, Math.floor(index / 24) * cellSize, cellSize, cellSize);
  });
  context.strokeStyle = "rgba(18, 22, 25, .18)";
  context.lineWidth = 1;
  for (let index = 0; index <= 24; index += 1) {
    const point = index * cellSize;
    context.beginPath();
    context.moveTo(point, 0); context.lineTo(point, target.height);
    context.moveTo(0, point); context.lineTo(target.width, point);
    context.stroke();
  }
  context.strokeStyle = "#18bbb7";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(target.width / 2, 0); context.lineTo(target.width / 2, target.height);
  context.moveTo(0, target.height / 2); context.lineTo(target.width, target.height / 2);
  context.stroke();
}

function updateEditorHistoryButtons(): void {
  ($("#undo-edit") as HTMLButtonElement).disabled = editorUndo.length === 0;
  ($("#redo-edit") as HTMLButtonElement).disabled = editorRedo.length === 0;
}

function rememberEditorState(): void {
  editorUndo.push([...editorPixels]);
  if (editorUndo.length > 60) editorUndo.shift();
  editorRedo = [];
  updateEditorHistoryButtons();
}

function editorCellFromEvent(event: PointerEvent): number | null {
  const target = $("#editor-canvas") as HTMLCanvasElement;
  const bounds = target.getBoundingClientRect();
  const x = Math.floor((event.clientX - bounds.left) / bounds.width * 24);
  const y = Math.floor((event.clientY - bounds.top) / bounds.height * 24);
  return x >= 0 && x < 24 && y >= 0 && y < 24 ? y * 24 + x : null;
}

function applyEditorPointer(event: PointerEvent): void {
  const index = editorCellFromEvent(event);
  if (index === null) return;
  if (editorTool === "picker") {
    selectEditorColor(editorPixels[index]);
    setEditorTool("brush");
    return;
  }
  if (editorPixels[index] === editorSelectedColor) return;
  editorPixels[index] = editorSelectedColor;
  drawEditor();
}

function openPixelEditor(source: "template" | "conversion"): void {
  try {
    const pixels = source === "conversion"
      ? generatedTemplate?.paletteIndices
      : currentJson ? templatePaletteIndices(currentJson) : null;
    if (!pixels) return setMessage("请先导入或生成一个模板。", "error");
    editorSource = source;
    editorPixels = [...pixels];
    editorOriginalPixels = [...pixels];
    editorUndo = [];
    editorRedo = [];
    editorSelectedColor = editorPixels.find((index) => index !== 3) ?? 0;
    setEditorTool("brush");
    selectEditorColor(editorSelectedColor);
    updateEditorHistoryButtons();
    drawEditor();
    ($("#pixel-editor") as HTMLDivElement).hidden = false;
  } catch (error) {
    setMessage(String(error), "error");
  }
}

function closePixelEditor(): void {
  editorPainting = false;
  ($("#pixel-editor") as HTMLDivElement).hidden = true;
}

async function acceptEditedTemplate(saveFile: boolean): Promise<void> {
  try {
    const generated = createTemplateFromPaletteIndices(editorPixels);
    const result = await invoke<TemplateAnalysis>("analyze_template", { json: generated.json });
    const fileName = editorSource === "conversion" ? `${sourceImageName || "像素画模板"}.json` : `${currentTemplateName || "像素画模板"}.json`;
    closePixelEditor();
    if (editorSource === "conversion") closeImageStudio(false);
    renderAnalysis(fileName, generated.json, result);
    rememberTemplate(fileName, generated.json);
    if (saveFile) exportCurrentTemplate();
    else setMessage(`${fileName} 的精修结果已应用并加入模板库。`, "success");
  } catch (error) {
    setMessage(String(error), "error");
  }
}

function groupMarkup(group: ColorGroup): string {
  return `<div class="color-task"><i style="--swatch:${group.hex}"></i><div><b>色板 ${group.paletteRow}-${group.paletteColumn}</b><span>${group.cellCount} 格 · ${group.cellCount} 次精确单击</span></div><code>${group.hex}</code></div>`;
}

function renderAnalysis(fileName: string, json: string, result: TemplateAnalysis): void {
  analysis = result;
  currentJson = json;
  currentTemplateName = fileName.replace(/\.json$/i, "");
  emptyState.hidden = true;
  canvas.classList.add("is-visible");
  templateStatus.textContent = "校验通过";
  templateStatus.className = "status-chip is-ready";
  $("#painted-count").textContent = String(result.paintedCells);
  $("#color-count").textContent = String(result.colorCount);
  $("#stroke-count").textContent = String(result.paintedCells);
  $("#drag-count").textContent = "0";
  $("#color-groups").innerHTML = result.groups.map(groupMarkup).join("");
  $("#execution-name").textContent = fileName;
  $("#execution-detail").textContent = `${result.paintedCells} 个非白格 · ${result.colorCount} 色 · 精确单击模式`;
  primaryImport.disabled = false;
  ($("#export-template") as HTMLButtonElement).disabled = false;
  ($("#edit-template") as HTMLButtonElement).disabled = false;
  primaryImport.querySelector("b")!.textContent = "READY";
  testButton.disabled = !calibrationReady();
  startButton.disabled = !calibrationReady();
  setMessage(`${fileName} 已载入；白色格保持空白，其余 ${result.paintedCells} 格将逐格精确单击。`, "success");
  renderPreview(result);
}

async function loadTemplate(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) return setMessage("请选择 JSON 模板文件。", "error");
  setMessage("正在校验模板并生成绘制任务…", "info");
  try {
    const json = await file.text();
    const result = await invoke<TemplateAnalysis>("analyze_template", { json });
    renderAnalysis(file.name, json, result);
    rememberTemplate(file.name, json);
  }
  catch (error) { templateStatus.textContent = "模板无效"; templateStatus.className = "status-chip is-error"; setMessage(String(error), "error"); }
}

async function loadInputFile(file: File): Promise<void> {
  if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") await loadTemplate(file);
  else if (file.type.startsWith("image/")) await openImageStudio(file);
  else setMessage("请选择 JSON 模板或常见图片文件。", "error");
}

async function loadLibraryTemplate(name: string, json: string): Promise<void> {
  setMessage("正在载入模板库内容…", "info");
  try {
    const result = await invoke<TemplateAnalysis>("analyze_template", { json });
    renderAnalysis(`${name}.json`, json, result);
  } catch (error) {
    setMessage(String(error), "error");
  }
}

function exportCurrentTemplate(): void {
  if (!currentJson) return;
  const blob = new Blob([currentJson], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeName = (currentTemplateName || "ark-beads-template").replace(/[\\/:*?"<>|]/g, "-");
  anchor.download = `${safeName}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setMessage("当前模板已导出为 JSON 文件。", "success");
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
  setMessage("窗口将隐藏，3 秒后执行单格试点。", "info");
  try {
    await invoke("test_cell", { calibration: calibration as Calibration, paletteRow: group.paletteRow, paletteColumn: group.paletteColumn, cell, delayMs: Number(speed.value), countdownMs: 3000 });
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
  setMessage("窗口将隐藏；4 秒后开始绘制，结束或停止后自动恢复。", "info");
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

$("#choose-file").addEventListener("click", () => { fileInput.accept = "application/json,.json"; fileInput.click(); });
$("#choose-image").addEventListener("click", () => { fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp"; fileInput.click(); });
$("#edit-template").addEventListener("click", () => openPixelEditor("template"));
$("#export-template").addEventListener("click", exportCurrentTemplate);
$("#template-library").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const removeButton = target.closest<HTMLElement>("[data-remove]");
  if (removeButton?.dataset.remove) {
    savedTemplates = savedTemplates.filter((item) => item.id !== removeButton.dataset.remove);
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(savedTemplates));
    renderTemplateLibrary();
    setMessage("已从本机模板库移除。", "info");
    return;
  }
  const presetButton = target.closest<HTMLElement>("[data-preset]");
  if (presetButton?.dataset.preset) {
    const preset = PRESET_TEMPLATES.find((item) => item.id === presetButton.dataset.preset);
    if (preset) void loadLibraryTemplate(preset.name, preset.json);
    return;
  }
  const savedButton = target.closest<HTMLElement>("[data-saved]");
  if (savedButton?.dataset.saved) {
    const saved = savedTemplates.find((item) => item.id === savedButton.dataset.saved);
    if (saved) void loadLibraryTemplate(saved.name, saved.json);
  }
});
dropZone.addEventListener("click", (event) => {
  if (event.target !== canvas) {
    fileInput.accept = "application/json,.json,image/png,image/jpeg,image/webp,image/gif,image/bmp";
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadInputFile(file);
  fileInput.value = "";
});
for (const name of ["dragenter", "dragover"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); });
for (const name of ["dragleave", "drop"]) dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); });
dropZone.addEventListener("drop", (event) => { const file = event.dataTransfer?.files[0]; if (file) void loadInputFile(file); });
document.querySelectorAll<HTMLButtonElement>("[data-conversion-preset]").forEach((button) => button.addEventListener("click", () => {
  const preset = button.dataset.conversionPreset as ConversionPreset;
  conversionSettings = { ...CONVERSION_PRESETS[preset] };
  setConversionControls(conversionSettings);
  document.querySelectorAll<HTMLElement>("[data-conversion-preset]").forEach((item) => item.classList.toggle("is-active", item === button));
  queueConversionPreview();
}));
for (const selector of ["#conversion-algorithm", "#conversion-fit", "#conversion-edge", "#conversion-contrast", "#conversion-saturation", "#conversion-dither"]) {
  $(selector).addEventListener("input", () => {
    document.querySelectorAll<HTMLElement>("[data-conversion-preset]").forEach((item) => item.classList.remove("is-active"));
    updateConversionLabels();
    queueConversionPreview();
  });
}
$("#close-studio").addEventListener("click", () => closeImageStudio());
$("#cancel-conversion").addEventListener("click", () => closeImageStudio());
$("#edit-conversion").addEventListener("click", () => openPixelEditor("conversion"));
$("#use-conversion").addEventListener("click", () => void acceptGeneratedTemplate(false));
$("#save-conversion").addEventListener("click", () => void acceptGeneratedTemplate(true));
$("#image-studio").addEventListener("click", (event) => { if (event.target === $("#image-studio")) closeImageStudio(); });
$("#editor-palette").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-editor-color]");
  if (button?.dataset.editorColor !== undefined) {
    selectEditorColor(Number(button.dataset.editorColor));
    setEditorTool("brush");
  }
});
$("#brush-tool").addEventListener("click", () => setEditorTool("brush"));
$("#picker-tool").addEventListener("click", () => setEditorTool("picker"));
$("#undo-edit").addEventListener("click", () => {
  const previous = editorUndo.pop();
  if (!previous) return;
  editorRedo.push([...editorPixels]);
  editorPixels = previous;
  drawEditor();
  updateEditorHistoryButtons();
});
$("#redo-edit").addEventListener("click", () => {
  const next = editorRedo.pop();
  if (!next) return;
  editorUndo.push([...editorPixels]);
  editorPixels = next;
  drawEditor();
  updateEditorHistoryButtons();
});
$("#reset-edit").addEventListener("click", () => {
  rememberEditorState();
  editorPixels = [...editorOriginalPixels];
  drawEditor();
  updateEditorHistoryButtons();
});
const editorCanvas = $("#editor-canvas") as HTMLCanvasElement;
editorCanvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (editorTool === "brush") rememberEditorState();
  editorPainting = editorTool === "brush";
  editorCanvas.setPointerCapture(event.pointerId);
  applyEditorPointer(event);
});
editorCanvas.addEventListener("pointermove", (event) => { if (editorPainting) applyEditorPointer(event); });
editorCanvas.addEventListener("pointerup", () => { editorPainting = false; });
editorCanvas.addEventListener("pointercancel", () => { editorPainting = false; });
$("#close-editor").addEventListener("click", closePixelEditor);
$("#cancel-editor").addEventListener("click", closePixelEditor);
$("#apply-editor").addEventListener("click", () => void acceptEditedTemplate(false));
$("#save-editor").addEventListener("click", () => void acceptEditedTemplate(true));
$("#pixel-editor").addEventListener("click", (event) => { if (event.target === $("#pixel-editor")) closePixelEditor(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!($("#pixel-editor") as HTMLDivElement).hidden) closePixelEditor();
  else if (!($("#image-studio") as HTMLDivElement).hidden) closeImageStudio();
});
document.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.step as Step;
  if (target === "import" || target === "calibrate" || (target === "execute" && analysis && calibrationReady())) setStep(target);
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
renderTemplateLibrary();
