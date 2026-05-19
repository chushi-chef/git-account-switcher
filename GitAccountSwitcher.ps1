param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'list', 'add', 'use', 'ensure-ssh', 'remove', 'help')]
    [string]$Command = 'help',

    [string]$ProfileName,
    [string]$GitUserName,
    [string]$GitEmail,
    [string]$GitHubUser,
    [ValidateSet('ssh', 'https')]
    [string]$Protocol = 'ssh',
    [string]$SshHost,
    [string]$SshKeyPath,
    [ValidateSet('global', 'repo')]
    [string]$Scope = 'global',
    [string]$RepoPath = (Get-Location).Path,
    [switch]$RewriteRemote,
    [switch]$ClearGithubHttpsCredentials,
    [switch]$IUnderstandThisDeletesGithubHttpsCredentials,
    [switch]$WhatIfMode
)

$ErrorActionPreference = 'Stop'

$ConfigDir = Join-Path $HOME '.git-account-switcher'
$ProfilesPath = Join-Path $ConfigDir 'profiles.json'
$SshConfigPath = Join-Path $HOME '.ssh\config'

function Write-Info {
    param([string]$Message)
    Write-Host "[git-account-switcher] $Message"
}

function Invoke-Step {
    param(
        [string]$Message,
        [scriptblock]$Action
    )

    if ($WhatIfMode) {
        Write-Info "DRY RUN: $Message"
        return
    }

    Write-Info $Message
    & $Action
}

function Ensure-ConfigDir {
    if (-not (Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }
}

function Load-Profiles {
    Ensure-ConfigDir

    if (-not (Test-Path $ProfilesPath)) {
        return @{}
    }

    $raw = Get-Content -LiteralPath $ProfilesPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @{}
    }

    $json = $raw | ConvertFrom-Json
    $profiles = @{}
    foreach ($property in $json.PSObject.Properties) {
        $profiles[$property.Name] = $property.Value
    }
    return $profiles
}

function Save-Profiles {
    param([hashtable]$Profiles)

    Ensure-ConfigDir
    $Profiles | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ProfilesPath -Encoding UTF8
}

function Get-ProfileOrFail {
    param([string]$Name)

    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw 'Please pass -ProfileName.'
    }

    $profiles = Load-Profiles
    if (-not $profiles.ContainsKey($Name)) {
        throw "Profile '$Name' was not found. Run: .\GitAccountSwitcher.ps1 list"
    }

    return $profiles[$Name]
}

function Get-GitValue {
    param([string[]]$GitArgs)

    try {
        $value = & git @GitArgs 2>$null
        if ($LASTEXITCODE -ne 0) {
            return ''
        }
        return ($value -join "`n").Trim()
    } catch {
        return ''
    }
}

function Test-InsideRepo {
    param([string]$Path)

    Push-Location $Path
    try {
        return ((Get-GitValue @('rev-parse', '--is-inside-work-tree')) -eq 'true')
    } finally {
        Pop-Location
    }
}

function Convert-RemoteForProfile {
    param(
        [string]$RemoteUrl,
        [object]$Profile
    )

    if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
        throw 'No origin remote found in this repository.'
    }

    $ownerRepo = $null

    if ($RemoteUrl -match '^git@([^:]+):(.+?)(\.git)?$') {
        $ownerRepo = $Matches[2]
    } elseif ($RemoteUrl -match '^ssh://git@([^/]+)/(.+?)(\.git)?$') {
        $ownerRepo = $Matches[2]
    } elseif ($RemoteUrl -match '^https://github\.com/(.+?)(\.git)?$') {
        $ownerRepo = $Matches[1]
    } else {
        throw "Unsupported remote format: $RemoteUrl"
    }

    $ownerRepo = $ownerRepo.TrimEnd('/')
    if ($Profile.protocol -eq 'https') {
        return "https://github.com/$ownerRepo.git"
    }

    if ([string]::IsNullOrWhiteSpace($Profile.sshHost)) {
        throw "Profile '$ProfileName' uses SSH but has no sshHost."
    }

    return "git@$($Profile.sshHost):$ownerRepo.git"
}

