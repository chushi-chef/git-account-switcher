import { open } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, GitBranch, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { call } from "./tauri";
import type { ActionReport, AppStatus, Profile } from "./types";

const emptyProfile: Profile = {
  name: "",
  gitUserName: "",
  gitEmail: "",
  gitHubUser: "",
  protocol: "https",
  platformHost: "github.com",
  sshHost: null,
  sshKeyPath: null,
};

const sshKeyPrefix = "~/.ssh/";

type ModalMode = "none" | "add" | "edit" | "delete";

function slugifyProfileName(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "account";
}

function uniqueProfileName(baseName: string, profiles: Profile[], keepName?: string) {
  const usedNames = new Set(profiles.map((profile) => profile.name).filter((name) => name !== keepName));
  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  while (usedNames.has(`${baseName}-${index}`)) {
    index += 1;
  }
  return `${baseName}-${index}`;
}

function sameIdentity(profile: Profile, status: AppStatus | null) {
  return profile.gitUserName === status?.globalUserName && profile.gitEmail === status?.globalUserEmail;
}

function isFullPath(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("~/") ||
    trimmed.startsWith("~\\") ||
    trimmed.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  );
}

function normalizeSshKeyInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === sshKeyPrefix || trimmed === "~\\.ssh\\") {
    return "";
  }
  return isFullPath(trimmed) ? trimmed : `${sshKeyPrefix}${trimmed}`;
}

