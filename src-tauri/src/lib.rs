use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use thiserror::Error;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Error)]
enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<AppError> for String {
    fn from(value: AppError) -> Self {
        value.to_string()
    }
}

type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    name: String,
    git_user_name: String,
    git_email: String,
    git_hub_user: String,
    protocol: String,
    platform_host: Option<String>,
    ssh_host: Option<String>,
    ssh_key_path: Option<String>,
    pinned: Option<bool>,
    sort_order: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoStatus {
    path: String,
    is_repo: bool,
    user_name: Option<String>,
    user_email: Option<String>,
    origin: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    app_version: String,
    git_available: bool,
    git_version: Option<String>,
    global_user_name: Option<String>,
    global_user_email: Option<String>,
    credential_helper: Option<String>,
    profiles_path: String,
    settings_path: String,
    ssh_config_path: String,
    repo: Option<RepoStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionReport {
    actions: Vec<String>,
    changed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportReport {
    actions: Vec<String>,
    changed: bool,
    imported: usize,
    skipped: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileHealthItem {
    label: String,
    status: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileHealth {
    profile_name: String,
    level: String,
    items: Vec<ProfileHealthItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfilesExport {
    format_version: u8,
    app: String,
    exported_at: String,
    profiles: Vec<Profile>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProfilesImport {
    Export(ProfilesExport),
    Map(BTreeMap<String, Profile>),
    List(Vec<Profile>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    language: String,
    theme: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".into(),
            theme: "system".into(),
        }
    }
}

fn home_dir() -> AppResult<PathBuf> {
    dirs::home_dir().ok_or_else(|| AppError::Message("Could not resolve home directory.".into()))
}

fn config_dir() -> AppResult<PathBuf> {
    Ok(home_dir()?.join(".git-account-switcher"))
}

fn profiles_path() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("profiles.json"))
}

fn settings_path() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("settings.json"))
}

fn ssh_config_path() -> AppResult<PathBuf> {
    Ok(home_dir()?.join(".ssh").join("config"))
}

fn ensure_config_dir() -> AppResult<()> {
    fs::create_dir_all(config_dir()?)?;
    Ok(())
}

fn sibling_path_with_suffix(path: &Path, suffix: &str) -> AppResult<PathBuf> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::Message(format!("Invalid file path: {}", path.display())))?;
    Ok(path.with_file_name(format!("{}{}", file_name, suffix)))
}

fn write_text_with_backup(path: &Path, content: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Message(format!("Invalid file path: {}", path.display())))?;
    fs::create_dir_all(parent)?;

    let temp_path = sibling_path_with_suffix(path, ".git-account-switcher.tmp")?;
    let backup_path = sibling_path_with_suffix(path, ".git-account-switcher.bak")?;
    fs::write(&temp_path, content)?;

    if path.exists() {
        fs::copy(path, &backup_path)?;
        fs::remove_file(path)?;
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        if backup_path.exists() && !path.exists() {
            let _ = fs::copy(&backup_path, path);
        }
        let _ = fs::remove_file(&temp_path);
        return Err(error.into());
    }

    Ok(())
}

fn load_profiles_inner() -> AppResult<BTreeMap<String, Profile>> {
    ensure_config_dir()?;
    let path = profiles_path()?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(BTreeMap::new());
    }

    Ok(serde_json::from_str(&raw)?)
}

fn save_profiles_inner(profiles: &BTreeMap<String, Profile>) -> AppResult<()> {
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(profiles)?;
    fs::write(profiles_path()?, json)?;
    Ok(())
}

fn is_line_safe(value: &str) -> bool {
    !value
        .chars()
        .any(|ch| ch.is_control() || ch == '\u{2028}' || ch == '\u{2029}')
}

fn ensure_line_safe(label: &str, value: &str) -> AppResult<()> {
    if !is_line_safe(value) {
        return Err(AppError::Message(format!(
            "{} must not contain line breaks or control characters.",
            label
        )));
    }
    Ok(())
}

fn ensure_trimmed(label: &str, value: &str) -> AppResult<()> {
    if value.trim() != value {
        return Err(AppError::Message(format!(
            "{} must not start or end with whitespace.",
            label
        )));
    }
    Ok(())
}

fn ensure_len(label: &str, value: &str, max: usize) -> AppResult<()> {
    if value.chars().count() > max {
        return Err(AppError::Message(format!(
            "{} is too long; maximum length is {} characters.",
            label, max
        )));
    }
    Ok(())
}

fn validate_simple_token(label: &str, value: &str) -> AppResult<()> {
    ensure_line_safe(label, value)?;
    ensure_trimmed(label, value)?;
    ensure_len(label, value, 96)?;
    if value.is_empty()
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::Message(format!(
            "{} may only contain ASCII letters, numbers, dots, dashes, and underscores.",
            label
        )));
    }
    Ok(())
}

fn validate_host_name(label: &str, value: &str) -> AppResult<()> {
    ensure_line_safe(label, value)?;
    ensure_trimmed(label, value)?;
    ensure_len(label, value, 253)?;
    if value.is_empty()
        || value.starts_with('.')
        || value.ends_with('.')
        || value.contains("..")
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.'))
    {
        return Err(AppError::Message(format!(
            "{} must be a plain host name such as github.com.",
            label
        )));
    }
    Ok(())
}

fn validate_ssh_key_path(value: &str) -> AppResult<()> {
    ensure_line_safe("SSH key path", value)?;
    ensure_trimmed("SSH key path", value)?;
    ensure_len("SSH key path", value, 512)?;
    if value.is_empty() || value.starts_with('-') {
        return Err(AppError::Message(
            "SSH key path must be a non-empty file path.".into(),
        ));
    }
    Ok(())
}

fn validate_optional_nonempty<F>(label: &str, value: Option<&str>, validator: F) -> AppResult<()>
where
    F: Fn(&str) -> AppResult<()>,
{
    if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
        validator(value).map_err(|error| AppError::Message(format!("{}: {}", label, error)))?;
    }
    Ok(())
}

