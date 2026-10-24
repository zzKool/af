# Homelab on Proxmox — the owner's box, step by step

> The setup for the owner's box: an **HP EliteDesk 800 G2 Desktop Mini** (Intel 6th gen, 4 cores, **32 GB** DDR4 = 2 × 16 GB, **NVMe 256 GB** Samsung PM961 + **SATA 256 GB** Lite-On SSD). Proxmox on the bare machine, the app in its own encrypted VM, Omarchy beside it for fun. The generic runbook is [[deployment]]; this page is the concrete path. Real data lives only here ([[constitution]], `CLAUDE.md` *Real data*, D51).

```
HP EliteDesk 800 G2 Mini · 32 GB
└─ Proxmox VE                         NVMe 256 GB  (Proxmox + the app VM)
   ├─ VM 100 "af"       Debian, disk encrypted (LUKS)        2 vCPU · 8 GB · 64 GB on NVMe
   │    docker compose (prod): db · migrate · app · azurite
   │    tailscale serve → https://af.<tailnet>.ts.net         ← the only way in
   │    backup.sh daily (systemd timer)
   └─ VM 200 "omarchy"  for fun — never holds AF data         2 vCPU · 8 GB · 120 GB on SATA
USB disk ── Proxmox backup of VM 100, daily (the VM disk is encrypted → so are the backup files)
second USB disk ── swapped with the first once a month, kept outside the house
```

Order: **1 BIOS → 2 Proxmox → 3 storages → 4 Tailscale on the host → 5 the app VM → 6 Docker + AF → 7 Tailscale on the VM → 8 OCR keys → 9 backups → 10 restore drill → B1**. Omarchy (11) whenever.

What you need: a USB stick ≥ 8 GB (installer), a monitor + keyboard for steps 1–2 only, an Ethernet cable to the router, one or two external USB disks for backups, the Windows laptop.

## 1. BIOS (F10 at power-on)

- If Windows is still on the box: update the BIOS first with HP's tool for the EliteDesk 800 G2 Mini — easiest while Windows is there.
- *Advanced → System Options*: turn on **Virtualization Technology (VT-x)** and **Virtualization Technology for Directed I/O (VT-d)**.
- *Advanced → Power-On Options → After Power Loss*: **Power On** (the box comes back by itself after a power cut).
- Boot mode UEFI. If the Proxmox installer will not boot, turn off Secure Boot and try again.

