# Git Account Switcher

一个本地桌面小工具，用来切换 Git 提交身份和 GitHub SSH 认证入口。

它基于 Tauri、Rust 和 React 构建，目标是让已有的远程地址继续使用 `git@github.com:owner/repo.git`，同时通过本地配置切换当前生效的账号。

## 功能

- 保存多个本地账号配置。
- 每 10 秒读取一次全局 Git 身份，并在账号列表中显示当前生效账号。
- 点击启用账号时执行：

```bash
git config --global user.name "xxx"
git config --global user.email "yyy"
```

- 如果账号绑定了平台域名和 SSH key 路径，同步维护 `~/.ssh/config`。
- 如果当前 `Host github.com` 被未知 key 占用，程序会拒绝覆盖，避免误伤已有配置。
- 不保存 GitHub 密码、token 或私钥内容。
- 不删除、覆盖或打印已有 GitHub HTTPS 凭据。

账号数据保存在本机：

```text
~/.git-account-switcher/profiles.json
```

## SSH Key 选择

添加账号时，`SSH key 路径` 应该选择没有 `.pub` 后缀的私钥文件。

例如：

```text
~/.ssh/id_ed25519
```

不要选择：

```text
~/.ssh/id_ed25519.pub
```

`.pub` 文件是添加到 GitHub SSH keys 页面里的公钥，本地连接 GitHub 时使用的是同名私钥。

## SSH 切换逻辑

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

如果 `Host github.com` 当前被一个未知 key 占用，程序会拒绝覆盖。你需要先把那个账号也添加进本地列表，然后再切换。

## Git 和 GitHub 的区别

Git 是本地版本控制工具。它记录提交里的名字和邮箱。

GitHub 是远端平台。它决定你能不能 push/pull 某个仓库，认证方式通常是 HTTPS token 或 SSH key。

所以“切账号”实际有两层：

- 提交看起来是谁写的：改 Git config。
- 推送时 GitHub 认为你是谁：切换 HTTPS 凭据或 SSH key。

本工具处理本地 Git 身份和 SSH key 入口，不做绕过 GitHub 限制或风控的事情。

## 开发

安装依赖：

```bash
npm install
```

启动 Tauri 桌面应用：

```bash
npm run tauri:dev
```

只构建前端：

```bash
npm run build
```

打包当前系统的桌面安装包：

```bash
npm run tauri:build
```

## Windows 打包要求

- Node.js 和 npm
- Rust toolchain：`rustup` / `cargo` / `rustc`
- Microsoft Visual Studio Build Tools，包含 C++ 桌面开发工具
- WebView2 Runtime，通常 Windows 10/11 已自带

输出位置通常在：

```text
src-tauri\target\release\bundle\
```

## macOS 打包要求

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

不做 Apple 签名和 notarization 时，macOS 包可以构建出来，但用户首次打开可能会被系统拦截，需要右键打开或后续补签名流程。

## GitHub Release

项目包含 GitHub Actions workflow：

```text
.github/workflows/build-desktop.yml
```

推送 `v*` tag 后会分别在 Windows 和 macOS runner 上构建，并创建 GitHub Release。

例如：

```bash
git tag v0.1.0
git push origin v0.1.0
```

workflow 会上传 `.exe`、`.msi` 和 `.dmg` 到对应 Release。
