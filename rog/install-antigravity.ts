// Requires a signed-in agy CLI and the existing private push.json from rog/install.ts.
const home = Deno.env.get("HOME")!;
const cli = Deno.args[0] ?? "agy";
if (!/^[a-zA-Z0-9_./-]+$/.test(cli)) throw new Error("Invalid CLI path");
const config = `${home}/.config/archea-usage/push.json`;
const target = new URL(JSON.parse(await Deno.readTextFile(config)).url);
const api = `${target.hostname}:${
  target.port || (target.protocol === "http:" ? 80 : 443)
}`;
const base = new URL("../", import.meta.url);
const dest = `${home}/.local/share/archea-usage-antigravity`;
for (const dir of ["rog", "src"]) {
  await Deno.mkdir(`${dest}/${dir}`, { recursive: true });
}
for (
  const name of [
    "rog/antigravity-push.ts",
    "src/providers.ts",
    "src/auth.ts",
  ]
) {
  await Deno.copyFile(new URL(name, base), `${dest}/${name}`);
}
const units = `${home}/.config/systemd/user`;
await Deno.mkdir(units, { recursive: true });
await Deno.writeTextFile(
  `${units}/archea-usage-antigravity.service`,
  `[Unit]
Description=Send Antigravity Gemini quotas to Archea Usage
After=network-online.target

[Service]
Type=oneshot
Environment=PATH=${Deno.env.get("PATH")}
ExecStart=${Deno.execPath()} run --no-config --allow-env=HOME --allow-read=${config} --allow-run=${cli} --allow-net=${api} ${dest}/rog/antigravity-push.ts ${config} ${cli}
TimeoutStartSec=75
NoNewPrivileges=true
PrivateTmp=true
`,
);
await Deno.writeTextFile(
  `${units}/archea-usage-antigravity.timer`,
  `[Unit]
Description=Send Antigravity Gemini quotas every 5 minutes

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
  "Zainstalowano kolektor Antigravity. Uruchom: systemctl --user daemon-reload && systemctl --user enable --now archea-usage-antigravity.timer",
);
