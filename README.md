# Git Account Switcher

一个给 Windows / PowerShell 用的本地 GitHub 账号切换器。

现在同时包含：

- `GitAccountSwitcher.ps1`：命令行版本，保留较完整的 Git/SSH 辅助能力。
- Tauri 桌面版：保存账号信息，并在点击切换时执行：

```powershell
git config --global user.name "xxx"
git config --global user.email "yyy"
```

如果账号记录里填写了平台域名和 SSH key 路径，桌面版还会同步维护 `~/.ssh/config`，把当前启用账号的 key 提升到真实平台入口，例如 `Host github.com`。

桌面版启动时会自动读取当前本机已有的全局 Git 身份。如果 profiles 里还没有同样的 `user.name/user.email`，会自动保存为一个账号，避免第一次打开时列表为空。

桌面版每 10 秒重新读取一次全局 Git 身份，并用账号列表里的选中态显示当前真实生效的账号。右上角 `+` 会弹出窗口，填写 `user.name`、`user.email`、平台域名和 SSH key 路径。账号行右侧提供启用、修改、删除按钮；删除会先弹窗确认。

底部状态栏会显示最近一次成功读取全局配置距现在多久，例如 `最近拉取配置：12秒前`。

桌面版解决的是本地侧的两件事：

- Git 提交身份：`user.name` 和 `user.email`
- SSH 认证入口：`~/.ssh/config` 里的真实平台 Host，例如 `github.com`

它不做、也不应该做绕过 GitHub 限制或风控的事情。如果旧账号被标记，建议同时走 GitHub 申诉；这个工具只帮你把本地开发环境切到你有权使用的新账号。

## 关于旧账号凭据

默认情况下，这个工具不会删除、覆盖或打印你旧 GitHub 账号的 HTTPS 凭据。

只有你同时传入下面两个开关时，才会尝试清理本机 `github.com` 的 HTTPS 凭据：

```powershell
-ClearGithubHttpsCredentials -IUnderstandThisDeletesGithubHttpsCredentials
```

如果旧号已经被 flagged，而你暂时只能依赖旧凭据 push/pull，请不要使用这两个开关。

桌面版没有提供清理旧凭据按钮，也不会改 HTTPS 凭据或仓库级配置。

## 桌面版 SSH 切换逻辑

假设 `~/.ssh/config` 里有：

```text
Host github-user1
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa

Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519
```

如果你启用的账号绑定了 `github.com` 和 `~/.ssh/id_rsa`，程序会先检查当前谁占用了 `Host github.com`。

如果占用者的 key 已经存在于本地账号列表，程序会把它改成一个别名，例如：

```text
Host github-chef
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519
```

然后把目标账号提升为：

```text
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa
```

如果 `Host github.com` 当前被一个未知 key 占用，程序会拒绝覆盖。你需要先把那个账号也添加进本地列表，避免误伤已有 SSH 配置。

## Git 和 GitHub 的区别

Git 是本地版本控制工具。它记录提交里的名字和邮箱。

GitHub 是远端平台。它决定你能不能 push/pull 某个仓库，认证方式通常是 HTTPS token 或 SSH key。

所以“切账号”实际有两层：

- 提交看起来是谁写的：改 Git config。
- 推送时 GitHub 认为你是谁：改 HTTPS 凭据或 SSH key。

## 查看现状

```powershell
cd G:\git-account-switcher
.\GitAccountSwitcher.ps1 status
```

## 推荐方式：给新 GitHub 小号单独配 SSH key

生成新 key：

```powershell
ssh-keygen -t ed25519 -C "your-new-github-email@example.com" -f "$HOME\.ssh\id_ed25519_small"
```

查看公钥，然后把输出添加到 GitHub 小号的 SSH keys：

```powershell
Get-Content "$HOME\.ssh\id_ed25519_small.pub"
```

添加 profile：

```powershell
.\GitAccountSwitcher.ps1 add `
  -ProfileName small `
  -GitUserName "Your Name" `
  -GitEmail "12345678+yourname@users.noreply.github.com" `
  -GitHubUser "yourname" `
  -Protocol ssh `
  -SshHost github-small `
  -SshKeyPath "$HOME\.ssh\id_ed25519_small"
```

写入 SSH alias：

```powershell
.\GitAccountSwitcher.ps1 ensure-ssh -ProfileName small
```

测试 SSH：

```powershell
ssh -T git@github-small
```

GitHub 通常会返回类似 `Hi yourname!` 的认证提示。

## 切换全局提交身份

```powershell
.\GitAccountSwitcher.ps1 use -ProfileName small -Scope global
```

## 只切换某个仓库

```powershell
.\GitAccountSwitcher.ps1 use -ProfileName small -Scope repo -RepoPath "G:\your-repo"
```

如果还想把仓库的 `origin` 从 `github.com` 改成 `github-small`：

```powershell
.\GitAccountSwitcher.ps1 use -ProfileName small -Scope repo -RepoPath "G:\your-repo" -RewriteRemote
```

例如：

```text
git@github.com:owner/repo.git
```

会变成：

```text
git@github-small:owner/repo.git
```

## 如果你用 HTTPS

可以添加 HTTPS profile：

```powershell
.\GitAccountSwitcher.ps1 add `
  -ProfileName small-https `
  -GitUserName "Your Name" `
  -GitEmail "12345678+yourname@users.noreply.github.com" `
  -GitHubUser "yourname" `
  -Protocol https
```

切换并清掉旧的 `github.com` HTTPS 凭据。只有你确定不再需要旧凭据时才这样做：

```powershell
.\GitAccountSwitcher.ps1 use -ProfileName small-https -Scope global -ClearGithubHttpsCredentials -IUnderstandThisDeletesGithubHttpsCredentials
```

下次 push 时 Git 会重新要求登录或输入 token。

## 预演

任何会写配置的命令都可以加 `-WhatIfMode`：

```powershell
.\GitAccountSwitcher.ps1 use -ProfileName small -Scope repo -RepoPath "G:\your-repo" -RewriteRemote -WhatIfMode
```

## 桌面应用

安装前端依赖：

```powershell
npm install
```

开发预览前端：

```powershell
npm run dev
```

启动 Tauri 桌面应用：

```powershell
npm run tauri:dev
```

只构建前端：

```powershell
npm run build
```

打包当前系统的桌面安装包：

```powershell
npm run tauri:build
```

### Windows 打包要求

需要：

- Node.js 和 npm
- Rust toolchain：`rustup` / `cargo` / `rustc`
- Microsoft Visual Studio Build Tools，包含 C++ 桌面开发工具
- WebView2 Runtime，通常 Windows 10/11 已自带

输出位置通常在：

```text
src-tauri\target\release\bundle\
```

### macOS 打包要求

在 macOS 机器上运行同一套源码：

```bash
npm install
npm run tauri:build
```

需要：

- Node.js 和 npm
- Rust toolchain
- Xcode Command Line Tools

输出位置通常在：

```text
src-tauri/target/release/bundle/
```

Tauri 不能在 Windows 上直接产出可用的 macOS `.app` / `.dmg`。要同时产出 Windows 和 macOS，推荐用 GitHub Actions 分别在 `windows-latest` 和 `macos-latest` runner 上构建。

本项目已经包含工作流：

```text
.github/workflows/build-desktop.yml
```

推送 `v*` 标签或手动触发 workflow 后，会分别上传 Windows 和 macOS 的 bundle artifact。
