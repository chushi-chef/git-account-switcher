import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  AlertTriangle,
  Download,
  FolderOpen,
  GitBranch,
  GripVertical,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Pin,
  Plus,
  Power,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type CSSProperties, FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
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
import type {
  ActionReport,
  AppLanguage,
  AppSettings,
  AppStatus,
  AppTheme,
  ImportReport,
  Profile,
  ProfileHealth,
} from "./types";

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

type ModalMode = "none" | "add" | "edit" | "delete" | "switch";
type AppPage = "accounts" | "settings";

const defaultSettings: AppSettings = {
  language: "zh-CN",
  theme: "system",
};

const updateRequestTimeoutMs = 7000;

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
    activate: "切换",
    accounts: "账号",
    activeAccount: "当前账号",
    dragToReorder: "拖拽排序",
    minimizeWindow: "最小化",
    maximizeWindow: "最大化",
    restoreWindow: "还原窗口",
    closeWindow: "关闭",
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
    accountData: "账号数据",
    importAccounts: "导入账号",
    exportAccounts: "导出账号",
    importAccountsTitle: "选择账号备份文件",
    exportAccountsTitle: "导出账号备份",
    accountDataDescription: "导出会生成 JSON 备份；导入会合并账号，重复身份会跳过。",
    importDone: "导入完成",
    exportDone: "导出完成",
    checkUpdate: "检查更新",
    checkingUpdate: "正在检查更新...",
    checkingUpdateDescription: "正在连接 GitHub Release。每次请求都会自动检测当前系统代理。",
    downloadingUpdate: "正在下载更新...",
    downloadProgress: "下载进度",
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
    networkHint: "如果你在中国境内，确认 Clash/代理已接管 GitHub 流量后再试。",
    noSshKey: "未绑定 SSH key",
    healthOk: "健康",
    healthWarning: "注意",
    healthError: "异常",
    pinAccount: "置顶账号",
    unpinAccount: "取消置顶",
    moveUp: "上移",
    moveDown: "下移",
    switchAccount: "切换账号",
    switchDescription: "确认后会写入全局 Git 身份，并同步 SSH Host。切换完成后会自动校验。",
    switchCurrent: "当前",
    switchTarget: "目标",
    switchVerified: "切换已校验",
    switchVerifyFailed: "切换后校验失败，请检查 Git 全局配置。",
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
    activate: "Switch",
    accounts: "Accounts",
    activeAccount: "Current account",
    dragToReorder: "Drag to reorder",
    minimizeWindow: "Minimize",
    maximizeWindow: "Maximize",
    restoreWindow: "Restore",
    closeWindow: "Close",
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
    accountData: "Account Data",
    importAccounts: "Import Accounts",
    exportAccounts: "Export Accounts",
    importAccountsTitle: "Choose account backup",
    exportAccountsTitle: "Export account backup",
    accountDataDescription: "Export creates a JSON backup. Import merges accounts and skips duplicate identities.",
    importDone: "Import complete",
    exportDone: "Export complete",
    checkUpdate: "Check for updates",
    checkingUpdate: "Checking for updates...",
    checkingUpdateDescription: "Connecting to GitHub Releases. The current system proxy is detected for every request.",
    downloadingUpdate: "Downloading update...",
    downloadProgress: "Download progress",
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
    networkHint: "If GitHub is slow or blocked, enable your proxy/VPN and try again.",
    noSshKey: "No SSH key",
    healthOk: "Healthy",
    healthWarning: "Check",
    healthError: "Issue",
    pinAccount: "Pin account",
    unpinAccount: "Unpin account",
    moveUp: "Move up",
    moveDown: "Move down",
    switchAccount: "Switch Account",
    switchDescription: "This writes the global Git identity and syncs SSH Host. The result is verified after switching.",
    switchCurrent: "Current",
    switchTarget: "Target",
    switchVerified: "Switch verified",
    switchVerifyFailed: "Switch verification failed. Check the global Git config.",
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

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
  };
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

type TextLabels = (typeof messages)["zh-CN"];

