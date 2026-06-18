"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export type SkillStatus = "have" | "partial" | "gap";

export interface ZenoNodeData extends Record<string, unknown> {
  label: string;
  kind: "role-current" | "role-target" | "skill";
  status?: SkillStatus;
  sub?: string;
}

const STATUS_RING: Record<SkillStatus, string> = {
  have: "border-cyan/70 text-cyan shadow-[0_0_20px_hsl(187_100%_50%/0.18)]",
  partial: "border-gold/70 text-gold shadow-[0_0_20px_hsl(43_100%_50%/0.16)]",
  gap: "border-magenta/70 text-magenta shadow-[0_0_20px_hsl(335_100%_65%/0.18)]",
};

const STATUS_DOT: Record<SkillStatus, string> = {
  have: "bg-cyan",
  partial: "bg-gold",
  gap: "bg-magenta",
};

function RoleNode({ data }: NodeProps) {
  const d = data as ZenoNodeData;
  const isTarget = d.kind === "role-target";
  return (
    <div
      className={
        "min-w-[150px] rounded-2xl border bg-card/90 px-4 py-3 text-center backdrop-blur " +
        (isTarget
          ? "border-gold/70 shadow-[0_0_28px_hsl(43_100%_50%/0.22)]"
          : "border-cyan/70 shadow-[0_0_28px_hsl(187_100%_50%/0.22)]")
      }
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {isTarget ? "Target" : "Current"}
      </p>
      <p className={"mt-0.5 text-sm font-semibold " + (isTarget ? "text-gold" : "text-cyan")}>
        {d.label}
      </p>
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
    </div>
  );
}

function SkillNode({ data }: NodeProps) {
  const d = data as ZenoNodeData;
  const status = d.status ?? "gap";
  return (
    <div
      className={
        "min-w-[120px] rounded-xl border bg-surface/90 px-3 py-2 text-center backdrop-blur " +
        STATUS_RING[status]
      }
    >
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0" />
      <div className="flex items-center justify-center gap-1.5">
        <span className={"h-1.5 w-1.5 rounded-full " + STATUS_DOT[status]} />
        <span className="text-xs font-medium text-foreground">{d.label}</span>
      </div>
      {d.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{d.sub}</p>}
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0" />
    </div>
  );
}

const nodeTypes = { role: RoleNode, skill: SkillNode };

interface CareerGraphProps {
  nodes?: Node<ZenoNodeData>[];
  edges?: Edge[];
  height?: number | string;
}

export function CareerGraph({ nodes, edges, height = 420 }: CareerGraphProps) {
  const initialNodes = nodes ?? DEMO_NODES;
  const initialEdges = edges ?? DEMO_EDGES;
  const [selected, setSelected] = useState<string | null>(null);

  const onSelectionChange = useCallback((p: OnSelectionChangeParams) => {
    setSelected(p.nodes[0]?.id ?? null);
  }, []);

  const styledEdges = useMemo(
    () =>
      initialEdges.map((e) => {
        const active = selected != null && (e.source === selected || e.target === selected);
        return {
          ...e,
          animated: active,
          style: {
            stroke: active ? "hsl(183 86% 52%)" : "hsl(183 86% 52% / 0.22)",
            strokeWidth: active ? 1.6 : 1,
            ...e.style,
          },
        };
      }),
    [initialEdges, selected],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-aurora" style={{ height }}>
      <ReactFlow
        nodes={initialNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onSelectionChange={onSelectionChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        minZoom={0.5}
        maxZoom={1.2}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="hsl(222 20% 22%)" />
      </ReactFlow>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Demo constellation for the homepage (frontend -> AI engineer)
// --------------------------------------------------------------------------- //
const DEMO_NODES: Node<ZenoNodeData>[] = [
  { id: "cur", type: "role", position: { x: 0, y: 180 }, data: { label: "Frontend Engineer", kind: "role-current" } },
  { id: "tgt", type: "role", position: { x: 760, y: 180 }, data: { label: "AI Engineer", kind: "role-target" } },
  { id: "ts", type: "skill", position: { x: 230, y: 40 }, data: { label: "TypeScript", kind: "skill", status: "have" } },
  { id: "api", type: "skill", position: { x: 230, y: 170 }, data: { label: "API 设计", kind: "skill", status: "have" } },
  { id: "stream", type: "skill", position: { x: 230, y: 300 }, data: { label: "流式集成", kind: "skill", status: "have" } },
  { id: "prompt", type: "skill", position: { x: 470, y: 30 }, data: { label: "Prompt 结构", kind: "skill", status: "partial" } },
  { id: "rag", type: "skill", position: { x: 470, y: 150 }, data: { label: "向量检索", kind: "skill", status: "gap" } },
  { id: "fc", type: "skill", position: { x: 470, y: 270 }, data: { label: "函数调用", kind: "skill", status: "gap" } },
  { id: "eval", type: "skill", position: { x: 470, y: 380 }, data: { label: "离线评估", kind: "skill", status: "gap" } },
];

const DEMO_EDGES: Edge[] = [
  { id: "e1", source: "cur", target: "ts" },
  { id: "e2", source: "cur", target: "api" },
  { id: "e3", source: "cur", target: "stream" },
  { id: "e4", source: "ts", target: "prompt" },
  { id: "e5", source: "api", target: "rag" },
  { id: "e6", source: "stream", target: "fc" },
  { id: "e7", source: "prompt", target: "tgt" },
  { id: "e8", source: "rag", target: "tgt" },
  { id: "e9", source: "fc", target: "tgt" },
  { id: "e10", source: "eval", target: "tgt" },
  { id: "e11", source: "api", target: "eval" },
];
