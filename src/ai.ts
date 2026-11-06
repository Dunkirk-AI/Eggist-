import {
  agents,
  contextMessages,
  getAttachment,
  type Attachment,
  type CanvasNode,
  type Message,
  type ModelSettings,
} from "./model";
export type TaskStep = { label: string; state: "running" | "done" | "error" };
function asDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function serializeMessage(m: Message) {
  const text = [
    m.content,
    ...(m.attachments || [])
      .filter((a) => a.text !== undefined)
      .map((a) => `附件 ${a.name}：\n${a.text}`),
  ].join("\n\n");
  const images = (m.attachments || []).filter((a) =>
    a.type.startsWith("image/"),
  );
  const unsupported = (m.attachments || []).filter(
    (a) => a.text === undefined && !a.type.startsWith("image/"),
  );
  if (unsupported.length)
    throw new Error(
      `这些附件已本地保存，但此接口暂不解析 ${unsupported.map((a) => a.name).join("、")}。请使用图片或文本附件。`,
    );
  if (!images.length) return { role: m.role, content: text };
  const content: unknown[] = [{ type: "text", text }];
  for (const a of images) {
    const blob = await getAttachment(a.id);
    if (!blob) throw new Error(`附件 ${a.name} 的本地文件不存在，请重新添加`);
    content.push({
      type: "image_url",
      image_url: { url: await asDataURL(blob) },
    });
  }
  return { role: m.role, content };
}
export async function generateReply(
  node: CanvasNode,
  settings: ModelSettings,
  apiKey: string,
  signal: AbortSignal,
  onStep: (step: TaskStep) => void,
  failDemo = false,
): Promise<{ text: string; tokens?: number }> {
  const messages = contextMessages(node);
  if (settings.mode === "demo") {
    onStep({ label: "整理本地对话上下文", state: "running" });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 700);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("已停止", "AbortError"));
        },
        { once: true },
      );
    });
    if (failDemo) throw new Error("演示请求失败。消息已保留，可重试。");
    const prompt =
      messages.filter((m) => m.role === "user").at(-1)?.content || "这个想法";
    onStep({ label: "本地演示完成，未执行联网检索", state: "done" });
    return {
      text: `【本地演示 · ${agents[settings.agent as keyof typeof agents]?.name || "自定义助手"}】\n\n你提出了「${prompt.slice(0, 180)}」。${node.context?.length ? `这个分支继承了 ${node.context.length} 条上文。` : ""}\n\n可以从三个方向继续：\n1. 明确要解决的问题和目标人群。\n2. 把已有证据与待验证假设分开。\n3. 设计一个能快速得到反馈的最小实验。\n\n你可以标记这条回复、从任意消息创建分支，或选择多个节点整理成果。配置模型接口后，可使用实际 AI 回答。`,
    };
  }
  if (!settings.baseUrl.trim() || !settings.model.trim())
    throw new Error("请先在模型设置中填写接口地址和模型 ID");
  onStep({ label: `准备 ${messages.length} 条上下文与附件`, state: "running" });
  const serialized = await Promise.all(messages.map(serializeMessage));
  const agentPrompt =
    agents[settings.agent as keyof typeof agents]?.prompt || "";
  onStep({
    label: `等待 ${settings.model} 返回（未启用浏览器搜索工具）`,
    state: "running",
  });
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      apiKey,
      model: settings.model,
      messages: [
        {
          role: "system",
          content: [agentPrompt, settings.systemPrompt]
            .filter(Boolean)
            .join("\n"),
        },
        ...serialized,
      ],
    }),
  });
  const data = await response.json().catch(() => {
    throw new Error("本地模型网关未就绪，请使用 npm run dev 启动完整服务");
  });
  if (!response.ok)
    throw new Error(data.error || `模型请求失败 (${response.status})`);
  onStep({ label: "模型响应已接收", state: "done" });
  return { text: data.text, tokens: data.tokens };
}
export function attachmentLabel(a: Attachment) {
  return `${a.name} · ${a.size < 1024 * 1024 ? Math.ceil(a.size / 1024) + " KB" : (a.size / 1024 / 1024).toFixed(1) + " MB"}`;
}
