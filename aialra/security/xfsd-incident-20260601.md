# AIALRA xfsd / XMRig incident report

Date: 2026-06-01
Host: vmi3267391
Primary IP: 213.136.74.126

## Executive summary

This was not a single stray `xfsd` file

The machine has evidence of at least three related miner persistence paths:

- `systemd-logind -c config.json`, a fake system process name used for XMRig
- `c3pool_miner.service`, a systemd unit that launched XMRig from the root home state directory
- `.bashrc -> .sysvsd`, a shell-startup persistence path found and quarantined on 2026-06-01
- `xfsd -c config.json`, a later miner process observed under the Codex App app-server cgroup on 2026-06-01

The strongest local source evidence points to the DeeeeeepWiki web runtime as the first observed execution environment:

- Historical logs from 2026-04-29 show `aialra-deeeeeepwiki-web.service` had a child process `./systemd-logind -c config.json`
- The same historical evidence shows `sudo systemctl start c3pool_miner.service` executed with `PWD=/srv/aialra/apps/deeeeeepwiki/.next/standalone`
- On 2026-06-01, a leftover XMRig `config.json` was still present in that same standalone directory and was quarantined

The initial entry vector is not proven from local logs

The likely risk pattern is:

1. A root-running web or agent service was able to execute attacker-controlled code
2. The attacker dropped or launched a miner under a fake system name
3. Persistence was added through root crontab, systemd, and later shell startup
4. Later benchmark or agent worktrees observed `xfsd` and `config.json`, likely as a second wave or copied residue, not as the original infection point

Current scan status:

- No active `xfsd`, `.sysvsd`, `xmrig`, `c3pool`, or fake `systemd-logind -c config.json` process was found during the 2026-06-01 scan
- No active connection to the known miner pool IPs was found
- Targeted scans of DeeeeeepWiki, CodexApp, benchmark worktrees, quarantine, and security backups found miner filenames only in quarantine or backup evidence directories
- Systemd logs prove `xfsd` and `.sysvsd` had been running under `aialra-codexapp-app-server.service` earlier on 2026-06-01
- Several infected artifacts remain preserved in quarantine for evidence
- A leftover DeeeeeepWiki miner config was removed from the live app directory and quarantined
- Temporary credential helper scripts in `/tmp` containing plaintext credentials were removed

Severity: critical

Reason: root-level services and root-owned persistence paths were involved, so all secrets on this host must be treated as exposed

## Confirmed indicators

### Files and hashes

| Artifact | Path | SHA256 | Meaning |
| --- | --- | --- | --- |
| fake systemd-logind miner | `/srv/aialra/backups/security-cleanup-20260429T105346Z/systemd-logind` | `fd11982f252c060a1372e81d5be57589647052b56281a5c54975ca22164f7726` | XMRig-compatible Linux miner, fake system process name |
| fake systemd-logind config | `/srv/aialra/backups/security-cleanup-20260429T105346Z/config.json` | `d37a1698683f37863fb15e05eb4610eb3256a053c06efbdc31e4e9c2537f32e8` | XMRig config, pool `62.60.246.210:443`, nicehash enabled |
| c3pool XMRig binary | `/srv/aialra/backups/security-20260429T105109Z/c3pool/xmrig` | `618b912fc5556eb9cee63c6beb5d41ad70474942879582faaf4588bbf2457c0b` | XMRig binary used by `c3pool_miner.service` |
| shell-startup payload | `/srv/aialra/security-quarantine/20260601/sysvsd` | `ae1e87603b91a497be1bd83d969ef4f7aededd07c48b7911983e5fda2a5a6104` | UPX-packed static ELF, quarantined from root home startup path |
| DeeeeeepWiki standalone miner config | `/srv/aialra/security-quarantine/20260601/deeeeeepwiki-standalone-config.json` | `f869bd3caa5e60320873f14cf1bf2f1e430c871dfdae5e1a45ddfb4f62a5b183` | XMRig config left in DeeeeeepWiki build output |

### Network indicators

| Indicator | Meaning |
| --- | --- |
| `auto.c3pool.org:80` | XMRig pool seen in c3pool config and logs |
| `51.81.211.221` | Resolved pool IP seen in XMRig log |
| `62.60.246.210:443` | Pool endpoint in fake systemd-logind config |
| `pool.hashvault.pro:443` | Pool endpoint in DeeeeeepWiki leftover XMRig config |
| `pool.supportxmr.com:443` | Pool endpoint in DeeeeeepWiki leftover XMRig config |
| `us.monero.herominers.com:1111` | Pool endpoint in DeeeeeepWiki leftover XMRig config |
| `auto.c3pool.org:19999` | Pool endpoint in DeeeeeepWiki leftover XMRig config |

### Persistence paths

