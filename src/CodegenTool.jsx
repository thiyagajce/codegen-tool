import { useState, useRef, useCallback } from "react";

const TABS = ["Requirements", "Design", "Codebase", "API Spec"];
const LAYER_LABELS = {
  frontend: "React Component",
  backend_node: "Node.js Service",
  backend_java: "Java Service",
  api: "API Route / Controller",
  test: "Test Suite",
};

const STACK_TARGETS = [
  { id: "frontend", label: "React Component", icon: "⚛️" },
  { id: "backend_node", label: "Node.js Service", icon: "🟩" },
  { id: "backend_java", label: "Java Service", icon: "☕" },
  { id: "api", label: "API Route", icon: "🔌" },
  { id: "test", label: "Test Suite", icon: "🧪" },
];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildSystemPrompt(targets) {
  return `You are an expert full-stack code generator for a React + Node.js/Java codebase.

Your task: Generate production-ready code that strictly follows the existing codebase conventions, naming patterns, and architectural style shown in the reference files.

Rules:
- Match the exact file structure, import style, naming conventions, and patterns from the provided code references.
- For React: use the same hooks patterns, component structure, styling approach (CSS modules / Tailwind / styled-components — match what you see).
- For Node.js: match the same middleware patterns, error handling, and service/controller split.
- For Java: match the same package structure, annotations, and Spring Boot/Quarkus patterns.
- If an OpenAPI spec is provided, match the exact endpoint paths, request/response shapes, and HTTP methods.
- If a Figma design image is provided, implement the UI to match the layout, spacing, component hierarchy, and visual intent shown.
- Generate ONLY the requested layer(s): ${targets.map((t) => LAYER_LABELS[t]).join(", ")}.
- Output each file in a clearly labelled code block: \`\`\`filename.ext
- Do NOT generate placeholder comments like "// TODO: implement". Write complete, working code.
- After the code, add a brief "Convention notes" section explaining which patterns from the reference you followed.`;
}

function buildUserPrompt({ requirement, codeFiles, apiSpec, targets }) {
  let prompt = `## Business Requirement\n${requirement}\n\n`;

  if (apiSpec.trim()) {
    prompt += `## API Contract (OpenAPI/Spec)\n\`\`\`yaml\n${apiSpec}\n\`\`\`\n\n`;
  }

  if (codeFiles.length > 0) {
    prompt += `## Existing Codebase Reference\n`;
    for (const f of codeFiles) {
      prompt += `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\`\n\n`;
    }
  }

  prompt += `## Generate the following layer(s): ${targets.map((t) => LAYER_LABELS[t]).join(", ")}`;
  return prompt;
}

