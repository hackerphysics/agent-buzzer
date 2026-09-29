import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Resvg } from "@resvg/resvg-js";

const source = readFileSync(new URL("../src/icon.svg", import.meta.url), "utf8");

test("brand icon stays crisp and nonblank at app and small UI sizes", () => {
  for (const size of [16, 32, 256, 1024]) {
    const rendered = new Resvg(source, { fitTo: { mode: "width", value: size } }).render();
    const png = Buffer.from(rendered.asPng());
    assert.equal(rendered.width, size);
    assert.equal(rendered.height, size);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
  const pixels = new Resvg(source, { fitTo: { mode: "width", value: 32 } }).render().pixels;
  const at = (x, y) => [...pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
  assert.deepEqual(at(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(23, 9), [238, 183, 74, 255]);
  assert.deepEqual(at(16, 18), [246, 250, 247, 255]);
});
