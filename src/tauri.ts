import { invoke } from "@tauri-apps/api/core";
import type { ActionReport, AppSettings, AppStatus, ImportReport, Profile, ProfileHealth } from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const mockProfiles: Profile[] = [
  {
    name: "small",
    gitUserName: "Your Name",
    gitEmail: "12345678+yourname@users.noreply.github.com",
    gitHubUser: "yourname",
    protocol: "ssh",
    sshHost: "github-small",
    sshKeyPath: "C:\\Users\\you\\.ssh\\id_ed25519_small",
    pinned: false,
    sortOrder: 0,
  },
];

let mockSettings: AppSettings = {
  language: "zh-CN",
  theme: "system",
};

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invoke<T>(command, args);
  }

  await new Promise((resolve) => window.setTimeout(resolve, 160));
  if (command === "get_status") {
    return ({
      appVersion: "0.1.0",
      gitAvailable: true,
      gitVersion: "git version 2.x",
      globalUserName: "preview-user",
      globalUserEmail: "preview@example.com",
      credentialHelper: "store",
      profilesPath: "~/.git-account-switcher/profiles.json",
      settingsPath: "~/.git-account-switcher/settings.json",
      sshConfigPath: "~/.ssh/config",
      repo: args?.repoPath
        ? {
            path: String(args.repoPath),
            isRepo: true,
            userName: "repo-user",
            userEmail: "repo@example.com",
            origin: "git@github.com:owner/repo.git",
          }
        : null,
    } satisfies AppStatus) as T;
  }
  if (command === "list_profiles") {
    return mockProfiles as T;
  }
  if (command === "list_profile_health") {
    return ([
      {
        profileName: "small",
        level: "ok",
        items: [{ label: "email", status: "ok", message: "Email format looks valid." }],
      },
    ] satisfies ProfileHealth[]) as T;
  }
  if (command === "get_settings") {
    return mockSettings as T;
  }
  if (command === "save_settings") {
    mockSettings = args?.settings as AppSettings;
    return ({ actions: ["Saved settings."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "detect_network_proxy") {
    return null as T;
  }
  if (command === "export_profiles") {
    return ({ actions: ["Exported profiles."], changed: false } satisfies ActionReport) as T;
  }
  if (command === "import_profiles") {
    return ({ actions: ["Imported profiles."], changed: true, imported: 1, skipped: 0 } satisfies ImportReport) as T;
  }
  if (command === "save_profile") {
    return ({ actions: ["Saved profile."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "remove_profile") {
    return ({ actions: ["Removed profile."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "toggle_profile_pin") {
    return ({ actions: ["Pinned profile."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "move_profile") {
    return ({ actions: ["Moved profile."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "reorder_profiles") {
    return ({ actions: ["Reordered profiles."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "ensure_ssh_host") {
    return ({ actions: ["Ensure SSH directory exists.", "Write SSH host alias."], changed: false } satisfies ActionReport) as T;
  }
  if (command === "switch_global_identity") {
    return ({ actions: ["Switched global identity."], changed: true } satisfies ActionReport) as T;
  }
  if (command === "activate_profile") {
    return ({ actions: ["Preview activation.", "No credentials were deleted."], changed: false } satisfies ActionReport) as T;
  }
  throw new Error(`Preview mock does not implement ${command}`);
}