| Path | Evidence | Current state |
| --- | --- | --- |
| root crontab | `@reboot cd /var/tmp && nohup ./systemd-logind -c config.json >/dev/null 2>&1 &` found in backups | current root crontab empty |
| systemd unit | `c3pool_miner.service` launches `/srv/aialra/state/root-home/c3pool/xmrig --config=...` | unit removed from active system, preserved in backups |
| shell startup | `/srv/aialra/state/root-home/.bashrc` launched `.sysvsd` | line removed, payload quarantined |
| cron hourly | `/etc/cron.hourly/free` wrote `1` to `/proc/sys/vm/drop_caches` | file quarantined |
| DeeeeeepWiki standalone | XMRig `config.json` present in `.next/standalone` | file quarantined on 2026-06-01 |
| Codex App cgroup residue | `aialra-codexapp-app-server.service` had leftover `xfsd` and `.sysvsd` processes | no active process found after cleanup, but service isolation remains unsafe |
| Codex App health monitor | `/etc/cron.d/codexapp-health-monitor` runs `/srv/aialra/apps/codexapp/health-monitor.sh` as root every 5 minutes | appears intended for auth repair, but increases credential blast radius |

## Timeline

All times below are local server time, Europe/Berlin

| Time | Event | Confidence |
| --- | --- | --- |
| 2026-04-29 10:22 | wtmp begins, reboot recorded, `/etc/cron.hourly/free` birth time | high |
| 2026-04-29 11:55 | DeeeeeepWiki API, broker, and web services start | high |
| 2026-04-29 12:04 | fake `systemd-logind` XMRig config mtime | high |
| 2026-04-29 12:17 | c3pool miner files and service created or started, XMRig log begins | high |
| 2026-04-29 12:17 | historical log shows DeeeeeepWiki web service child `./systemd-logind -c config.json` | high |
| 2026-04-29 12:17 | historical log shows `sudo systemctl start c3pool_miner.service` from DeeeeeepWiki standalone directory | high |
| 2026-04-29 12:41 | XMRig connects to c3pool endpoint | high |
| 2026-04-29 12:44-12:50 | XMRig accepts shares, proving actual mining happened | high |
| 2026-04-29 12:51-13:32 | prior security cleanup backups capture miner files, crontab, service unit | high |
| 2026-05-01 23:02 | fake `systemd-logind` copy appears in `/root/deeeeeepwiki-quarantine-20260506T041005Z` | high |
| 2026-05-02 04:34 | XMRig `config.json` appears or is modified in DeeeeeepWiki `.next/standalone` | high |
| 2026-05-06 06:15 | DeeeeeepWiki quarantine directory records fake `systemd-logind` and config | high |
| 2026-05-30 06:31 UTC | Codex session backup records active `xfsd -c config.json`, high CPU | high |
| 2026-05-30 21:31 | benchmark worktree shows `xfsd` and `config.json` created in an Element Web task directory | medium |
| 2026-06-01 08:09-08:13 | systemd records `xfsd` and `.sysvsd` as leftover processes in `aialra-codexapp-app-server.service` | high |
| 2026-06-01 08:13 | systemd SIGKILLs the old Codex App app-server process after stop timeout | high |
| 2026-06-01 08:17-21:17 | kernel logs show hourly `drop_caches: 1`, matching the quarantined `/etc/cron.hourly/free` persistence helper | high |
| 2026-06-01 21:57-21:59 | `.sysvsd`, c3pool tree, and cron file quarantined | high |
| 2026-06-01 23:09 | leftover DeeeeeepWiki XMRig config quarantined | high |

## What probably happened

The earliest reliable local execution evidence is the DeeeeeepWiki web service chain on 2026-04-29

That service was running as root, and its build/runtime directory contained the fake miner process and miner config

Because the service was root, an exploit, injected script, malicious dependency, compromised build artifact, or unsafe agent action could write root crontab and start a systemd service directly

The later `xfsd` event on 2026-05-30 looks like a later payload or second-stage copy:

- It was seen running from the OpenCode turn-engine working directory
- It also appeared in a benchmark worktree during an agent evaluation
- It was later recorded by systemd inside the Codex App app-server cgroup, together with `.sysvsd`
- No evidence found so far proves it was the original entry vector

## 2026-06-01 second-pass findings

### Attacker IP and manual vs automatic assessment

No local log currently proves a successful attacker SSH login during the known miner deployment windows

The only successful SSH login visible in current `wtmp` is `root` from `74.70.107.162` between 2026-05-29 18:11 and 2026-05-30 07:01

User confirmation on 2026-06-01: `74.70.107.162` is the owner's Troy location, so it is not treated as an attacker IP in this report

The SSH journal shows heavy automated brute-force traffic, including many attempts for username `monero`, but the visible records are failed or disconnected pre-authentication attempts