fn validate_profile(profile: &Profile) -> AppResult<()> {
    if profile.name.trim().is_empty() {
        return Err(AppError::Message("Profile name is required.".into()));
    }
    validate_simple_token("Profile name", &profile.name)?;

    if profile.git_user_name.trim().is_empty() {
        return Err(AppError::Message("Git user name is required.".into()));
    }
    ensure_line_safe("Git user name", &profile.git_user_name)?;
    ensure_len("Git user name", profile.git_user_name.trim(), 128)?;

    if profile.git_email.trim().is_empty() {
        return Err(AppError::Message("Git email is required.".into()));
    }
    ensure_line_safe("Git email", &profile.git_email)?;
    ensure_trimmed("Git email", &profile.git_email)?;
    ensure_len("Git email", &profile.git_email, 254)?;
    if !profile.git_email.contains('@')
        || profile.git_email.split('@').any(|part| part.is_empty())
        || profile.git_email.chars().any(char::is_whitespace)
    {
        return Err(AppError::Message("Git email format is invalid.".into()));
    }

    validate_optional_nonempty("GitHub user", Some(&profile.git_hub_user), |value| {
        validate_simple_token("GitHub user", value)
    })?;
    validate_optional_nonempty("Platform host", profile.platform_host.as_deref(), |value| {
        validate_host_name("Platform host", value)
    })?;
    validate_optional_nonempty("SSH host", profile.ssh_host.as_deref(), |value| {
        validate_simple_token("SSH host", value)
    })?;
    validate_optional_nonempty("SSH key path", profile.ssh_key_path.as_deref(), |value| {
        validate_ssh_key_path(value)
    })?;

    if profile.protocol != "ssh" && profile.protocol != "https" {
        return Err(AppError::Message("Protocol must be ssh or https.".into()));
    }
    Ok(())
}

fn unique_profile_key(profiles: &BTreeMap<String, Profile>, preferred: &str) -> String {
    let base = slugify(preferred);
    if !profiles.contains_key(&base) {
        return base;
    }

    let mut index = 2;
    loop {
        let candidate = format!("{}-{}", base, index);
        if !profiles.contains_key(&candidate) {
            return candidate;
        }
        index += 1;
    }
}

fn same_profile_identity(left: &Profile, right: &Profile) -> bool {
    left.git_user_name == right.git_user_name
        && left.git_email == right.git_email
        && left.platform_host == right.platform_host
        && left.ssh_key_path == right.ssh_key_path
}

fn imported_profiles(raw: &str) -> AppResult<Vec<Profile>> {
    let imported: ProfilesImport = serde_json::from_str(raw)?;
    Ok(match imported {
        ProfilesImport::Export(export) => export.profiles,
        ProfilesImport::Map(map) => map.into_values().collect(),
        ProfilesImport::List(list) => list,
    })
}

fn ordered_profiles(profiles: BTreeMap<String, Profile>) -> Vec<Profile> {
    let mut values: Vec<Profile> = profiles.into_values().collect();
    values.sort_by(|left, right| {
        left.sort_order
            .unwrap_or(i32::MAX)
            .cmp(&right.sort_order.unwrap_or(i32::MAX))
            .then_with(|| left.name.cmp(&right.name))
    });
    values
}

fn persist_profile_order(profiles: &mut BTreeMap<String, Profile>, ordered_names: &[String]) {
    for (index, name) in ordered_names.iter().enumerate() {
        if let Some(profile) = profiles.get_mut(name) {
            profile.sort_order = Some(index as i32);
        }
    }
}

fn health_item(label: &str, status: &str, message: String) -> ProfileHealthItem {
    ProfileHealthItem {
        label: label.into(),
        status: status.into(),
        message,
    }
}

fn profile_health_inner(profile: &Profile) -> ProfileHealth {
    let mut items = Vec::new();

    let email = profile.git_email.trim();
    if email.contains('@') && email.split('@').all(|part| !part.trim().is_empty()) {
        items.push(health_item(
            "email",
            "ok",
            "Email format looks valid.".into(),
        ));
    } else {
        items.push(health_item(
            "email",
            "error",
            "Email format is invalid.".into(),
        ));
    }

    if profile.protocol == "ssh" {
        if let Some(key_path) = profile
            .ssh_key_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            match expand_home(key_path) {
                Ok(path) if path.exists() => {
                    items.push(health_item(
                        "sshKey",
                        "ok",
                        format!("SSH key exists: {}", path.display()),
                    ));
                }
                Ok(path) => {
                    items.push(health_item(
                        "sshKey",
                        "error",
                        format!("SSH key was not found: {}", path.display()),
                    ));
                }
                Err(error) => {
                    items.push(health_item("sshKey", "error", error.to_string()));
                }
            }
        } else {
            items.push(health_item(
                "sshKey",
                "warning",
                "SSH profile has no key path.".into(),
            ));
        }

        let platform_host = profile
            .platform_host
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("github.com");
        match fs::read_to_string(ssh_config_path().unwrap_or_default()) {
            Ok(raw) => {
                let lines: Vec<String> = raw.lines().map(|line| line.to_string()).collect();
                if find_host_block(&lines, platform_host).is_some() {
                    items.push(health_item(
                        "sshConfig",
                        "ok",
                        format!("Active Host {} exists.", platform_host),
                    ));
                } else {
                    items.push(health_item(
                        "sshConfig",
                        "warning",
                        format!("Host {} is not active in SSH config yet.", platform_host),
                    ));
                }
            }
            Err(_) => {
                items.push(health_item(
                    "sshConfig",
                    "warning",
                    "SSH config file has not been created yet.".into(),
                ));
            }
        }
    } else {
        items.push(health_item(
            "protocol",
            "ok",
            "HTTPS profile does not need an SSH key.".into(),
        ));
    }

    let level = if items.iter().any(|item| item.status == "error") {
        "error"
    } else if items.iter().any(|item| item.status == "warning") {
        "warning"
    } else {
        "ok"
    };

    ProfileHealth {
        profile_name: profile.name.clone(),
        level: level.into(),
        items,
    }
}

