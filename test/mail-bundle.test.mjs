import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("bundled Nodemailer imports and builds MIME outside the repository dependency tree", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "agent-buzzer-mail-"));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("agent-buzzer-mail-"));
    rmSync(dir, { recursive: true, force: true });
  });
  const source = new URL("../node_modules/nodemailer/", import.meta.url);
  const destination = join(dir, "nodemailer");
  cpSync(source, destination, { recursive: true });
  const pkg = JSON.parse(readFileSync(join(destination, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies || {}, {});
  const nodemailer = (await import(pathToFileURL(join(destination, pkg.exports["."].import)))).default;
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true });
  const info = await transport.sendMail({ from: "from@example.com", to: "to@example.com", subject: "AgentBuzzer", text: "Unicode: \u4e2d\u6587" });
  assert.match(info.message.toString(), /Subject: AgentBuzzer/);
  assert.match(info.message.toString(), /Content-Type: text\/plain/);
  transport.close();
});
