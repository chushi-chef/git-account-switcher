import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  Check,
  FolderOpen,
  GitBranch,
  Pencil,
  Plus,
  Save,
  Settings,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { call } from "./tauri";
import type { ActionReport, AppLanguage, AppSettings, AppStatus, AppTheme, Profile } from "./types";

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

const defaultSettings: AppSettings = {
  language: "zh-CN",
  theme: "system",
};

const languageOptions: Array<{ value: AppLanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

const themeOptions: Array<{ value: AppTheme; label: Record<AppLanguage, string> }> = [
  { value: "system", label: { "zh-CN": "跟随系统", en: "System" } },
  { value: "light", label: { "zh-CN": "浅色", en: "Light" } },
  { value: "dark", label: { "zh-CN": "深色", en: "Dark" } },
];

const messages = {
  "zh-CN": {
    addAccount: "添加账号",
    editAccount: "修改账号",
    saveIdentityDescription: "保存 Git 提交身份，可选绑定本机 SSH 私钥路径。",
    platformHost: "平台域名",
    sshKeyPath: "SSH key 路径",
    privateKeyHint: "选无 .pub 后缀的私钥",
    chooseSshKey: "选择 SSH key 文件",
    cancel: "取消",
    save: "保存",
    enable: "启用",
    editInfo: "修改信息",
    deleteAccount: "删除账号",
    deleteDescription: "将从本地列表删除",
    deleteNote: "不会修改当前 Git 全局配置。",
    settings: "设置",
    settingsDescription: "点选后立即生效，并保存到本机设置文件。",
    language: "语言",
    theme: "主题",
    saving: "正在保存...",
    settingsPath: "保存位置",
    checkUpdate: "检查更新",
    checkingUpdate: "正在检查更新...",
    downloadingUpdate: "正在下载更新...",
    updateReady: "发现新版本",
    updateReadyDescription: "检测到 GitHub Release 上有可用更新。",
    updateNow: "更新",
    upToDate: "已是最新版本",
    upToDateDescription: "当前版本已经是 GitHub Release 上的最新版本。",
    updateUnavailable: "无法自动更新",
    noCompatibleAsset: "找到新版本，但没有适合当前平台的安装包。",
    updateFailed: "更新检查失败",
    currentVersion: "当前版本",
    latestVersion: "最新版本",
    packageName: "发布日期",
    noSshKey: "未绑定 SSH key",
    unsetIdentity: "未设置全局 Git 身份",
    gitNotReady: "Git 未就绪",
    recentRefresh: "最近拉取配置",
    waiting: "等待中",
    ago: "前",
  },
  en: {
    addAccount: "Add Account",
    editAccount: "Edit Account",
    saveIdentityDescription: "Save the Git commit identity, with an optional local SSH private key.",
    platformHost: "Platform Host",
    sshKeyPath: "SSH key path",
    privateKeyHint: "Choose the private key without .pub",
    chooseSshKey: "Choose SSH key file",
    cancel: "Cancel",
    save: "Save",
    enable: "Enable",
    editInfo: "Edit info",
    deleteAccount: "Delete Account",
    deleteDescription: "Remove from the local account list",
    deleteNote: "The current global Git config will not be changed.",
    settings: "Settings",
    settingsDescription: "Selections apply immediately and are saved to the local settings file.",
    language: "Language",
    theme: "Theme",
    saving: "Saving...",
    settingsPath: "Saved at",
    checkUpdate: "Check for updates",
    checkingUpdate: "Checking for updates...",
    downloadingUpdate: "Downloading update...",
    updateReady: "Update Available",
    updateReadyDescription: "A newer GitHub Release is available.",
    updateNow: "Update",
    upToDate: "Up to Date",
    upToDateDescription: "This is already the latest GitHub Release.",
    updateUnavailable: "Automatic Update Unavailable",
    noCompatibleAsset: "A newer version exists, but no installer was found for this platform.",
    updateFailed: "Update Check Failed",
    currentVersion: "Current version",
    latestVersion: "Latest version",
    packageName: "Release date",
    noSshKey: "No SSH key",
    unsetIdentity: "Global Git identity is not set",
    gitNotReady: "Git is not ready",
    recentRefresh: "Last config refresh",
    waiting: "waiting",
    ago: "ago",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

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

function formatElapsed(ms: number, language: AppLanguage) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (language === "en") {
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(defaultSettings);
  const latestSettingsRef = useRef<AppSettings>(defaultSettings);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const text = messages[settings.language];

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

  async function loadSettings() {
    const nextSettings = await call<AppSettings>("get_settings");
    latestSettingsRef.current = nextSettings;
    setSettings(nextSettings);
    setDraftSettings(nextSettings);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
    loadSettings().catch(() => undefined);
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

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

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

  function openSettingsModal() {
    setDraftSettings(settings);
    setSettingsOpen(true);
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
      title: text.chooseSshKey,
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

  async function applySettings(patch: Partial<AppSettings>) {
    const nextSettings = {
      ...latestSettingsRef.current,
      ...patch,
    };

    if (nextSettings.language === latestSettingsRef.current.language && nextSettings.theme === latestSettingsRef.current.theme) {
      return;
    }

    latestSettingsRef.current = nextSettings;
    setSettings(nextSettings);
    setDraftSettings(nextSettings);
    setBusyProfile("__settings__");
    try {
      await call<ActionReport>("save_settings", { settings: nextSettings });
    } catch (error) {
      await loadSettings().catch(() => undefined);
      throw error;
    } finally {
      setBusyProfile("");
    }
  }

  function readableError(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  async function checkForUpdates() {
    setBusyProfile("__update_check__");
    setUpdateInfo(null);
    setUpdateError("");
    try {
      const nextUpdateInfo = await check();
      setUpdateInfo(nextUpdateInfo);
    } catch (error) {
      setUpdateError(readableError(error));
    } finally {
      setBusyProfile("");
      setUpdateOpen(true);
    }
  }

  async function downloadAndOpenUpdate() {
    if (!updateInfo) {
      return;
    }
    setBusyProfile("__update_download__");
    setUpdateError("");
    try {
      await updateInfo.downloadAndInstall();
      setUpdateOpen(false);
      await relaunch();
    } catch (error) {
      setUpdateError(readableError(error));
    } finally {
      setBusyProfile("");
    }
  }

  const currentIdentity =
    status?.globalUserName && status?.globalUserEmail
      ? `${status.globalUserName} <${status.globalUserEmail}>`
      : text.unsetIdentity;
  const gitVersion = status?.gitVersion || text.gitNotReady;
  const appVersion = status?.appVersion || "0.1.0";
  const updateBusy = busyProfile === "__update_check__" || busyProfile === "__update_download__";
  const canDownloadUpdate = Boolean(updateInfo);

  return (
    <main className="appShell accountsOnly">
      <Card className="headLine">
        <CardContent className="headLineContent">
          <div className="brandCluster">
            <div className="productIcon" title="Git Account Switcher">
              <GitBranch size={18} />
            </div>
            <button className="versionPill" type="button" onClick={checkForUpdates} disabled={updateBusy} title={text.checkUpdate}>
              {busyProfile === "__update_check__" ? "..." : `v${appVersion}`}
            </button>
          </div>
          <div className="headerActions">
            <Button size="icon" variant="ghost" onClick={openSettingsModal} title={text.settings}>
              <Settings size={16} />
            </Button>
            <Button size="icon" variant="icon" onClick={openAddModal} title={text.addAccount}>
              <Plus size={17} />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="accountPanel">
        {profiles.map((profile) => {
          const active = sameIdentity(profile, status);
          return (
            <Card className={`accountRow ${active ? "active" : ""}`} key={profile.name}>
              <div className="accountName">
                <strong>{profile.gitUserName}</strong>
                <span>{profile.gitEmail}</span>
                <small>
                  <Badge>{profile.platformHost || "github.com"}</Badge>
                  {profile.sshKeyPath ? profile.sshKeyPath : text.noSshKey}
                </small>
              </div>
              <div className="rowActions">
                <Button
                  variant={active ? "secondary" : "default"}
                  size="sm"
                  className={active ? "enabledButton" : undefined}
                  onClick={() => switchTo(profile)}
                  disabled={busyProfile === profile.name || active}
                  title={`${text.enable} ${profile.gitUserName}`}
                >
                  {active ? <Check size={15} /> : null}
                  {text.enable}
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openEditModal(profile)} title={text.editInfo}>
                  <Pencil size={15} />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => openDeleteModal(profile)} title={text.deleteAccount}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </Card>
          );
        })}
      </Card>

      <Dialog open={modalMode === "add" || modalMode === "edit"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <form className="modalForm" onSubmit={saveIdentity}>
            <DialogHeader>
              <DialogTitle>{modalMode === "add" ? text.addAccount : text.editAccount}</DialogTitle>
              <DialogDescription>{text.saveIdentityDescription}</DialogDescription>
            </DialogHeader>
            <div className="fieldStack">
              <Label htmlFor="git-user-name">user.name</Label>
              <Input id="git-user-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} autoFocus />
            </div>
            <div className="fieldStack">
              <Label htmlFor="git-user-email">user.email</Label>
              <Input id="git-user-email" value={draftEmail} onChange={(event) => setDraftEmail(event.target.value)} />
            </div>
            <div className="fieldStack">
              <Label htmlFor="platform-host">{text.platformHost}</Label>
              <Input
                id="platform-host"
                value={draftPlatformHost}
                onChange={(event) => setDraftPlatformHost(event.target.value)}
                placeholder="github.com"
              />
            </div>
            <div className="fieldStack">
              <div className="fieldTitle">
                <Label htmlFor="ssh-key-path">{text.sshKeyPath}</Label>
                <em>{text.privateKeyHint}</em>
              </div>
              <div className="pathField">
                <Input
                  id="ssh-key-path"
                  value={draftSshKeyPath}
                  onBlur={() => setDraftSshKeyPath((value) => normalizeSshKeyInput(value) || sshKeyPrefix)}
                  onChange={(event) => setDraftSshKeyPath(event.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
                <Button type="button" size="icon" variant="icon" onClick={chooseSshKeyPath} title={text.chooseSshKey}>
                  <FolderOpen size={15} />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {text.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busyProfile === "__save__"}>
                <Save size={15} />
                {text.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={modalMode === "delete"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="deleteConfirm">
          <DialogHeader>
            <DialogTitle>{text.deleteAccount}</DialogTitle>
            <DialogDescription>
              {settings.language === "en" ? (
                <>
                  {text.deleteDescription} <strong>{editingProfile?.gitUserName}</strong>. {text.deleteNote}
                </>
              ) : (
                <>
                  {text.deleteDescription} <strong>{editingProfile?.gitUserName}</strong>，{text.deleteNote}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {text.cancel}
              </Button>
            </DialogClose>
            {editingProfile ? (
              <Button type="button" variant="destructive" onClick={confirmDelete} disabled={busyProfile === editingProfile.name}>
                {text.deleteAccount}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <div className="modalForm">
            <DialogHeader>
              <DialogTitle>{text.settings}</DialogTitle>
              <DialogDescription>{text.settingsDescription}</DialogDescription>
            </DialogHeader>

            <div className="fieldStack">
              <Label>{text.language}</Label>
              <div className="segmentedControl" role="group" aria-label={text.language}>
                {languageOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={draftSettings.language === option.value ? "secondary" : "ghost"}
                    size="sm"
                    className={draftSettings.language === option.value ? "selectedOption" : undefined}
                    aria-pressed={draftSettings.language === option.value}
                    disabled={busyProfile === "__settings__" && draftSettings.language === option.value}
                    onClick={() => applySettings({ language: option.value }).catch(() => undefined)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="fieldStack">
              <Label>{text.theme}</Label>
              <div className="segmentedControl" role="group" aria-label={text.theme}>
                {themeOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant={draftSettings.theme === option.value ? "secondary" : "ghost"}
                    size="sm"
                    className={draftSettings.theme === option.value ? "selectedOption" : undefined}
                    aria-pressed={draftSettings.theme === option.value}
                    disabled={busyProfile === "__settings__" && draftSettings.theme === option.value}
                    onClick={() => applySettings({ theme: option.value }).catch(() => undefined)}
                  >
                    {option.label[settings.language]}
                  </Button>
                ))}
              </div>
            </div>

            <p className="settingsPath">
              {busyProfile === "__settings__"
                ? text.saving
                : `${text.settingsPath}: ${status?.settingsPath || "~/.git-account-switcher/settings.json"}`}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent>
          <div className="modalForm">
            <DialogHeader>
              <DialogTitle>
                {updateError
                  ? text.updateFailed
                  : updateInfo
                    ? text.updateReady
                    : text.upToDate}
              </DialogTitle>
              <DialogDescription>
                {updateError
                  ? updateError
                  : updateInfo
                    ? text.updateReadyDescription
                    : text.upToDateDescription}
              </DialogDescription>
            </DialogHeader>

            {updateInfo ? (
              <div className="updateDetails">
                <span>
                  {text.currentVersion}: v{updateInfo.currentVersion}
                </span>
                <span>
                  {text.latestVersion}: v{updateInfo.version}
                </span>
                {updateInfo.date ? (
                  <span>
                    {text.packageName}: {updateInfo.date}
                  </span>
                ) : null}
              </div>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={busyProfile === "__update_download__"}>
                  {text.cancel}
                </Button>
              </DialogClose>
              {canDownloadUpdate ? (
                <Button type="button" onClick={downloadAndOpenUpdate} disabled={busyProfile === "__update_download__"}>
                  {busyProfile === "__update_download__" ? text.downloadingUpdate : text.updateNow}
                </Button>
              ) : null}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="statusBar">
        <CardContent className="statusBarContent">
          <span>{gitVersion}</span>
          <span>{currentIdentity}</span>
          <span>
            {lastFetchedAt
              ? `${text.recentRefresh}: ${formatElapsed(now - lastFetchedAt, settings.language)} ${text.ago}`
              : `${text.recentRefresh}: ${text.waiting}`}
          </span>
        </CardContent>
      </Card>
    </main>
  );
}

export default App;