(HP's menu names can differ slightly by BIOS version.)

## 2. Install Proxmox VE

1. On the laptop: download the current **Proxmox VE ISO** from proxmox.com, write it to the USB stick with Rufus or balenaEtcher.
2. Boot the box from the stick (F9 = boot menu), *Install Proxmox VE (Graphical)*.
3. Target disk: **the NVMe (Samsung, 256 GB)** — not the SATA one. Filesystem: the default (ext4); it gives the `local-lvm` storage that snapshots need. **This wipes the NVMe.**
4. Country Switzerland, time zone Europe/Zurich, a strong root password, an e-mail.
5. Network: hostname `pve.home.arpa`, a **fixed IP** in your home range (and reserve it in the router).
6. Reboot, remove the stick. From the laptop: `https://<that IP>:8006`, user `root`. The certificate warning is expected (self-signed).
7. *Node → Updates → Repositories*: disable the two *enterprise* repositories, **Add → No-Subscription**. Then *Updates → Refresh → Upgrade*. The "no valid subscription" pop-up at login is normal.

## 3. Storages

- *Node → Disks*: both SSDs listed. Check **SMART = PASSED** on each (they are used drives — note the wearout).
- SATA SSD (Lite-On): *Disks → Wipe Disk*, then *Disks → Directory → Create*: ext4, name `sata`, content **Disk image, ISO image, VZDump backup**. Omarchy and the ISOs go there.
- USB backup disk: plug it in, *Wipe Disk*, *Directory → Create*: ext4, name `usb-backup`, content **VZDump backup** only. (The second USB disk: the same, at the first swap — see 9.)

## 4. Tailscale on the Proxmox host

So you can reach the Proxmox console when you travel — needed to type the app VM's disk passphrase after a reboot.

In *Node → Shell*:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up                 # opens a login link — log in with your Tailscale account
```

Install Tailscale on the laptop (and the phone) with the same account. From then on: `https://pve:8006` from anywhere. In the Tailscale admin console turn on **MagicDNS** and **HTTPS certificates** (step 7 needs them). Never forward a port on the router — nothing on the box is open to the internet.

## 5. The app VM (100 "af")

1. Upload the **Debian stable netinst ISO** to `sata` (*sata → ISO Images → Download from URL*, the URL from debian.org).
2. *Create VM*: ID 100, name `af`, ISO the Debian one; *System*: qemu agent ✓; *Disks*: `local-lvm`, 64 GB, Discard ✓, SSD emulation ✓; *CPU*: 2 cores, type `host`; *Memory*: 8192 MB; *Network*: default. *Options → Start at boot*: ✓.
3. Install Debian (*Console*): hostname `af`, a user for you, **Partitioning: Guided – use entire disk and set up encrypted LVM**. Choose a **long passphrase** and keep it in your password manager — without it, the VM and its backups cannot be opened, by anyone, including you.
4. Software selection: **only** *SSH server* + *standard system utilities* (no desktop).
5. After the first boot: every reboot stops at *Please unlock disk* in the VM's console (*VM 100 → Console*) — type the passphrase there. You use the app twice a month; a reboot is rare.

In the VM (console or `ssh <you>@<VM IP>`):

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y qemu-guest-agent git curl && sudo systemctl enable --now qemu-guest-agent
```

## 6. Docker + AF

Docker from Docker's own repository (the Debian instructions on docs.docker.com):

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

AF, as [[deployment]] *The homelab*:

```bash
sudo mkdir -p /opt/af && sudo chown $USER /opt/af && cd /opt/af
git clone https://github.com/zzKool/af.git .
cp .env.prod.example .env.prod && chmod 600 .env.prod
openssl rand -hex 24        # → POSTGRES_PASSWORD (and the same in DATABASE_MIGRATION_URL)
openssl rand -base64 32     # → AUTH_SECRET
nano .env.prod
```

In `.env.prod`:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` + the password inside `DATABASE_MIGRATION_URL` | the first random value |
| `AUTH_SECRET` | the second random value |
| `AUTH_URL` | `https://af.<your-tailnet>.ts.net` (step 7 shows the exact name) |
| `AF_PORT` | `127.0.0.1:3000` — only Tailscale reaches the app |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` | step 8 |
| `NEXT_PUBLIC_SENTRY_DSN` | **leave empty** (D51) |

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
curl -s localhost:3000/api/health          # {"status":"ok","db":"ok",…}
```

Never run the seed here. `.env.prod` never leaves the VM.

## 7. Tailscale on the VM — the app's address

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 3000             # https://af.<tailnet>.ts.net → the app, with a real certificate
tailscale serve status                     # shows the exact URL → put it in AUTH_URL, then:
docker compose -f docker-compose.prod.yml up -d
```

Open the URL on the laptop → **/register** → the first account becomes the owner of the AnalyticsFab AB tenant. Works the same at home and abroad. (The machine name `af.<tailnet>.ts.net` appears in public certificate logs — a name, no data.)

## 8. OCR keys — Azure Document Intelligence, Switzerland North (D51)

1. portal.azure.com → *Create a resource* → **Document Intelligence**.
2. Region **Switzerland North**, pricing tier **F0 (free)**, a resource group of its own (e.g. `af-ocr`).
3. *Keys and Endpoint* → copy *Endpoint* and *Key 1* into `AZURE_DI_ENDPOINT` / `AZURE_DI_KEY`.
4. `docker compose -f docker-compose.prod.yml up -d`; upload one receipt — the review page shows the extracted fields (not the mock).

The documents go to Azure for reading — nothing else leaves the box (D51). The free tier has a monthly page limit and, as far as we know, reads only the first pages of a long document; check Azure's pricing page if a supplier invoice comes back incomplete.

## 9. Backups — three layers

```
① in the VM   backup.sh daily   → /opt/af/backups (30 days)         the app's own dump + blobs, portable
② Proxmox     VM 100 daily      → usb-backup (7 daily, 4 weekly, 6 monthly)   the whole VM, encrypted
③ off-site    swap the USB disk with the second one once a month, keep it outside the house
```

**① A systemd timer in the VM** (catches up after a reboot, unlike cron):

```bash
sudo tee /etc/systemd/system/af-backup.service >/dev/null <<'EOF'
[Unit]
Description=AF backup (database dump + blobs)
[Service]
Type=oneshot
WorkingDirectory=/opt/af
ExecStart=/opt/af/scripts/backup.sh
EOF
sudo tee /etc/systemd/system/af-backup.timer >/dev/null <<'EOF'
[Unit]
Description=AF backup daily
[Timer]
OnCalendar=*-*-* 01:30
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now af-backup.timer
sudo systemctl start af-backup.service && ls -lh /opt/af/backups     # a first run now
```

**② Proxmox backup job**: *Datacenter → Backup → Add*: storage `usb-backup`, schedule `03:00`, selection VM 100, mode **Snapshot**, *Retention*: keep-daily 7, keep-weekly 4, keep-monthly 6. *Run now* once and check the file appears.

**③ The swap**: once a month (e.g. at package time), *usb-backup* → unplug → plug the second disk (prepared as in 3, same name) → *Run now*. The disk you take away holds an encrypted VM: useless without the passphrase.

Before Omarchy updates, Proxmox upgrades or an AF update: *VM 100 → Snapshots → Take Snapshot* (seconds; *Rollback* if it goes wrong).

## 10. Restore drill — before B1, then once a quarter

- **①** as [[deployment]] *Proving a backup* (a second checkout in the VM with its own project name).
- **②** *usb-backup → Backups → pick one → Restore* to a **new VM ID** (e.g. 900), start it, unlock with the passphrase, `curl localhost:3000/api/health`, then delete VM 900.

A backup never restored is a hope. Do it once with a few test entries before entering the real data.

## 11. Omarchy (VM 200, optional)

- ISO from omarchy.org to `sata`. VM 200: 2 cores (`host`), 8 GB, 120 GB disk on `sata`, *Display* **VirtIO-GPU** (or **VirGL GPU** for 3D), *Machine* q35, BIOS **OVMF (UEFI)** with an EFI disk.
- Omarchy is a Wayland desktop (Hyprland) made for real hardware: in the browser console it is usable but slow. The smoother path on this box is to share a slice of the built-in Intel graphics with the VM (Intel **GVT-g**, supported on 6th-gen Intel) — see the Proxmox wiki *PCI(e) Passthrough → Intel GVT-g* — or a monitor on the box with the GPU passed through.
- It never holds AF data, has no access to VM 100's disk, and can be wiped any time.

## Routine

| When | What |
|---|---|
| After a merge you want | VM 100: `cd /opt/af && git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d` (pin `AF_TAG` for a known version) |
| Monthly | Proxmox *Updates → Upgrade*; VM 100 `sudo apt update && sudo apt full-upgrade` (snapshot first); swap the USB disk; glance at *Disks → SMART* |
| Quarterly | the restore drill |
| After a power cut | the box restarts by itself; open `https://pve:8006` → VM 100 → *Console* → passphrase |

Related: [[deployment]] · [[constitution]] §7 · D51 (`CLAUDE.md` *Real data*)