fn load_settings_inner() -> AppResult<AppSettings> {
    ensure_config_dir()?;
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(AppSettings::default());
    }

    let settings: AppSettings = serde_json::from_str(&raw)?;
    validate_settings(&settings)?;
    Ok(settings)
}

fn save_settings_inner(settings: &AppSettings) -> AppResult<()> {
    validate_settings(settings)?;
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(settings)?;
    fs::write(settings_path()?, json)?;
    Ok(())
}

fn validate_settings(settings: &AppSettings) -> AppResult<()> {
    match settings.language.as_str() {
        "zh-CN" | "en" => {}
        other => {
            return Err(AppError::Message(format!(
                "Unsupported language setting: {}",
                other
            )));
        }
    }

    match settings.theme.as_str() {
        "system" | "light" | "dark" => {}
        other => {
            return Err(AppError::Message(format!(
                "Unsupported theme setting: {}",
                other
            )));
        }
    }

    Ok(())
}

fn command_text(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

fn normalize_proxy_url(value: &str, default_scheme: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("direct") {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks5://")
    {
        return Some(trimmed.to_string());
    }
    if lower.contains("://") || !trimmed.contains(':') {
        return None;
    }
    Some(format!("{}://{}", default_scheme, trimmed))
}

fn env_proxy_candidate() -> Option<String> {
    for key in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(value) = env::var(key) {
            if let Some(proxy) = normalize_proxy_url(&value, "http") {
                return Some(proxy);
            }
        }
    }
    None
}

#[cfg(windows)]
fn registry_value(name: &str) -> Option<String> {
    let output = command_text(
        "reg",
        &[
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            name,
        ],
    )?;

    output
        .lines()
        .find(|line| line.contains(name))
        .and_then(|line| line.split_whitespace().last())
        .map(str::to_string)
}

#[cfg(windows)]
fn windows_proxy_candidate() -> Option<String> {
    let enabled = registry_value("ProxyEnable")?;
    let enabled = enabled.eq_ignore_ascii_case("0x1") || enabled == "1";
    if !enabled {
        return None;
    }

    let server = registry_value("ProxyServer")?;
    if server.contains('=') {
        let mut https = None;
        let mut http = None;
        let mut socks = None;
        for item in server.split(';') {
            let Some((kind, value)) = item.split_once('=') else {
                continue;
            };
            match kind.trim().to_ascii_lowercase().as_str() {
                "https" => https = normalize_proxy_url(value, "http"),
                "http" => http = normalize_proxy_url(value, "http"),
                "socks" | "socks5" => socks = normalize_proxy_url(value, "socks5"),
                _ => {}
            }
        }
        return https.or(http).or(socks);
    }

    normalize_proxy_url(&server, "http")
}

#[cfg(not(windows))]
fn windows_proxy_candidate() -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn macos_proxy_candidate() -> Option<String> {
    let output = command_text("scutil", &["--proxy"])?;
    let mut values = BTreeMap::new();
    for line in output.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        values.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
    }

    let enabled = |key: &str| values.get(key).is_some_and(|value| value == "1");
    let host_port = |host_key: &str, port_key: &str, scheme: &str| {
        let host = values.get(host_key)?.trim();
        let port = values.get(port_key)?.trim();
        normalize_proxy_url(&format!("{}:{}", host, port), scheme)
    };

    if enabled("httpsenable") {
        if let Some(proxy) = host_port("httpsproxy", "httpsport", "http") {
            return Some(proxy);
        }
    }
    if enabled("httpenable") {
        if let Some(proxy) = host_port("httpproxy", "httpport", "http") {
            return Some(proxy);
        }
    }
    if enabled("socksenable") {
        if let Some(proxy) = host_port("socksproxy", "socksport", "socks5") {
            return Some(proxy);
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn macos_proxy_candidate() -> Option<String> {
    None
}

fn system_proxy_candidate() -> Option<String> {
    windows_proxy_candidate()
        .or_else(macos_proxy_candidate)
        .or_else(env_proxy_candidate)
}

fn git_output(args: &[&str], cwd: Option<&Path>) -> AppResult<String> {
    let mut command = Command::new("git");
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    if let Some(path) = cwd {
        command.current_dir(path);
    }

    let output = command.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(AppError::Message(if detail.is_empty() {
            format!("git {:?} failed.", args)
        } else {
            detail
        }));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_optional(args: &[&str], cwd: Option<&Path>) -> Option<String> {
    git_output(args, cwd)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn is_inside_repo(path: &Path) -> bool {
    matches!(
        git_output(&["rev-parse", "--is-inside-work-tree"], Some(path)),
        Ok(value) if value == "true"
    )
}

fn repo_status(path: &Path) -> RepoStatus {
    if !is_inside_repo(path) {
        return RepoStatus {
            path: path.display().to_string(),
            is_repo: false,
            user_name: None,
            user_email: None,
            origin: None,
        };
    }

    RepoStatus {
        path: path.display().to_string(),
        is_repo: true,
        user_name: git_optional(&["config", "--local", "user.name"], Some(path)),
        user_email: git_optional(&["config", "--local", "user.email"], Some(path)),
        origin: git_optional(&["remote", "get-url", "origin"], Some(path)),
    }
}

fn profile_or_fail(name: &str) -> AppResult<Profile> {
    let profiles = load_profiles_inner()?;
    let profile = profiles
        .get(name)
        .cloned()
        .ok_or_else(|| AppError::Message(format!("Profile '{}' was not found.", name)))?;
    validate_profile(&profile)?;
    Ok(profile)
}

fn expand_home(path: &str) -> AppResult<PathBuf> {
    if path == "~" {
        return home_dir();
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return Ok(home_dir()?.join(rest));
    }
    Ok(PathBuf::from(path))
}

fn unquote_ssh_value(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

fn ssh_config_value(value: &str) -> String {
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || matches!(ch, '"' | '\''))
    {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

fn normalize_key_path(path: &str) -> AppResult<String> {
    let expanded = expand_home(unquote_ssh_value(path))?;
    let normalized = expanded
        .display()
        .to_string()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    #[cfg(windows)]
    {
        Ok(normalized.to_lowercase())
    }
    #[cfg(not(windows))]
    {
        Ok(normalized)
    }
}

fn slugify(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            output.push(ch);
            last_dash = false;
        } else if !last_dash {
            output.push('-');
            last_dash = true;
        }
    }
    let trimmed = output.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "account".into()
    } else {
        trimmed
    }
}

fn platform_prefix(platform_host: &str) -> String {
    platform_host
        .split('.')
        .next()
        .map(slugify)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "host".into())
}

fn derived_host_alias(profile: &Profile, platform_host: &str) -> String {
    profile
        .ssh_host
        .as_deref()
        .filter(|value| !value.trim().is_empty() && value.trim() != platform_host)
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|| {
            format!(
                "{}-{}",
                platform_prefix(platform_host),
                slugify(&profile.git_user_name)
            )
        })
}

fn host_line_hosts(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    let (keyword, rest) = trimmed.split_once(char::is_whitespace)?;
    if !keyword.eq_ignore_ascii_case("Host") {
        return None;
    }
    Some(
        rest.split_whitespace()
            .map(|value| value.to_string())
            .collect(),
    )
}

fn find_host_block(lines: &[String], host: &str) -> Option<(usize, usize)> {
    let mut index = 0;
    while index < lines.len() {
        if let Some(hosts) = host_line_hosts(&lines[index]) {
            let end = ((index + 1)..lines.len())
                .find(|next| host_line_hosts(&lines[*next]).is_some())
                .unwrap_or(lines.len());
            if hosts.iter().any(|candidate| candidate == host) {
                return Some((index, end));
            }
            index = end;
        } else {
            index += 1;
        }
    }
    None
}

fn find_block_by_key(
    lines: &[String],
    platform_host: &str,
    key_path: &str,
) -> AppResult<Option<(usize, usize)>> {
    let target_key = normalize_key_path(key_path)?;
    let mut index = 0;
    while index < lines.len() {
        if host_line_hosts(&lines[index]).is_some() {
            let end = ((index + 1)..lines.len())
                .find(|next| host_line_hosts(&lines[*next]).is_some())
                .unwrap_or(lines.len());
            let block = &lines[index..end];
            let hostname = get_directive(block, "HostName");
            let identity_file = get_directive(block, "IdentityFile");
            let hostname_matches = hostname
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(platform_host))
                .unwrap_or(false);
            let key_matches = if let Some(identity_file) = identity_file {
                normalize_key_path(&identity_file)? == target_key
            } else {
                false
            };
            if hostname_matches && key_matches {
                return Ok(Some((index, end)));
            }
            index = end;
        } else {
            index += 1;
        }
    }
    Ok(None)
}

fn get_directive(block: &[String], key: &str) -> Option<String> {
    for line in block {
        let trimmed = line.trim();
        let (directive, value) = trimmed.split_once(char::is_whitespace)?;
        if directive.eq_ignore_ascii_case(key) {
            return Some(value.trim().to_string());
        }
    }
    None
}

fn set_host_line(lines: &mut [String], block_start: usize, host: &str) {
    lines[block_start] = format!("Host {}", host);
}

fn set_directive(
    lines: &mut Vec<String>,
    start: usize,
    end: usize,
    key: &str,
    value: &str,
) -> usize {
    let existing_index = ((start + 1)..end).find(|&index| {
        let trimmed = lines[index].trim();
        let directive = trimmed
            .split_once(char::is_whitespace)
            .map(|(directive, _)| directive)
            .unwrap_or(trimmed);
        directive.eq_ignore_ascii_case(key)
    });

    if let Some(index) = existing_index {
        lines[index] = format!("    {} {}", key, value);
        return end;
    }

    lines.insert(end, format!("    {} {}", key, value));
    end + 1
}

fn unique_alias(lines: &[String], preferred: &str, platform_host: &str) -> String {
    if preferred != platform_host && find_host_block(lines, preferred).is_none() {
        return preferred.to_string();
    }
    let mut index = 2;
    loop {
        let candidate = format!("{}-{}", preferred, index);
        if candidate != platform_host && find_host_block(lines, &candidate).is_none() {
            return candidate;
        }
        index += 1;
    }
}

fn profile_matches_key(profile: &Profile, platform_host: &str, key_path: &str) -> AppResult<bool> {
    let profile_platform = profile
        .platform_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("github.com");
    let Some(profile_key) = profile.ssh_key_path.as_deref() else {
        return Ok(false);
    };
    Ok(profile_platform.eq_ignore_ascii_case(platform_host)
        && normalize_key_path(profile_key)? == normalize_key_path(key_path)?)
}

fn switch_ssh_identity_inner(
    profile: &Profile,
    all_profiles: &[Profile],
    what_if: bool,
) -> AppResult<ActionReport> {
    let platform_host = profile
        .platform_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("github.com")
        .trim()
        .to_string();
    let Some(key_path) = profile
        .ssh_key_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(ActionReport {
            actions: vec!["No SSH key path configured; skipped SSH config switch.".into()],
            changed: false,
        });
    };

    let ssh_config = ssh_config_path()?;
    let ssh_dir = ssh_config
        .parent()
        .ok_or_else(|| AppError::Message("Could not resolve SSH directory.".into()))?;
    let normalized_target_key = normalize_key_path(key_path)?;
    let mut actions = Vec::new();

    if what_if {
        actions.push(format!(
            "Would switch Host {} to {}",
            platform_host, key_path
        ));
        return Ok(ActionReport {
            actions,
            changed: false,
        });
    }

    fs::create_dir_all(ssh_dir)?;
    let existing = fs::read_to_string(&ssh_config).unwrap_or_default();
    let mut lines: Vec<String> = existing.lines().map(|line| line.to_string()).collect();

    if let Some((active_start, active_end)) = find_host_block(&lines, &platform_host) {
        let active_key = get_directive(&lines[active_start..active_end], "IdentityFile");
        let active_key_matches = if let Some(active_key) = active_key.as_deref() {
            normalize_key_path(active_key)? == normalized_target_key
        } else {
            false
        };

        if !active_key_matches {
            let Some(active_key) = active_key else {
                return Err(AppError::Message(format!(
                    "Host {} exists but has no IdentityFile. Refusing to overwrite it.",
                    platform_host
                )));
            };
            let owner = all_profiles
                .iter()
                .find(|candidate| candidate.name != profile.name && profile_matches_key(candidate, &platform_host, &active_key).unwrap_or(false))
                .ok_or_else(|| {
                    AppError::Message(format!(
                        "Host {} is occupied by an unknown key: {}. Add that account first, then switch again.",
                        platform_host, active_key
                    ))
                })?;
            let alias = unique_alias(
                &lines,
                &derived_host_alias(owner, &platform_host),
                &platform_host,
            );
            set_host_line(&mut lines, active_start, &alias);
            let next_end = set_directive(
                &mut lines,
                active_start,
                active_end,
                "HostName",
                &platform_host,
            );
            actions.push(format!(
                "Renamed active Host {} to {}",
                platform_host, alias
            ));
            if next_end != active_end {
                // The insertion happened inside the old active block, so cached ranges are stale. We only
                // search fresh ranges after this point.
            }
        }
    }

    if let Some((target_start, target_end)) = find_block_by_key(&lines, &platform_host, key_path)? {
        set_host_line(&mut lines, target_start, &platform_host);
        let mut end = target_end;
        end = set_directive(&mut lines, target_start, end, "HostName", &platform_host);
        end = set_directive(&mut lines, target_start, end, "User", "git");
        let _ = set_directive(
            &mut lines,
            target_start,
            end,
            "IdentityFile",
            &ssh_config_value(key_path),
        );
        actions.push(format!("Promoted {} to Host {}", key_path, platform_host));
    } else {
        if !lines.is_empty()
            && !lines
                .last()
                .map(|line| line.trim().is_empty())
                .unwrap_or(false)
        {
            lines.push(String::new());
        }
        lines.extend([
            format!("Host {}", platform_host),
            format!("    HostName {}", platform_host),
            "    User git".to_string(),
            format!("    IdentityFile {}", ssh_config_value(key_path)),
        ]);
        actions.push(format!("Created Host {} for {}", platform_host, key_path));
    }

    write_text_with_backup(&ssh_config, &(lines.join("\n") + "\n"))?;
    Ok(ActionReport {
        actions,
        changed: true,
    })
}

