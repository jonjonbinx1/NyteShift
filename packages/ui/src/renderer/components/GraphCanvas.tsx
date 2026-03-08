import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../theme/ThemeContext.js";
import type { ThemePalette } from "../theme/themes.js";
import type { GraphNodeInfo, GraphEdgeInfo, NodeOutputInfo, NodeRunState } from "../global.js";

// ── Constants ────────────────────────────────────────────────────────────────

const NODE_W = 210;
const NODE_H = 72;
const PORT_R = 7;
const BRANCH_ROW_H = 28; // height per branch on condition nodes

// ── Node visual config ────────────────────────────────────────────────────────

export const NODE_TYPE_STYLES: Record<string, { icon: string; label: string; color: string; textColor: string; description: string }> = {
  input:     { icon: "▶",  label: "Input",     color: "#a6e3a1", textColor: "#1e1e2e", description: "Graph entry point — emits input variables." },
  output:    { icon: "⏹",  label: "Output",    color: "#89b4fa", textColor: "#1e1e2e", description: "Graph exit point — captures final result." },
  llm:       { icon: "🧠", label: "LLM Call",  color: "#cba6f7", textColor: "#1e1e2e", description: "Single LLM call with a prompt template." },
  agent:     { icon: "🤖", label: "Agent",     color: "#fab387", textColor: "#1e1e2e", description: "Full ReAct agent with tools and skills." },
  tool:      { icon: "🔧", label: "Tool",      color: "#94e2d5", textColor: "#1e1e2e", description: "Direct tool invocation." },
  condition: { icon: "⋔",  label: "Condition", color: "#f9e2af", textColor: "#1e1e2e", description: "Route to different branches based on conditions." },
  operation: { icon: "⚙",  label: "Operation", color: "#89dceb", textColor: "#1e1e2e", description: "Mutate a variable (vars.name) — used to drive loops." },
};

// ── Geometry helpers ─────────────────────────────────────────────────────────

function nodeHeight(node: GraphNodeInfo): number {
  if (node.type !== "condition") return NODE_H;
  const portCount = (node.branches?.length ?? 0) + (node.defaultTarget !== undefined ? 1 : 0);
  return Math.max(NODE_H, 44 + Math.max(1, portCount) * BRANCH_ROW_H);
}

/** Canvas-space coords of the input port (left center). null if node has no input. */
function inputPort(node: GraphNodeInfo): { x: number; y: number } | null {
  if (node.type === "input") return null;
  const p = node.position ?? { x: 0, y: 0 };
  return { x: p.x, y: p.y + nodeHeight(node) / 2 };
}

/** Canvas-space coords of all output ports. */
function outputPorts(node: GraphNodeInfo): Array<{ x: number; y: number; branchIndex: number | null; label: string }> {
  if (node.type === "output") return [];
  const p = node.position ?? { x: 0, y: 0 };
  const h = nodeHeight(node);

  if (node.type === "condition") {
    const branches = node.branches ?? [];
    const hasDefault = node.defaultTarget !== undefined;
    const total = branches.length + (hasDefault ? 1 : 0);
    const ports: Array<{ x: number; y: number; branchIndex: number | null; label: string }> = [];
    branches.forEach((b, i) => {
      ports.push({
        x: p.x + NODE_W,
        y: p.y + 44 + i * BRANCH_ROW_H + BRANCH_ROW_H / 2,
        branchIndex: i,
        label: b.label || `Branch ${i + 1}`,
      });
    });
    if (hasDefault) {
      ports.push({
        x: p.x + NODE_W,
        y: p.y + 44 + branches.length * BRANCH_ROW_H + BRANCH_ROW_H / 2,
        branchIndex: -1,
        label: "Default",
      });
    }
    if (total === 0) {
      ports.push({ x: p.x + NODE_W, y: p.y + h / 2, branchIndex: null, label: "" });
    }
    return ports;
  }

  return [{ x: p.x + NODE_W, y: p.y + h / 2, branchIndex: null, label: "" }];
}

/** Smooth cubic-bezier SVG path between two points. */
function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cx = Math.max(60, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
}

// ── Visual edge computation ──────────────────────────────────────────────────

