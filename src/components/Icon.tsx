import type { CSSProperties } from "react";
const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  chat: "M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3V6a2 2 0 0 1 1-2Z",
  board: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  folder: "M3 6h7l2 3h9v11H3Z",
  search: "M21 21l-5-5M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  chevron: "m9 5 7 7-7 7",
  panel: "M3 4h18v16H3ZM9 4v16",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z",
  home: "m3 10 9-7 9 7v11h-6v-7H9v7H3Z",
  file: "M5 3h9l5 5v13H5ZM14 3v6h5M8 13h8M8 17h8",
  spark: "m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z",
  select: "m5 3 15 9-7 2-3 7Z",
  link: "M8 16 16 8M9 6l2-2a5 5 0 0 1 7 7l-2 2M8 11l-2 2a5 5 0 0 0 7 7l2-2",
  sticky: "M4 3h16v12l-5 6H4ZM15 21v-6h5",
  frame: "M4 3v18M20 3v18M3 5h18M3 19h18",
  text: "M4 4h16M12 4v17M8 21h8",
  branch: "M6 3v13a4 4 0 0 0 4 4h8M6 8h8a4 4 0 0 0 4-4V3",
  expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  undo: "M9 5 3 10l6 5M3 10h11a6 6 0 0 1 0 12",
  redo: "m15 5 6 5-6 5M21 10H10a6 6 0 0 0 0 12",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18",
  attachment: "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9",
  check: "m5 12 4 4 10-10",
  stop: "M6 6h12v12H6Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  play: "m8 4 12 8-12 8Z",
};
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const assets: Record<string, [string, number, number]> = {
    arrow: ["send", 9.50003, 9.5],
    plus: ["plus", 14, 14],
    panel: ["panel", 14, 14],
    chat: ["chat", 14, 14],
    folder: ["folder", 16, 16],
    board: ["grid", 13.4312, 13.4312],
    search: ["search", 14, 14],
    select: ["select", 14, 14],
    home: ["home", 16, 16],
    settings: ["settings", 14, 14],
    frame: ["frame", 14, 14],
    sticky: ["sticky", 14, 14],
    text: ["text", 14, 14],
    more: ["more", 14, 14],
    globe: ["globe", 14, 14],
    chevron: ["chevron", 14, 14],
  };
  assets["nav-board"] = ["nav-board", 17.1813, 17.1813];
  assets.idea = ["idea", 14, 14];
  assets.project = ["project", 16, 16];
  const asset = assets[name];
  if (asset)
    return (
      <span
        className={`figma-icon icon-${name}`}
        style={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
        aria-hidden="true"
      >
        <img
          src={`/figma/${asset[0]}.svg`}
          width={asset[1]}
          height={asset[2]}
          alt=""
        />
      </span>
    );
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