fn ensure_ssh_host_inner(profile: &Profile, what_if: bool) -> AppResult<ActionReport> {
    if profile.protocol != "ssh" {
        return Ok(ActionReport {
            actions: vec!["Profile uses HTTPS; no SSH alias needed.".into()],
            changed: false,
        });
    }

    let ssh_host = profile
        .ssh_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Message("SSH profile needs an sshHost.".into()))?;
    let ssh_key_path = profile
        .ssh_key_path
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Message("SSH profile needs an sshKeyPath.".into()))?;

    let ssh_config = ssh_config_path()?;
    let ssh_dir = ssh_config
        .parent()
        .ok_or_else(|| AppError::Message("Could not resolve SSH directory.".into()))?;
    let key_path = expand_home(ssh_key_path)?;
    let platform_host = profile
        .platform_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("github.com");
    let block_start = format!("# BEGIN git-account-switcher {}", profile.name);
    let block_end = format!("# END git-account-switcher {}", profile.name);
    let block = [
        block_start.clone(),
        format!("Host {}", ssh_host),
        format!("    HostName {}", platform_host),
        "    User git".into(),
        format!(
            "    IdentityFile {}",
            ssh_config_value(&key_path.display().to_string())
        ),
        "    IdentitiesOnly yes".into(),
        block_end.clone(),
    ]
    .join("\n");

    let actions = vec![
        format!("Ensure SSH directory exists: {}", ssh_dir.display()),
        format!(
            "Write SSH host alias '{}' to {}",
            ssh_host,
            ssh_config.display()
        ),
    ];

    if what_if {
        return Ok(ActionReport {
            actions,
            changed: false,
        });
    }

    fs::create_dir_all(ssh_dir)?;
    let existing = fs::read_to_string(&ssh_config).unwrap_or_default();
    let mut output_lines = Vec::new();
    let mut skipping = false;

    for line in existing.lines() {
        if line.trim() == block_start {
            skipping = true;
            continue;
        }
        if skipping && line.trim() == block_end {
            skipping = false;
            continue;
        }
        if !skipping {
            output_lines.push(line.to_string());
        }
    }

    let mut new_content = output_lines.join("\n");
    if !new_content.trim().is_empty() {
        new_content = format!("{}\n\n", new_content.trim_end());
    }
    new_content.push_str(&block);
    new_content.push('\n');
    write_text_with_backup(&ssh_config, &new_content)?;

    Ok(ActionReport {
        actions,
        changed: true,
    })
}

