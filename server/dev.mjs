import { createApp } from "./app.mjs";
const portIndex = process.argv.indexOf("--port");
const port = Number(
  process.env.PORT || (portIndex >= 0 ? process.argv[portIndex + 1] : 4173),
);
const app = await createApp({
  production: process.argv.includes("--production"),
});
app.server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，请使用 --port 指定其他端口。`
      : error.message,
  );
  process.exitCode = 1;
});
app.server.listen(port, "127.0.0.1", () =>
  console.log(`Eggist 已启动：http://127.0.0.1:${port}/`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
