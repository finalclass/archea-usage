// Run inside an extracted download. Does not overwrite an existing credential file.
const home = Deno.env.get("HOME")!;
const base = new URL("../", import.meta.url);
const dest = `${home}/.local/share/archea-usage`;
await Deno.mkdir(`${dest}/omarchy`, { recursive: true });
await Deno.mkdir(`${dest}/src`, { recursive: true });
for (
  const name of [
    "omarchy/usage-widget.ts",
    "omarchy/Panel.qml",
    "omarchy/manifest.json",
    "src/providers.ts",
  ]
) {
  await Deno.copyFile(new URL(name, base), `${dest}/${name}`);
}
await Deno.mkdir(`${home}/.config/archea-usage`, {
  recursive: true,
  mode: 0o700,
});
const config = `${home}/.config/archea-usage/client.json`;
try {
  await Deno.stat(config);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  await Deno.writeTextFile(
    config,
    JSON.stringify(
      {
        url: "https://usage.szymon.archea.dev",
        username: "usage",
        password: "UZUPEŁNIJ",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
const plugins = `${home}/.config/omarchy/plugins`;
await Deno.mkdir(plugins, { recursive: true });
const link = `${plugins}/archea.usage`;
try {
  await Deno.lstat(link);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  await Deno.symlink(`${dest}/omarchy`, link);
}
console.log(
  "Zainstalowano plugin. Uzupełnij " + config +
    ", potem: omarchy plugin enable archea.usage",
);