function parentPath(path: string) {
  const normalized = path.trim();
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index > 0 ? normalized.slice(0, index) : normalized;
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}日${hours}时${minutes}分${seconds}秒`;
  }
  if (hours > 0) {
    return `${hours}时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function profileFromIdentity(
  userName: string,
  userEmail: string,
  profiles: Profile[],
  keepName?: string,
  platformHost = "github.com",
  sshKeyPath = "",
): Profile {
  const baseName = slugifyProfileName(userName);
  const name = uniqueProfileName(baseName, profiles, keepName);
  const keyPath = sshKeyPath.trim();
  return {
    ...emptyProfile,
    name,
    gitHubUser: name,
    gitUserName: userName.trim(),
    gitEmail: userEmail.trim(),
    protocol: keyPath ? "ssh" : "https",
    platformHost: platformHost.trim() || "github.com",
    sshKeyPath: keyPath || null,
  };
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [modalMode, setModalMode] = useState<ModalMode>("none");
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPlatformHost, setDraftPlatformHost] = useState("github.com");
  const [draftSshKeyPath, setDraftSshKeyPath] = useState(sshKeyPrefix);
  const [busyProfile, setBusyProfile] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const activeProfile = useMemo(
    () => profiles.find((profile) => sameIdentity(profile, status)) ?? null,
    [profiles, status],
  );

  async function refresh() {
    const [nextStatus, nextProfiles] = await Promise.all([
      call<AppStatus>("get_status", { repoPath: null }),
      call<Profile[]>("list_profiles"),
    ]);

    let profilesToUse = nextProfiles;
    const currentName = nextStatus.globalUserName?.trim();
    const currentEmail = nextStatus.globalUserEmail?.trim();

    if (currentName && currentEmail) {
      const alreadySaved = nextProfiles.some(
        (profile) => profile.gitUserName === currentName && profile.gitEmail === currentEmail,
      );

      if (!alreadySaved) {
        const profile = profileFromIdentity(currentName, currentEmail, nextProfiles);
        await call<ActionReport>("save_profile", { profile });
        profilesToUse = await call<Profile[]>("list_profiles");
      }
    }

    setStatus(nextStatus);
    setProfiles(profilesToUse);
    setLastFetchedAt(Date.now());
  }

  useEffect(() => {
    refresh().catch(() => undefined);
    const fetchTimer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 10000);
    const clockTimer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(fetchTimer);
      window.clearInterval(clockTimer);
    };
  }, []);

  function openAddModal() {
    setEditingProfile(null);
    setDraftName("");
    setDraftEmail("");
    setDraftPlatformHost("github.com");
    setDraftSshKeyPath(sshKeyPrefix);
    setModalMode("add");
  }

  function openEditModal(profile: Profile) {
    setEditingProfile(profile);
    setDraftName(profile.gitUserName);
    setDraftEmail(profile.gitEmail);
    setDraftPlatformHost(profile.platformHost || "github.com");
    setDraftSshKeyPath(profile.sshKeyPath || sshKeyPrefix);
    setModalMode("edit");
  }

  function openDeleteModal(profile: Profile) {
    setEditingProfile(profile);
    setModalMode("delete");
  }

  function closeModal() {
    setModalMode("none");
    setEditingProfile(null);
    setDraftName("");
    setDraftEmail("");
    setDraftPlatformHost("github.com");
    setDraftSshKeyPath(sshKeyPrefix);
  }

  async function chooseSshKeyPath() {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: status?.sshConfigPath ? parentPath(status.sshConfigPath) : sshKeyPrefix,
      title: "选择 SSH key 文件",
    });

    if (typeof selected === "string") {
      setDraftSshKeyPath(selected);
    }
  }

  async function saveIdentity(event: FormEvent) {
    event.preventDefault();
    const userName = draftName.trim();
    const userEmail = draftEmail.trim();
    if (!userName || !userEmail) {
      return;
    }

    setBusyProfile("__save__");
    try {
      const nextProfile = profileFromIdentity(
        userName,
        userEmail,
        profiles,
        editingProfile?.name,
        draftPlatformHost,
        normalizeSshKeyInput(draftSshKeyPath),
      );
      nextProfile.sshHost = editingProfile?.sshHost ?? null;
      if (editingProfile && editingProfile.name !== nextProfile.name) {
        await call<ActionReport>("remove_profile", { profileName: editingProfile.name });
      }
      await call<ActionReport>("save_profile", { profile: nextProfile });
      closeModal();
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  async function switchTo(profile: Profile) {
    setBusyProfile(profile.name);
    try {
      await call<ActionReport>("switch_global_identity", {
        profileName: profile.name,
        whatIf: false,
      });
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  async function confirmDelete() {
    if (!editingProfile) {
      return;
    }
    setBusyProfile(editingProfile.name);
    try {
      await call<ActionReport>("remove_profile", { profileName: editingProfile.name });
      closeModal();
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  return (
    <main className="appShell accountsOnly">
      <header className="headLine">
        <div className="productIcon" title="Git Account Switcher">
          <GitBranch size={18} />
        </div>
        <button className="addButton" onClick={openAddModal} title="添加账号">
          <Plus size={17} />
        </button>
      </header>

      <section className="accountPanel">
        {profiles.map((profile) => {
          const active = sameIdentity(profile, status);
          return (
            <article className={`accountRow ${active ? "active" : ""}`} key={profile.name}>
              <div className="accountName">
                <strong>{profile.gitUserName}</strong>
                <span>{profile.gitEmail}</span>
                <small>
                  <b>{profile.platformHost || "github.com"}</b>
                  {profile.sshKeyPath ? profile.sshKeyPath : "未绑定 SSH key"}
                </small>
              </div>
              <div className="rowActions">
                <button
                  className={`enableButton ${active ? "enabled" : ""}`}
                  onClick={() => switchTo(profile)}
                  disabled={busyProfile === profile.name || active}
                  title={`启用 ${profile.gitUserName}`}
                >
                  {active ? <Check size={15} /> : null}
                  启用
                </button>
                <button className="iconAction" onClick={() => openEditModal(profile)} title="修改信息">
                  <Pencil size={15} />
                </button>
                <button className="iconAction" onClick={() => openDeleteModal(profile)} title="删除账号">
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {(modalMode === "add" || modalMode === "edit") && (
        <div className="modalLayer" role="dialog" aria-modal="true">
          <form className="modalCard" onSubmit={saveIdentity}>
            <header>
              <h2>{modalMode === "add" ? "添加账号" : "修改账号"}</h2>
              <button type="button" onClick={closeModal}>
                关闭
              </button>
            </header>
            <label>
              <span>user.name</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus />
            </label>
            <label>
              <span>user.email</span>
              <input value={draftEmail} onChange={(event) => setDraftEmail(event.target.value)} />
            </label>
            <label>
              <span>平台域名</span>
              <input value={draftPlatformHost} onChange={(event) => setDraftPlatformHost(event.target.value)} placeholder="github.com" />
            </label>
            <label>
              <span className="fieldTitle">
                SSH key 路径
                <em>选无 .pub 后缀的私钥</em>
              </span>
              <div className="pathField">
                <input
                  value={draftSshKeyPath}
                  onBlur={() => setDraftSshKeyPath((value) => normalizeSshKeyInput(value) || sshKeyPrefix)}
                  onChange={(event) => setDraftSshKeyPath(event.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
                <button type="button" className="pathPicker" onClick={chooseSshKeyPath} title="选择 SSH key 文件">
                  <FolderOpen size={15} />
                </button>
              </div>
            </label>
            <button className="modalPrimary" type="submit" disabled={busyProfile === "__save__"}>
              <Save size={15} />
              保存
            </button>
          </form>
        </div>
      )}

      {modalMode === "delete" && editingProfile && (
        <div className="modalLayer" role="dialog" aria-modal="true">
          <section className="modalCard deleteConfirm">
            <header>
              <h2>删除账号</h2>
              <button type="button" onClick={closeModal}>
                关闭
              </button>
            </header>
            <p>
              将从本地列表删除 <strong>{editingProfile.gitUserName}</strong>，不会修改当前 Git 全局配置。
            </p>
            <div className="confirmActions">
              <button type="button" onClick={closeModal}>
                取消
              </button>
              <button type="button" className="dangerButton" onClick={confirmDelete} disabled={busyProfile === editingProfile.name}>
                删除
              </button>
            </div>
          </section>
        </div>
      )}

      <footer className="statusBar">
        <span>{lastFetchedAt ? `最近拉取配置：${formatElapsed(now - lastFetchedAt)}前` : "最近拉取配置：等待中"}</span>
      </footer>
    </main>
  );
}

export default App;
