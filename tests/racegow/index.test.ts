import { assert, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

async function readIndex(): Promise<string> {
  return await Deno.readTextFile(new URL("../../racegow/index.html", import.meta.url));
}

Deno.test("racegow/index.html - macOS install snippet puts ~/.local/bin on PATH", async () => {
  const html = await readIndex();
  const snippet = html.match(/<pre class="cmd" id="install-macos"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ??
    "";

  assertStringIncludes(snippet, 'export PATH="$HOME/.local/bin:$PATH"');
  assertStringIncludes(snippet, "~/.zprofile");
});

Deno.test("racegow/index.html - file picker resets after each selection", async () => {
  const html = await readIndex();

  assert(
    /fileInput\.addEventListener\("change", \(\) => \{[\s\S]*?fileInput\.value = "";\s*[\s\S]*?\n\}\);/
      .test(html),
    "file input must clear its value so picking the same file again fires change",
  );
});
