use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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
    profiles
        .get(name)
        .cloned()
        .ok_or_else(|| AppError::Message(format!("Profile '{}' was not found.", name)))
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

fn normalize_key_path(path: &str) -> AppResult<String> {
    let expanded = expand_home(path)?;
    Ok(expanded
        .display()
        .to_string()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase())
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
    for index in (start + 1)..end {
        let trimmed = lines[index].trim();
        let directive = trimmed
            .split_once(char::is_whitespace)
            .map(|(directive, _)| directive)
            .unwrap_or(trimmed);
        if directive.eq_ignore_ascii_case(key) {
            lines[index] = format!("    {} {}", key, value);
            return end;
        }
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
        let _ = set_directive(&mut lines, target_start, end, "IdentityFile", key_path);
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
            format!("    IdentityFile {}", key_path),
        ]);
        actions.push(format!("Created Host {} for {}", platform_host, key_path));
    }

    fs::write(ssh_config, lines.join("\n") + "\n")?;
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
    let block_start = format!("# BEGIN git-account-switcher {}", profile.name);
    let block_end = format!("# END git-account-switcher {}", profile.name);
    let block = vec![
        block_start.clone(),
        format!("Host {}", ssh_host),
        "    HostName github.com".into(),
        "    User git".into(),
        format!("    IdentityFile {}", key_path.display()),
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
    fs::write(ssh_config, new_content)?;

    Ok(ActionReport {
        actions,
        changed: true,
    })
}

fn owner_repo_from_remote(remote_url: &str) -> AppResult<String> {
    let owner_repo = if let Some(rest) = remote_url.strip_prefix("git@") {
        rest.split_once(':')
            .map(|(_, repo)| repo.to_string())
            .ok_or_else(|| AppError::Message(format!("Unsupported SSH remote: {}", remote_url)))?
    } else if let Some(rest) = remote_url.strip_prefix("ssh://git@") {
        rest.split_once('/')
            .map(|(_, repo)| repo.to_string())
            .ok_or_else(|| AppError::Message(format!("Unsupported SSH remote: {}", remote_url)))?
    } else if let Some(rest) = remote_url.strip_prefix("https://github.com/") {
        rest.to_string()
    } else {
        return Err(AppError::Message(format!(
            "Unsupported remote format: {}",
            remote_url
        )));
    };

    let trimmed = owner_repo.trim_end_matches('/').trim_end_matches(".git");
    if trimmed.split('/').count() < 2 {
        return Err(AppError::Message(format!(
            "Remote does not look like owner/repo: {}",
            remote_url
        )));
    }
    Ok(trimmed.to_string())
}

fn remote_for_profile(remote_url: &str, profile: &Profile) -> AppResult<String> {
    let owner_repo = owner_repo_from_remote(remote_url)?;
    if profile.protocol == "https" {
        return Ok(format!("https://github.com/{}.git", owner_repo));
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
fn list_profiles() -> Result<Vec<Profile>, String> {
    let profiles = load_profiles_inner().map_err(String::from)?;
    Ok(profiles.into_values().collect())
}

#[tauri::command]
fn save_profile(profile: Profile) -> Result<ActionReport, String> {
    if profile.name.trim().is_empty() {
        return Err("Profile name is required.".into());
    }
    if profile.git_user_name.trim().is_empty() {
        return Err("Git user name is required.".into());
    }
    if profile.git_email.trim().is_empty() {
        return Err("Git email is required.".into());
    }
    if profile.protocol != "ssh" && profile.protocol != "https" {
        return Err("Protocol must be ssh or https.".into());
    }

    let mut profiles = load_profiles_inner().map_err(String::from)?;
    let name = profile.name.clone();
    profiles.insert(name.clone(), profile);
    save_profiles_inner(&profiles).map_err(String::from)?;

    Ok(ActionReport {
        actions: vec![format!("Saved profile '{}'.", name)],
        changed: true,
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

    if profile.protocol == "ssh" {
        let report = ensure_ssh_host_inner(&profile, what_if).map_err(String::from)?;
        actions.extend(report.actions);
        changed |= report.changed;
    }

    match scope.as_str() {
        "global" => {
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

            if rewrite_remote {
                let old_remote = git_output(&["remote", "get-url", "origin"], Some(repo_path))
                    .map_err(String::from)?;
                let new_remote = remote_for_profile(&old_remote, &profile).map_err(String::from)?;
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_status,
            get_settings,
            save_settings,
            list_profiles,
            save_profile,
            remove_profile,
            ensure_ssh_host,
            switch_global_identity,
            activate_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Git Account Switcher");
}
