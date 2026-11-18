<#
  One-shot setup: GitHub Actions -> Firebase Hosting (alderoberge.com/chess).

  Prereqs (installed once):  node/npm, git, gh (GitHub CLI), gcloud (Google Cloud SDK)
  Usage (from the repo root):
      pwsh scripts/setup-firebase-deploy.ps1 -ProjectId <firebase-project-id> [-Repo AldeRoberge/Chess] [-Site <hosting-site-id>]

  What it does (idempotent, safe to re-run):
    1. Logs in to firebase / gcloud / gh if needed
    2. Writes firebase.json + .firebaserc (serves ./dist, build lands in dist/chess/)
    3. Creates a deploy service account with Firebase Hosting Admin
    4. Stores its key as the GitHub secret FIREBASE_SERVICE_ACCOUNT (key never touches disk after upload)
    5. Writes .github/workflows/firebase-deploy.yml (build + deploy on push to main)

  WARNING: a Firebase Hosting deploy REPLACES the whole site. Use a site that only
  serves /chess (-Site), or make sure ./dist contains the rest of alderoberge.com too.
#>
param(
  [Parameter(Mandatory)] [string] $ProjectId,
  [string] $Repo = "AldeRoberge/Chess",
  [string] $Site = $ProjectId,
  [string] $ServiceAccount = "github-chess-deploy"
)
$ErrorActionPreference = "Stop"
function Need($cmd) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing '$cmd' on PATH." } }
function Run { param([string]$What) Write-Host "`n==> $What" -ForegroundColor Cyan }

Need git; Need gh; Need gcloud; Need npx
Set-Location (git rev-parse --show-toplevel)

Run "Authenticating"
gh auth status 2>$null; if ($LASTEXITCODE -ne 0) { gh auth login }
if (-not (gcloud auth list --filter=status:ACTIVE --format="value(account)")) { gcloud auth login }
gcloud config set project $ProjectId | Out-Null

Run "Enabling APIs"
gcloud services enable firebasehosting.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com apikeys.googleapis.com

Run "Writing firebase.json / .firebaserc"
@"
{
  "hosting": {
    "site": "$Site",
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "headers": [
      { "source": "/chess/assets/**", "headers": [{ "key": "Cache-Control", "value": "public,max-age=31536000,immutable" }] }
    ]
  }
}
"@ | Set-Content firebase.json -Encoding utf8
@"
{ "projects": { "default": "$ProjectId" } }
"@ | Set-Content .firebaserc -Encoding utf8

Run "Creating service account $ServiceAccount"
$sa = "$ServiceAccount@$ProjectId.iam.gserviceaccount.com"
gcloud iam service-accounts describe $sa 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  gcloud iam service-accounts create $ServiceAccount --display-name "GitHub Actions: deploy chess"
}
foreach ($role in "roles/firebasehosting.admin", "roles/serviceusage.apiKeysViewer", "roles/serviceusage.serviceUsageConsumer") {
  gcloud projects add-iam-policy-binding $ProjectId --member "serviceAccount:$sa" --role $role --condition=None --quiet | Out-Null
}

Run "Uploading key to GitHub secret FIREBASE_SERVICE_ACCOUNT ($Repo)"
$key = Join-Path ([IO.Path]::GetTempPath()) "fb-sa-$([guid]::NewGuid()).json"
try {
  gcloud iam service-accounts keys create $key --iam-account $sa
  Get-Content $key -Raw | gh secret set FIREBASE_SERVICE_ACCOUNT --repo $Repo
} finally {
  if (Test-Path $key) { Remove-Item $key -Force }
}

Run "Writing .github/workflows/firebase-deploy.yml"
New-Item -ItemType Directory -Force .github/workflows | Out-Null
@"
name: Deploy /chess (Firebase)

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: firebase-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run setup:stockfish
      - run: npm run build
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: `${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: `${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: $ProjectId
          channelId: live
"@ | Set-Content .github/workflows/firebase-deploy.yml -Encoding utf8

Write-Host "`nDone." -ForegroundColor Green
Write-Host @"
Remaining manual steps:
  1. Firebase console > Hosting > add custom domain alderoberge.com (if not already attached to site '$Site').
  2. If the old Cloudflare route still points at /chess, remove it (wrangler.jsonc + .github/workflows/deploy.yml)
     so it stops shadowing / failing: git rm .github/workflows/deploy.yml wrangler.jsonc
  3. git add firebase.json .firebaserc .github/workflows/firebase-deploy.yml; git commit; git push
"@