fn ssh_alias_points_to_platform(alias: &str, platform_host: &str) -> AppResult<bool> {
    let Ok(raw) = fs::read_to_string(ssh_config_path()?) else {
        return Ok(false);
    };
    let lines: Vec<String> = raw.lines().map(|line| line.to_string()).collect();
    let Some((start, end)) = find_host_block(&lines, alias) else {
        return Ok(false);
    };
    Ok(get_directive(&lines[start..end], "HostName")
        .as_deref()
        .is_some_and(|host| host.eq_ignore_ascii_case(platform_host)))
}

fn remote_host_matches_platform(host: &str, platform_host: &str) -> AppResult<bool> {
    if host.eq_ignore_ascii_case(platform_host) {
        return Ok(true);
    }
    ssh_alias_points_to_platform(host, platform_host)
}

fn validate_owner_repo(owner_repo: &str, remote_url: &str) -> AppResult<String> {
    let trimmed = owner_repo.trim_end_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| part.is_empty())
        || !parts[0]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        || !parts[1]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(AppError::Message(format!(
            "Remote does not look like a GitHub owner/repo URL: {}",
            remote_url
        )));
    }
    Ok(trimmed.to_string())
}

fn owner_repo_from_remote(remote_url: &str, platform_host: &str) -> AppResult<String> {
    validate_host_name("Platform host", platform_host)?;
    let (host, owner_repo) = if let Some(rest) = remote_url.strip_prefix("git@") {
        let (host, repo) = rest
            .split_once(':')
            .ok_or_else(|| AppError::Message(format!("Unsupported SSH remote: {}", remote_url)))?;
        (host, repo)
    } else if let Some(rest) = remote_url.strip_prefix("ssh://git@") {
        let (host, repo) = rest
            .split_once('/')
            .ok_or_else(|| AppError::Message(format!("Unsupported SSH remote: {}", remote_url)))?;
        (host, repo)
    } else if let Some(rest) = remote_url.strip_prefix("https://") {
        let (host, repo) = rest.split_once('/').ok_or_else(|| {
            AppError::Message(format!("Unsupported HTTPS remote: {}", remote_url))
        })?;
        (host, repo)
    } else {
        return Err(AppError::Message(format!(
            "Unsupported remote format: {}",
            remote_url
        )));
    };

    if !remote_host_matches_platform(host, platform_host)? {
        return Err(AppError::Message(format!(
            "Remote host '{}' does not match platform host '{}'.",
            host, platform_host
        )));
    }

    validate_owner_repo(owner_repo, remote_url)
}