interface VisualEdge {
  id: string;
  fromNodeId: string;
  branchIndex: number | null; // null = regular, -1 = default, >=0 = branch index
  toNodeId: string;
  label?: string;
  isRegular: boolean; // false = from a condition branch
}

function computeVisualEdges(nodes: GraphNodeInfo[], edges: GraphEdgeInfo[]): VisualEdge[] {
  const result: VisualEdge[] = [];

  for (const e of edges) {
    result.push({ id: e.id, fromNodeId: e.source, branchIndex: null, toNodeId: e.target, label: e.label, isRegular: true });
  }

  for (const n of nodes) {
    if (n.type !== "condition") continue;
    (n.branches ?? []).forEach((b, i) => {
      if (b.target) {
        result.push({ id: `${n.id}:br:${i}`, fromNodeId: n.id, branchIndex: i, toNodeId: b.target, label: b.label, isRegular: false });
      }
    });
    if (n.defaultTarget) {
      result.push({ id: `${n.id}:default`, fromNodeId: n.id, branchIndex: -1, toNodeId: n.defaultTarget, label: "Default", isRegular: false });
    }
  }

  return result;
}

// ── Interaction state ────────────────────────────────────────────────────────

type Interaction =
  | { type: "pan"; startMouse: { x: number; y: number }; origPan: { x: number; y: number } }
  | { type: "drag"; nodeId: string; startMouse: { x: number; y: number }; origPos: { x: number; y: number } }
  | { type: "connect"; sourceNodeId: string; branchIndex: number | null; currCanvas: { x: number; y: number }; sourcePos: { x: number; y: number } };

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  nodes: GraphNodeInfo[];
  edges: GraphEdgeInfo[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  runProgress?: Record<string, NodeRunState>;
  onNodeSelect(id: string | null): void;
  onEdgeSelect(id: string | null): void;
  onNodeMoved(id: string, pos: { x: number; y: number }): void;
  onAddEdge(source: string, target: string): void;
  onSetBranchTarget(nodeId: string, branchIndex: number, targetNodeId: string): void;
  onDeleteNode(id: string): void;
  onDeleteEdge(edgeId: string): void;
  onClearBranchTarget(nodeId: string, branchIndex: number): void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function GraphCanvas(props: Props): React.JSX.Element {
  const {
    nodes, edges, selectedNodeId, selectedEdgeId, runProgress,
    onNodeSelect, onEdgeSelect, onNodeMoved, onAddEdge, onSetBranchTarget,
    onDeleteNode, onDeleteEdge, onClearBranchTarget,
  } = props;
  const { palette: C } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan state
  const [pan, setPan] = useState({ x: 80, y: 60 });
  // Zoom state (scale applied after translate)
  const [scale, setScale] = useState<number>(1);
  const scaleRef = useRef<number>(scale);
  scaleRef.current = scale;
  const MIN_SCALE = 0.3;
  const MAX_SCALE = 3;

  // Tick counter drives spinner animation on running nodes (one shared timer)
  const [runTick, setRunTick] = useState(0);
  const hasRunning = !!runProgress && Object.values(runProgress).some(s => s.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => setRunTick(p => (p + 1) % 4), 600);
    return () => clearInterval(t);
  }, [hasRunning]);

  // Interaction (one at a time)
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  // Refs for use inside window-level event handlers (avoid stale closure)
  const interactionRef = useRef<Interaction | null>(null);
  interactionRef.current = interaction;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const panRef = useRef(pan);
  panRef.current = pan;
  const saveZoomDebounceRef = useRef<number | null>(null);

  // Reset pan when graph changes significantly
  useEffect(() => {
    setPan({ x: 80, y: 60 });
  }, []); // only on mount

  // Load saved zoom/pan (if any)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("solix:graph:zoom");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.pan && typeof parsed?.scale === "number") {
        setPan(parsed.pan);
        setScale(parsed.scale);
      }
    } catch (e) { /* ignore */ }
  }, []);

  // Persist zoom/pan (debounced)
  useEffect(() => {
    if (saveZoomDebounceRef.current) window.clearTimeout(saveZoomDebounceRef.current);
    saveZoomDebounceRef.current = window.setTimeout(() => {
      try { localStorage.setItem("solix:graph:zoom", JSON.stringify({ pan, scale })); } catch (e) { }
    }, 250) as unknown as number;
    return () => { if (saveZoomDebounceRef.current) window.clearTimeout(saveZoomDebounceRef.current); };
  }, [pan, scale]);

  // Keyboard: delete selected
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") &&
        (e.target as HTMLElement).tagName !== "INPUT" &&
        (e.target as HTMLElement).tagName !== "TEXTAREA") {
        if (selectedNodeId) {
          const node = nodesRef.current.find(n => n.id === selectedNodeId);
          if (node && node.type !== "input" && node.type !== "output") {
            onDeleteNode(selectedNodeId);
          }
        } else if (selectedEdgeId) {
          const ve = computeVisualEdges(nodesRef.current, []).find(v => v.id === selectedEdgeId);
          if (ve && !ve.isRegular && ve.branchIndex !== null) {
            onClearBranchTarget(ve.fromNodeId, ve.branchIndex);
          } else {
            onDeleteEdge(selectedEdgeId);
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeId, selectedEdgeId, onDeleteNode, onDeleteEdge, onClearBranchTarget]);

  // Window mouse handlers during active interaction
  const isInteracting = interaction !== null;
  useEffect(() => {
    if (!isInteracting) return;

    const getCanvasPos = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - panRef.current.x) / (scaleRef.current || 1),
        y: (clientY - rect.top - panRef.current.y) / (scaleRef.current || 1),
      };
    };

    const onMove = (e: MouseEvent) => {
      const ia = interactionRef.current;
      if (!ia) return;

      if (ia.type === "pan") {
        setPan({
          x: ia.origPan.x + (e.clientX - ia.startMouse.x),
          y: ia.origPan.y + (e.clientY - ia.startMouse.y),
        });
      } else if (ia.type === "drag") {
        // Update local visual via a temp class — propagate to parent on mouseup only
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = (e.clientX - ia.startMouse.x) / (scaleRef.current || 1);
        const dy = (e.clientY - ia.startMouse.y) / (scaleRef.current || 1);
        const newX = ia.origPos.x + dx;
        const newY = ia.origPos.y + dy;
        // Live-update the node div directly for smooth drag (bypass React re-render)
        const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${ia.nodeId}"]`);
        if (el) {
          el.style.left = `${newX}px`;
          el.style.top = `${newY}px`;
        }
        // Also live-update edge SVG paths
        updateEdgesDom(ia.nodeId, newX, newY);
      } else if (ia.type === "connect") {
        const cp = getCanvasPos(e.clientX, e.clientY);
        setInteraction({ ...ia, currCanvas: cp });
      }
    };

    const onUp = (e: MouseEvent) => {
      const ia = interactionRef.current;
      if (!ia) { setInteraction(null); return; }

      if (ia.type === "drag") {
        const rect = containerRef.current?.getBoundingClientRect();
        const dx = (e.clientX - ia.startMouse.x) / (scaleRef.current || 1);
        const dy = (e.clientY - ia.startMouse.y) / (scaleRef.current || 1);
        onNodeMoved(ia.nodeId, {
          x: ia.origPos.x + dx,
          y: ia.origPos.y + dy,
        });
      } else if (ia.type === "connect") {
        const cp = getCanvasPos(e.clientX, e.clientY);
        const target = findInputPort(cp.x, cp.y, nodesRef.current, ia.sourceNodeId);
        if (target) {
          if (ia.branchIndex !== null) {
            onSetBranchTarget(ia.sourceNodeId, ia.branchIndex, target);
          } else {
            onAddEdge(ia.sourceNodeId, target);
          }
        }
      }
      setInteraction(null);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isInteracting, onNodeMoved, onAddEdge, onSetBranchTarget]);

  // Update SVG edge paths during node drag without full re-render
  const updateEdgesDom = (movedNodeId: string, nx: number, ny: number) => {
    const svgEl = containerRef.current?.querySelector<SVGSVGElement>(".graph-edges-svg");
    if (!svgEl) return;
    const movedNode = nodesRef.current.find(n => n.id === movedNodeId);
    if (!movedNode) return;
    const tempNode = { ...movedNode, position: { x: nx, y: ny } };
    const allNodes = nodesRef.current.map(n => n.id === movedNodeId ? tempNode : n);
    const visualEdges = computeVisualEdges(allNodes, edges);

    for (const ve of visualEdges) {
      const pathEl = svgEl.querySelector<SVGPathElement>(`[data-edge-id="${ve.id}"]`);
      if (!pathEl) continue;
      const srcNode = allNodes.find(n => n.id === ve.fromNodeId);
      const dstNode = allNodes.find(n => n.id === ve.toNodeId);
      if (!srcNode || !dstNode) continue;
      const srcPorts = outputPorts(srcNode);
      const srcPort = ve.branchIndex === null
        ? srcPorts[0]
        : srcPorts.find(p => p.branchIndex === ve.branchIndex);
      const dstPort = inputPort(dstNode);
      if (!srcPort || !dstPort) continue;
      pathEl.setAttribute("d", bezierPath(srcPort.x, srcPort.y, dstPort.x, dstPort.y));
    }
  };

  const visualEdges = useMemo(() => computeVisualEdges(nodes, edges), [nodes, edges]);

  // ── Mouse down on container ─────────────────────────────────────────────────
  const onContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-node-id]") ||
      (e.target as HTMLElement).closest("[data-port]")) return;

    // Click on an edge?
    const edgeEl = (e.target as HTMLElement).closest<SVGElement>("[data-edge-id]");
    if (edgeEl) {
      const id = edgeEl.getAttribute("data-edge-id")!;
      onEdgeSelect(selectedEdgeId === id ? null : id);
      onNodeSelect(null);
      return;
    }

    // Deselect on background click
    onNodeSelect(null);
    onEdgeSelect(null);

    // Start pan
    setInteraction({ type: "pan", startMouse: { x: e.clientX, y: e.clientY }, origPan: panRef.current });
  }, [selectedEdgeId, onEdgeSelect, onNodeSelect]);

  // ── Node mouse down ─────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e: React.MouseEvent, node: GraphNodeInfo) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onNodeSelect(node.id);
    onEdgeSelect(null);
    const pos = node.position ?? { x: 0, y: 0 };
    setInteraction({ type: "drag", nodeId: node.id, startMouse: { x: e.clientX, y: e.clientY }, origPos: pos });
  }, [onNodeSelect, onEdgeSelect]);

  // ── Port mouse down ─────────────────────────────────────────────────────────
  const onPortMouseDown = useCallback((e: React.MouseEvent, node: GraphNodeInfo, branchIndex: number | null) => {
    e.stopPropagation();
    const ports = outputPorts(node);
    const port = branchIndex === null ? ports[0] : ports.find(p => p.branchIndex === branchIndex);
    if (!port) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvas = {
      x: (e.clientX - rect.left - panRef.current.x) / (scaleRef.current || 1),
      y: (e.clientY - rect.top - panRef.current.y) / (scaleRef.current || 1),
    };
    setInteraction({ type: "connect", sourceNodeId: node.id, branchIndex, currCanvas: canvas, sourcePos: { x: port.x, y: port.y } });
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // ----- Zoom / wheel / keyboard helpers -----
  const clamp = (v: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));

  const zoomAt = useCallback((newScale: number, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) { setScale(clamp(newScale)); return; }
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const curScale = scaleRef.current || 1;
    const cx = (mx - panRef.current.x) / curScale;
    const cy = (my - panRef.current.y) / curScale;
    const s = clamp(newScale);
    const panX = mx - cx * s;
    const panY = my - cy * s;
    setScale(s);
    setPan({ x: panX, y: panY });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) { setScale(s => clamp(s * factor)); return; }
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const curScale = scaleRef.current || 1;
    const canvasX = (cx - panRef.current.x) / curScale;
    const canvasY = (cy - panRef.current.y) / curScale;
    const s = clamp(curScale * factor);
    setScale(s);
    setPan({ x: cx - canvasX * s, y: cy - canvasY * s });
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPan({ x: 80, y: 60 });
  }, []);

  const fitToView = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!nodesRef.current || nodesRef.current.length === 0) { resetZoom(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodesRef.current) {
      const p = n.position ?? { x: 0, y: 0 };
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + nodeHeight(n));
    }
    const padding = 40;
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const s = clamp(Math.min((rect.width - padding * 2) / contentW, (rect.height - padding * 2) / contentH));
    setScale(s);
    setPan({ x: padding - minX * s, y: padding - minY * s });
  }, [resetZoom]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    // Ctrl/Cmd + wheel => zoom centered at cursor
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.002);
      zoomAt((scaleRef.current || 1) * factor, e.clientX, e.clientY);
      return;
    }
    // Otherwise use wheel to pan
    setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
  }, [zoomAt]);

  // Keyboard shortcuts: Ctrl/Cmd + +/- and 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "0") { e.preventDefault(); resetZoom(); }
      if (e.key === "+" || (e.key === "=" && e.shiftKey)) { e.preventDefault(); zoomBy(1.15); }
      if (e.key === "-") { e.preventDefault(); zoomBy(1 / 1.15); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, resetZoom]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onMouseDown={onContainerMouseDown}
      onWheel={onWheel}
      style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: C.mantle, cursor: interaction?.type === "pan" ? "grabbing" : "default",
        outline: "none",
        backgroundImage: `radial-gradient(circle, ${C.surface0} 1px, transparent 1px)`,
        backgroundSize: `${28 * scale}px ${28 * scale}px`,
        backgroundPosition: `${pan.x % (28 * scale)}px ${pan.y % (28 * scale)}px`,
      }}
    >
      {/* SVG edge layer */}
      <svg
        className="graph-edges-svg"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
          {visualEdges.map(ve => {
            const srcNode = nodeMap.get(ve.fromNodeId);
            const dstNode = nodeMap.get(ve.toNodeId);
            if (!srcNode || !dstNode) return null;
            const srcPorts = outputPorts(srcNode);
            const srcPort = ve.branchIndex === null
              ? srcPorts[0]
              : srcPorts.find(p => p.branchIndex === ve.branchIndex);
            const dstPort = inputPort(dstNode);
            if (!srcPort || !dstPort) return null;
            const path = bezierPath(srcPort.x, srcPort.y, dstPort.x, dstPort.y);
            const isSelected = selectedEdgeId === ve.id;
            return (
              <g key={ve.id}>
                {/* Wide invisible hit area */}
                <path
                  data-edge-id={ve.id}
                  d={path}
                  stroke="transparent"
                  strokeWidth={16}
                  fill="none"
                  style={{ cursor: "pointer", pointerEvents: "stroke" }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onEdgeSelect(selectedEdgeId === ve.id ? null : ve.id);
                    onNodeSelect(null);
                  }}
                />
                {/* Visible edge */}
                <path
                  d={path}
                  stroke={isSelected ? C.mauve : C.overlay0}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  fill="none"
                  strokeDasharray={ve.isRegular ? undefined : "5,3"}
                />
                {/* Arrow head */}
                <circle
                  cx={dstPort.x}
                  cy={dstPort.y}
                  r={3}
                  fill={isSelected ? C.mauve : C.overlay0}
                />
                {/* Label */}
                {ve.label && (
                  <text
                    x={(srcPort.x + dstPort.x) / 2}
                    y={(srcPort.y + dstPort.y) / 2 - 6}
                    fontSize={9}
                    fill={C.overlay1}
                    textAnchor="middle"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {ve.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Connection preview line */}
          {interaction?.type === "connect" && (
            <path
              d={bezierPath(
                interaction.sourcePos.x, interaction.sourcePos.y,
                interaction.currCanvas.x, interaction.currCanvas.y,
              )}
              stroke={C.teal}
              strokeWidth={2}
              fill="none"
              strokeDasharray="6,3"
              style={{ pointerEvents: "none" }}
            />
          )}
        </g>
      </svg>

      {/* Node layer */}
      <div
        style={{
          position: "absolute", top: 0, left: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: "0 0",
          pointerEvents: "none",
        }}
      >
        {nodes.map(node => (
          <NodeCard
            key={node.id}
            node={node}
            isSelected={selectedNodeId === node.id}
            runState={runProgress?.[node.id]}
            runTick={runTick}
            palette={C}
            onMouseDown={onNodeMouseDown}
            onPortMouseDown={onPortMouseDown}
          />
        ))}
      </div>

      {/* Keyboard hint */}
      <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 6, alignItems: "center", pointerEvents: "auto", zIndex: 40 }}>
        <div style={{ background: C.surface1, border: `1px solid ${C.surface2}`, padding: 6, borderRadius: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => zoomBy(1 / 1.15)} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: C.surface0, cursor: "pointer" }}>−</button>
          <button onClick={() => resetZoom()} style={{ width: 44, height: 28, borderRadius: 6, border: "none", background: C.surface0, cursor: "pointer" }}>Reset</button>
          <button onClick={() => zoomBy(1.15)} style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: C.surface0, cursor: "pointer" }}>＋</button>
          <button onClick={() => fitToView()} style={{ marginLeft: 8, height: 28, padding: "0 8px", borderRadius: 6, border: "none", background: C.surface0, cursor: "pointer" }}>Fit</button>
          <div style={{ marginLeft: 8, fontSize: "0.75rem", color: C.overlay0 }}>{Math.round(scale * 100)}%</div>
        </div>
      </div>
      <div style={{
        position: "absolute", bottom: 12, right: 14,
        fontSize: "0.68rem", color: C.overlay0, pointerEvents: "none",
        lineHeight: 1.6,
      }}>
        Drag node to move · Drag port to connect · Click to select · ⌫ Delete selected
      </div>
    </div>
  );
}