`lastb` shows brute-force activity was still ongoing on 2026-06-01, with repeated failed attempts against `root` and common usernames from many IPs

Current SSH posture is unsafe:

- `PermitRootLogin yes`
- `PasswordAuthentication yes`
- `fail2ban` inactive
- UFW allows OpenSSH from anywhere, including IPv6

Current confidence:

- External SSH brute force: high
- Successful SSH attacker login: not proven
- Miner deployment style: commodity automated miner behavior, high confidence
- Initial exploit path: not proven
- Manual attacker activity after initial entry: not proven

Unknown external IPs seen in failed SSH or miner evidence and currently treated as hostile or suspicious:

- `51.81.211.221`, XMRig pool endpoint resolved from `auto.c3pool.org`
- `62.60.246.210`, XMRig pool endpoint in fake `systemd-logind` config
- `213.182.94.106`, failed SSH brute-force source
- `45.148.10.157`, failed SSH brute-force source
- `103.153.190.105`, failed SSH brute-force source

### Codex App involvement

Systemd logs on 2026-06-01 show `aialra-codexapp-app-server.service` contained:

- `xfsd -c config.json`
- `.sysvsd`, shown by systemd as `.sysvsd` or `"[nfsd]"`

When the service was stopped, systemd repeatedly reported those processes as leftover children in the unit cgroup

This means Codex App was not just a victim of high machine load; its persistent root-running app-server process had miner processes in its cgroup

That does not prove Codex App source code is malicious, but it does prove the runtime isolation was insufficient

### DeeeeeepWiki source and runtime assessment

The local DeeeeeepWiki git remote points to the owner's fork, `https://github.com/AIALRA-0/deepwiki-open.git`, with upstream `https://github.com/AsyncFuncAI/deepwiki-open.git`

Targeted source scans excluding build caches and dependency trees did not find miner strings or miner filenames in tracked application source

The stronger finding is runtime exposure, not proven GitHub source pollution:

- DeeeeeepWiki web, broker, API, and terminal services run as `root`
- public nginx proxies `deeeeeepwiki.aialra.online` to the Next server without a global auth gate
- Next middleware currently returns `NextResponse.next()` and does not enforce authentication globally
- workspace bootstrap, stream, messages, file, approval, interrupt, and settings routes are publicly reachable through the web app layer unless protected elsewhere
- the terminal websocket accepts a `repo_path`-style working directory and starts shell sessions
- local path resolution supports broad host paths and mirrors such as `/opt` and `/tmp`
- the broker has a secret between Next and broker, but that only protects the broker from direct calls, not public unauthenticated Next routes if those routes are callable

Current interpretation:

- the GitHub fork is not proven to contain miner code
- the deployed runtime was powerful enough to run commands as root
- the first observed miner execution was inside the DeeeeeepWiki runtime directory
- therefore the likely pollution path is runtime command execution, unsafe workspace or terminal access, malicious prompt or agent action, or a deployed artifact side effect, not necessarily a poisoned GitHub commit

This distinction matters because deleting the miner file is not enough; the exposed runtime capability must be locked down

### Mining duration and resource use

Confirmed c3pool mining:

- XMRig log begins: 2026-04-29 12:17:08
- pool selected: `auto.c3pool.org:80`, resolved to `51.81.211.221`
- accepted shares: 13 accepted, 0 rejected
- first accepted share: 2026-04-29 12:44:27
- last accepted share: 2026-04-29 12:50:58
- observed hashrate: roughly 1000 to 1650 H/s during productive window

Confirmed Codex App cgroup resource impact:

- old Codex App app-server unit reported 10.5G memory peak and 513.8M swap peak while `xfsd` and `.sysvsd` were leftover unit processes
- one captured process snapshot showed `xfsd -c config.json` at 99 percent CPU, with earlier session output showing 370 percent CPU

Exact attacker mining payout cannot be computed from local logs because pool account ownership and payout records are external

## What is not proven

- We do not yet have proof of a successful SSH login by the attacker
- We do not yet have the original dropper command or URL
- We do not yet know whether the first entry was DeeeeeepWiki app exploit, a build script, a compromised package, a leaked credential, or an unsafe agent execution
- File mtimes on malicious binaries are not fully trustworthy, because at least one miner binary has an old mtime inconsistent with local creation

## Current machine risk

Current active mining process: not found

Current known miner pool connection: not found

Current load after cleanup was substantially lower than during the miner snapshots:

- observed load average after cleanup was about `1.16, 1.39, 2.04`
- no active `xfsd`, `.sysvsd`, `xmrig`, `c3pool`, or fake `systemd-logind -c config.json` process was found
- old evidence showed `xfsd` at 99 percent CPU in one snapshot and 370 percent CPU in an earlier session output
- old Codex App cgroup accounting showed 10.5G memory peak, 513.8M swap peak, and 4d 8h 20min CPU time while miner residue was present