fn remote_for_profile(remote_url: &str, profile: &Profile) -> AppResult<String> {
    validate_profile(profile)?;
    let platform_host = profile
        .platform_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("github.com");
    let owner_repo = owner_repo_from_remote(remote_url, platform_host)?;
    if profile.protocol == "https" {
        return Ok(format!("https://{}/{}.git", platform_host, owner_repo));
    }

    let ssh_host = profile
        .ssh_host
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::Message("SSH profile needs an sshHost.".into()))?;
    Ok(format!("git@{}:{}.git", ssh_host, owner_repo))
}

#[tauri::command]
fn get_status(repo_path: Option<String>) -> Result<AppStatus, String> {
    let git_version = git_optional(&["--version"], None);
    let repo = repo_path
        .filter(|path| !path.trim().is_empty())
        .map(|path| repo_status(Path::new(&path)));

    Ok(AppStatus {
        app_version: env!("CARGO_PKG_VERSION").into(),
        git_available: git_version.is_some(),
        git_version,
        global_user_name: git_optional(&["config", "--global", "user.name"], None),
        global_user_email: git_optional(&["config", "--global", "user.email"], None),
        credential_helper: git_optional(&["config", "--global", "credential.helper"], None),
        profiles_path: profiles_path().map_err(String::from)?.display().to_string(),
        settings_path: settings_path().map_err(String::from)?.display().to_string(),
        ssh_config_path: ssh_config_path()
            .map_err(String::from)?
            .display()
            .to_string(),
        repo,
    })
}

#[tauri::command]
fn get_settings() -> Result<AppSettings, String> {
    load_settings_inner().map_err(String::from)
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<ActionReport, String> {
    save_settings_inner(&settings).map_err(String::from)?;
    Ok(ActionReport {
        actions: vec!["Saved app settings.".into()],
        changed: true,
    })
}

#[tauri::command]
fn detect_network_proxy() -> Option<String> {
    system_proxy_candidate()
}

#[tauri::command]
fn list_profiles() -> Result<Vec<Profile>, String> {
    let profiles = load_profiles_inner().map_err(String::from)?;
    Ok(ordered_profiles(profiles))
}

#[tauri::command]
fn save_profile(profile: Profile) -> Result<ActionReport, String> {
    validate_profile(&profile).map_err(String::from)?;

    let mut profiles = load_profiles_inner().map_err(String::from)?;
    let name = profile.name.clone();
    let mut next_profile = profile;
    if next_profile.sort_order.is_none() {
        let next_order = profiles
            .values()
            .filter_map(|profile| profile.sort_order)
            .max()
            .map(|value| value + 1)
            .unwrap_or(profiles.len() as i32);
        next_profile.sort_order = Some(next_order);
    }
    profiles.insert(name.clone(), next_profile);
    save_profiles_inner(&profiles).map_err(String::from)?;

    Ok(ActionReport {
        actions: vec![format!("Saved profile '{}'.", name)],
        changed: true,
    })
}

#[tauri::command]
fn list_profile_health() -> Result<Vec<ProfileHealth>, String> {
    let profiles = ordered_profiles(load_profiles_inner().map_err(String::from)?);
    Ok(profiles.iter().map(profile_health_inner).collect())
}

#[tauri::command]
fn toggle_profile_pin(profile_name: String) -> Result<ActionReport, String> {
    let mut profiles = load_profiles_inner().map_err(String::from)?;
    let top_order = profiles
        .values()
        .filter_map(|profile| profile.sort_order)
        .min()
        .unwrap_or(0)
        - 1;
    let pinned = {
        let profile = profiles
            .get_mut(&profile_name)
            .ok_or_else(|| format!("Profile '{}' was not found.", profile_name))?;
        let pinned = !profile.pinned.unwrap_or(false);
        profile.pinned = Some(pinned);
        if pinned {
            profile.sort_order = Some(top_order);
        }
        pinned
    };
    save_profiles_inner(&profiles).map_err(String::from)?;
    Ok(ActionReport {
        actions: vec![format!(
            "{} profile '{}'.",
            if pinned { "Pinned" } else { "Unpinned" },
            profile_name
        )],
        changed: true,
    })
}

#[tauri::command]
fn move_profile(profile_name: String, direction: String) -> Result<ActionReport, String> {
    let mut profiles = load_profiles_inner().map_err(String::from)?;
    if !profiles.contains_key(&profile_name) {
        return Err(format!("Profile '{}' was not found.", profile_name));
    }

    let current_pinned = profiles
        .get(&profile_name)
        .and_then(|profile| profile.pinned)
        .unwrap_or(false);
    let ordered: Vec<Profile> = ordered_profiles(profiles.clone())
        .into_iter()
        .filter(|profile| profile.pinned.unwrap_or(false) == current_pinned)
        .collect();
    let Some(index) = ordered
        .iter()
        .position(|profile| profile.name == profile_name)
    else {
        return Err(format!("Profile '{}' was not found.", profile_name));
    };

    let target_index = match direction.as_str() {
        "up" if index > 0 => index - 1,
        "down" if index + 1 < ordered.len() => index + 1,
        "up" | "down" => index,
        other => return Err(format!("Unsupported move direction '{}'.", other)),
    };

    if target_index == index {
        return Ok(ActionReport {
            actions: vec![format!(
                "Profile '{}' is already at the edge.",
                profile_name
            )],
            changed: false,
        });
    }

    let mut names: Vec<String> = ordered.into_iter().map(|profile| profile.name).collect();
    names.swap(index, target_index);
    persist_profile_order(&mut profiles, &names);
    save_profiles_inner(&profiles).map_err(String::from)?;

    Ok(ActionReport {
        actions: vec![format!("Moved profile '{}' {}.", profile_name, direction)],
        changed: true,
    })
}

#[tauri::command]
fn reorder_profiles(profile_names: Vec<String>) -> Result<ActionReport, String> {
    let mut profiles = load_profiles_inner().map_err(String::from)?;
    let mut ordered_names = Vec::new();
    for name in profile_names {
        if profiles.contains_key(&name) && !ordered_names.contains(&name) {
            ordered_names.push(name);
        }
    }

    for profile in ordered_profiles(profiles.clone()) {
        if !ordered_names.contains(&profile.name) {
            ordered_names.push(profile.name);
        }
    }

    persist_profile_order(&mut profiles, &ordered_names);
    save_profiles_inner(&profiles).map_err(String::from)?;

    Ok(ActionReport {
        actions: vec!["Reordered profiles.".into()],
        changed: true,
    })
}

#[tauri::command]
fn export_profiles(path: String) -> Result<ActionReport, String> {
    let target_path = PathBuf::from(path.trim());
    if target_path.as_os_str().is_empty() {
        return Err("Export path is required.".into());
    }

    if let Some(parent) = target_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let profiles = load_profiles_inner().map_err(String::from)?;
    let exported_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("{}s", duration.as_secs()))
        .unwrap_or_else(|_| "0s".into());
    let export = ProfilesExport {
        format_version: 1,
        app: "git-account-switcher".into(),
        exported_at,
        profiles: profiles.into_values().collect(),
    };
    let json = serde_json::to_string_pretty(&export).map_err(|error| error.to_string())?;
    fs::write(&target_path, format!("{}\n", json)).map_err(|error| error.to_string())?;

    Ok(ActionReport {
        actions: vec![format!("Exported profiles to {}.", target_path.display())],
        changed: false,
    })
}

