Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"

# Charge GROQ_API_KEY depuis les variables utilisateur si pas encore definie
if (-not $env:GROQ_API_KEY) {
    $sysKey = [System.Environment]::GetEnvironmentVariable("GROQ_API_KEY", "User")
    if ($sysKey) {
        $env:GROQ_API_KEY = $sysKey
        Write-Host "[Groq] Cle chargee depuis les variables utilisateur." -ForegroundColor Green
    } else {
        Write-Warning "[Groq] GROQ_API_KEY absent - analyse qualitative desactivee."
        Write-Warning "       Obtenez une cle sur https://console.groq.com"
    }
}

if (-not $env:GROQ_MODEL) {
    $env:GROQ_MODEL = "llama-3.1-8b-instant"
}
Write-Host "[Groq] Modele : $env:GROQ_MODEL" -ForegroundColor Cyan

uvicorn src.api_service:app --host 0.0.0.0 --port 8765 --reload