This means stopping and quarantining the miner reduced active machine pressure, but the host remains high risk until ingress paths and root-running services are fixed

Current risk remains critical for these reasons:

- Root password SSH is currently enabled
- Root login over SSH is currently enabled
- Many public-facing and agent-facing services run as root
- Historical Codex/session logs and `/tmp` helper files contained sensitive credentials
- A plaintext credential helper file was still present under `/tmp` during second-pass scanning and was removed after confirmation
- A second 159-byte executable `/tmp/tmp.*` credential helper appeared during continued scanning and was also removed after confirmation
- Public web and agent systems can execute code paths that touch the same root-owned state tree
- Existing logs are incomplete enough that exact initial ingress cannot be proven

Second-pass persistence review found:

- systemd suspicious-name scan: no active miner unit names beyond legitimate `systemd-logind.service`
- active timers: standard system timers only, no obvious miner timer
- current root crontab: empty except cron metadata comments
- `/etc/cron.d/staticroute`: provider or local route repair command, not miner-like
- `/etc/cron.hourly/fstrim`: simple `fstrim /`, not miner-like
- `/etc/cron.d/codexapp-health-monitor`: root job that copies/restores Codex auth state, not miner-like but credential-sensitive
- `/root/.ssh/authorized_keys`: empty
- shell startup files: no remaining miner launch line found after `.sysvsd` removal
- Docker container name/image scan: no obvious miner container found

Because the host was root-compromised, these clean checks reduce immediate active-residue risk but do not prove the machine is trustworthy

## Immediate actions already taken

- Quarantined `.sysvsd`
- Quarantined c3pool miner tree
- Quarantined `/etc/cron.hourly/free`
- Removed `.sysvsd` launch line from `/srv/aialra/state/root-home/.bashrc`
- Quarantined DeeeeeepWiki standalone XMRig config
- Removed temporary credential helper scripts from `/tmp`
- Removed an additional plaintext `/tmp/tmp.*` credential helper found during second-pass scanning
- Rechecked process list and network sockets for active miner indicators

## Required next actions

### Must do now

1. Rotate all secrets that ever lived on this host
   - GitHub tokens
   - model provider API keys
   - Cloudflare tokens
   - database passwords
   - app login passwords
   - SSH passwords and keys
   - Codex/OpenCode/Kimi/Claude credentials

2. Disable root password SSH
   - set `PermitRootLogin no` or at least `prohibit-password`
   - set `PasswordAuthentication no`
   - use a non-root admin user with key-only login
   - enable fail2ban or equivalent rate limiting

3. Stop running web and agent services as root
   - DeeeeeepWiki web/api/broker/terminal must move to dedicated users
   - OpenCode and debug1 should not run as root
   - CodexApp login/web/app-server should not share root home state without hard isolation

4. Treat the host as root-compromised
   - safest path is rebuild from a clean image
   - restore only reviewed data and source
   - never restore quarantined executables

### Should do next

1. Add immutable quarantine storage
2. Add auditd rules for `/var/tmp`, `/tmp`, root crontab, systemd units, and app build directories
3. Add outbound firewall logging for miner pool ports and domains
4. Add daily `ps`, `ss`, crontab, systemd, and file-integrity reports
5. Add sandboxed service users for every agent runner
6. Separate benchmark worktrees from production service accounts

## Firewall and access-control posture

UFW is active, but current exposure is still broad:

- OpenSSH is allowed from anywhere, including IPv6
- public web ports 80 and 443 are open
- additional public service ports include 18000, 13389, 3479, 5349, and high TURN-style port ranges
- several sensitive app and agent systems are reachable through nginx-backed public domains

Firewall hardening can stop direct brute force and direct access to non-web services, but it cannot fully protect a public web application that itself can execute commands

The durable hardening model is layered:

1. SSH should be key-only and preferably reachable only from VPN, Zero Trust, or the owner's known IP range
2. root password SSH should be disabled
3. non-web admin ports should not be public
4. public web apps with agent or terminal capability must have authentication before their workspace APIs
5. web and agent services must run as non-root service users
6. outbound miner indicators should be blocked and logged as IOCs

Known miner IOC block or watch list:

- `51.81.211.221`
- `62.60.246.210`
- `auto.c3pool.org`
- `pool.hashvault.pro`
- `pool.supportxmr.com`
- `us.monero.herominers.com`
- wallet or user marker `NEUGLOBALLY799911`

## Source note

External sandbox lookup for SHA256 `fd11982f252c060a1372e81d5be57589647052b56281a5c54975ca22164f7726` identifies it as `xmrig`, malicious, Linux 64-bit, statically linked and stripped

Local strings also show `XMRig 6.22.0`, `Monero`, `randomx`, `nicehash`, and miner configuration strings