#[tauri::command]
fn import_profiles(path: String) -> Result<ImportReport, String> {
    let source_path = PathBuf::from(path.trim());
    if source_path.as_os_str().is_empty() {
        return Err("Import path is required.".into());
    }

    let raw = fs::read_to_string(&source_path).map_err(|error| error.to_string())?;
    let incoming = imported_profiles(&raw).map_err(String::from)?;
    let mut profiles = load_profiles_inner().map_err(String::from)?;
    let mut imported = 0;
    let mut skipped = 0;

    for mut profile in incoming {
        if let Err(error) = validate_profile(&profile) {
            skipped += 1;
            eprintln!("Skipped invalid imported profile: {}", error);
            continue;
        }

        if profiles
            .values()
            .any(|existing| same_profile_identity(existing, &profile))
        {
            skipped += 1;
            continue;
        }

        let key = if profiles.contains_key(&profile.name) {
            unique_profile_key(&profiles, &profile.name)
        } else {
            profile.name.clone()
        };
        profile.name = key.clone();
        profiles.insert(key, profile);
        imported += 1;
    }

    if imported > 0 {
        save_profiles_inner(&profiles).map_err(String::from)?;
    }

    Ok(ImportReport {
        actions: vec![format!(
            "Imported {} profile(s), skipped {} from {}.",
            imported,
            skipped,
            source_path.display()
        )],
        changed: imported > 0,
        imported,
        skipped,
    })
}

#[tauri::command]
fn remove_profile(profile_name: String) -> Result<ActionReport, String> {
    let mut profiles = load_profiles_inner().map_err(String::from)?;
    if profiles.remove(&profile_name).is_none() {
        return Err(format!("Profile '{}' was not found.", profile_name));
    }
    save_profiles_inner(&profiles).map_err(String::from)?;
    Ok(ActionReport {
        actions: vec![format!("Removed profile '{}'.", profile_name)],
        changed: true,
    })
}

#[tauri::command]
fn ensure_ssh_host(profile_name: String, what_if: bool) -> Result<ActionReport, String> {
    let profile = profile_or_fail(&profile_name).map_err(String::from)?;
    ensure_ssh_host_inner(&profile, what_if).map_err(String::from)
}

#[tauri::command]
fn switch_global_identity(profile_name: String, what_if: bool) -> Result<ActionReport, String> {
    let profiles = load_profiles_inner().map_err(String::from)?;
    let profile = profiles
        .get(&profile_name)
        .cloned()
        .ok_or_else(|| format!("Profile '{}' was not found.", profile_name))?;
    validate_profile(&profile).map_err(String::from)?;
    let all_profiles: Vec<Profile> = profiles.into_values().collect();
    let mut actions = vec![
        format!(
            "git config --global user.name \"{}\"",
            profile.git_user_name
        ),
        format!("git config --global user.email \"{}\"", profile.git_email),
    ];
    let mut changed = false;

    let ssh_report =
        switch_ssh_identity_inner(&profile, &all_profiles, what_if).map_err(String::from)?;
    actions.extend(ssh_report.actions);
    changed |= ssh_report.changed;

    if !what_if {
        git_output(
            &["config", "--global", "user.name", &profile.git_user_name],
            None,
        )
        .map_err(String::from)?;
        git_output(
            &["config", "--global", "user.email", &profile.git_email],
            None,
        )
        .map_err(String::from)?;
        changed = true;
    }

    Ok(ActionReport { actions, changed })
}