function Ensure-SshHost {
    param([object]$Profile)

    if ($Profile.protocol -ne 'ssh') {
        return
    }

    if ([string]::IsNullOrWhiteSpace($Profile.sshHost)) {
        throw 'SSH profile needs -SshHost, for example github-small.'
    }
    if ([string]::IsNullOrWhiteSpace($Profile.sshKeyPath)) {
        throw 'SSH profile needs -SshKeyPath, for example C:\Users\you\.ssh\id_ed25519_small.'
    }

    $sshDir = Split-Path $SshConfigPath -Parent
    Invoke-Step "Ensure SSH directory exists: $sshDir" {
        New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
    }

    $keyPath = [Environment]::ExpandEnvironmentVariables($Profile.sshKeyPath)
    $blockStart = "# BEGIN git-account-switcher $($Profile.name)"
    $blockEnd = "# END git-account-switcher $($Profile.name)"
    $block = @(
        $blockStart
        "Host $($Profile.sshHost)"
        "    HostName github.com"
        "    User git"
        "    IdentityFile $keyPath"
        "    IdentitiesOnly yes"
        $blockEnd
    ) -join [Environment]::NewLine

    Invoke-Step "Write SSH host alias '$($Profile.sshHost)' to $SshConfigPath" {
        if (-not (Test-Path $SshConfigPath)) {
            Set-Content -LiteralPath $SshConfigPath -Value $block -Encoding UTF8
            return
        }

        $content = Get-Content -LiteralPath $SshConfigPath -Raw
        $pattern = '(?s)' + [regex]::Escape($blockStart) + '.*?' + [regex]::Escape($blockEnd)
        if ($content -match $pattern) {
            $content = [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $block })
        } else {
            $content = $content.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $block + [Environment]::NewLine
        }
        Set-Content -LiteralPath $SshConfigPath -Value $content -Encoding UTF8
    }
}

function Clear-GithubHttpsCredentials {
    if (-not $IUnderstandThisDeletesGithubHttpsCredentials) {
        throw 'Refusing to clear GitHub HTTPS credentials without -IUnderstandThisDeletesGithubHttpsCredentials. This is intentionally hard to do by accident.'
    }

    $gitCredentials = Join-Path $HOME '.git-credentials'

    Invoke-Step 'Ask Git credential helper to erase github.com HTTPS credentials' {
        "protocol=https`nhost=github.com`n" | git credential reject
    }

    if (Test-Path $gitCredentials) {
        Invoke-Step "Remove github.com entries from $gitCredentials without printing secrets" {
            $remaining = Get-Content -LiteralPath $gitCredentials | Where-Object {
                $_ -notmatch '^https://.*@github\.com'
            }
            Set-Content -LiteralPath $gitCredentials -Value $remaining -Encoding UTF8
        }
    }
}

function Show-Status {
    Write-Host ''
    Write-Host 'Git global identity'
    Write-Host "  user.name  = $(Get-GitValue @('config', '--global', 'user.name'))"
    Write-Host "  user.email = $(Get-GitValue @('config', '--global', 'user.email'))"
    Write-Host "  helper     = $(Get-GitValue @('config', '--global', 'credential.helper'))"

    if (Test-InsideRepo $RepoPath) {
        Push-Location $RepoPath
        try {
            Write-Host ''
            Write-Host "Repository: $RepoPath"
            Write-Host "  user.name  = $(Get-GitValue @('config', '--local', 'user.name'))"
            Write-Host "  user.email = $(Get-GitValue @('config', '--local', 'user.email'))"
            Write-Host "  origin     = $(Get-GitValue @('remote', 'get-url', 'origin'))"
        } finally {
            Pop-Location
        }
    }

    Write-Host ''
    Write-Host "Profiles file: $ProfilesPath"
}