type SortableProfileRowProps = {
  profile: Profile;
  active: boolean;
  health?: ProfileHealth;
  healthLabel: string;
  text: TextLabels;
  busyProfile: string;
  draggingProfileName: string | null;
  onTogglePin: (profile: Profile) => void;
  onSwitch: (profile: Profile) => void;
  onEdit: (profile: Profile) => void;
  onDelete: (profile: Profile) => void;
};

function SortableProfileRow({
  profile,
  active,
  health,
  healthLabel,
  text,
  busyProfile,
  draggingProfileName,
  onTogglePin,
  onSwitch,
  onEdit,
  onDelete,
}: SortableProfileRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: profile.name,
    disabled: busyProfile === "__reorder__",
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 4 : undefined,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`accountRow ${active ? "active" : ""} ${draggingProfileName === profile.name || isDragging ? "dragging" : ""}`}
    >
      <div className="accountName">
        <strong>{profile.gitUserName}</strong>
        <span>{profile.gitEmail}</span>
        <small>
          <Badge>{profile.platformHost || "github.com"}</Badge>
          {health ? (
            <span className={`healthPill ${health.level}`} title={health.items.map((item) => item.message).join("\n")}>
              {health.level === "ok" ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
              {healthLabel}
            </span>
          ) : null}
          {profile.sshKeyPath ? profile.sshKeyPath : text.noSshKey}
        </small>
      </div>
      <div className="rowActions">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="dragHandle"
          disabled={busyProfile === "__reorder__"}
          title={text.dragToReorder}
          aria-label={`${text.dragToReorder} ${profile.gitUserName}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={15} />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => onTogglePin(profile)}
          disabled={busyProfile === `__pin__${profile.name}`}
          title={profile.pinned ? text.unpinAccount : text.pinAccount}
          className={profile.pinned ? "pinnedButton" : undefined}
        >
          <Pin size={14} />
        </Button>
        <Button
          type="button"
          variant={active ? "secondary" : "default"}
          size="icon"
          className={`activateButton ${active ? "active" : ""}`}
          onClick={() => onSwitch(profile)}
          disabled={busyProfile === profile.name || active}
          title={active ? text.activeAccount : `${text.activate} ${profile.gitUserName}`}
          aria-label={active ? text.activeAccount : `${text.activate} ${profile.gitUserName}`}
        >
          <Power size={15} />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => onEdit(profile)} title={text.editInfo}>
          <Pencil size={15} />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => onDelete(profile)} title={text.deleteAccount}>
          <Trash2 size={15} />
        </Button>
      </div>
    </Card>
  );
}

function getAppWindow() {
  if (!("__TAURI_INTERNALS__" in window)) {
    return null;
  }
  return getCurrentWindow();
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileHealth, setProfileHealth] = useState<Record<string, ProfileHealth>>({});
  const [modalMode, setModalMode] = useState<ModalMode>("none");
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [pendingSwitchProfile, setPendingSwitchProfile] = useState<Profile | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftPlatformHost, setDraftPlatformHost] = useState("github.com");
  const [draftSshKeyPath, setDraftSshKeyPath] = useState(sshKeyPrefix);
  const [switchNotice, setSwitchNotice] = useState("");
  const [busyProfile, setBusyProfile] = useState("");
  const [activePage, setActivePage] = useState<AppPage>("accounts");
  const [draggingProfileName, setDraggingProfileName] = useState<string | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(defaultSettings);
  const latestSettingsRef = useRef<AppSettings>(defaultSettings);
  const profilesRef = useRef<Profile[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const updateRunRef = useRef(0);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateProgress, setUpdateProgress] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const text = messages[settings.language];

  async function refresh() {
    const [nextStatus, nextProfiles, nextHealth] = await Promise.all([
      call<AppStatus>("get_status", { repoPath: null }),
      call<Profile[]>("list_profiles"),
      call<ProfileHealth[]>("list_profile_health"),
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
    setProfileHealth(Object.fromEntries(nextHealth.map((health) => [health.profileName, health])));
    setLastFetchedAt(Date.now());
  }

  async function loadSettings() {
    const nextSettings = normalizeSettings(await call<AppSettings>("get_settings"));
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

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    const appWindow = getAppWindow();
    if (!appWindow) {
      return;
    }

    let disposed = false;
    const syncMaximized = () => {
      appWindow
        .isMaximized()
        .then((maximized) => {
          if (!disposed) {
            setWindowMaximized(maximized);
          }
        })
        .catch(() => undefined);
    };

    syncMaximized();
    const unlisten = appWindow.onResized(syncMaximized);
    return () => {
      disposed = true;
      unlisten.then((dispose) => dispose()).catch(() => undefined);
    };
  }, []);

  function startWindowDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || event.detail > 1) {
      return;
    }
    getAppWindow()?.startDragging().catch(() => undefined);
  }

  async function toggleWindowMaximize() {
    const appWindow = getAppWindow();
    if (!appWindow) {
      return;
    }

    await appWindow.toggleMaximize().catch(() => undefined);
    appWindow
      .isMaximized()
      .then(setWindowMaximized)
      .catch(() => undefined);
  }

  function minimizeWindow() {
    getAppWindow()?.minimize().catch(() => undefined);
  }

  function closeWindow() {
    getAppWindow()?.close().catch(() => undefined);
  }

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

  function openSwitchModal(profile: Profile) {
    setPendingSwitchProfile(profile);
    setSwitchNotice("");
    setModalMode("switch");
  }

  function openSettingsPage() {
    setDraftSettings(settings);
    setActivePage("settings");
  }

  function closeModal() {
    setModalMode("none");
    setEditingProfile(null);
    setPendingSwitchProfile(null);
    setSwitchNotice("");
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
      nextProfile.pinned = editingProfile?.pinned ?? false;
      nextProfile.sortOrder = editingProfile?.sortOrder ?? null;
      await call<ActionReport>("save_profile", { profile: nextProfile });
      if (editingProfile && editingProfile.name !== nextProfile.name) {
        await call<ActionReport>("remove_profile", { profileName: editingProfile.name });
      }
      closeModal();
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  async function confirmSwitch() {
    const profile = pendingSwitchProfile;
    if (!profile) {
      return;
    }

    setBusyProfile(profile.name);
    setSwitchNotice("");
    try {
      await call<ActionReport>("switch_global_identity", {
        profileName: profile.name,
        whatIf: false,
      });
      const nextStatus = await call<AppStatus>("get_status", { repoPath: null });
      if (nextStatus.globalUserName !== profile.gitUserName || nextStatus.globalUserEmail !== profile.gitEmail) {
        setSwitchNotice(text.switchVerifyFailed);
        setStatus(nextStatus);
        return;
      }
      setSwitchNotice(text.switchVerified);
      closeModal();
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  async function togglePin(profile: Profile) {
    setBusyProfile(`__pin__${profile.name}`);
    try {
      await call<ActionReport>("toggle_profile_pin", { profileName: profile.name });
      await refresh();
    } finally {
      setBusyProfile("");
    }
  }

  function beginProfileDrag(event: DragStartEvent) {
    setDraggingProfileName(String(event.active.id));
  }

  function cancelProfileDrag() {
    setDraggingProfileName(null);
  }

  async function finishProfileDrag(event: DragEndEvent) {
    setDraggingProfileName(null);
    const sourceName = String(event.active.id);
    const targetName = event.over ? String(event.over.id) : "";
    if (!targetName || sourceName === targetName) {
      return;
    }

    const currentProfiles = profilesRef.current;
    const sourceIndex = currentProfiles.findIndex((profile) => profile.name === sourceName);
    const targetIndex = currentProfiles.findIndex((profile) => profile.name === targetName);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return;
    }

    const nextProfiles = arrayMove(currentProfiles, sourceIndex, targetIndex);
    profilesRef.current = nextProfiles;
    setProfiles(nextProfiles);
    setBusyProfile("__reorder__");
    try {
      await call<ActionReport>("reorder_profiles", {
        profileNames: nextProfiles.map((profile) => profile.name),
      });
      await refresh();
    } catch {
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
    const nextSettings = normalizeSettings({
      ...latestSettingsRef.current,
      ...patch,
    });

    if (JSON.stringify(nextSettings) === JSON.stringify(latestSettingsRef.current)) {
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

  function readableUpdateError(error: unknown) {
    const raw = readableError(error);
    return `${raw}\n${text.networkHint}`;
  }

  function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  }

  async function exportAccountData() {
    const selected = await saveDialog({
      title: text.exportAccountsTitle,
      defaultPath: "git-account-switcher-profiles.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (!selected) {
      return;
    }

    setBusyProfile("__account_data__");
    setSettingsNotice("");
    try {
      const report = await call<ActionReport>("export_profiles", { path: selected });
      setSettingsNotice(report.actions[0] || text.exportDone);
    } catch (error) {
      setSettingsNotice(readableError(error));
    } finally {
      setBusyProfile("");
    }
  }

  async function importAccountData() {
    const selected = await open({
      multiple: false,
      directory: false,
      title: text.importAccountsTitle,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (typeof selected !== "string") {
      return;
    }

    setBusyProfile("__account_data__");
    setSettingsNotice("");
    try {
      const report = await call<ImportReport>("import_profiles", { path: selected });
      setSettingsNotice(report.actions[0] || `${text.importDone}: ${report.imported}`);
      await refresh();
    } catch (error) {
      setSettingsNotice(readableError(error));
    } finally {
      setBusyProfile("");
    }
  }

  async function detectNetworkProxy() {
    const proxy = await call<string | null>("detect_network_proxy");
    return proxy?.trim() || undefined;
  }

  async function checkForUpdates() {
    const runId = updateRunRef.current + 1;
    updateRunRef.current = runId;
    setBusyProfile("__update_check__");
    setUpdateInfo(null);
    setUpdateError("");
    setUpdateProgress("");
    setUpdateOpen(true);
    try {
      const proxy = await detectNetworkProxy();
      const nextUpdateInfo = await check({
        timeout: updateRequestTimeoutMs,
        proxy,
      });
      if (updateRunRef.current !== runId) {
        return;
      }
      setUpdateInfo(nextUpdateInfo);
    } catch (error) {
      if (updateRunRef.current !== runId) {
        return;
      }
      setUpdateError(readableUpdateError(error));
    } finally {
      if (updateRunRef.current === runId) {
        setBusyProfile("");
      }
    }
  }

  async function downloadAndOpenUpdate() {
    if (!updateInfo) {
      return;
    }
    setBusyProfile("__update_download__");
    setUpdateError("");
    setUpdateProgress("");
    try {
      const proxy = await detectNetworkProxy();
      const latestUpdateInfo = await check({
        timeout: updateRequestTimeoutMs,
        proxy,
      });
      if (!latestUpdateInfo) {
        setUpdateInfo(null);
        setUpdateError(text.upToDateDescription);
        return;
      }
      setUpdateInfo(latestUpdateInfo);
      let downloaded = 0;
      let total = 0;
      const onEvent = (event: DownloadEvent) => {
        if (event.event === "Started") {
          downloaded = 0;
          total = event.data.contentLength || 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        } else {
          setUpdateProgress(text.downloadingUpdate);
          return;
        }

        setUpdateProgress(
          total > 0
            ? `${text.downloadProgress}: ${formatBytes(downloaded)} / ${formatBytes(total)}`
            : `${text.downloadProgress}: ${formatBytes(downloaded)}`,
        );
      };
      await latestUpdateInfo.downloadAndInstall(onEvent, { timeout: updateRequestTimeoutMs });
      setUpdateOpen(false);
      await relaunch();
    } catch (error) {
      setUpdateError(readableUpdateError(error));
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
  const pendingTargetIdentity = pendingSwitchProfile
    ? `${pendingSwitchProfile.gitUserName} <${pendingSwitchProfile.gitEmail}>`
    : "";
  const healthText = {
    ok: text.healthOk,
    warning: text.healthWarning,
    error: text.healthError,
  } satisfies Record<ProfileHealth["level"], string>;

  return (
    <main className="appShell accountsOnly">
      <div className="windowTitleBar">
        <div className="titleDragSurface" onMouseDown={startWindowDrag} onDoubleClick={toggleWindowMaximize}>
          <span className="windowTitleText">Git Account Switcher</span>
        </div>
        <div className="windowControls" aria-label="Window controls">
          <button className="windowControl" type="button" onClick={minimizeWindow} title={text.minimizeWindow}>
            <Minus size={14} />
          </button>
          <button
            className="windowControl"
            type="button"
            onClick={toggleWindowMaximize}
            title={windowMaximized ? text.restoreWindow : text.maximizeWindow}
          >
            {windowMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button className="windowControl close" type="button" onClick={closeWindow} title={text.closeWindow}>
            <X size={15} />
          </button>
        </div>
      </div>
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
            <Button
              size="icon"
              variant={activePage === "settings" ? "secondary" : "ghost"}
              onClick={activePage === "settings" ? () => setActivePage("accounts") : openSettingsPage}
              title={activePage === "settings" ? text.accounts : text.settings}
            >
              {activePage === "settings" ? <ArrowLeft size={16} /> : <Settings size={16} />}
            </Button>
            <Button size="icon" variant="icon" onClick={openAddModal} title={text.addAccount}>
              <Plus size={17} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {activePage === "settings" ? (
        <Card className="settingsPage">
          <div className="settingsPageContent">
            <div className="settingsHeader">
              <div>
                <h2>{text.settings}</h2>
                <p>{text.settingsDescription}</p>
              </div>
            </div>

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

            <div className="fieldStack">
              <div className="fieldTitle">
                <Label>{text.accountData}</Label>
                <em>{text.accountDataDescription}</em>
              </div>
              <div className="dataActions">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={exportAccountData}
                  disabled={busyProfile === "__account_data__"}
                >
                  <Download size={15} />
                  {text.exportAccounts}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={importAccountData}
                  disabled={busyProfile === "__account_data__"}
                >
                  <Upload size={15} />
                  {text.importAccounts}
                </Button>
              </div>
              {settingsNotice ? <p className="settingsNotice">{settingsNotice}</p> : null}
            </div>
          </div>
        </Card>
      ) : (
        <Card className="accountPanel">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={beginProfileDrag}
            onDragCancel={cancelProfileDrag}
            onDragEnd={finishProfileDrag}
          >
            <SortableContext items={profiles.map((profile) => profile.name)} strategy={verticalListSortingStrategy}>
              {profiles.map((profile) => {
                const active = sameIdentity(profile, status);
                const health = profileHealth[profile.name];
                return (
                  <SortableProfileRow
                    key={profile.name}
                    profile={profile}
                    active={active}
                    health={health}
                    healthLabel={health ? healthText[health.level] : ""}
                    text={text}
                    busyProfile={busyProfile}
                    draggingProfileName={draggingProfileName}
                    onTogglePin={togglePin}
                    onSwitch={openSwitchModal}
                    onEdit={openEditModal}
                    onDelete={openDeleteModal}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </Card>
      )}

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

      <Dialog open={modalMode === "switch"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent>
          <div className="modalForm">
            <DialogHeader>
              <DialogTitle>{text.switchAccount}</DialogTitle>
              <DialogDescription>{text.switchDescription}</DialogDescription>
            </DialogHeader>

            <div className="switchPreview">
              <div>
                <span>{text.switchCurrent}</span>
                <strong>{currentIdentity}</strong>
              </div>
              <div>
                <span>{text.switchTarget}</span>
                <strong>{pendingTargetIdentity}</strong>
              </div>
              {pendingSwitchProfile?.sshKeyPath ? (
                <div>
                  <span>{text.sshKeyPath}</span>
                  <strong>{pendingSwitchProfile.sshKeyPath}</strong>
                </div>
              ) : null}
            </div>

            {switchNotice ? <p className="settingsNotice">{switchNotice}</p> : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={Boolean(pendingSwitchProfile && busyProfile === pendingSwitchProfile.name)}>
                  {text.cancel}
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={confirmSwitch}
                disabled={Boolean(pendingSwitchProfile && busyProfile === pendingSwitchProfile.name)}
              >
                {text.activate}
              </Button>
            </DialogFooter>
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
                    : busyProfile === "__update_check__"
                      ? text.checkingUpdate
                      : text.upToDate}
              </DialogTitle>
              <DialogDescription className={updateError ? "updateErrorText" : undefined}>
                {updateError
                  ? updateError
                  : updateInfo
                    ? text.updateReadyDescription
                    : busyProfile === "__update_check__"
                      ? text.checkingUpdateDescription
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

            {updateProgress ? <p className="updateProgress">{updateProgress}</p> : null}

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