#[tauri::command]
fn activate_profile(
    profile_name: String,
    scope: String,
    repo_path: Option<String>,
    rewrite_remote: bool,
    what_if: bool,
) -> Result<ActionReport, String> {
    let profile = profile_or_fail(&profile_name).map_err(String::from)?;
    let mut actions = Vec::new();
    let mut changed = false;

    match scope.as_str() {
        "global" => {
            if profile.protocol == "ssh" {
                let report = ensure_ssh_host_inner(&profile, what_if).map_err(String::from)?;
                actions.extend(report.actions);
                changed |= report.changed;
            }

            actions.push(format!(
                "Set global Git identity to '{} <{}>'.",
                profile.git_user_name, profile.git_email
            ));
            if !what_if {
                git_output(
                    &["config", "--global", "user.name", &profile.git_user_name],
                    None,
                )
                .map_err(String::from)?;
                git_output(
                    &["config", "--global", "user.email", &profile.git_email],
                    None,
                )
                .map_err(String::from)?;
                changed = true;
            }
        }
        "repo" => {
            let repo = repo_path
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "Repository path is required for repo scope.".to_string())?;
            let repo_path = Path::new(repo);
            if !is_inside_repo(repo_path) {
                return Err(format!("Not a Git repository: {}", repo));
            }

            let new_remote = if rewrite_remote {
                let old_remote = git_output(&["remote", "get-url", "origin"], Some(repo_path))
                    .map_err(String::from)?;
                Some(remote_for_profile(&old_remote, &profile).map_err(String::from)?)
            } else {
                None
            };

            if profile.protocol == "ssh" {
                let report = ensure_ssh_host_inner(&profile, what_if).map_err(String::from)?;
                actions.extend(report.actions);
                changed |= report.changed;
            }

            actions.push(format!(
                "Set repository Git identity in {}.",
                repo_path.display()
            ));
            if !what_if {
                git_output(
                    &["config", "user.name", &profile.git_user_name],
                    Some(repo_path),
                )
                .map_err(String::from)?;
                git_output(
                    &["config", "user.email", &profile.git_email],
                    Some(repo_path),
                )
                .map_err(String::from)?;
                changed = true;
            }

            if let Some(new_remote) = new_remote {
                actions.push(format!("Rewrite origin remote to {}.", new_remote));
                if !what_if {
                    git_output(
                        &["remote", "set-url", "origin", &new_remote],
                        Some(repo_path),
                    )
                    .map_err(String::from)?;
                    changed = true;
                }
            }
        }
        other => return Err(format!("Unsupported scope '{}'.", other)),
    }

    Ok(ActionReport { actions, changed })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_profile() -> Profile {
        Profile {
            name: "chushi-chef".into(),
            git_user_name: "chushi-chef".into(),
            git_email: "12345678+chushi@users.noreply.github.com".into(),
            git_hub_user: "chushi-chef".into(),
            protocol: "ssh".into(),
            platform_host: Some("github.com".into()),
            ssh_host: Some("github-chushi".into()),
            ssh_key_path: Some("C:\\Users\\me\\.ssh\\id_ed25519".into()),
            pinned: Some(false),
            sort_order: Some(0),
        }
    }

    #[test]
    fn validate_profile_rejects_ssh_config_injection() {
        let mut profile = valid_profile();
        profile.ssh_key_path = Some("~/.ssh/id_ed25519\nProxyCommand calc".into());
        assert!(validate_profile(&profile).is_err());

        let mut profile = valid_profile();
        profile.ssh_host = Some("github-main\nHost *".into());
        assert!(validate_profile(&profile).is_err());

        let mut profile = valid_profile();
        profile.platform_host = Some("github.com ProxyCommand=calc".into());
        assert!(validate_profile(&profile).is_err());
    }

    #[test]
    fn validate_profile_accepts_safe_key_paths_with_spaces() {
        let mut profile = valid_profile();
        profile.ssh_key_path = Some("C:\\Users\\Me Dev\\.ssh\\id_ed25519".into());
        assert!(validate_profile(&profile).is_ok());
        assert_eq!(
            ssh_config_value(profile.ssh_key_path.as_deref().unwrap()),
            "\"C:\\Users\\Me Dev\\.ssh\\id_ed25519\""
        );
    }

    #[test]
    fn remote_rewrite_rejects_non_platform_hosts() {
        let mut profile = valid_profile();
        profile.protocol = "https".into();
        let error = remote_for_profile("https://gitlab.com/owner/repo.git", &profile)
            .expect_err("non-platform hosts must be rejected");
        assert!(error.to_string().contains("does not match platform host"));
    }

    #[test]
    fn remote_rewrite_accepts_github_owner_repo() {
        let mut profile = valid_profile();
        profile.protocol = "https".into();
        assert_eq!(
            remote_for_profile("https://github.com/owner/repo.git", &profile).unwrap(),
            "https://github.com/owner/repo.git"
        );
    }

    #[test]
    fn write_text_with_backup_preserves_previous_content() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("git-account-switcher-test-{}", unique));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config");
        fs::write(&path, "original\n").unwrap();

        write_text_with_backup(&path, "next\n").unwrap();

        let backup = sibling_path_with_suffix(&path, ".git-account-switcher.bak").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "next\n");
        assert_eq!(fs::read_to_string(&backup).unwrap(), "original\n");

        fs::remove_dir_all(&dir).unwrap();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            save_settings,
            detect_network_proxy,
            list_profiles,
            save_profile,
            list_profile_health,
            toggle_profile_pin,
            move_profile,
            reorder_profiles,
            export_profiles,
            import_profiles,
            remove_profile,
            ensure_ssh_host,
            switch_global_identity,
            activate_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Git Account Switcher");
}
