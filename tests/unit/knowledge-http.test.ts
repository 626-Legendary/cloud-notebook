import { expect, it, vi } from "vitest";
vi.mock("@/db", () => ({ sqlite: {} }));
vi.mock("@/lib/auth", () => ({ authError: () => 500 }));
import { readKnowledgeJson } from "@/lib/knowledge-http";
it("reads bounded JSON and rejects malformed/empty requests", async () => {
  await expect(readKnowledgeJson(new Request("http://localhost/api/knowledge", { method: "POST", body: '{"title":"概念"}' }))).resolves.toEqual({ title: "概念" });
  await expect(readKnowledgeJson(new Request("http://localhost/api/knowledge", { method: "POST", body: "{" }))).rejects.toMatchObject({ status: 400 });
  await expect(readKnowledgeJson(new Request("http://localhost/api/knowledge", { method: "POST" }))).rejects.toMatchObject({ status: 400 });
});
it("enforces actual streamed bytes independently of the declared content length", async () => {
  await expect(readKnowledgeJson(new Request("http://localhost/api/knowledge", { method: "POST", headers: { "content-length": "1000" }, body: "{}" }), 16)).rejects.toMatchObject({ status: 413 });
  await expect(readKnowledgeJson(new Request("http://localhost/api/knowledge", { method: "POST", headers: { "content-length": "1" }, body: "x".repeat(32) }), 16)).rejects.toMatchObject({ status: 413 });
});
