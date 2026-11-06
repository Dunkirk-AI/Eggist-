import { useEffect, useRef, useState, type FormEvent } from "react";
import Canvas, { type Tool } from "./components/Canvas";
import { Icon } from "./components/Icon";
import { Markdown } from "./components/Markdown";
import { AttachmentImage } from "./components/AttachmentImage";
import { generateReply, attachmentLabel, type TaskStep } from "./ai";
import {
  agents,
  branchNode,
  buildLocalReport,
  contextMessages,
  createProject,
  defaultSettings,
  download,
  getAttachment,
  makeNode,
  now,
  putAttachment,
  readWorkspace,
  reportSource,
  searchProject,
  SETTINGS_KEY,
  STORAGE_KEY,
  uid,
  validateWorkspace,
  type Attachment,
  type CanvasNode,
  type Message,
  type ModelSettings,
  type Point,
  type Project,
  type Report,
  type Workspace,
} from "./model";

type Section = "board" | "reports" | "history" | "home";
type RunningTask = {
  id: string;
  projectId: string;
  nodeId?: string;
  title: string;
  steps: TaskStep[];
  state: "running" | "done" | "error";
  controller: AbortController;
};
type Dialog =
  "settings" | "project" | "report" | "search" | "delete" | undefined;
type Usage = {
  date: string;
  rounds: number;
  tokens: number;
  realRequests: number;
};
type ModelProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
};
const reportKinds = [
  "调研文档",
  "竞品报告",
  "痛点观察",
  "IDEA",
  "PPT",
  "自定义成果",
];

