# =====================================================================
#  KIAMA — Fabrication d'un zip de deploiement PROPRE, cote Windows
#  A lancer dans PowerShell sur ta machine (PAS sur le VPS).
#  Produit : C:\KIAMA\Divers\kiama_deploy_clean.zip
#  Exclut : node_modules, dist/build, __pycache__, .git,
#           donnees persistantes (data, uploads) et fichiers .env (secrets).
# =====================================================================

$ErrorActionPreference = 'Stop'
$src   = 'C:\KIAMA\Divers'
$stage = Join-Path $env:TEMP 'kiama_stage'
$zip   = 'C:\KIAMA\Divers\kiama_deploy_clean.zip'

Write-Host "1/4  Preparation du dossier temporaire..." -ForegroundColor Cyan
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# Elements applicatifs a inclure
$items = @('docker-compose.yml', '.env.example', '.gitignore',
           'backend', 'frontend', 'decision_engine', 'ao_extractor')

# Dossiers a exclure partout (dependances, artefacts, donnees persistantes)
$xdirs = @('node_modules', 'dist', 'build', '.next', '__pycache__',
           '.git', 'data', 'uploads')
# Fichiers a exclure (secrets + logs)
$xfiles = @('.env', '*.log')

Write-Host "2/4  Copie du code source (sans dependances ni donnees)..." -ForegroundColor Cyan
foreach ($it in $items) {
  $s = Join-Path $src $it
  if (-not (Test-Path $s)) { continue }
  if ((Get-Item $s).PSIsContainer) {
    $d = Join-Path $stage $it
    robocopy $s $d /E /XD $xdirs /XF $xfiles /NFL /NDL /NJH /NJS /NP | Out-Null
  } else {
    Copy-Item $s (Join-Path $stage $it) -Force
  }
}

Write-Host "3/4  Compression..." -ForegroundColor Cyan
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force

Write-Host "4/4  Nettoyage..." -ForegroundColor Cyan
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 2)
Write-Host ""
Write-Host "OK  ->  $zip  ($size Mo)" -ForegroundColor Green
Write-Host "Verifie qu'il n'y a PAS de node_modules dedans, puis uploade-le sur le VPS." -ForegroundColor Yellow
