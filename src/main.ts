import { invoke } from "@tauri-apps/api/core";
import "./styles.css";
import type { ColorGroup, TemplateAnalysis } from "./types";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("无法初始化应用界面");
}

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div>
          <p class="eyebrow">OFFLINE BEAD AUTOMATION</p>
          <h1>ARK <strong>BEADS</strong></h1>
        </div>
      </div>
      <div class="platform-badge"><i></i> macOS · 本地运行</div>
    </header>

    <section class="workflow" aria-label="工作流程">
      <div class="workflow-step is-active"><b>01</b><span>导入模板</span></div>
      <div class="workflow-line"></div>
      <div class="workflow-step"><b>02</b><span>校准界面</span></div>
      <div class="workflow-line"></div>
      <div class="workflow-step"><b>03</b><span>执行绘制</span></div>
    </section>

    <section class="workspace">
      <div class="preview-panel panel">
        <div class="panel-heading">
          <div>
            <p class="panel-index">PREVIEW / 24×24</p>
            <h2>模板预览</h2>
          </div>
          <span id="template-status" class="status-chip">等待导入</span>
        </div>

        <div id="drop-zone" class="drop-zone">
          <canvas id="preview" width="576" height="576" aria-label="拼豆模板预览"></canvas>
          <div id="empty-state" class="empty-state">
            <div class="file-glyph" aria-hidden="true">JSON</div>
            <strong>拖入模板文件</strong>
            <span>或点击此处选择网站导出的 JSON</span>
          </div>
          <input id="file-input" type="file" accept="application/json,.json" />
        </div>

        <div class="preview-footer">
          <span>白色与透明格将保持画布空白</span>
          <button id="choose-file" class="text-button" type="button">重新选择</button>
        </div>
      </div>

      <aside class="control-panel panel">
        <div class="panel-heading compact">
          <div>
            <p class="panel-index">MISSION DATA</p>
            <h2>绘制任务</h2>
          </div>
        </div>

        <div id="message" class="message is-info">请导入来自 prts.chongxi.us 的模板。</div>

        <dl class="metrics">
          <div><dt>有效格子</dt><dd id="painted-count">—</dd></div>
          <div><dt>使用颜色</dt><dd id="color-count">—</dd></div>
          <div><dt>预计操作</dt><dd id="stroke-count">—</dd></div>
          <div><dt>连续拖动</dt><dd id="drag-count">—</dd></div>
        </dl>

        <div class="section-label"><span>调色板任务</span><i></i></div>
        <div id="color-groups" class="color-groups">
          <p class="placeholder-copy">导入后将按调色板顺序生成任务</p>
        </div>

        <div class="safety-note">
          <b>执行前提</b>
          <span>请从全新空白画布开始。程序不会点击保存或发布。</span>
        </div>

        <button class="primary-button" type="button" disabled>
          <span>下一步：校准界面</span>
          <b>LOCKED</b>
        </button>
      </aside>
    </section>
  </main>
`;

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const chooseFileButton = document.querySelector<HTMLButtonElement>("#choose-file")!;
const dropZone = document.querySelector<HTMLDivElement>("#drop-zone")!;
const emptyState = document.querySelector<HTMLDivElement>("#empty-state")!;
const canvas = document.querySelector<HTMLCanvasElement>("#preview")!;
const templateStatus = document.querySelector<HTMLSpanElement>("#template-status")!;
const message = document.querySelector<HTMLDivElement>("#message")!;
const paintedCount = document.querySelector<HTMLElement>("#painted-count")!;
const colorCount = document.querySelector<HTMLElement>("#color-count")!;
const strokeCount = document.querySelector<HTMLElement>("#stroke-count")!;
const dragCount = document.querySelector<HTMLElement>("#drag-count")!;
const colorGroups = document.querySelector<HTMLDivElement>("#color-groups")!;
const primaryButton = document.querySelector<HTMLButtonElement>(".primary-button")!;

function setMessage(text: string, kind: "info" | "success" | "error"): void {
  message.textContent = text;
  message.className = `message is-${kind}`;
}

function renderPreview(analysis: TemplateAnalysis): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const cellSize = canvas.width / analysis.size;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  analysis.preview.forEach((color, index) => {
    if (!color || color.toUpperCase() === "#FFFFFF") return;
    const x = index % analysis.size;
    const y = Math.floor(index / analysis.size);
    context.fillStyle = color;
    context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
  });

  context.strokeStyle = "rgba(17, 21, 26, 0.12)";
  context.lineWidth = 1;
  for (let index = 1; index < analysis.size; index += 1) {
    const point = index * cellSize;
    context.beginPath();
    context.moveTo(point, 0);
    context.lineTo(point, canvas.height);
    context.moveTo(0, point);
    context.lineTo(canvas.width, point);
    context.stroke();
  }

  context.strokeStyle = "#1ca7a2";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(canvas.width / 2, 0);
  context.lineTo(canvas.width / 2, canvas.height);
  context.moveTo(0, canvas.height / 2);
  context.lineTo(canvas.width, canvas.height / 2);
  context.stroke();
}

function groupMarkup(group: ColorGroup): string {
  const label = `${group.paletteRow}-${group.paletteColumn}`;
  return `
    <div class="color-task">
      <i style="--swatch: ${group.hex}"></i>
      <div><b>色板 ${label}</b><span>${group.cellCount} 格 · ${group.strokes.length} 次操作</span></div>
      <code>${group.hex}</code>
    </div>
  `;
}

function renderAnalysis(fileName: string, analysis: TemplateAnalysis): void {
  emptyState.hidden = true;
  canvas.classList.add("is-visible");
  templateStatus.textContent = "校验通过";
  templateStatus.className = "status-chip is-ready";
  paintedCount.textContent = String(analysis.paintedCells);
  colorCount.textContent = String(analysis.colorCount);
  strokeCount.textContent = String(analysis.strokeCount);
  dragCount.textContent = String(analysis.dragStrokeCount);
  colorGroups.innerHTML = analysis.groups.map(groupMarkup).join("");
  primaryButton.disabled = false;
  primaryButton.querySelector("span")!.textContent = "下一步：校准界面";
  primaryButton.querySelector("b")!.textContent = "READY";
  setMessage(
    `${fileName} 已载入；跳过 ${analysis.skippedWhite} 个白色格和 ${analysis.skippedTransparent} 个透明格。`,
    "success",
  );
  renderPreview(analysis);
}

async function loadTemplate(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    setMessage("请选择 JSON 模板文件。", "error");
    return;
  }

  setMessage("正在校验模板并生成绘制任务…", "info");
  try {
    const json = await file.text();
    const analysis = await invoke<TemplateAnalysis>("analyze_template", { json });
    renderAnalysis(file.name, analysis);
  } catch (error) {
    templateStatus.textContent = "模板无效";
    templateStatus.className = "status-chip is-error";
    setMessage(String(error), "error");
  }
}

chooseFileButton.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("click", (event) => {
  if (event.target !== canvas) fileInput.click();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void loadTemplate(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
}

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files[0];
  if (file) void loadTemplate(file);
});

primaryButton.addEventListener("click", () => {
  setMessage("模板任务已就绪。下一阶段将接入游戏界面校准。", "info");
});
