@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =============================================
echo   JUNGLE WAGERING PROCESSOR - INICIALIZADOR
echo =============================================
where bun >nul 2>nul || (echo ERRO: Bun nao encontrado. Instale em https://bun.sh && pause && exit /b 1)
where docker >nul 2>nul || (echo ERRO: Docker nao encontrado. Abra o Docker Desktop. && pause && exit /b 1)
docker info >nul 2>nul || (echo ERRO: Docker Engine nao esta rodando. Abra o Docker Desktop. && pause && exit /b 1)
if not exist .env copy .env.example .env >nul
echo [1/3] Instalando dependencias...
bun install
if errorlevel 1 (echo Falha ao instalar dependencias. & pause & exit /b 1)
echo [2/3] Subindo banco, LocalStack, API e worker...
docker compose up --build -d
if errorlevel 1 (echo Falha no Docker Compose. & pause & exit /b 1)
echo [3/3] Aguardando API...
for /L %%i in (1,1,30) do (
  curl -fsS http://localhost:3000/health/ready >nul 2>nul && goto :ready
  timeout /t 2 /nobreak >nul
)
echo API ainda nao respondeu. Consulte: docker compose logs --tail=100
goto :end
:ready
echo.
echo SUCESSO! API disponivel em http://localhost:3000
echo Swagger: http://localhost:3000/docs
echo Health: http://localhost:3000/health/ready
echo Para parar: PARAR.bat
start http://localhost:3000/docs
:end
pause