// ── NodeCard ─────────────────────────────────────────────────────────────────

function formatNodeMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function NodeCard({ node, isSelected, runState, runTick, palette: C, onMouseDown, onPortMouseDown }: {
  node: GraphNodeInfo;
  isSelected: boolean;
  runState?: NodeRunState;
  runTick?: number;
  palette: ThemePalette;
  onMouseDown(e: React.MouseEvent, node: GraphNodeInfo): void;
  onPortMouseDown(e: React.MouseEvent, node: GraphNodeInfo, branchIndex: number | null): void;
}) {
  const cfg = NODE_TYPE_STYLES[node.type] ?? NODE_TYPE_STYLES.llm!;
  const pos = node.position ?? { x: 0, y: 0 };
  const h = nodeHeight(node);
  const branches = node.branches ?? [];
  const hasDefault = node.defaultTarget !== undefined;

  const runStatus = runState?.status;
  const statusColor = runStatus === "running" ? C.yellow
    : runStatus === "success" ? C.green
    : runStatus === "error" ? C.red
    : runStatus === "skipped" ? C.overlay0
    : undefined;

  const isPulsing = runStatus === "running" && (runTick ?? 0) % 2 === 0;
  const SPINNER = ['◐', '◓', '◑', '◒'];
  const spinnerChar = SPINNER[(runTick ?? 0) % 4]!;
  const borderColor = statusColor ?? (isSelected ? C.mauve : `${cfg.color}90`);

  return (
    <div
      data-node-id={node.id}
      onMouseDown={(e) => onMouseDown(e, node)}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: NODE_W,
        height: h,
        background: C.surface0,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        cursor: "grab",
        boxShadow: isSelected ? `0 0 0 2px ${C.mauve}55` : isPulsing ? `0 0 16px ${C.yellow}99, 0 2px 8px rgba(0,0,0,0.3)` : statusColor ? `0 0 8px ${statusColor}44` : "0 2px 8px rgba(0,0,0,0.3)",
        pointerEvents: "all",
        userSelect: "none",
        overflow: "hidden",
        transition: "box-shadow 0.15s",
      }}
    >
      {/* Color header stripe */}
      <div style={{ height: 4, background: cfg.color, width: "100%" }} />

      {/* Content */}
      <div style={{ padding: "8px 10px 6px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>{cfg.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: "0.78rem", fontWeight: 700, color: C.text,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: 150,
          }}>
            {node.name}
          </div>
          <div style={{ fontSize: "0.65rem", color: C.subtext0, marginTop: 1 }}>
            {cfg.label}
            {node.agentName ? ` · ${node.agentName}` : ""}
            {node.toolName ? ` · ${node.toolName.split("/").pop()}` : ""}
          </div>
        </div>
        {runStatus && (
          <span style={{
            marginLeft: "auto", fontSize: "0.75rem", fontWeight: 700,
            color: statusColor, flexShrink: 0,
          }}>
            {runStatus === "running" ? spinnerChar : runStatus === "success" ? "✓" : runStatus === "error" ? "✗" : "—"}
          </span>
        )}
        {runState?.iteration !== undefined && runState.iteration > 0 && (
          <span style={{
            marginLeft: runStatus ? 4 : "auto",
            fontSize: "0.58rem", padding: "1px 4px", borderRadius: 8,
            background: `${C.teal}22`, color: C.teal, border: `1px solid ${C.teal}44`,
            flexShrink: 0,
          }}>×{runState.iteration + 1}</span>
        )}
      </div>

      {/* Elapsed / iteration footer for completed nodes */}
      {runState && runStatus !== "running" && runState.elapsedMs !== undefined && (
        <div style={{ padding: "0 10px 4px", fontSize: "0.6rem", color: C.overlay0, display: "flex", gap: 6 }}>
          <span>{formatNodeMs(runState.elapsedMs)}</span>
          {runState.iteration !== undefined && runState.iteration > 0 && (
            <span style={{ color: C.teal }}>iter {runState.iteration + 1}</span>
          )}
        </div>
      )}

      {/* Condition branches */}
      {node.type === "condition" && (
        <div style={{ borderTop: `1px solid ${C.surface1}`, marginTop: 2 }}>
          {branches.map((b, i) => (
            <div key={i} style={{
              height: BRANCH_ROW_H, display: "flex", alignItems: "center",
              padding: "0 8px", fontSize: "0.65rem", color: C.subtext0,
              borderBottom: `1px solid ${C.surface1}22`,
            }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.label || `Branch ${i + 1}`}
              </span>
            </div>
          ))}
          {hasDefault && (
            <div style={{
              height: BRANCH_ROW_H, display: "flex", alignItems: "center",
              padding: "0 8px", fontSize: "0.65rem", color: C.overlay0,
              fontStyle: "italic",
            }}>
              Default
            </div>
          )}
        </div>
      )}

      {/* Input port (left) */}
      {node.type !== "input" && (
        <div
          data-port="input"
          style={{
            position: "absolute", left: -PORT_R, top: h / 2 - PORT_R,
            width: PORT_R * 2, height: PORT_R * 2,
            borderRadius: "50%",
            background: C.surface2,
            border: `2px solid ${C.overlay0}`,
            cursor: "crosshair",
            pointerEvents: "all",
          }}
        />
      )}

      {/* Output port(s) (right) */}
      {node.type !== "output" && (() => {
        const ports = outputPorts(node);
        return ports.map((pt, pi) => (
          <div
            key={pi}
            data-port="output"
            onMouseDown={(e) => {
              e.stopPropagation();
              onPortMouseDown(e, node, pt.branchIndex);
            }}
            style={{
              position: "absolute",
              right: -PORT_R,
              top: (pt.y - (node.position?.y ?? 0)) - PORT_R,
              width: PORT_R * 2, height: PORT_R * 2,
              borderRadius: "50%",
              background: cfg.color,
              border: `2px solid ${cfg.color}cc`,
              cursor: "crosshair",
              pointerEvents: "all",
              zIndex: 2,
            }}
          />
        ));
      })()}
    </div>
  );
}

// ── Hit test: nearest input port ─────────────────────────────────────────────

function findInputPort(cx: number, cy: number, nodes: GraphNodeInfo[], excludeNodeId?: string): string | null {
  const RADIUS = PORT_R + 10;
  for (const node of nodes) {
    if (node.id === excludeNodeId) continue;
    const port = inputPort(node);
    if (!port) continue;
    if (Math.hypot(cx - port.x, cy - port.y) <= RADIUS) return node.id;
  }
  return null;
}