function Show-Help {
    @'
GitAccountSwitcher.ps1

What it switches:
  1. Git commit identity: user.name and user.email
  2. GitHub auth route: SSH host alias or HTTPS remote
  3. Optional cleanup of old github.com HTTPS credentials

Examples:
  .\GitAccountSwitcher.ps1 status

  .\GitAccountSwitcher.ps1 add `
    -ProfileName small `
    -GitUserName "Your Name" `
    -GitEmail "12345678+small@users.noreply.github.com" `
    -GitHubUser "small" `
    -Protocol ssh `
    -SshHost github-small `
    -SshKeyPath "$HOME\.ssh\id_ed25519_small"

  .\GitAccountSwitcher.ps1 ensure-ssh -ProfileName small

  .\GitAccountSwitcher.ps1 use -ProfileName small -Scope global

  .\GitAccountSwitcher.ps1 use -ProfileName small -Scope repo -RepoPath "G:\your-repo" -RewriteRemote

  .\GitAccountSwitcher.ps1 use -ProfileName small -Scope global -ClearGithubHttpsCredentials -IUnderstandThisDeletesGithubHttpsCredentials

Notes:
  - Git is not GitHub. Git stores commit identity locally. GitHub authenticates pushes/pulls.
  - For SSH profiles, add the public key to GitHub first, then use ensure-ssh/use.
  - Use -WhatIfMode to preview changes.
  - Existing HTTPS credentials are never removed unless both credential-clear switches are passed.
'@ | Write-Host
}

switch ($Command) {
    'help' {
        Show-Help
    }

    'status' {
        Show-Status
    }

    'list' {
        $profiles = Load-Profiles
        if ($profiles.Count -eq 0) {
            Write-Info 'No profiles yet. Use the add command first.'
            return
        }

        foreach ($name in ($profiles.Keys | Sort-Object)) {
            $p = $profiles[$name]
            Write-Host "$name"
            Write-Host "  git       : $($p.gitUserName) <$($p.gitEmail)>"
            Write-Host "  github    : $($p.gitHubUser)"
            Write-Host "  protocol  : $($p.protocol)"
            if ($p.protocol -eq 'ssh') {
                Write-Host "  ssh host  : $($p.sshHost)"
                Write-Host "  ssh key   : $($p.sshKeyPath)"
            }
        }
    }

    'add' {
        foreach ($required in @('ProfileName', 'GitUserName', 'GitEmail')) {
            if ([string]::IsNullOrWhiteSpace((Get-Variable $required -ValueOnly))) {
                throw "Please pass -$required."
            }
        }

        if ([string]::IsNullOrWhiteSpace($GitHubUser)) {
            $GitHubUser = $ProfileName
        }
        if ($Protocol -eq 'ssh' -and [string]::IsNullOrWhiteSpace($SshHost)) {
            $SshHost = "github-$ProfileName"
        }

        $profiles = Load-Profiles
        $profiles[$ProfileName] = [ordered]@{
            name = $ProfileName
            gitUserName = $GitUserName
            gitEmail = $GitEmail
            gitHubUser = $GitHubUser
            protocol = $Protocol
            sshHost = $SshHost
            sshKeyPath = $SshKeyPath
        }

        Invoke-Step "Save profile '$ProfileName'" {
            Save-Profiles $profiles
        }

        if ($WhatIfMode) {
            Write-Info "Profile '$ProfileName' preview completed."
        } else {
            Write-Info "Saved profile '$ProfileName'."
        }
    }

    'ensure-ssh' {
        $profile = Get-ProfileOrFail $ProfileName
        Ensure-SshHost $profile
    }

    'use' {
        $profile = Get-ProfileOrFail $ProfileName

        if ($profile.protocol -eq 'ssh') {
            Ensure-SshHost $profile
        }

        if ($Scope -eq 'global') {
            Invoke-Step "Set global Git identity to '$($profile.gitUserName) <$($profile.gitEmail)>'" {
                git config --global user.name "$($profile.gitUserName)"
                git config --global user.email "$($profile.gitEmail)"
            }
        } else {
            if (-not (Test-InsideRepo $RepoPath)) {
                throw "Not a Git repository: $RepoPath"
            }
            Push-Location $RepoPath
            try {
                Invoke-Step "Set repository Git identity in $RepoPath" {
                    git config user.name "$($profile.gitUserName)"
                    git config user.email "$($profile.gitEmail)"
                }

                if ($RewriteRemote) {
                    $oldRemote = Get-GitValue @('remote', 'get-url', 'origin')
                    $newRemote = Convert-RemoteForProfile -RemoteUrl $oldRemote -Profile $profile
                    Invoke-Step "Rewrite origin remote to $newRemote" {
                        git remote set-url origin $newRemote
                    }
                }
            } finally {
                Pop-Location
            }
        }

        if ($ClearGithubHttpsCredentials) {
            Clear-GithubHttpsCredentials
        }

        if ($WhatIfMode) {
            Write-Info "Profile '$ProfileName' preview completed for scope '$Scope'."
        } else {
            Write-Info "Profile '$ProfileName' is active for scope '$Scope'."
        }
    }

    'remove' {
        if ([string]::IsNullOrWhiteSpace($ProfileName)) {
            throw 'Please pass -ProfileName.'
        }

        $profiles = Load-Profiles
        if (-not $profiles.ContainsKey($ProfileName)) {
            Write-Info "Profile '$ProfileName' does not exist."
            return
        }

        $profiles.Remove($ProfileName)
        Invoke-Step "Remove profile '$ProfileName'" {
            Save-Profiles $profiles
        }
    }
}
