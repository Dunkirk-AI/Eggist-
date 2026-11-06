import { useEffect, useRef, useState } from "react";
import { type CanvasNode, type Point, type Project } from "../model";
import { Icon } from "./Icon";
import { AttachmentImage } from "./AttachmentImage";
export type Tool = "select" | "chat" | "sticky" | "frame" | "text" | "link";
type Props = {
  project: Project;
  selected: string[];
  setSelected: (ids: string[]) => void;
  update: (nodes: CanvasNode[]) => void;
  commit: () => void;
  create: (type: CanvasNode["type"], point: Point) => void;
  connect: (source: string, target: string) => void;
  branch: (id: string, messageId?: string, direction?: number) => void;
  openChat: (id: string) => void;
  continueChat: (id: string) => void;
  remove: (ids?: string[]) => void;
  generate: () => void;
  mark: (nodeId: string, messageId: string) => void;
  tool: Tool;
  setTool: (tool: Tool) => void;
  focusId?: string;
  draft: string;
  activeId?: string;
};
const coverOf = (n: CanvasNode) =>
  n.messages
    .flatMap((m) => m.attachments || [])
    .find((a) => a.type.startsWith("image/"));
const heightOf = (n: CanvasNode) =>
  n.height +
  (n.type === "chat" && n.expansion ? (n.expansion === 1 ? 200 : 330) : 0) +
  (coverOf(n) ? 44 : 0);