export default function App() {
  const [initial] = useState(readWorkspace);
  const [workspace, setWorkspace] = useState<Workspace>(initial.data);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [storageError, setStorageError] = useState(initial.error || "");
  const [saveAllowed, setSaveAllowed] = useState(!initial.error);
  const [saved, setSaved] = useState(true);
  const [settings, setSettings] = useState<ModelSettings>(() => {
    try {
      return {
        ...defaultSettings,
        ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
      };
    } catch {
      return defaultSettings;
    }
  });
  const [apiKey, setApiKey] = useState("");
  const [profiles, setProfiles] = useState<ModelProfile[]>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("eggist.models.v1") || "[]",
      );
      return Array.isArray(value)
        ? value.filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              typeof p.baseUrl === "string" &&
              typeof p.model === "string",
          )
        : [];
    } catch {
      return [];
    }
  });
  const providerKeys = useRef(new Map<string, string>());
  const [profileName, setProfileName] = useState("");
  function useProfile(id: string) {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    providerKeys.current.set(settings.baseUrl, apiKey);
    setApiKey(providerKeys.current.get(profile.baseUrl) || "");
    setSettings((s) => ({
      ...s,
      mode: "api",
      baseUrl: profile.baseUrl,
      model: profile.model,
    }));
  }
  function saveProfile() {
    if (!settings.baseUrl.trim() || !settings.model.trim()) {
      notify("先填写接口地址和模型 ID");
      return;
    }
    const profile = {
      id: uid("model"),
      name: profileName.trim() || settings.model,
      baseUrl: settings.baseUrl.trim(),
      model: settings.model.trim(),
    };
    setProfiles((s) =>
      [
        ...s.filter(
          (p) => !(p.baseUrl === profile.baseUrl && p.model === profile.model),
        ),
        profile,
      ].slice(-20),
    );
    providerKeys.current.set(profile.baseUrl, apiKey);
    setProfileName("");
    notify("已保存常用模型，可以在输入框快速切换");
  }
  const [mode, setMode] = useState<"board" | "chat">("board");
  const [section, setSection] = useState<Section>("board");
  const [sidebar, setSidebar] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [target, setTarget] = useState<"new" | "continue" | "branch">("new");
  const [dialog, setDialog] = useState<Dialog>();
  const [projectName, setProjectName] = useState("");
  const [editProject, setEditProject] = useState(false);
  const [query, setQuery] = useState("");
  const [reportKind, setReportKind] = useState("调研文档");
  const [reportTitle, setReportTitle] = useState("");
  const [reportPrompt, setReportPrompt] = useState("");
  const [validationModels, setValidationModels] = useState<string[]>([]);
  const [reportId, setReportId] = useState<string>();
  const [selectedReports, setSelectedReports] = useState<string[]>([]);
  const [rightbar, setRightbar] = useState(false);
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [demoFail, setDemoFail] = useState(false);
  const [undoStack, setUndoStack] = useState<Project[]>([]);
  const [redoStack, setRedoStack] = useState<Project[]>([]);
  const [usage, setUsage] = useState<Usage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("eggist.usage.v1") || "[]");
    } catch {
      return [];
    }
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftByProject = useRef(
    new Map<
      string,
      {
        draft: string;
        attachments: Attachment[];
        activeId?: string;
        target: typeof target;
      }
    >(),
  );
  const project = workspace.projects.find(
    (p) => p.id === workspace.activeProjectId,
  )!;
  const active = project.nodes.find(
    (n) => n.id === activeId && n.type === "chat",
  );
  const currentReport = project.reports.find((r) => r.id === reportId);
  const currentTask = tasks.find(
    (t) =>
      t.nodeId === activeId &&
      t.projectId === project.id &&
      t.state === "running",
  );
  const selectedNodes = project.nodes.filter((n) => selected.includes(n.id));
  const searchResults = searchProject(project, query);
  const reportResults = query.trim()
    ? project.reports.filter((r) =>
        `${r.title}\n${r.markdown}`.toLowerCase().includes(query.toLowerCase()),
      )
    : [];
  const totalRounds = usage.reduce((sum, u) => sum + u.rounds, 0),
    totalTokens = usage.reduce((sum, u) => sum + u.tokens, 0);

  function notify(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }
  function changeProject(id: string, update: (p: Project) => Project) {
    setWorkspace((w) => ({
      ...w,
      projects: w.projects.map((p) =>
        p.id === id ? { ...update(p), updatedAt: now() } : p,
      ),
    }));
  }
  function patchProject(patch: Partial<Project>) {
    changeProject(project.id, (p) => ({ ...p, ...patch }));
  }
  function commit() {
    setUndoStack((s) => [...s.slice(-39), structuredClone(project)]);
    setRedoStack([]);
  }
  function restoreCanvas(snapshot: Project) {
    patchProject({
      nodes: snapshot.nodes.map((n) => {
        const latest = project.nodes.find((item) => item.id === n.id);
        return latest && n.type === "chat"
          ? { ...n, messages: latest.messages }
          : n;
      }),
      edges: snapshot.edges,
    });
  }
  function undo() {
    const prev = undoStack.at(-1);
    if (!prev || tasks.some((t) => t.state === "running")) return;
    setRedoStack((s) => [...s, structuredClone(project)]);
    setUndoStack((s) => s.slice(0, -1));
    restoreCanvas(prev);
    setSelected([]);
  }
  function redo() {
    const next = redoStack.at(-1);
    if (!next || tasks.some((t) => t.state === "running")) return;
    setUndoStack((s) => [...s, structuredClone(project)]);
    setRedoStack((s) => s.slice(0, -1));
    restoreCanvas(next);
    setSelected([]);
  }
  function updateNode(
    id: string,
    fn: (n: CanvasNode) => CanvasNode,
    projectId = project.id,
  ) {
    changeProject(projectId, (p) => ({
      ...p,
      nodes: p.nodes.map((n) => (n.id === id ? fn(n) : n)),
    }));
  }
  function openChat(id: string) {
    setSelected([id]);
    setActiveId(id);
    setTarget("continue");
    setMode("chat");
    setSection("board");
    setSidebar(true);
  }
  function continueChat(id: string) {
    setActiveId(id);
    setSelected([id]);
    setTarget("continue");
    inputRef.current?.focus();
  }
  function changeMode(next: "board" | "chat") {
    if (mode !== next) setSidebar(true);
    setMode(next);
    setSection("board");
    setTool("select");
  }
  function switchProject(id: string) {
    draftByProject.current.set(project.id, {
      draft,
      attachments,
      activeId,
      target,
    });
    const state = draftByProject.current.get(id);
    setWorkspace((w) => ({ ...w, activeProjectId: id }));
    setSelected([]);
    setActiveId(state?.activeId);
    setDraft(state?.draft || "");
    setAttachments(state?.attachments || []);
    setTarget(state?.target || "new");
    setUndoStack([]);
    setRedoStack([]);
    setReportId(undefined);
    setMode("board");
    setSection("board");
    setTool("select");
  }
  function visibleCenter(): Point {
    const element = document.querySelector<HTMLElement>("[data-testid=canvas]");
    const canvas = element?.getBoundingClientRect();
    const zoom = Number(element?.dataset.zoom) || 1;
    return {
      x:
        ((canvas?.width || 1000) / 2 - (Number(element?.dataset.viewX) || 0)) /
          zoom -
        99.5,
      y:
        ((canvas?.height || 650) / 2 - (Number(element?.dataset.viewY) || 0)) /
          zoom -
        100,
    };
  }
  function availableChatPoint(point: Point, direction = 1): Point {
    let y = point.y;
    while (
      project.nodes.some(
        (n) =>
          n.type !== "frame" &&
          point.x < n.x + n.width + 20 &&
          point.x + 219 > n.x &&
          y <
            n.y +
              n.height +
              (n.type === "chat" && n.expansion
                ? n.expansion === 1
                  ? 200
                  : 330
                : 0) +
              20 &&
          y + 174 > n.y,
      )
    )
      y += direction * 220;
    return { x: point.x, y };
  }
  function create(type: CanvasNode["type"], point: Point) {
    commit();
    const n = makeNode(type, point);
    patchProject({ nodes: [...project.nodes, n] });
    setSelected([n.id]);
    if (type === "chat") {
      setActiveId(n.id);
      setTarget("continue");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
    return n;
  }
  function branch(id: string, messageId?: string, direction = 1) {
    const source = project.nodes.find((n) => n.id === id);
    if (!source) return;
    commit();
    const n = branchNode(
      source,
      messageId,
      availableChatPoint(
        {
          x: source.x + source.width + 80,
          y: source.y + direction * 230,
        },
        direction,
      ),
    );
    patchProject({
      nodes: [...project.nodes, n],
      edges: [
        ...project.edges,
        { id: uid("edge"), sourceId: id, targetId: n.id },
      ],
    });
    setSelected([n.id]);
    setActiveId(n.id);
    setFocusId(n.id);
    setTarget("continue");
    notify(`分支已创建，保留 ${n.context?.length || 0} 条上文`);
    return n;
  }
  function connect(a: string, b: string) {
    if (
      project.edges.some(
        (e) =>
          (e.sourceId === a && e.targetId === b) ||
          (e.sourceId === b && e.targetId === a),
      )
    ) {
      notify("这两个节点已经连接");
      return;
    }
    commit();
    patchProject({
      edges: [...project.edges, { id: uid("edge"), sourceId: a, targetId: b }],
    });
  }
  function mark(nodeId: string, messageId: string) {
    commit();
    updateNode(nodeId, (n) => ({
      ...n,
      messages: n.messages.map((m) =>
        m.id === messageId ? { ...m, marked: !m.marked } : m,
      ),
    }));
  }
  function removeSelected(ids = selected) {
    if (!ids.length) return;
    if (
      tasks.some((t) => t.state === "running" && ids.includes(t.nodeId || ""))
    ) {
      notify("请先停止选中节点的任务");
      return;
    }
    setSelected(ids);
    setDialog("delete");
  }
  function confirmDelete() {
    commit();
    const ids = new Set(selected);
    patchProject({
      nodes: project.nodes
        .filter((n) => !ids.has(n.id))
        .map((n) =>
          ids.has(n.parentId || "")
            ? { ...n, parentId: undefined, branchMessageId: undefined }
            : n,
        ),
      edges: project.edges.filter(
        (e) => !ids.has(e.sourceId) && !ids.has(e.targetId),
      ),
    });
    if (ids.has(activeId || "")) {
      setActiveId(undefined);
      setTarget("new");
    }
    setSelected([]);
    setDialog(undefined);
  }

  useEffect(() => {
    if (!saveAllowed) return;
    setSaved(false);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        setSaved(true);
        setStorageError("");
      } catch {
        setStorageError("本地存储空间不足，最新修改尚未保存。请立即导出备份。");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [workspace, saveAllowed]);
  useEffect(() => {
    const save = () => {
      if (saveAllowed)
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(workspaceRef.current),
          );
        } catch {
          /* The visible save error is handled by the scheduled save. */
        }
    };
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [saveAllowed]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      notify("模型设置无法保存");
    }
  }, [settings]);
  useEffect(() => {
    try {
      localStorage.setItem("eggist.models.v1", JSON.stringify(profiles));
    } catch {
      notify("常用模型配置无法保存");
    }
  }, [profiles]);
  useEffect(() => {
    try {
      localStorage.setItem("eggist.usage.v1", JSON.stringify(usage));
    } catch {
      /* Workspace save status remains separate. */
    }
  }, [usage]);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [active?.messages, mode]);
  useEffect(
    () => () => {
      tasksRef.current.forEach((t) => t.controller.abort());
      clearTimeout(toastTimer.current);
    },
    [],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.closest(
        "input,textarea,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setDialog("search");
      }
      if (e.key === "Escape") {
        setDialog(undefined);
        setRightbar(false);
        setTool("select");
      }
      if (editing || dialog) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement;
    const modal = document.querySelector<HTMLElement>(".modal");
    const first = modal?.querySelector<HTMLElement>(
      "input:not([type=hidden]),textarea,button",
    );
    if (!modal?.contains(document.activeElement)) first?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modal) return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not([type=hidden]):not(:disabled),textarea,select,[tabindex="0"]',
        ),
      );
      const a = focusable[0],
        b = focusable.at(-1);
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        b?.focus();
      } else if (!e.shiftKey && document.activeElement === b) {
        e.preventDefault();
        a?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus?.();
    };
  }, [dialog]);
  function logUsage(tokens = 0, real = false) {
    const date = new Date().toLocaleDateString("sv-SE");
    setUsage((s) => {
      const found = s.find((u) => u.date === date);
      return found
        ? s.map((u) =>
            u.date === date
              ? {
                  ...u,
                  rounds: u.rounds + 1,
                  tokens: u.tokens + tokens,
                  realRequests: u.realRequests + (real ? 1 : 0),
                }
              : u,
          )
        : [...s, { date, rounds: 1, tokens, realRequests: real ? 1 : 0 }];
    });
  }
  async function run(
    node: CanvasNode,
    pid: string,
    assistantId: string,
    connection?: { settings: ModelSettings; key: string },
  ) {
    const controller = new AbortController(),
      taskId = uid("task");
    const currentSettings = { ...(connection?.settings || settings) };
    const fail = demoFail && currentSettings.mode === "demo";
    setDemoFail(false);
    const task: RunningTask = {
      id: taskId,
      projectId: pid,
      nodeId: node.id,
      title: node.title,
      steps: [],
      state: "running",
      controller,
    };
    setTasks((s) =>
      [task, ...s].filter((t, i) => t.state === "running" || i < 30),
    );
    try {
      const result = await generateReply(
        node,
        currentSettings,
        connection?.key ?? apiKey,
        controller.signal,
        (step) =>
          setTasks((s) =>
            s.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    steps: [
                      ...t.steps.map((x) =>
                        x.state === "running"
                          ? { ...x, state: "done" as const }
                          : x,
                      ),
                      step,
                    ],
                  }
                : t,
            ),
          ),
        fail,
      );
      updateNode(
        node.id,
        (n) => ({
          ...n,
          messages: n.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: result.text, status: "complete" }
              : m,
          ),
        }),
        pid,
      );
      setTasks((s) =>
        s.map((t) => (t.id === taskId ? { ...t, state: "done" } : t)),
      );
      logUsage(result.tokens, currentSettings.mode === "api");
      notify(
        `「${node.title}」已完成${currentSettings.mode === "demo" ? " · 本地演示" : ""}`,
      );
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = aborted
        ? "已停止生成，可重试"
        : error instanceof Error
          ? error.message
          : "请求失败";
      updateNode(
        node.id,
        (n) => ({
          ...n,
          messages: n.messages.map((m) =>
            m.id === assistantId
              ? { ...m, status: "failed", error: message }
              : m,
          ),
        }),
        pid,
      );
      setTasks((s) =>
        s.map((t) =>
          t.id === taskId
            ? {
                ...t,
                state: "error",
                steps: [...t.steps, { label: message, state: "error" }],
              }
            : t,
        ),
      );
      notify(message);
    }
  }
  async function send(e?: FormEvent) {
    e?.preventDefault();
    if ((!draft.trim() && !attachments.length) || attaching) return;
    if (settings.mode === "api" && (!settings.baseUrl || !settings.model)) {
      setDialog("settings");
      notify("填写接口地址和模型 ID 后即可发送");
      return;
    }
    if (
      active?.messages.some((m) => m.status === "pending") &&
      target === "continue"
    )
      return;
    let n: CanvasNode;
    let edge: Project["edges"][number] | undefined;
    if (target === "continue" && active) n = active;
    else if (target === "branch" && active) {
      n = branchNode(
        active,
        undefined,
        availableChatPoint({
          x: active.x + 330,
          y: active.y + 220,
        }),
      );
      edge = { id: uid("edge"), sourceId: active.id, targetId: n.id };
    } else {
      const center = visibleCenter();
      n = makeNode("chat", availableChatPoint(center));
    }
    commit();
    const prompt = draft.trim() || "请分析这些附件";
    const assistantId = uid("message");
    const timestamp = now();
    const userMessage: Message = {
      id: uid("message"),
      role: "user",
      content: prompt,
      createdAt: timestamp,
      status: "complete",
      attachments,
    };
    const pending: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: timestamp,
      status: "pending",
      model: settings.mode === "demo" ? "本地演示" : settings.model,
    };
    n = {
      ...n,
      title: n.messages.length === 0 ? prompt.slice(0, 36) : n.title,
      messages: [...n.messages, userMessage, pending],
    };
    changeProject(project.id, (p) => ({
      ...p,
      nodes: p.nodes.some((item) => item.id === n.id)
        ? p.nodes.map((item) => (item.id === n.id ? n : item))
        : [...p.nodes, n],
      edges: edge ? [...p.edges, edge] : p.edges,
    }));
    setActiveId(n.id);
    setSelected([n.id]);
    setTarget("continue");
    setDraft("");
    setAttachments([]);
    setFocusId(n.id);
    await run(n, project.id, assistantId);
  }
  function retry(message: Message) {
    if (!active || currentTask) return;
    const index = active.messages.findIndex((m) => m.id === message.id);
    const preceding = active.messages.slice(0, index);
    const n = {
      ...active,
      messages: [
        ...preceding,
        {
          ...message,
          status: "pending" as const,
          error: undefined,
          content: "",
        },
      ],
    };
    updateNode(active.id, (item) => ({
      ...item,
      messages: item.messages.map((m) =>
        m.id === message.id ? { ...m, status: "pending", error: undefined } : m,
      ),
    }));
    void run(n, project.id, message.id);
  }
  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    if (attachments.length + list.length > 8) {
      notify("每条消息最多附加 8 个文件");
      return;
    }
    if (list.some((f) => f.size > 10 * 1024 * 1024)) {
      notify("单个附件不能超过 10 MB");
      return;
    }
    const pid = project.id;
    setAttaching(true);
    try {
      const result = await Promise.all(list.map(putAttachment));
      if (workspaceRef.current.activeProjectId === pid)
        setAttachments((s) => [...s, ...result]);
      else {
        const state = draftByProject.current.get(pid);
        if (state) state.attachments.push(...result);
      }
      notify("附件已保存到本地");
    } catch {
      notify("附件保存失败，请检查浏览器存储权限");
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function openFile(a: Attachment) {
    try {
      const blob = await getAttachment(a.id);
      if (!blob) {
        notify("附件文件不存在，此备份仅包含附件描述，请重新添加原文件");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify("无法读取附件");
    }
  }
  function openReportDialog() {
    if (!selectedNodes.length) {
      notify("先在白板上框选对话或便签，再整理成果");
      return;
    }
    setReportTitle("");
    setValidationModels(profiles.slice(0, 4).map((p) => p.id));
    setDialog("report");
  }
  async function parallelValidate() {
    const chosen = profiles
      .filter((p) => validationModels.includes(p.id))
      .slice(0, 4);
    if (!chosen.length || !selectedNodes.length) return;
    const source = reportSource(structuredClone(selectedNodes));
    const pid = project.id;
    const center = visibleCenter();
    const nodes = chosen.map((profile, i) => {
      const n = makeNode(
        "chat",
        { x: center.x + i * 285, y: center.y + 240 },
        `${profile.name} · 交叉验证`,
      );
      n.messages = [
        {
          id: uid("message"),
          role: "user",
          status: "complete",
          createdAt: now(),
          content: `请独立检验下列想法。指出证据不足、逻辑漏洞、风险与下一步验证方法。${reportPrompt}\n\n${source}`,
        },
        {
          id: uid("message"),
          role: "assistant",
          status: "pending",
          createdAt: now(),
          content: "",
          model: profile.model,
        },
      ];
      return n;
    });
    commit();
    patchProject({
      nodes: [...project.nodes, ...nodes],
      edges: [
        ...project.edges,
        ...nodes.flatMap((n) =>
          selectedNodes.map((s) => ({
            id: uid("edge"),
            sourceId: s.id,
            targetId: n.id,
          })),
        ),
      ],
    });
    setDialog(undefined);
    setSection("board");
    setMode("board");
    setSelected(nodes.map((n) => n.id));
    setActiveId(nodes[0].id);
    setFocusId(nodes[0].id);
    setRightbar(true);
    await Promise.all(
      nodes.map((n, i) => {
        const profile = chosen[i];
        return run(n, pid, n.messages[1].id, {
          settings: {
            ...settings,
            mode: "api",
            baseUrl: profile.baseUrl,
            model: profile.model,
            agent: "critic",
          },
          key:
            profile.baseUrl === settings.baseUrl
              ? apiKey
              : providerKeys.current.get(profile.baseUrl) || "",
        });
      }),
    );
  }
  async function generateReport() {
    const nodes = structuredClone(selectedNodes);
    if (!nodes.length) return;
    const pid = project.id,
      kind = reportKind,
      title = reportTitle.trim() || `${project.name} · ${kind}`;
    const report: Report = {
      id: uid("report"),
      title,
      kind,
      markdown: buildLocalReport(kind, nodes),
      sourceIds: nodes.map((n) => n.id),
      createdAt: now(),
    };
    setDialog(undefined);
    if (settings.mode === "api") {
      const controller = new AbortController(),
        id = uid("task");
      setTasks((s) => [
        { id, projectId: pid, title, steps: [], state: "running", controller },
        ...s,
      ]);
      try {
        const n = makeNode("chat", { x: 0, y: 0 });
        n.messages = [
          {
            id: uid(),
            role: "user",
            status: "complete",
            createdAt: now(),
            content: `将以下原始内容整理成${kind}，标题是${title}。${reportPrompt}。保留证据与假设的区别，不编造来源，返回完整 Markdown。\n\n${reportSource(nodes)}`,
          },
        ];
        const result = await generateReply(
          n,
          settings,
          apiKey,
          controller.signal,
          (step) =>
            setTasks((s) =>
              s.map((t) =>
                t.id === id ? { ...t, steps: [...t.steps, step] } : t,
              ),
            ),
        );
        report.markdown = result.text;
        logUsage(result.tokens, true);
        setTasks((s) =>
          s.map((t) => (t.id === id ? { ...t, state: "done" } : t)),
        );
      } catch (error) {
        notify(error instanceof Error ? error.message : "成果生成失败");
        setTasks((s) =>
          s.map((t) => (t.id === id ? { ...t, state: "error" } : t)),
        );
        return;
      }
    }
    changeProject(pid, (p) => ({ ...p, reports: [report, ...p.reports] }));
    if (workspaceRef.current.activeProjectId === pid) {
      setReportId(report.id);
      setSection("reports");
    }
    notify(
      settings.mode === "demo"
        ? "本地内容整理已保存到成果库"
        : "成果已生成并保存",
    );
  }
  function reportToChat(report: Report | Report[]) {
    const reports = Array.isArray(report) ? report : [report];
    if (!reports.length) return;
    commit();
    const n = makeNode(
      "chat",
      availableChatPoint(visibleCenter()),
      `围绕成果：${reports
        .map((r) => r.title)
        .join("、")
        .slice(0, 40)}`,
    );
    n.context = [
      {
        id: uid("context"),
        role: "user",
        content: `以下是已有成果，后续请基于此讨论：\n${reports.map((r) => `# ${r.title}\n${r.markdown}`).join("\n\n")}`,
        status: "complete",
        createdAt: now(),
      },
    ];
    patchProject({ nodes: [...project.nodes, n] });
    setActiveId(n.id);
    setSelected([n.id]);
    setTarget("continue");
    setSelectedReports([]);
    changeMode("chat");
    notify("已将成果作为新对话的上下文");
  }
  function backup() {
    download(
      `Eggist-备份-${new Date().toLocaleDateString("sv-SE")}.json`,
      JSON.stringify(workspace, null, 2),
      "application/json",
    );
    notify("已导出项目备份；附件原文件保留在当前浏览器");
  }
  async function importBackup(file?: File) {
    if (!file) return;
    if (tasks.some((t) => t.state === "running")) {
      notify("请先停止正在运行的任务，再导入备份");
      return;
    }
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error("备份不能超过 30 MB");
      const value: unknown = JSON.parse(await file.text());
      if (!validateWorkspace(value))
        throw new Error("备份格式不正确，原数据未修改");
      const existing = workspaceRef.current;
      const ids = new Set(existing.projects.map((p) => p.id));
      const imported = value.projects.map((p) => ({
        ...p,
        id: ids.has(p.id) ? uid("project") : p.id,
      }));
      setWorkspace({
        ...existing,
        projects: [...existing.projects, ...imported],
        activeProjectId: imported[0].id,
      });
      setSaveAllowed(true);
      setSelected([]);
      setActiveId(undefined);
      setDraft("");
      setAttachments([]);
      setUndoStack([]);
      setRedoStack([]);
      setSection("board");
      setMode("board");
      notify(`已导入 ${imported.length} 个项目，原项目已保留`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "导入失败");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }
  async function exportPpt(report: Report) {
    try {
      const { default: PptxGenJS } = await import("pptxgenjs");
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Eggist";
      pptx.subject = report.kind;
      pptx.title = report.title;
      const sections = report.markdown.split(/\n(?=#{1,2} )/);
      let pages = 0;
      for (const s of sections) {
        const lines = s.replace(/\*\*/g, "").split("\n");
        const title = lines.shift()?.replace(/^#+\s*/, "") || report.title;
        const body = lines.join("\n").trim();
        const chunks = body.match(/[\s\S]{1,650}/g) || [""];
        for (const chunk of chunks) {
          const slide = pptx.addSlide();
          slide.background = { color: "F7F7FA" };
          slide.addText(title.slice(0, 100), {
            x: 0.7,
            y: 0.6,
            w: 11.9,
            h: 0.8,
            fontSize: 26,
            bold: true,
            color: "282838",
            fontFace: "Microsoft YaHei",
          });
          slide.addText(chunk, {
            x: 0.7,
            y: 1.65,
            w: 11.9,
            h: 4.9,
            fontSize: 17,
            breakLine: false,
            color: "5A5A70",
            fontFace: "Microsoft YaHei",
            fit: "shrink",
            valign: "top",
          });
          slide.addText(`EGGIST · ${++pages}`, {
            x: 0.7,
            y: 7,
            w: 11,
            h: 0.2,
            fontSize: 9,
            color: "8D8D9F",
          });
        }
      }
      await pptx.writeFile({
        fileName: `${report.title.replace(/[<>:"/\\|?*]/g, "_")}.pptx`,
      });
    } catch {
      notify("PPT 导出失败，请先导出 Markdown");
    }
  }

  return (
    <main
      className={`app-shell ${sidebar ? "sidebar-visible" : ""} ${mode === "chat" ? "chat-mode" : ""}`}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
        }}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => void importBackup(e.target.files?.[0])}
      />
      {sidebar && (
        <aside className="sidebar" aria-label="工作区侧边栏">
          <div className="brand">
            <img src="/figma/brand.png" alt="" />
            <strong>Eggist</strong>
            <button
              title="收起侧边栏"
              aria-label="收起侧边栏"
              onClick={() => setSidebar(false)}
            >
              <Icon name="panel" size={16} />
            </button>
          </div>
          <button
            className={`nav-item ${section === "home" ? "active" : ""}`}
            onClick={() => setSection("home")}
          >
            <Icon name="home" size={16} />
            首页
          </button>
          <div className="sidebar-caption">
            <span>
              <Icon name="folder" size={15} /> 项目
            </span>
            <button
              title="新建项目"
              aria-label="新建项目"
              onClick={() => {
                setProjectName("");
                setEditProject(false);
                setDialog("project");
              }}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          <div className="project-list">
            {workspace.projects.map((p) => (
              <div key={p.id} className="project-group">
                <button
                  className={`project-name ${p.id === project.id ? "current" : ""}`}
                  onClick={() => switchProject(p.id)}
                >
                  <Icon name="folder" size={15} />
                  <span>{p.name}</span>
                  <Icon
                    name="chevron"
                    size={12}
                    style={{
                      transform:
                        p.id === project.id ? "rotate(90deg)" : undefined,
                    }}
                  />
                </button>
                {p.id === project.id && (
                  <div className="project-children">
                    <button
                      className={section === "board" ? "active" : ""}
                      onClick={() => {
                        setSection("board");
                        setMode("board");
                      }}
                    >
                      <span className="nav-color purple">
                        <Icon name="nav-board" size={12} />
                      </span>
                      白板
                    </button>
                    <button
                      className={section === "history" ? "active" : ""}
                      onClick={() => setSection("history")}
                    >
                      <span className="nav-color green">
                        <Icon name="chat" size={12} />
                      </span>
                      对话
                      <span className="count">
                        {p.nodes.filter((n) => n.type === "chat").length}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="新对话"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTarget("new");
                          setActiveId(undefined);
                          changeMode("chat");
                          inputRef.current?.focus();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            setTarget("new");
                            setActiveId(undefined);
                            changeMode("chat");
                          }
                        }}
                      >
                        <Icon name="plus" size={13} />
                      </span>
                    </button>
                    <div className="conversation-list">
                      {p.nodes
                        .filter((n) => n.type === "chat")
                        .slice(-8)
                        .map((n) => (
                          <button
                            key={n.id}
                            className={activeId === n.id ? "chosen" : ""}
                            title={n.title}
                            onClick={() => openChat(n.id)}
                          >
                            {n.parentId && <Icon name="branch" size={11} />}
                            <span>{n.title}</span>
                            {n.messages.some((m) => m.status === "pending") && (
                              <i className="busy-dot" />
                            )}
                          </button>
                        ))}
                    </div>
                    <button
                      className={section === "reports" ? "active" : ""}
                      onClick={() => setSection("reports")}
                    >
                      <span className="nav-color orange">
                        <Icon name="idea" size={12} />
                      </span>
                      成果库<span className="count">{p.reports.length}</span>
                      <Icon name="chevron" size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="sidebar-bottom">
            <button className="local-status" onClick={backup}>
              <span className={`save-dot ${storageError ? "error" : ""}`} />
              {storageError ? "保存异常" : saved ? "已保存到本机" : "正在保存…"}
              <Icon name="download" size={13} />
            </button>
            <div className="profile">
              <img src="/figma/avatar.png" alt="" />
              <span>
                本地工作空间<small>让灵感有迹可循</small>
              </span>
              <button
                aria-label="设置"
                title="模型与数据设置"
                onClick={() => setDialog("settings")}
              >
                <Icon name="settings" size={16} />
              </button>
            </div>
          </div>
        </aside>
      )}
      <section className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            {!sidebar && (
              <button
                aria-label="展开侧边栏"
                title="展开侧边栏"
                onClick={() => setSidebar(true)}
              >
                <Icon name="panel" size={16} />
              </button>
            )}
            <button
              title="重命名项目"
              onClick={() => {
                setProjectName(project.name);
                setEditProject(true);
                setDialog("project");
              }}
            >
              {project.name}
            </button>
            <span>/</span>
            <span>
              {section === "board"
                ? mode === "board"
                  ? "白板"
                  : "对话"
                : section === "reports"
                  ? "成果库"
                  : section === "history"
                    ? "聊天记录"
                    : "首页"}
            </span>
          </div>
          <div className="mode-switch" aria-label="视图模式">
            <button
              className={mode === "chat" && section === "board" ? "active" : ""}
              onClick={() => changeMode("chat")}
            >
              对话
            </button>
            <button
              className={
                mode === "board" && section === "board" ? "active" : ""
              }
              onClick={() => changeMode("board")}
            >
              白板
            </button>
          </div>
          <div className="topbar-actions">
            <button
              className="search-trigger"
              onClick={() => setDialog("search")}
            >
              <Icon name="search" size={13} />
              <span>找到 IDEA</span>
              <kbd>Ctrl F</kbd>
            </button>
            <button
              title="任务活动"
              aria-label="任务活动"
              className={rightbar ? "active" : ""}
              onClick={() => setRightbar((s) => !s)}
            >
              <Icon name="globe" size={17} />
              {tasks.some((t) => t.state === "running") && (
                <i className="busy-dot" />
              )}
            </button>
          </div>
        </header>
        {storageError && (
          <div className="storage-banner" role="alert">
            {storageError}
            <button onClick={backup}>导出当前内容</button>
            <button
              onClick={() =>
                download(
                  "Eggist-原始数据.json",
                  localStorage.getItem(STORAGE_KEY) || "{}",
                  "application/json",
                )
              }
            >
              下载原始备份
            </button>
          </div>
        )}
        <div className="content-area">
          {section === "board" && mode === "board" && (
            <Canvas
              key={project.id}
              project={project}
              selected={selected}
              setSelected={(ids) => {
                setSelected(ids);
                const n = project.nodes.find(
                  (n) => ids.includes(n.id) && n.type === "chat",
                );
                if (n) {
                  setActiveId(n.id);
                  setTarget("continue");
                }
              }}
              update={(nodes) => patchProject({ nodes })}
              commit={commit}
              create={create}
              connect={connect}
              branch={branch}
              openChat={openChat}
              continueChat={continueChat}
              remove={removeSelected}
              generate={openReportDialog}
              mark={mark}
              tool={tool}
              setTool={setTool}
              focusId={focusId}
              draft={draft}
              activeId={activeId}
            />
          )}
          {section === "board" && mode === "chat" && (
            <div
              className={`chat-view ${!active?.messages.length ? "empty-chat" : ""}`}
              data-testid="chat-view"
              ref={scrollRef}
            >
              {!active?.messages.length ? (
                <div className="chat-welcome">
                  <span className="welcome-icon">
                    <Icon name="spark" size={26} />
                  </span>
                  <h1>
                    {active?.context?.length
                      ? "沿着这个想法，继续探索。"
                      : "今天，想探索什么？"}
                  </h1>
                  <p>
                    {active?.context?.length
                      ? `已继承 ${active.context.length} 条上下文，新的对话将保存在此分支。`
                      : "一个问题、一个想法，都可以从这里开始。"}
                  </p>
                  <div className="suggestions">
                    {[
                      "规划一张游戏地图",
                      "比较两种设计方案",
                      "整理我的研究资料",
                      "帮我打开一个思路",
                    ].map((text, i) => (
                      <button
                        key={text}
                        onClick={() => {
                          setDraft(text);
                          inputRef.current?.focus();
                        }}
                      >
                        <Icon
                          name={["board", "panel", "file", "spark"][i]}
                          size={20}
                        />
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="chat-thread">
                  <div className="thread-heading">
                    <div>
                      <span className="eyebrow">
                        {active.parentId ? "分支对话" : "对话"}
                      </span>
                      <h1>{active.title}</h1>
                    </div>
                    <button
                      title="返回白板"
                      aria-label="返回白板"
                      onClick={() => {
                        changeMode("board");
                        setFocusId(active.id);
                        setSelected([active.id]);
                      }}
                    >
                      <Icon name="close" size={17} />
                    </button>
                  </div>
                  {!!active.context?.length && (
                    <details className="context-details">
                      <summary>
                        继承的上下文 · {active.context.length} 条
                      </summary>
                      {active.context.map((m) => (
                        <div key={m.id}>
                          <small>{m.role === "user" ? "你" : "助手"}</small>
                          <Markdown text={m.content} />
                        </div>
                      ))}
                    </details>
                  )}
                  {active.messages.map((m) => (
                    <article
                      key={m.id}
                      className={`message ${m.role} ${m.status}`}
                      data-testid={`message-${m.role}`}
                    >
                      <div className="message-avatar">
                        {m.role === "user" ? (
                          <img src="/figma/avatar.png" alt="" />
                        ) : (
                          <Icon name="spark" size={17} />
                        )}
                      </div>
                      <div className="message-content">
                        <div className="message-meta">
                          <strong>
                            {m.role === "user" ? "你" : m.model || "研究助手"}
                          </strong>
                          <time>
                            {new Date(m.createdAt).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          {m.marked && (
                            <span className="marked-tag">已标记</span>
                          )}
                        </div>
                        {m.status === "pending" ? (
                          <button
                            className="thinking"
                            onClick={() => setRightbar(true)}
                          >
                            <span className="typing">
                              <i />
                              <i />
                              <i />
                            </span>
                            正在思考，点此查看任务进度
                          </button>
                        ) : m.status === "failed" ? (
                          <div className="failed-message">
                            <p>{m.error}</p>
                            <button
                              onClick={() => retry(m)}
                              disabled={!!currentTask}
                            >
                              重试
                            </button>
                          </div>
                        ) : (
                          <Markdown text={m.content} />
                        )}
                        {!!m.attachments?.length && (
                          <div className="message-attachments">
                            {m.attachments.map((a) => (
                              <button
                                key={a.id}
                                onClick={() => void openFile(a)}
                              >
                                {a.type.startsWith("image/") && (
                                  <AttachmentImage
                                    attachment={a}
                                    className="message-image"
                                  />
                                )}
                                <Icon name="attachment" size={14} />
                                {a.name}
                                <Icon name="download" size={12} />
                              </button>
                            ))}
                          </div>
                        )}
                        {m.status === "complete" && (
                          <div className="message-actions">
                            <button
                              aria-label={m.marked ? "取消标记" : "标记消息"}
                              title={m.marked ? "取消标记" : "标记消息"}
                              className={m.marked ? "marked" : ""}
                              onClick={() => mark(active.id, m.id)}
                            >
                              <Icon name="bookmark" size={14} />
                            </button>
                            <button
                              title="从这条消息创建分支"
                              aria-label="从这条消息创建分支"
                              onClick={() => {
                                const n = branch(active.id, m.id);
                                if (n) openChat(n.id);
                              }}
                            >
                              <Icon name="branch" size={14} />
                              <span>分支</span>
                            </button>
                            <button
                              title="复制内容"
                              aria-label="复制内容"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(m.content)
                                  .then(() => notify("内容已复制"))
                                  .catch(() => notify("浏览器不允许访问剪贴板"))
                              }
                            >
                              <Icon name="file" size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {section === "reports" && (
            <div className="library-view">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">成果，让想法被看见</span>
                  <h1>
                    成果库 <span>{project.reports.length}</span>
                  </h1>
                  <p>把对话中的发现，沉淀为下一步的起点。</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => changeMode("board")}
                >
                  <Icon name="board" size={15} />
                  在白板选择内容
                </button>
              </div>
              {currentReport ? (
                <div className="report-detail">
                  <div className="report-toolbar">
                    <button onClick={() => setReportId(undefined)}>
                      ‹ 全部成果
                    </button>
                    <span>
                      {currentReport.kind} ·{" "}
                      {new Date(currentReport.createdAt).toLocaleDateString(
                        "zh-CN",
                      )}
                    </span>
                    <button onClick={() => reportToChat(currentReport)}>
                      <Icon name="chat" size={14} />
                      继续探索
                    </button>
                    <button
                      title="导出 Markdown"
                      onClick={() =>
                        download(
                          `${currentReport.title}.md`,
                          currentReport.markdown,
                        )
                      }
                    >
                      <Icon name="download" size={14} />
                      MD
                    </button>
                    <button
                      title="打印或另存为 PDF"
                      onClick={() => window.print()}
                    >
                      <Icon name="file" size={14} />
                      PDF
                    </button>
                    <button
                      title="导出 PowerPoint"
                      onClick={() => void exportPpt(currentReport)}
                    >
                      PPTX
                    </button>
                  </div>
                  <input
                    className="report-title-input"
                    aria-label="成果标题"
                    value={currentReport.title}
                    onChange={(e) =>
                      patchProject({
                        reports: project.reports.map((r) =>
                          r.id === currentReport.id
                            ? { ...r, title: e.target.value }
                            : r,
                        ),
                      })
                    }
                  />
                  <div className="report-editor">
                    <textarea
                      aria-label="编辑成果 Markdown"
                      value={currentReport.markdown}
                      onChange={(e) =>
                        patchProject({
                          reports: project.reports.map((r) =>
                            r.id === currentReport.id
                              ? { ...r, markdown: e.target.value }
                              : r,
                          ),
                        })
                      }
                    />
                    <div className="report-preview">
                      <Markdown text={currentReport.markdown} />
                    </div>
                  </div>
                  <div className="report-sources">
                    来源节点：
                    {currentReport.sourceIds.map((id) => {
                      const n = project.nodes.find((n) => n.id === id);
                      return n ? (
                        <button
                          key={id}
                          onClick={() => {
                            setSelected([id]);
                            changeMode("board");
                            setFocusId(id);
                          }}
                        >
                          {n.title} ↗
                        </button>
                      ) : (
                        <span key={id}>已删除的节点（成果已保留）</span>
                      );
                    })}
                  </div>
                </div>
              ) : project.reports.length ? (
                <>
                  <div className="report-batch-actions">
                    <span>选择成果，组合新的探索</span>
                    <button
                      className="secondary"
                      disabled={
                        !project.reports.some((r) =>
                          selectedReports.includes(r.id),
                        )
                      }
                      onClick={() =>
                        reportToChat(
                          project.reports.filter((r) =>
                            selectedReports.includes(r.id),
                          ),
                        )
                      }
                    >
                      <Icon name="chat" size={14} />
                      基于所选成果创建对话
                    </button>
                  </div>
                  <div className="report-grid">
                    {project.reports.map((r) => (
                      <div className="report-tile" key={r.id}>
                        <input
                          type="checkbox"
                          aria-label={`选择成果 ${r.title}`}
                          checked={selectedReports.includes(r.id)}
                          onChange={(e) =>
                            setSelectedReports((ids) =>
                              e.target.checked
                                ? [...ids, r.id]
                                : ids.filter((id) => id !== r.id),
                            )
                          }
                        />
                        <button
                          className="report-card"
                          onClick={() => setReportId(r.id)}
                        >
                          <span className="report-icon">
                            <Icon name="file" size={25} />
                          </span>
                          <small>{r.kind}</small>
                          <h3>{r.title}</h3>
                          <p>
                            {r.markdown.replace(/[#*>]/g, "").slice(0, 120)}
                          </p>
                          <footer>
                            {r.sourceIds.length} 个来源 ·{" "}
                            {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                            <Icon name="chevron" size={15} />
                          </footer>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="library-empty">
                  <Icon name="file" size={36} />
                  <h2>每个想法，都值得一份成果。</h2>
                  <p>回到白板，框选对话与便签，点击「整理成果」。</p>
                  <button
                    className="primary"
                    onClick={() => changeMode("board")}
                  >
                    前往白板
                  </button>
                </div>
              )}
            </div>
          )}
          {section === "history" && (
            <div className="library-view">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">每一次探索，都有迹可循</span>
                  <h1>聊天记录</h1>
                  <p>
                    {project.nodes.filter((n) => n.type === "chat").length}{" "}
                    段对话，保存在这个项目中。
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setActiveId(undefined);
                    setTarget("new");
                    changeMode("chat");
                  }}
                >
                  <Icon name="plus" size={15} />
                  新对话
                </button>
              </div>
              <div className="history-list">
                {project.nodes
                  .filter((n) => n.type === "chat")
                  .map((n) => (
                    <button key={n.id} onClick={() => openChat(n.id)}>
                      <span className="history-icon">
                        <Icon name={n.parentId ? "branch" : "chat"} />
                      </span>
                      <div>
                        <strong>{n.title}</strong>
                        <p>
                          {n.messages.filter((m) => m.role === "user").at(-1)
                            ?.content || "还没有消息"}
                        </p>
                      </div>
                      <small>{n.messages.length} 条消息</small>
                      <Icon name="chevron" size={15} />
                    </button>
                  ))}
                {!project.nodes.some((n) => n.type === "chat") && (
                  <div className="library-empty">
                    <Icon name="chat" size={34} />
                    <h2>从第一句提问开始。</h2>
                  </div>
                )}
              </div>
            </div>
          )}
          {section === "home" && (
            <div className="library-view home-view">
              <div className="page-heading">
                <div>
                  <span className="eyebrow">WELCOME TO EGGIST</span>
                  <h1>你好，让想法开始生长。</h1>
                  <p>快速发散，快速验证，快速找回。</p>
                </div>
                <img src="/eggist.png" alt="先有蛋" />
              </div>
              <div className="stats-grid">
                <div>
                  <Icon name="chat" />
                  <strong>{totalRounds}</strong>
                  <span>已完成对话轮次</span>
                </div>
                <div>
                  <Icon name="folder" />
                  <strong>{workspace.projects.length}</strong>
                  <span>本地项目</span>
                </div>
                <div>
                  <Icon name="file" />
                  <strong>
                    {workspace.projects.reduce(
                      (s, p) => s + p.reports.length,
                      0,
                    )}
                  </strong>
                  <span>沉淀的成果</span>
                </div>
                <div>
                  <Icon name="spark" />
                  <strong>{totalTokens.toLocaleString()}</strong>
                  <span>实际 API 返回的 Token</span>
                </div>
              </div>
              <h2>最近的探索</h2>
              <div className="home-projects">
                {workspace.projects.map((p) => (
                  <button key={p.id} onClick={() => switchProject(p.id)}>
                    <Icon name="folder" />
                    <div>
                      <strong>{p.name}</strong>
                      <p>
                        {p.nodes.filter((n) => n.type === "chat").length} 段对话
                        · {p.reports.length} 份成果
                      </p>
                    </div>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>
              <h2>用量记录</h2>
              <div className="usage-table">
                <div>
                  <strong>日期</strong>
                  <strong>完成轮次</strong>
                  <strong>实际 API 请求</strong>
                  <strong>实际 Token</strong>
                </div>
                {usage
                  .slice()
                  .reverse()
                  .map((u) => (
                    <div key={u.date}>
                      <span>{u.date}</span>
                      <span>{u.rounds}</span>
                      <span>{u.realRequests}</span>
                      <span>{u.tokens}</span>
                    </div>
                  ))}
                {!usage.length && (
                  <p>
                    开始对话后，这里会记录你的探索。演示回复不计入实际 Token。
                  </p>
                )}
              </div>
            </div>
          )}
          {section === "board" && (
            <form
              className={`composer ${mode === "chat" && !active?.messages.length ? "welcome-composer" : ""}`}
              onSubmit={(e) => void send(e)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void addFiles(e.dataTransfer.files);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
            >
              {target !== "new" && active && (
                <div className="composer-context">
                  <Icon
                    name={target === "branch" ? "branch" : "chat"}
                    size={12}
                  />
                  <span>
                    {target === "branch" ? "创建分支：" : "继续："}
                    {active.title}
                  </span>
                  <button
                    type="button"
                    title="切换为新对话"
                    onClick={() => {
                      setTarget("new");
                      setActiveId(undefined);
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )}
              {!!attachments.length && (
                <div className="attachment-list">
                  {attachments.map((a) => (
                    <span key={a.id} title={attachmentLabel(a)}>
                      <Icon name="attachment" size={13} />
                      {a.name}
                      <button
                        type="button"
                        aria-label={`移除附件 ${a.name}`}
                        onClick={() =>
                          setAttachments((s) => s.filter((x) => x.id !== a.id))
                        }
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                aria-label="聊天消息"
                value={draft}
                placeholder={
                  attaching ? "正在保存附件…" : "今天我们要调研些什么？"
                }
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="composer-controls">
                <button
                  type="button"
                  title="添加附件 / 图片"
                  aria-label="添加附件"
                  onClick={() => fileRef.current?.click()}
                  disabled={attaching}
                >
                  <Icon name="plus" size={18} />
                </button>
                <select
                  aria-label="对话节点选择"
                  value={target}
                  onChange={(e) => setTarget(e.target.value as typeof target)}
                >
                  <option value="new">● NewCHAT</option>
                  <option value="continue" disabled={!active}>
                    继续当前对话
                  </option>
                  <option value="branch" disabled={!active}>
                    从当前对话分支
                  </option>
                </select>
                <div className="composer-model">
                  <img
                    className="composer-model-logo"
                    src="/figma/model.png"
                    alt=""
                  />
                  <span
                    className={`provider-dot ${settings.mode === "api" ? "real" : ""}`}
                  />
                  <select
                    aria-label="智能体选择"
                    value={settings.agent}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, agent: e.target.value }))
                    }
                  >
                    {Object.entries(agents).map(([id, a]) => (
                      <option key={id} value={id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {profiles.length > 0 && (
                    <select
                      className="profile-select"
                      aria-label="切换常用模型"
                      value={
                        profiles.find(
                          (p) =>
                            settings.mode === "api" &&
                            p.baseUrl === settings.baseUrl &&
                            p.model === settings.model,
                        )?.id || ""
                      }
                      onChange={(e) => useProfile(e.target.value)}
                    >
                      <option value="" disabled>
                        {settings.mode === "demo" ? "本地演示" : "当前模型"}
                      </option>
                      {profiles.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    title="选择模型与接口"
                    onClick={() => setDialog("settings")}
                  >
                    {settings.mode === "demo"
                      ? "本地演示"
                      : settings.model || "选择模型"}
                    <span>⌄</span>
                  </button>
                </div>
                {currentTask && target === "continue" ? (
                  <button
                    type="button"
                    aria-label="停止生成"
                    title="停止生成"
                    className="send-button"
                    onClick={() => currentTask.controller.abort()}
                  >
                    <Icon name="stop" size={15} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    aria-label="发送消息"
                    className="send-button"
                    disabled={
                      (!draft.trim() && !attachments.length) || attaching
                    }
                  >
                    <Icon name="arrow" size={17} />
                  </button>
                )}
              </div>
            </form>
          )}
          {currentTask && !rightbar && (
            <button
              className="working-companion"
              onClick={() => setRightbar(true)}
            >
              <img src="/figma/avatar.png" alt="" />
              <span>
                灵感孵化中…
                <small>{currentTask.steps.at(-1)?.label || "准备上下文"}</small>
              </span>
              <Icon name="chevron" size={12} />
            </button>
          )}
          {section === "board" && mode === "board" && (
            <div className="undo-controls">
              <button
                aria-label="撤销"
                title="撤销 Ctrl Z"
                disabled={
                  !undoStack.length || tasks.some((t) => t.state === "running")
                }
                onClick={undo}
              >
                <Icon name="undo" size={15} />
              </button>
              <button
                aria-label="重做"
                title="重做 Ctrl Shift Z"
                disabled={
                  !redoStack.length || tasks.some((t) => t.state === "running")
                }
                onClick={redo}
              >
                <Icon name="redo" size={15} />
              </button>
            </div>
          )}
        </div>
      </section>
      {rightbar && (
        <aside className="activity-panel">
          <header>
            <span>
              <Icon name="globe" size={16} />
              任务活动
            </span>
            <button
              aria-label="关闭任务活动"
              onClick={() => setRightbar(false)}
            >
              <Icon name="close" size={17} />
            </button>
          </header>
          <p className="activity-note">
            显示本机请求进度。当前未接入浏览器搜索工具，不会模拟网页检索结果。
          </p>
          {tasks.length ? (
            tasks.map((t) => (
              <div className={`task-card ${t.state}`} key={t.id}>
                <strong>{t.title}</strong>
                <small>
                  {t.state === "running"
                    ? "正在处理"
                    : t.state === "done"
                      ? "已完成"
                      : "未完成"}{" "}
                  · {workspace.projects.find((p) => p.id === t.projectId)?.name}
                </small>
                {t.steps.map((step, i) => (
                  <p key={i}>
                    <Icon
                      name={
                        step.state === "done"
                          ? "check"
                          : step.state === "error"
                            ? "close"
                            : "spark"
                      }
                      size={12}
                    />
                    {step.label}
                  </p>
                ))}
                {t.state === "running" && (
                  <button onClick={() => t.controller.abort()}>停止任务</button>
                )}
              </div>
            ))
          ) : (
            <div className="activity-empty">
              <Icon name="spark" size={30} />
              <p>开始对话后，任务进度会出现在这里。</p>
            </div>
          )}
        </aside>
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="spark" size={15} />
          {toast}
          <button aria-label="关闭通知" onClick={() => setToast("")}>
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(undefined);
          }}
        >
          <section
            className={`modal ${dialog === "settings" ? "settings-modal" : ""} ${dialog === "search" ? "search-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === "settings"
                ? "模型与数据设置"
                : dialog === "project"
                  ? "项目名称"
                  : dialog === "search"
                    ? "搜索项目"
                    : dialog === "delete"
                      ? "删除选中内容"
                      : "整理成果"
            }
          >
            <header>
              <h2>
                {dialog === "settings"
                  ? "模型与数据设置"
                  : dialog === "project"
                    ? editProject
                      ? "重命名项目"
                      : "新建项目"
                    : dialog === "search"
                      ? "找到你的 IDEA"
                      : dialog === "delete"
                        ? "删除选中内容？"
                        : "把想法，整理成成果。"}
              </h2>
              <button
                aria-label="关闭弹窗"
                onClick={() => setDialog(undefined)}
              >
                <Icon name="close" size={18} />
              </button>
            </header>
            {dialog === "project" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!projectName.trim()) return;
                  if (editProject) patchProject({ name: projectName.trim() });
                  else {
                    draftByProject.current.set(project.id, {
                      draft,
                      attachments,
                      activeId,
                      target,
                    });
                    const p = createProject(projectName.trim());
                    setWorkspace((w) => ({
                      ...w,
                      projects: [...w.projects, p],
                      activeProjectId: p.id,
                    }));
                    setSelected([]);
                    setActiveId(undefined);
                    setDraft("");
                    setAttachments([]);
                    setTarget("new");
                    setUndoStack([]);
                    setRedoStack([]);
                    setSection("board");
                    setMode("board");
                  }
                  setDialog(undefined);
                }}
              >
                <label>
                  项目名称
                  <input
                    autoFocus
                    maxLength={60}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="给这次探索起个名字"
                  />
                </label>
                <footer>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setDialog(undefined)}
                  >
                    取消
                  </button>
                  <button className="primary" disabled={!projectName.trim()}>
                    {editProject ? "保存名称" : "创建项目"}
                  </button>
                </footer>
              </form>
            )}
            {dialog === "delete" && (
              <>
                <p>
                  将删除 {selected.length}{" "}
                  个节点及其连线。已生成的成果会保留，可以通过撤销恢复节点。
                </p>
                <footer>
                  <button
                    className="secondary"
                    onClick={() => setDialog(undefined)}
                  >
                    取消
                  </button>
                  <button className="danger" onClick={confirmDelete}>
                    删除 {selected.length} 项
                  </button>
                </footer>
              </>
            )}
            {dialog === "search" && (
              <>
                <div className="search-input">
                  <Icon name="search" />
                  <input
                    aria-label="搜索关键词"
                    autoFocus
                    placeholder="搜索对话、便签和成果…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <small className="search-caption">
                  当前项目 · {project.name} ·{" "}
                  {searchResults.length + reportResults.length} 个结果
                </small>
                <div className="search-results">
                  {searchResults.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        setDialog(undefined);
                        setSelected([n.id]);
                        if (n.type === "chat") openChat(n.id);
                        else {
                          changeMode("board");
                          setFocusId(n.id);
                        }
                      }}
                    >
                      <Icon name={n.type === "chat" ? "chat" : n.type} />
                      <div>
                        <strong>{n.title}</strong>
                        <p>
                          {`${n.content} ${n.messages.find((m) => m.content.toLowerCase().includes(query.toLowerCase()))?.content || ""}`.slice(
                            0,
                            140,
                          )}
                        </p>
                      </div>
                      <Icon name="chevron" size={15} />
                    </button>
                  ))}
                  {reportResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setDialog(undefined);
                        setSection("reports");
                        setReportId(r.id);
                      }}
                    >
                      <Icon name="file" />
                      <div>
                        <strong>{r.title}</strong>
                        <p>成果库 · {r.kind}</p>
                      </div>
                    </button>
                  ))}
                  {query && !searchResults.length && !reportResults.length && (
                    <p className="no-results">
                      没有找到匹配内容，试试其他关键词。
                    </p>
                  )}
                  {!query && (
                    <p className="no-results">
                      想法的标题、提问或回答，都可以用来找回。
                    </p>
                  )}
                </div>
              </>
            )}
            {dialog === "report" && (
              <>
                <p className="modal-description">
                  已选择 {selectedNodes.length} 个节点。
                  {settings.mode === "demo"
                    ? "本地模式将整理原始内容；配置实际模型后可生成分析。"
                    : `将使用 ${settings.model} 整理内容。`}
                </p>
                <div className="report-kind-options">
                  {reportKinds.map((k) => (
                    <button
                      key={k}
                      className={reportKind === k ? "active" : ""}
                      onClick={() => setReportKind(k)}
                    >
                      <Icon name={k === "PPT" ? "board" : "file"} size={17} />
                      {k}
                    </button>
                  ))}
                </div>
                <label>
                  成果标题
                  <input
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    placeholder={`${project.name} · ${reportKind}`}
                  />
                </label>
                <label>
                  补充要求
                  <textarea
                    value={reportPrompt}
                    onChange={(e) => setReportPrompt(e.target.value)}
                    placeholder="重点关注什么？希望如何组织内容？"
                    rows={3}
                  />
                </label>
                {profiles.length > 0 && (
                  <div className="parallel-options">
                    <h3>让多个模型独立验证</h3>
                    <p>选中相同来源，同时交给不同模型，比较各自的分析。</p>
                    {profiles.map((p) => (
                      <label className="checkbox" key={p.id}>
                        <input
                          type="checkbox"
                          checked={validationModels.includes(p.id)}
                          onChange={(e) =>
                            setValidationModels((ids) =>
                              e.target.checked
                                ? [...ids, p.id].slice(-4)
                                : ids.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {p.name}
                        <small>{p.model}</small>
                      </label>
                    ))}
                    <button
                      className="secondary"
                      disabled={!validationModels.length}
                      onClick={() => void parallelValidate()}
                    >
                      <Icon name="branch" size={14} />
                      并行交叉验证（{validationModels.length} 个模型）
                    </button>
                  </div>
                )}
                <footer>
                  <button
                    className="secondary"
                    onClick={() => setDialog(undefined)}
                  >
                    取消
                  </button>
                  <button
                    className="primary"
                    onClick={() => void generateReport()}
                  >
                    <Icon name="spark" size={15} />
                    {settings.mode === "demo" ? "整理到成果库" : "生成成果"}
                  </button>
                </footer>
              </>
            )}
            {dialog === "settings" && (
              <>
                <div className="settings-section">
                  <h3>模型连接</h3>
                  {profiles.length > 0 && (
                    <div className="model-profiles">
                      {profiles.map((p) => (
                        <div key={p.id}>
                          <button onClick={() => useProfile(p.id)}>
                            <Icon name="spark" size={13} />
                            {p.name}
                            <small>{p.model}</small>
                          </button>
                          <button
                            aria-label={`移除常用模型 ${p.name}`}
                            onClick={() =>
                              setProfiles((s) =>
                                s.filter((item) => item.id !== p.id),
                              )
                            }
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="connection-toggle">
                    <button
                      className={settings.mode === "demo" ? "active" : ""}
                      onClick={() =>
                        setSettings((s) => ({ ...s, mode: "demo" }))
                      }
                    >
                      本地演示
                    </button>
                    <button
                      className={settings.mode === "api" ? "active" : ""}
                      onClick={() =>
                        setSettings((s) => ({ ...s, mode: "api" }))
                      }
                    >
                      自定义模型接口
                    </button>
                  </div>
                  {settings.mode === "api" ? (
                    <>
                      <p className="field-hint">
                        兼容 Chat Completions 协议。接口地址填写到
                        /v1，由本机网关转发请求。
                      </p>
                      <label>
                        接口地址
                        <input
                          placeholder="https://your-provider.example/v1"
                          value={settings.baseUrl}
                          onChange={(e) => {
                            providerKeys.current.set(settings.baseUrl, apiKey);
                            setApiKey("");
                            setSettings((s) => ({
                              ...s,
                              baseUrl: e.target.value,
                            }));
                          }}
                        />
                      </label>
                      <div className="form-row">
                        <label>
                          模型 ID
                          <input
                            placeholder="填写服务商提供的模型 ID"
                            value={settings.model}
                            onChange={(e) =>
                              setSettings((s) => ({
                                ...s,
                                model: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          API Key
                          <input
                            type="password"
                            autoComplete="off"
                            placeholder="仅保留在当前页面内存"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                          />
                        </label>
                      </div>
                      <p className="field-hint">
                        密钥不会写入本地存储或项目备份。使用接口时，选中对话的上下文与图片/文本附件将发送到你配置的服务商。
                      </p>
                      <div className="save-profile">
                        <input
                          aria-label="常用模型名称"
                          placeholder="常用模型名称（可选）"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                        />
                        <button className="secondary" onClick={saveProfile}>
                          保存常用模型
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="demo-settings">
                      <p>本地演示可体验分支、标记和成果整理，不调用实际 AI。</p>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={demoFail}
                          onChange={(e) => setDemoFail(e.target.checked)}
                        />
                        下一次模拟失败（验证重试）
                      </label>
                    </div>
                  )}
                  <label>
                    自定义助手指令 / Skill 提示词
                    <textarea
                      rows={3}
                      value={settings.systemPrompt}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          systemPrompt: e.target.value,
                        }))
                      }
                      placeholder="例如：每次回答先列出假设，再给出最小验证步骤。"
                    />
                  </label>
                  <p className="field-hint">
                    支持提示词型助手和多模型并行验证；暂不运行外部脚本型 Skill。
                  </p>
                </div>
                <div className="settings-section">
                  <h3>本地数据</h3>
                  <p className="field-hint">
                    项目、对话和成果保存在此浏览器。附件文件单独保存在
                    IndexedDB；JSON 备份包含内容与附件描述，不包含附件文件。
                  </p>
                  <div className="data-actions">
                    <button className="secondary" onClick={backup}>
                      <Icon name="download" size={15} />
                      导出项目备份
                    </button>
                    <button
                      className="secondary"
                      onClick={() => importRef.current?.click()}
                    >
                      <Icon name="upload" size={15} />
                      导入项目备份
                    </button>
                  </div>
                  {!saveAllowed && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setSaveAllowed(true);
                        setStorageError("");
                        notify("已恢复保存，将使用当前工作区覆盖原始损坏数据");
                      }}
                    >
                      已备份原始数据，恢复本地保存
                    </button>
                  )}
                </div>
                <footer>
                  <span className="field-hint">
                    设置自动保存 · API Key 仅本次有效
                  </span>
                  <button
                    className="primary"
                    onClick={() => setDialog(undefined)}
                  >
                    完成
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