// ─── Drag-drop file zone ────────────────────────────────────────────
function DropZone({ label, accept, multiple = false, files, onFiles, hint }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      onFiles(multiple ? dropped : [dropped[0]]);
    },
    [multiple, onFiles]
  );

  return (
    <div
      className={`drop-zone${dragging ? " dragging" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: "none" }}
        onChange={(e) => onFiles(Array.from(e.target.files))}
      />
      {files.length === 0 ? (
        <>
          <div className="drop-icon">↑</div>
          <div className="drop-label">{label}</div>
          {hint && <div className="drop-hint">{hint}</div>}
        </>
      ) : (
        <div className="drop-files">
          {files.map((f, i) => (
            <span key={i} className="file-chip">{f.name}</span>
          ))}
          <span className="drop-hint">Click to change</span>
        </div>
      )}
    </div>
  );
}

// ─── Code block with copy ───────────────────────────────────────────
function CodeOutput({ text }) {
  const [copied, setCopied] = useState(false);
  const blocks = [];
  const regex = /```(\S+)?\n([\s\S]*?)```/g;
  let match;
  let lastIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      blocks.push({ type: "prose", content: text.slice(lastIdx, match.index) });
    }
    blocks.push({ type: "code", lang: match[1] || "text", content: match[2] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    blocks.push({ type: "prose", content: text.slice(lastIdx) });
  }

  return (
    <div className="code-output">
      {blocks.map((b, i) =>
        b.type === "prose" ? (
          <p key={i} className="prose-block">{b.content.trim()}</p>
        ) : (
          <div key={i} className="code-block">
            <div className="code-header">
              <span className="code-lang">{b.lang}</span>
              <button
                className="copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(b.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre><code>{b.content}</code></pre>
          </div>
        )
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────
export default function CodeGenTool() {
  const [activeTab, setActiveTab] = useState(0);
  const [requirement, setRequirement] = useState("");
  const [figmaFiles, setFigmaFiles] = useState([]);
  const [codeFiles, setCodeFiles] = useState([]);
  const [apiSpec, setApiSpec] = useState("");
  const [apiFiles, setApiFiles] = useState([]);
  const [targets, setTargets] = useState(["frontend"]);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [readFiles, setReadFiles] = useState([]);

  const toggleTarget = (id) =>
    setTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );

  // Read uploaded code files as text
  const handleCodeFiles = async (files) => {
    setCodeFiles(files);
    const read = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        content: await f.text(),
      }))
    );
    setReadFiles(read);
  };

  // Read API spec files as text
  const handleApiFiles = async (files) => {
    setApiFiles(files);
    if (files[0]) {
      const text = await files[0].text();
      setApiSpec(text);
    }
  };

  const generate = async () => {
    if (!requirement.trim()) {
      setError("Please enter a business requirement.");
      return;
    }
    if (targets.length === 0) {
      setError("Select at least one layer to generate.");
      return;
    }
    setError("");
    setLoading(true);
    setOutput("");

    try {
      // Build message content (multimodal if figma image)
      const userContent = [];

      if (figmaFiles.length > 0) {
        for (const f of figmaFiles) {
          const b64 = await fileToBase64(f);
          const mediaType = f.type || "image/png";
          userContent.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          });
        }
        userContent.push({
          type: "text",
          text: "The image(s) above are Figma design screens. Implement the UI to match them faithfully.\n\n" +
            buildUserPrompt({ requirement, codeFiles: readFiles, apiSpec, targets }),
        });
      } else {
        userContent.push({
          type: "text",
          text: buildUserPrompt({ requirement, codeFiles: readFiles, apiSpec, targets }),
        });
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: buildSystemPrompt(targets),
          messages: [{ role: "user", content: userContent }],
        }),
      });

      const data = await resp.json();
      const text = data.content?.map((b) => b.text || "").join("\n") || "";
      setOutput(text || "No output returned.");
    } catch (e) {
      setError("API call failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabComplete = [
    requirement.trim().length > 0,
    true, // figma optional
    true, // code files optional
    true, // api spec optional
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body { background: #0b0f1a; }

        .app {
          min-height: 100vh;
          background: #0b0f1a;
          color: #e2e8f0;
          font-family: 'DM Mono', monospace;
          display: flex;
          flex-direction: column;
        }

        .header {
          padding: 28px 40px 0;
          border-bottom: 1px solid #1e2a3a;
        }
        .header-top {
          display: flex;
          align-items: baseline;
          gap: 14px;
          margin-bottom: 24px;
        }
        .logo {
          font-family: 'Syne', sans-serif;
          font-size: 22px;
          font-weight: 800;
          color: #e2e8f0;
          letter-spacing: -0.5px;
        }
        .logo span { color: #38bdf8; }
        .badge {
          font-size: 10px;
          background: #1e3a52;
          color: #38bdf8;
          padding: 2px 8px;
          border-radius: 20px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .tabs {
          display: flex;
          gap: 0;
        }
        .tab {
          padding: 10px 22px;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          background: transparent;
          border: none;
          color: #4a5568;
          cursor: pointer;
          position: relative;
          transition: color 0.2s;
          display: flex;
          align-items: center;
          gap: 7px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .tab.active {
          color: #38bdf8;
        }
        .tab.active::after {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 2px;
          background: #38bdf8;
          border-radius: 2px 2px 0 0;
        }
        .tab:hover:not(.active) { color: #94a3b8; }
        .tab-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #38bdf8;
          display: none;
        }
        .tab.done .tab-dot { display: block; }

        .main {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
          flex: 1;
          min-height: 0;
        }

        .panel {
          padding: 32px 40px;
          border-right: 1px solid #1e2a3a;
          overflow-y: auto;
          max-height: calc(100vh - 120px);
        }
        .panel-right {
          padding: 32px 40px;
          overflow-y: auto;
          max-height: calc(100vh - 120px);
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .tab-panel { display: none; }
        .tab-panel.active { display: block; }

        .section-label {
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #4a5568;
          margin-bottom: 10px;
          font-weight: 500;
        }

        textarea {
          width: 100%;
          background: #111827;
          border: 1px solid #1e2a3a;
          border-radius: 8px;
          color: #e2e8f0;
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          padding: 14px 16px;
          resize: vertical;
          outline: none;
          transition: border-color 0.2s;
          line-height: 1.6;
        }
        textarea:focus { border-color: #38bdf8; }
        textarea::placeholder { color: #2d3748; }

        .drop-zone {
          border: 1.5px dashed #1e2a3a;
          border-radius: 8px;
          padding: 28px 20px;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          background: #0d1424;
        }
        .drop-zone:hover, .drop-zone.dragging {
          border-color: #38bdf8;
          background: #0d1e2e;
        }
        .drop-icon {
          font-size: 22px;
          margin-bottom: 8px;
          color: #2d4a6a;
        }
        .drop-label {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 4px;
        }
        .drop-hint {
          font-size: 11px;
          color: #2d3748;
          margin-top: 4px;
        }
        .drop-files {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          align-items: center;
        }
        .file-chip {
          background: #1a2a3a;
          color: #38bdf8;
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 4px;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .targets-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-top: 4px;
        }
        .target-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: #0d1424;
          border: 1.5px solid #1e2a3a;
          border-radius: 8px;
          color: #4a5568;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }
        .target-btn.selected {
          border-color: #38bdf8;
          color: #e2e8f0;
          background: #0d1e2e;
        }
        .target-btn:hover:not(.selected) {
          border-color: #2d4a6a;
          color: #94a3b8;
        }

        .spacer { height: 20px; }
        .spacer-sm { height: 12px; }

        .generate-btn {
          width: 100%;
          padding: 14px;
          background: #38bdf8;
          color: #0b0f1a;
          border: none;
          border-radius: 8px;
          font-family: 'Syne', sans-serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
          text-transform: uppercase;
        }
        .generate-btn:hover:not(:disabled) {
          background: #7dd3fc;
        }
        .generate-btn:active:not(:disabled) { transform: scale(0.99); }
        .generate-btn:disabled {
          background: #1e3a52;
          color: #2d4a6a;
          cursor: not-allowed;
        }

        .error-msg {
          font-size: 12px;
          color: #f87171;
          padding: 10px 14px;
          background: #1f1010;
          border: 1px solid #4a1010;
          border-radius: 6px;
        }

        .output-placeholder {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #1e2a3a;
          text-align: center;
        }
        .output-placeholder-icon { font-size: 40px; }
        .output-placeholder-text {
          font-size: 13px;
          line-height: 1.7;
          max-width: 280px;
        }

        .loader {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          flex: 1;
        }
        .loader-dots {
          display: flex;
          gap: 6px;
        }
        .loader-dots span {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #38bdf8;
          animation: pulse 1.2s ease-in-out infinite;
        }
        .loader-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loader-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        .loader-text {
          font-size: 12px;
          color: #4a5568;
          letter-spacing: 0.06em;
        }

        .code-output { display: flex; flex-direction: column; gap: 14px; }
        .prose-block {
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.7;
          white-space: pre-wrap;
        }
        .code-block {
          background: #080c14;
          border: 1px solid #1e2a3a;
          border-radius: 8px;
          overflow: hidden;
        }
        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px;
          background: #0d1424;
          border-bottom: 1px solid #1e2a3a;
        }
        .code-lang {
          font-size: 11px;
          color: #38bdf8;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .copy-btn {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          background: transparent;
          border: 1px solid #1e2a3a;
          color: #4a5568;
          padding: 3px 10px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .copy-btn:hover { border-color: #38bdf8; color: #38bdf8; }
        pre {
          padding: 16px;
          overflow-x: auto;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          line-height: 1.7;
          color: #cbd5e1;
        }

        .output-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .output-title {
          font-family: 'Syne', sans-serif;
          font-size: 14px;
          font-weight: 700;
          color: #38bdf8;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .regen-btn {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          background: transparent;
          border: 1px solid #1e2a3a;
          color: #4a5568;
          padding: 5px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .regen-btn:hover { border-color: #38bdf8; color: #38bdf8; }

        @media (max-width: 900px) {
          .main { grid-template-columns: 1fr; }
          .panel { border-right: none; border-bottom: 1px solid #1e2a3a; }
          .panel, .panel-right { max-height: none; }
        }
      `}</style>

      <div className="app">
        <div className="header">
          <div className="header-top">
            <div className="logo">code<span>gen</span></div>
            <div className="badge">React + Node / Java</div>
          </div>
          <div className="tabs">
            {TABS.map((t, i) => (
              <button
                key={t}
                className={`tab${activeTab === i ? " active" : ""}${tabComplete[i] && i !== activeTab ? " done" : ""}`}
                onClick={() => setActiveTab(i)}
              >
                <span className="tab-dot" />
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="main">
          {/* LEFT PANEL */}
          <div className="panel">
            {/* Tab 0: Requirements */}
            <div className={`tab-panel${activeTab === 0 ? " active" : ""}`}>
              <div className="section-label">Business Requirement / Enhancement</div>
              <textarea
                rows={10}
                placeholder={`Describe the feature or enhancement in detail.\n\nExample:\n"Add a multi-select filter panel to the Queue Management screen. Users should be able to filter by status, agent, and date range. On apply, the table should reload with filtered results via GET /api/queues?filters=..."`}
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
              />
              <div className="spacer" />
              <div className="section-label">Generate Layers</div>
              <div className="targets-grid">
                {STACK_TARGETS.map((t) => (
                  <button
                    key={t.id}
                    className={`target-btn${targets.includes(t.id) ? " selected" : ""}`}
                    onClick={() => toggleTarget(t.id)}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab 1: Design */}
            <div className={`tab-panel${activeTab === 1 ? " active" : ""}`}>
              <div className="section-label">Figma Screens / Design Images</div>
              <DropZone
                label="Drop Figma screenshots or exported images"
                accept="image/*"
                multiple
                files={figmaFiles}
                onFiles={setFigmaFiles}
                hint="PNG, JPG, WebP — exported from Figma or design tool"
              />
              <div className="spacer" />
              <div className="section-label" style={{ color: "#2d3748" }}>
                Tip: Export each screen as PNG from Figma (File → Export) and drop here. The AI will match the layout, spacing, and component hierarchy.
              </div>
            </div>

            {/* Tab 2: Codebase */}
            <div className={`tab-panel${activeTab === 2 ? " active" : ""}`}>
              <div className="section-label">Reference Code Files</div>
              <DropZone
                label="Drop existing component / service files"
                accept=".js,.jsx,.ts,.tsx,.java,.json,.css,.scss"
                multiple
                files={codeFiles}
                onFiles={handleCodeFiles}
                hint="Drop files that show the patterns and conventions to follow"
              />
              <div className="spacer" />
              <div className="section-label" style={{ color: "#2d3748" }}>
                Tip: Upload 2–3 representative files — a component, a service, and a test. The AI will mirror their structure exactly.
              </div>
            </div>

            {/* Tab 3: API Spec */}
            <div className={`tab-panel${activeTab === 3 ? " active" : ""}`}>
              <div className="section-label">OpenAPI / API Contract File</div>
              <DropZone
                label="Drop OpenAPI spec (.yaml / .json)"
                accept=".yaml,.yml,.json"
                multiple={false}
                files={apiFiles}
                onFiles={handleApiFiles}
                hint="OpenAPI 3.x or Swagger 2.x spec"
              />
              <div className="spacer-sm" />
              <div className="section-label">Or paste spec directly</div>
              <textarea
                rows={10}
                placeholder="Paste OpenAPI YAML or JSON here..."
                value={apiSpec}
                onChange={(e) => setApiSpec(e.target.value)}
                style={{ fontFamily: "'DM Mono', monospace", fontSize: "12px" }}
              />
            </div>
          </div>

          {/* RIGHT PANEL — Output */}
          <div className="panel-right">
            <div className="output-header">
              <div className="output-title">Generated Code</div>
              {output && (
                <button className="regen-btn" onClick={generate} disabled={loading}>
                  ↺ Regenerate
                </button>
              )}
            </div>

            {error && <div className="error-msg">⚠ {error}</div>}

            {loading ? (
              <div className="loader">
                <div className="loader-dots">
                  <span /><span /><span />
                </div>
                <div className="loader-text">Analysing context · generating code…</div>
              </div>
            ) : output ? (
              <CodeOutput text={output} />
            ) : (
              <div className="output-placeholder">
                <div className="output-placeholder-icon">⌥</div>
                <div className="output-placeholder-text">
                  Fill in Requirements, upload your Figma screens, drop reference code files and API spec — then generate.
                </div>
              </div>
            )}

            {!output && !loading && (
              <div style={{ marginTop: "auto" }}>
                {error && <div className="spacer-sm" />}
                <button
                  className="generate-btn"
                  onClick={generate}
                  disabled={loading || !requirement.trim() || targets.length === 0}
                >
                  Generate Code →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
