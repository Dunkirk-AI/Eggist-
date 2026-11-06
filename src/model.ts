export type Point = { x: number; y: number };
export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  text?: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  status: "complete" | "pending" | "failed";
  marked?: boolean;
  attachments?: Attachment[];
  model?: string;
  error?: string;
};
export type CanvasNode = {
  id: string;
  type: "chat" | "sticky" | "text" | "frame";
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expansion: 0 | 1 | 2;
  messages: Message[];
  parentId?: string;
  branchMessageId?: string;
  context?: Message[];
};
export type Edge = { id: string; sourceId: string; targetId: string };
export type Report = {
  id: string;
  title: string;
  kind: string;
  markdown: string;
  sourceIds: string[];
  createdAt: string;
};
export type Project = {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: Edge[];
  reports: Report[];
  createdAt: string;
  updatedAt: string;
};
export type Workspace = {
  version: 1;
  projects: Project[];
  activeProjectId: string;
};
export type ModelSettings = {
  mode: "demo" | "api";
  baseUrl: string;
  model: string;
  systemPrompt: string;
  agent: string;
};
export const STORAGE_KEY = "eggist.workspace.v1";
export const SETTINGS_KEY = "eggist.settings.v1";
export const uid = (prefix = "id") => `${prefix}-${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export const defaultSettings: ModelSettings = {
  mode: "demo",
  baseUrl: "",
  model: "",
  systemPrompt: "",
  agent: "research",
};
export const agents = {
  research: {
    name: "研究助手",
    prompt:
      "你是一名严谨的研究助手。帮助用户拆解问题，区分事实与假设，不编造来源。用中文和 Markdown 回答。",
  },
  critic: {
    name: "批判性思考",
    prompt:
      "你是批判性思考助手。识别论证中的假设、风险和反例，提出验证方法，不编造事实。用中文回答。",
  },
  ideation: {
    name: "灵感发散",
    prompt:
      "你是创意伙伴。从不同角度提出具体可执行的想法，说明适用条件和验证步骤。用中文回答。",
  },
} as const;
export function createProject(name: string): Project {
  return {
    id: uid("project"),
    name,
    nodes: [],
    edges: [],
    reports: [],
    createdAt: now(),
    updatedAt: now(),
  };
}
export function freshWorkspace(): Workspace {
  const p = createProject("我的第一个项目");
  return { version: 1, projects: [p], activeProjectId: p.id };
}
export function validateWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const w = value as Workspace;
  if (
    w.version !== 1 ||
    !Array.isArray(w.projects) ||
    !w.projects.length ||
    w.projects.length > 200
  )
    return false;
  const projectIds = new Set<string>();
  for (const p of w.projects) {
    if (
      !p ||
      typeof p.id !== "string" ||
      projectIds.has(p.id) ||
      typeof p.name !== "string" ||
      !Array.isArray(p.nodes) ||
      !Array.isArray(p.edges) ||
      !Array.isArray(p.reports)
    )
      return false;
    projectIds.add(p.id);
    const ids = new Set(p.nodes.map((n) => n?.id));
    if (ids.size !== p.nodes.length) return false;
    for (const n of p.nodes) {
      if (
        !n ||
        typeof n.id !== "string" ||
        !["chat", "sticky", "text", "frame"].includes(n.type) ||
        typeof n.title !== "string" ||
        typeof n.content !== "string" ||
        ![n.x, n.y, n.width, n.height].every(Number.isFinite) ||
        n.width < 50 ||
        n.height < 40 ||
        ![0, 1, 2].includes(n.expansion) ||
        !Array.isArray(n.messages)
      )
        return false;
      if (n.parentId && !ids.has(n.parentId)) return false;
      if (
        [...n.messages, ...(n.context || [])].some(
          (m) =>
            !m ||
            typeof m.id !== "string" ||
            !["user", "assistant"].includes(m.role) ||
            typeof m.content !== "string" ||
            !["complete", "pending", "failed"].includes(m.status) ||
            (m.attachments &&
              (!Array.isArray(m.attachments) ||
                m.attachments.some(
                  (a) =>
                    typeof a.id !== "string" ||
                    typeof a.name !== "string" ||
                    typeof a.type !== "string" ||
                    !Number.isFinite(a.size),
                ))),
        )
      )
        return false;
    }
    for (const n of p.nodes) {
      const seen = new Set([n.id]);
      let parent = n.parentId;
      while (parent) {
        if (seen.has(parent)) return false;
        seen.add(parent);
        parent = p.nodes.find((item) => item.id === parent)?.parentId;
      }
    }
    if (
      p.edges.some(
        (e) =>
          !e ||
          typeof e.id !== "string" ||
          !ids.has(e.sourceId) ||
          !ids.has(e.targetId),
      )
    )
      return false;
    if (
      p.reports.some(
        (r) =>
          !r ||
          typeof r.id !== "string" ||
          typeof r.title !== "string" ||
          typeof r.markdown !== "string" ||
          !Array.isArray(r.sourceIds),
      )
    )
      return false;
  }
  return projectIds.has(w.activeProjectId);
}
export function readWorkspace(): { data: Workspace; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { data: freshWorkspace() };
    const parsed = JSON.parse(raw);
    if (!validateWorkspace(parsed)) throw new Error("invalid workspace");
    // Interrupted requests become retryable after a refresh. Never fabricate a completed response.
    parsed.projects.forEach((p: Project) =>
      p.nodes.forEach((n) =>
        n.messages.forEach((m) => {
          if (m.status === "pending") {
            m.status = "failed";
            m.error = "请求已中断，请重试";
          }
        }),
      ),
    );
    return { data: parsed };
  } catch {
    return {
      data: freshWorkspace(),
      error:
        "本地数据无法读取。原始数据已保留；请在设置中下载原始备份后再恢复保存。",
    };
  }
}
export function makeNode(
  type: CanvasNode["type"],
  point: Point,
  title?: string,
): CanvasNode {
  return {
    id: uid(type),
    type,
    title:
      title ||
      { chat: "新对话", sticky: "便签", text: "文字", frame: "画框" }[type],
    content: "",
    ...point,
    width: type === "frame" ? 440 : type === "chat" ? 199 : 220,
    height:
      type === "frame"
        ? 300
        : type === "text"
          ? 110
          : type === "chat"
            ? 154
            : 175,
    expansion: 0,
    messages: [],
  };
}
export function branchNode(
  source: CanvasNode,
  messageId: string | undefined,
  point: Point,
): CanvasNode {
  const index = messageId
    ? source.messages.findIndex((m) => m.id === messageId)
    : source.messages.length - 1;
  const context = [
    ...(source.context || []),
    ...source.messages.slice(0, index + 1),
  ].filter((m) => m.status === "complete");
  return {
    ...makeNode("chat", point, `${source.title} · 分支`),
    parentId: source.id,
    branchMessageId: messageId,
    context: structuredClone(context),
  };
}
export function contextMessages(node: CanvasNode) {
  return [...(node.context || []), ...node.messages].filter(
    (m) => m.status === "complete",
  );
}
export function searchProject(project: Project, query: string) {
  const q = query.trim().toLocaleLowerCase();
  return q
    ? project.nodes.filter((n) =>
        `${n.title}\n${n.content}\n${n.messages.map((m) => m.content).join("\n")}`
          .toLocaleLowerCase()
          .includes(q),
      )
    : [];
}
export function reportSource(nodes: CanvasNode[]) {
  return nodes
    .map(
      (n) =>
        `## ${n.title}\n${n.content}\n${contextMessages(n)
          .map(
            (m) =>
              `### ${m.role === "user" ? "用户" : "助手"}${m.marked ? " · 已标记" : ""}\n${m.content}`,
          )
          .join("\n\n")}`,
    )
    .join("\n\n");
}
export function buildLocalReport(kind: string, nodes: CanvasNode[]): string {
  return `# ${kind}\n\n> 本地整理：下文保留选中内容与原始对话，不代表新的调研结论。\n\n## 待验证的问题\n\n- 哪些判断有证据支持？\n- 哪些是假设，需要进一步验证？\n- 下一步最小实验是什么？\n\n## 内容来源\n\n${reportSource(nodes)}`;
}
export async function putAttachment(file: File): Promise<Attachment> {
  const id = uid("file");
  const db = await openFiles();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const text =
    /^(text\/|application\/json)/.test(file.type) ||
    /\.(md|txt|csv|json|ts|js|py)$/i.test(file.name)
      ? (await file.text()).slice(0, 100_000)
      : undefined;
  return { id, name: file.name, type: file.type, size: file.size, text };
}
function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("eggist-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function getAttachment(id: string): Promise<Blob | undefined> {
  const db = await openFiles();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction("files").objectStore("files").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
export function download(
  name: string,
  text: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
