// Installs the Claude collector on ROG as a systemd user timer.
// Run from the repository or an extracted download:
//   deno run --allow-env=HOME --allow-read --allow-write rog/install.ts
// Does not overwrite an existing push.json.
const home = Deno.env.get("HOME")!;
const base = new URL("../", import.meta.url);
const dest = `${home}/.local/share/archea-usage`;
for (const dir of ["rog", "src"]) {
  await Deno.mkdir(`${dest}/${dir}`, { recursive: true });
}
for (const name of ["rog/claude-push.ts", "src/providers.ts", "src/auth.ts"]) {
  await Deno.copyFile(new URL(name, base), `${dest}/${name}`);
}
await Deno.mkdir(`${home}/.config/archea-usage`, {
  recursive: true,
  mode: 0o700,
});
const config = `${home}/.config/archea-usage/push.json`;
try {
  await Deno.stat(config);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  await Deno.writeTextFile(
    config,
    JSON.stringify(
      { url: "https://usage.szymon.archea.dev", token: "UZUPEŁNIJ" },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}
const target = new URL(JSON.parse(await Deno.readTextFile(config)).url);
const api = `${target.hostname}:${
  target.port || (target.protocol === "http:" ? 80 : 443)
}`;
const claudeDir = Deno.env.get("CLAUDE_CONFIG_DIR") || `${home}/.claude`;
const units = `${home}/.config/systemd/user`;
await Deno.mkdir(units, { recursive: true });
await Deno.writeTextFile(
  `${units}/archea-usage-claude.service`,
  `[Unit]
Description=Send Claude subscription limits to Archea Usage
After=network-online.target

[Service]
Type=oneshot
ExecStart=${Deno.execPath()} run --no-config --allow-env=HOME,CLAUDE_CONFIG_DIR --allow-read=${claudeDir}/.credentials.json,${config} --allow-net=api.anthropic.com:443,${api} ${dest}/rog/claude-push.ts ${config}
NoNewPrivileges=true
PrivateTmp=true
`,
);
await Deno.writeTextFile(
  `${units}/archea-usage-claude.timer`,
  `[Unit]
Description=Send Claude subscription limits to Archea Usage every 5 minutes

[Timer]
OnCalendar=*:0/5
OnStartupSec=1min
Persistent=true
AccuracySec=30s

[Install]
WantedBy=timers.target
`,
);
console.log(
  "Zainstalowano kolektor Claude. Uzupełnij token w " + config +
    ", potem: systemctl --user daemon-reload && systemctl --user enable --now archea-usage-claude.timer",
);
