@echo off
chcp 65001 >nul
title レイヴン・ポータル 対戦サーバー

echo ====================================
echo   レイヴン・ポータル 対戦サーバー
echo ====================================
echo.

:: Node.jsの存在確認
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [エラー] Node.js が見つかりません。
    echo https://nodejs.org/ からインストールしてください。
    pause
    exit /b 1
)

echo Node.js バージョン:
node --version
echo.

echo サーバーを起動しています...
echo.
echo ====================================
echo  テスト方法:
echo ====================================
echo.
echo [同じPCで2つのブラウザタブ]
echo   http://localhost:3461
echo.
echo [同じWiFiの友達]
echo   このPCのIPアドレス:3461 でアクセス
echo   (下に表示されるLANアドレスを共有)
echo.
echo [別の場所の友達]
echo   1. ngrok をインストール: https://ngrok.com/
echo   2. 別のターミナルで: ngrok http 3461
echo   3. 表示されたURLを友達に共有
echo ====================================
echo.

cd /d "%~dp0"
node server.js

pause