const tools: { id: Tool; icon: string; label: string }[] = [
  { id: "select", icon: "select", label: "选择 / 框选" },
  { id: "chat", icon: "chat", label: "新建对话" },
  { id: "link", icon: "link", label: "连线" },
  { id: "sticky", icon: "sticky", label: "便签" },
  { id: "frame", icon: "frame", label: "画框" },
  { id: "text", icon: "text", label: "文字" },
];
export default function Canvas(p: Props) {
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [menu, setMenu] = useState<{ screen: Point; world: Point }>();
  const [source, setSource] = useState<string>();
  const [box, setBox] = useState<{ start: Point; end: Point }>();
  const [space, setSpace] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | {
        kind: "nodes" | "pan" | "box" | "resize";
        start: Point;
        nodes: CanvasNode[];
        view: typeof view;
        id?: string;
        ids?: string[];
        additive?: string[];
        moved: boolean;
      }
    | undefined
  >(undefined);
  const viewRef = useRef(view);
  viewRef.current = view;
  const projectRef = useRef(p.project);
  projectRef.current = p.project;
  const propsRef = useRef(p);
  propsRef.current = p;
  function screenPoint(client: Point) {
    const rect = surface.current!.getBoundingClientRect();
    return { x: client.x - rect.left, y: client.y - rect.top };
  }
  function worldPoint(point: Point) {
    const v = viewRef.current;
    return { x: (point.x - v.x) / v.zoom, y: (point.y - v.y) / v.zoom };
  }
  function centerNode(n: CanvasNode) {
    const r = surface.current?.getBoundingClientRect();
    if (!r) return;
    setView((v) => ({
      ...v,
      x: r.width / 2 - (n.x + n.width / 2) * v.zoom,
      y: r.height / 2 - (n.y + n.height / 2) * v.zoom,
    }));
  }
  useEffect(() => {
    const node = p.project.nodes.find((n) => n.id === p.focusId);
    if (node) centerNode(node);
  }, [p.focusId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.closest(
        "input, textarea, [contenteditable=true]",
      );
      if (e.key === "Escape") {
        setMenu(undefined);
        setSource(undefined);
        setBox(undefined);
        drag.current = undefined;
        propsRef.current.setTool("select");
      }
      if (!editing && e.code === "Space") {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      drag.current = undefined;
      setBox(undefined);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const delta = { x: e.clientX - d.start.x, y: e.clientY - d.start.y };
      if (Math.abs(delta.x) + Math.abs(delta.y) > 3) d.moved = true;
      if (d.kind === "pan")
        setView({ ...d.view, x: d.view.x + delta.x, y: d.view.y + delta.y });
      else if (d.kind === "box")
        setBox({
          start: worldPoint(screenPoint(d.start)),
          end: worldPoint(screenPoint({ x: e.clientX, y: e.clientY })),
        });
      else
        propsRef.current.update(
          d.nodes.map((n) => {
            if (d.kind === "resize" && n.id === d.id)
              return {
                ...n,
                width: Math.max(160, n.width + delta.x / d.view.zoom),
                height: Math.max(90, n.height + delta.y / d.view.zoom),
              };
            if (d.kind === "nodes" && d.ids?.includes(n.id))
              return {
                ...n,
                x: n.x + delta.x / d.view.zoom,
                y: n.y + delta.y / d.view.zoom,
              };
            return n;
          }),
        );
    };
    const release = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (d.kind === "box" && d.moved) {
        const a = worldPoint(screenPoint(d.start));
        const b = worldPoint(screenPoint({ x: e.clientX, y: e.clientY }));
        const ids = projectRef.current.nodes
          .filter(
            (n) =>
              n.x < Math.max(a.x, b.x) &&
              n.x + n.width > Math.min(a.x, b.x) &&
              n.y < Math.max(a.y, b.y) &&
              n.y + heightOf(n) > Math.min(a.y, b.y),
          )
          .map((n) => n.id);
        propsRef.current.setSelected([
          ...new Set([...(d.additive || []), ...ids]),
        ]);
      }
      drag.current = undefined;
      setBox(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  useEffect(() => {
    if (p.tool !== "link") setSource(undefined);
  }, [p.tool]);
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "textarea,.node-expanded,.create-palette",
        )
      )
        return;
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const point = screenPoint({ x: e.clientX, y: e.clientY });
        const z = Math.min(
          2,
          Math.max(0.25, v.zoom * Math.exp(-e.deltaY * 0.005)),
        );
        setView({
          x: point.x - ((point.x - v.x) * z) / v.zoom,
          y: point.y - ((point.y - v.y) * z) / v.zoom,
          zoom: z,
        });
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function choose(n: CanvasNode, shift: boolean) {
    if (p.tool === "link") {
      if (!source) setSource(n.id);
      else if (source !== n.id) {
        p.connect(source, n.id);
        setSource(undefined);
        p.setTool("select");
      }
      return;
    }
    p.setSelected(
      shift
        ? p.selected.includes(n.id)
          ? p.selected.filter((id) => id !== n.id)
          : [...p.selected, n.id]
        : [n.id],
    );
  }
  function fit() {
    if (!p.project.nodes.length) {
      setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const r = surface.current!.getBoundingClientRect();
    const ns = p.project.nodes;
    const left = Math.min(...ns.map((n) => n.x)),
      top = Math.min(...ns.map((n) => n.y));
    const width = Math.max(...ns.map((n) => n.x + n.width)) - left,
      height = Math.max(...ns.map((n) => n.y + heightOf(n))) - top;
    const z = Math.min(
      1.2,
      Math.max(
        0.25,
        Math.min((r.width - 140) / width, (r.height - 220) / height),
      ),
    );
    setView({
      x: (r.width - width * z) / 2 - left * z,
      y: (r.height - 120 - height * z) / 2 - top * z,
      zoom: z,
    });
  }
  const nodeHeight = heightOf;
  return (
    <div
      ref={surface}
      data-testid="canvas"
      data-view-x={view.x}
      data-view-y={view.y}
      data-zoom={view.zoom}
      className={`canvas-surface tool-${p.tool} ${space ? "panning" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        if (p.selected.length) p.generate();
      }}
      onDoubleClick={(e) => {
        if (
          (e.target as HTMLElement).closest(
            ".canvas-node,button,textarea,input",
          ) ||
          drag.current ||
          p.tool === "link"
        )
          return;
        const point = screenPoint({ x: e.clientX, y: e.clientY });
        const r = surface.current!.getBoundingClientRect();
        setMenu({
          screen: {
            x: Math.max(12, Math.min(point.x, r.width - 240)),
            y: Math.max(12, Math.min(point.y, r.height - 300)),
          },
          world: worldPoint(point),
        });
      }}
      onPointerDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            ".canvas-node,button,.create-palette,.selection-actions",
          )
        )
          return;
        setMenu(undefined);
        const point = worldPoint(screenPoint({ x: e.clientX, y: e.clientY }));
        if (e.button === 1 || space) {
          e.preventDefault();
          drag.current = {
            kind: "pan",
            start: { x: e.clientX, y: e.clientY },
            nodes: [],
            view,
            moved: false,
          };
          return;
        }
        if (e.button !== 0) return;
        if (p.tool !== "select" && p.tool !== "link") {
          p.create(p.tool, point);
          p.setTool("select");
          return;
        }
        if (!e.shiftKey) p.setSelected([]);
        drag.current = {
          kind: "box",
          start: { x: e.clientX, y: e.clientY },
          nodes: [],
          view,
          moved: false,
          additive: e.shiftKey ? p.selected : [],
        };
      }}
    >
      <div
        className="canvas-world"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
        }}
      >
        <svg className="edge-layer" aria-label="画布连线">
          <defs>
            <marker
              id="arrowhead"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0 7 3.5 0 7" fill="none" stroke="#b4b4c2" />
            </marker>
          </defs>
          {p.project.edges.map((e) => {
            const a = p.project.nodes.find((n) => n.id === e.sourceId),
              b = p.project.nodes.find((n) => n.id === e.targetId);
            if (!a || !b) return null;
            const x = a.x + a.width,
              y = a.y + Math.min(nodeHeight(a), 175) / 2,
              xx = b.x,
              yy = b.y + Math.min(nodeHeight(b), 175) / 2,
              bend = Math.max(45, Math.abs(xx - x) / 2);
            return (
              <path
                key={e.id}
                data-testid="edge"
                markerEnd="url(#arrowhead)"
                d={`M${x} ${y} C${x + bend} ${y} ${xx - bend} ${yy} ${xx} ${yy}`}
              />
            );
          })}
        </svg>
        {p.project.nodes.map((n) => {
          const cover = coverOf(n);
          const selected = p.selected.includes(n.id),
            recent = n.messages.slice(-2),
            hidden = n.messages.filter(
              (m) =>
                !m.marked && !n.messages.slice(-2).some((r) => r.id === m.id),
            ),
            marked = n.messages.filter((m) => m.marked),
            branches = p.project.nodes.filter(
              (child) => child.parentId === n.id,
            );
          return (
            <article
              key={n.id}
              data-testid={`node-${n.type}`}
              data-node-id={n.id}
              className={`canvas-node node-${n.type} ${cover ? "has-cover" : ""} ${selected ? "selected" : ""} ${source === n.id ? "connection-source" : ""} ${n.messages.some((m) => m.status === "pending") ? "working" : ""}`}
              style={{
                left: n.x,
                top: n.y,
                width: n.width,
                height: nodeHeight(n),
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (p.tool === "link") {
                  e.preventDefault();
                  choose(n, false);
                  return;
                }
                if (!(e.target as HTMLElement).closest("button,input,textarea"))
                  choose(n, e.shiftKey);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (
                  n.type === "chat" &&
                  !(e.target as HTMLElement).closest("button,input,textarea")
                )
                  p.openChat(n.id);
              }}
            >
              <header
                className="node-header"
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  e.stopPropagation();
                  if (p.tool === "link") {
                    choose(n, false);
                    return;
                  }
                  if (e.shiftKey) {
                    choose(n, true);
                    return;
                  }
                  e.preventDefault();
                  const ids = selected ? p.selected : [n.id];
                  p.setSelected(ids);
                  p.commit();
                  drag.current = {
                    kind: "nodes",
                    start: { x: e.clientX, y: e.clientY },
                    nodes: p.project.nodes,
                    view,
                    moved: false,
                    ids,
                  };
                }}
              >
                <span className={`node-type-icon ${n.type}`}>
                  <Icon name={n.type === "chat" ? "board" : n.type} size={13} />
                </span>
                <span>
                  {n.type === "chat"
                    ? `对话 ${n.messages.filter((m) => m.role === "user").length}　分支 ${branches.length}`
                    : n.type === "frame"
                      ? "画框"
                      : n.type === "sticky"
                        ? "便签"
                        : "文字"}
                </span>
                <button
                  title="删除节点"
                  aria-label={`删除 ${n.title}`}
                  onClick={() => {
                    p.remove([n.id]);
                    setMenu(undefined);
                  }}
                  className="node-more"
                >
                  <Icon name="more" size={14} />
                </button>
              </header>
              {n.type === "chat" ? (
                <>
                  <div
                    className="node-body"
                    style={{ height: n.height - 36 + (cover ? 44 : 0) }}
                  >
                    {cover ? (
                      <AttachmentImage
                        attachment={cover}
                        className="node-cover"
                      />
                    ) : (
                      <div className="node-agent">
                        <Icon name="spark" size={12} />
                        {n.messages.find((m) => m.role === "assistant")
                          ?.model || "研究助手"}
                      </div>
                    )}
                    <strong className="node-title">{n.title}</strong>
                    <p className="node-excerpt">
                      {n.messages.some((m) => m.status === "pending")
                        ? "正在思考，整理你的问题…"
                        : n.messages
                            .filter(
                              (m) =>
                                m.role === "assistant" &&
                                m.status === "complete",
                            )
                            .at(-1)?.content ||
                          (n.context?.length
                            ? `继承 ${n.context.length} 条上文，继续探索这个分支。`
                            : "选中此卡片，在下方开始对话。")}
                    </p>
                  </div>
                  <button
                    className="branch-port top"
                    aria-label={`从 ${n.title} 向上分支`}
                    title="向上创建分支"
                    onClick={() => p.branch(n.id, undefined, -1)}
                  >
                    +
                  </button>
                  <button
                    className="branch-port bottom"
                    aria-label={`从 ${n.title} 向下分支`}
                    title="向下创建分支"
                    onClick={() => p.branch(n.id, undefined, 1)}
                  >
                    +
                  </button>
                  <button
                    className="expand-port"
                    aria-label={`展开 ${n.title}`}
                    title="概况 → 简单展开 → 全部展开"
                    onClick={() => {
                      p.commit();
                      p.update(
                        p.project.nodes.map((item) =>
                          item.id === n.id
                            ? {
                                ...item,
                                expansion: ((item.expansion + 1) % 3) as
                                  0 | 1 | 2,
                              }
                            : item,
                        ),
                      );
                    }}
                  >
                    <Icon
                      name="chevron"
                      size={12}
                      style={{ transform: `rotate(${n.expansion * 90}deg)` }}
                    />
                  </button>
                  {n.messages.some((m) => m.marked) && (
                    <span className="node-bookmark">
                      <Icon name="bookmark" size={15} />
                    </span>
                  )}
                  {n.expansion > 0 && (
                    <div
                      className="node-expanded"
                      style={{ top: n.height + (cover ? 44 : 0) - 1 }}
                    >
                      <div className="expanded-label">
                        {n.expansion === 1 ? "近期对话" : "完整对话树"}
                        <button
                          title="放大查看"
                          onClick={() => p.openChat(n.id)}
                        >
                          <Icon name="expand" size={12} />
                        </button>
                      </div>
                      {(n.expansion === 1 ? recent : n.messages).map((m) => (
                        <div
                          key={m.id}
                          className={`mini-message ${m.role}`}
                          onDoubleClick={() => p.openChat(n.id)}
                        >
                          <small>{m.role === "user" ? "你" : "助手"}</small>
                          <p>{m.content || "正在生成…"}</p>
                          <button
                            aria-label={`标记消息 ${m.id}`}
                            className={m.marked ? "marked" : ""}
                            onClick={() => p.mark(n.id, m.id)}
                          >
                            <Icon name="bookmark" size={11} />
                          </button>
                          <button
                            title="从此消息分支"
                            onClick={() => p.branch(n.id, m.id)}
                          >
                            <Icon name="branch" size={11} />
                          </button>
                        </div>
                      ))}
                      {n.expansion === 1 && hidden.length > 0 && (
                        <button
                          className="stacked-block"
                          onClick={() => {
                            p.commit();
                            p.update(
                              p.project.nodes.map((item) =>
                                item.id === n.id
                                  ? { ...item, expansion: 2 }
                                  : item,
                              ),
                            );
                          }}
                        >
                          从首次提问到近期讨论 · {hidden.length} 条消息　展开
                        </button>
                      )}
                      {marked.length > 0 && (
                        <div className="mini-section">
                          已标记 · {marked.length}
                          {marked.map((m) => (
                            <p key={m.id}>{m.content.slice(0, 100)}</p>
                          ))}
                        </div>
                      )}
                      {branches.length > 0 && (
                        <div className="mini-section">
                          分支 · {branches.length}
                          {branches.map((b) => (
                            <button
                              key={b.id}
                              onClick={() => {
                                p.setSelected([b.id]);
                                centerNode(b);
                              }}
                            >
                              {b.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {selected && (
                    <div className="node-quick-actions">
                      <button
                        title="继续对话"
                        aria-label={`继续 ${n.title}`}
                        onClick={() => p.continueChat(n.id)}
                      >
                        <Icon name="chat" size={14} />
                      </button>
                      <button
                        title="放大查看"
                        aria-label={`查看 ${n.title}`}
                        onClick={() => p.openChat(n.id)}
                      >
                        <Icon name="expand" size={14} />
                      </button>
                    </div>
                  )}
                  {p.activeId === n.id && p.draft && (
                    <div className="draft-preview">
                      正在输入 · {p.draft.slice(0, 70)}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <input
                    className="node-title-input"
                    aria-label="对象标题"
                    value={n.title}
                    onFocus={() => {
                      p.commit();
                      p.setSelected([n.id]);
                    }}
                    onChange={(e) =>
                      p.update(
                        p.project.nodes.map((item) =>
                          item.id === n.id
                            ? { ...item, title: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <textarea
                    className="node-content-input"
                    aria-label={`${n.title}内容`}
                    placeholder={
                      n.type === "frame" ? "为这一组想法命名…" : "写下一个想法…"
                    }
                    value={n.content}
                    onFocus={() => {
                      p.commit();
                      p.setSelected([n.id]);
                    }}
                    onChange={(e) =>
                      p.update(
                        p.project.nodes.map((item) =>
                          item.id === n.id
                            ? { ...item, content: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </>
              )}
              {selected && (
                <button
                  className="resize-handle"
                  aria-label="调整对象大小"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    p.commit();
                    drag.current = {
                      kind: "resize",
                      start: { x: e.clientX, y: e.clientY },
                      nodes: p.project.nodes,
                      view,
                      moved: false,
                      id: n.id,
                    };
                  }}
                />
              )}
            </article>
          );
        })}
        {box && (
          <div
            className="selection-box"
            style={{
              left: Math.min(box.start.x, box.end.x),
              top: Math.min(box.start.y, box.end.y),
              width: Math.abs(box.start.x - box.end.x),
              height: Math.abs(box.start.y - box.end.y),
            }}
          />
        )}
      </div>
      {!p.project.nodes.length && !menu && (
        <div className="canvas-empty">
          <div className="empty-symbol">
            <Icon name="spark" size={26} />
          </div>
          <h1>让想法，长出新的可能。</h1>
          <p>从一次对话开始，在白板上连接每一个灵感。</p>
          <button
            className="primary"
            onClick={() =>
              p.create(
                "chat",
                worldPoint({
                  x: surface.current!.clientWidth / 2 - 124,
                  y: surface.current!.clientHeight / 2 - 100,
                }),
              )
            }
          >
            <Icon name="plus" size={15} /> 开始第一段对话
          </button>
          <small>双击空白创建内容 · 拖动框选 · 空格拖动白板</small>
        </div>
      )}
      <nav className="canvas-toolbar" aria-label="白板工具">
        {tools.map((t) => (
          <button
            key={t.id}
            className={p.tool === t.id ? "active" : ""}
            title={t.label}
            aria-label={t.label}
            onClick={() => {
              p.setTool(t.id);
              setMenu(undefined);
            }}
          >
            <Icon name={t.icon} size={17} />
          </button>
        ))}
        <span />
        <button
          aria-label="整理选中内容"
          title="整理选中内容"
          onClick={p.generate}
        >
          <Icon name="spark" size={17} />
        </button>
      </nav>
      {p.selected.length > 0 && (
        <div className="selection-actions">
          <span>已选 {p.selected.length} 项</span>
          <button onClick={p.generate}>
            <Icon name="spark" size={14} /> 整理成果
          </button>
          <button onClick={() => p.remove()} aria-label="删除选中内容">
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
      {p.tool !== "select" && (
        <div className="tool-hint">
          {p.tool === "link"
            ? source
              ? "选择连线终点"
              : "选择连线起点"
            : `点击白板放置${tools.find((t) => t.id === p.tool)?.label.replace("新建", "")}`}
          <kbd>Esc</kbd>
        </div>
      )}
      <div className="zoom-controls">
        <button
          aria-label="缩小"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.max(0.25, v.zoom - 0.1) }))
          }
        >
          −
        </button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button
          aria-label="放大"
          onClick={() =>
            setView((v) => ({ ...v, zoom: Math.min(2, v.zoom + 0.1) }))
          }
        >
          +
        </button>
        <i />
        <button aria-label="适应全部内容" title="适应全部内容" onClick={fit}>
          <Icon name="expand" size={15} />
        </button>
      </div>
      {menu && (
        <div
          className="create-palette"
          style={{ left: menu.screen.x, top: menu.screen.y }}
          role="menu"
          aria-label="创建菜单"
        >
          <div className="palette-heading">
            添加到白板 <kbd>ESC</kbd>
          </div>
          {tools
            .filter((t) => t.id !== "select")
            .map((t) => (
              <button
                key={t.id}
                role="menuitem"
                onClick={() => {
                  if (t.id === "link") p.setTool("link");
                  else p.create(t.id as CanvasNode["type"], menu.world);
                  setMenu(undefined);
                }}
              >
                <Icon name={t.icon} size={17} />
                {t.label.replace("新建", "新")}
                <span>{t.id === "link" ? "连接想法" : "创建内容"}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
