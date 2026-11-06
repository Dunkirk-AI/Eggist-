import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) =>
            typeof src === "string" && /^https?:\/\//i.test(src) ? (
              <img
                src={src}
                alt={alt || "AI 图片内容"}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : null,
          table: ({ children }) => (
            <div className="md-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
