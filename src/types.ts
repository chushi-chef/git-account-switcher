export type Protocol = "ssh" | "https";
export type Scope = "global" | "repo";
export type AppLanguage = "zh-CN" | "en";
export type AppTheme = "system" | "light" | "dark";

export interface Profile {
  name: string;
  gitUserName: string;
  gitEmail: string;
  gitHubUser: string;
  protocol: Protocol;
  platformHost?: string | null;
  sshHost?: string | null;
  sshKeyPath?: string | null;
}

export interface RepoStatus {
  path: string;
  isRepo: boolean;
  userName?: string | null;
  userEmail?: string | null;
  origin?: string | null;
}

export interface AppStatus {
  appVersion: string;
  gitAvailable: boolean;
  gitVersion?: string | null;
  globalUserName?: string | null;
  globalUserEmail?: string | null;
  credentialHelper?: string | null;
  profilesPath: string;
  settingsPath: string;
  sshConfigPath: string;
  repo?: RepoStatus | null;
}

export interface AppSettings {
  language: AppLanguage;
  theme: AppTheme;
}

export interface ActionReport {
  actions: string[];
  changed: boolean;
}
