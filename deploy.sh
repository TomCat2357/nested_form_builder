#!/bin/bash
set -o pipefail
export LC_ALL=C LANG=C

# Google AppSheetスタイル データ管理アプリ デプロイスクリプト

echo "🚀 Google AppSheetスタイル データ管理アプリのデプロイを開始します..."

print_help() {
    cat <<'EOF'
Usage: ./deploy.sh [options]

Options:
  --manifest-override <path>  指定したJSONファイルで gas/appsscript.json を上書きしてから push/deploy します。
  -h, --help                  このヘルプを表示します。
EOF
}

MANIFEST_OVERRIDE_FILE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --manifest-override)
            shift
            if [[ -z "$1" ]]; then
                echo "❌ --manifest-override にはファイルパスを指定してください"
                exit 1
            fi
            MANIFEST_OVERRIDE_FILE="$1"
            ;;
        -h|--help)
            print_help
            exit 0
            ;;
        *)
            echo "❌ 不明なオプションです: $1"
            printf '\n'
            print_help
            exit 1
            ;;
    esac
    shift
done

# 既存デプロイ情報の読み込み
DEPLOY_CACHE_FILE=".gas-deployment.json"
if [ -f "$DEPLOY_CACHE_FILE" ]; then
    EXISTING_DEPLOYMENT_ID=$(node -e 'const fs=require("fs");const p=process.argv[1];try{const data=JSON.parse(fs.readFileSync(p,"utf8"));if(data && data.deploymentId){console.log(data.deploymentId)}}catch(_){}' "$DEPLOY_CACHE_FILE" 2>/dev/null)
    EXISTING_WEB_APP_URL=$(node -e 'const fs=require("fs");const p=process.argv[1];try{const data=JSON.parse(fs.readFileSync(p,"utf8"));if(data && data.webAppUrl){console.log(data.webAppUrl)}}catch(_){}' "$DEPLOY_CACHE_FILE" 2>/dev/null)
fi

# フロントエンドのビルドとGASへの同梱

echo "🛠 builder をビルド中..."
npm --prefix builder install || { echo "❌ builder の依存関係のインストールに失敗しました"; exit 1; }
npm --prefix builder run build || { echo "❌ builder のビルドに失敗しました"; exit 1; }

# GASファイルの結合
echo "🔧 GASファイルを結合中..."
node gas/scripts/bundle.js || { echo "❌ GASファイルの結合に失敗しました"; exit 1; }

# distディレクトリへのファイル配置
echo "📄 デプロイファイルを準備中..."

# dist/Index.html が生成されているか確認
if [ ! -f "dist/Index.html" ]; then
    echo "❌ ビルド成果物 dist/Index.html が見つかりません"
    exit 1
fi

# <base target="_top"> タグとデプロイ時刻を追加
DEPLOY_TIMESTAMP=$(TZ=Asia/Tokyo date '+%Y-%m-%d %H:%M:%S JST')
export DEPLOY_TIMESTAMP
node - "dist/Index.html" <<'NODE'
const fs = require('fs');
const targetPath = process.argv[2];
const deployTime = process.env.DEPLOY_TIMESTAMP || new Date().toISOString();
let html = fs.readFileSync(targetPath, 'utf8');

// <base target="_top"> タグを追加
if (!html.includes('<base target="_top">')) {
  html = html.replace('<head>', '<head>\n  <base target="_top">');
}

// デプロイ時刻をmetaタグとして埋め込み（既存のものがあれば置換）
const deployMeta = `<meta name="deploy-time" content="${deployTime}">`;
if (html.includes('<meta name="deploy-time"')) {
  html = html.replace(/<meta name="deploy-time".*?>/g, deployMeta);
} else {
  html = html.replace('<head>', `<head>\n  ${deployMeta}`);
}

fs.writeFileSync(targetPath, html);
console.log('📅 デプロイ時刻:', deployTime);
NODE

# appsscript.json をコピー
BASE_MANIFEST="gas/appsscript.json"
TARGET_MANIFEST="dist/appsscript.json"
cp "$BASE_MANIFEST" "$TARGET_MANIFEST" || { echo "❌ appsscript.json のコピーに失敗しました"; exit 1; }

if [ -n "$MANIFEST_OVERRIDE_FILE" ]; then
    if [ ! -f "$MANIFEST_OVERRIDE_FILE" ]; then
        echo "❌ 指定されたマニフェスト上書きファイル '$MANIFEST_OVERRIDE_FILE' が見つかりません"
        exit 1
    fi
    if ! node - "$TARGET_MANIFEST" "$MANIFEST_OVERRIDE_FILE" <<'NODE'
const fs = require('fs');
const targetPath = process.argv[2];
const overridePath = process.argv[3];
const base = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
const override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));

function merge(target, source) {
  if (Array.isArray(source)) {
    return source.slice();
  }
  if (source && typeof source === 'object') {
    const baseObj = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
    const result = { ...baseObj };
    for (const [key, value] of Object.entries(source)) {
      result[key] = merge(result[key], value);
    }
    return result;
  }
  return source;
}

const merged = merge(base, override);
fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2));
NODE
    then
        echo "❌ マニフェストの上書き処理に失敗しました"
        exit 1
    fi
    echo "   ➕ マニフェスト上書き: $MANIFEST_OVERRIDE_FILE を適用しました"
fi

echo "✅ デプロイファイルの準備が完了しました"
echo "   - dist/Bundle.gs (GAS結合ファイル)"
echo "   - dist/Index.html (Reactアプリ)"
if [ -n "$MANIFEST_OVERRIDE_FILE" ]; then
    echo "   - dist/appsscript.json (GAS設定, overrides: $MANIFEST_OVERRIDE_FILE)"
else
    echo "   - dist/appsscript.json (GAS設定)"
fi

# プロジェクトをプッシュ
echo "📤 プロジェクトファイルをGoogle Apps Scriptにプッシュ中..."
clasp push

if [ $? -eq 0 ]; then
    echo "✅ プッシュが完了しました"
else
    echo "❌ プッシュに失敗しました"
    exit 1
fi

# デプロイ
echo "🌐 Webアプリとしてデプロイ中..."

# JSON出力が使える場合は優先して利用し、だめなら通常出力を解析
DEPLOY_ARGS=("--description" "Google AppSheetスタイル データ管理アプリ v$(date +%Y%m%d_%H%M%S)")
if [ -n "$EXISTING_DEPLOYMENT_ID" ]; then
    DEPLOY_ARGS+=("--deploymentId" "$EXISTING_DEPLOYMENT_ID")
fi

DEPLOY_JSON=$(clasp deploy "${DEPLOY_ARGS[@]}" --json 2>/dev/null)
DEPLOY_STATUS=$?

DEPLOYMENT_ID=""
WEB_APP_URL=""

if [ $DEPLOY_STATUS -eq 0 ] && echo "$DEPLOY_JSON" | grep -q '^[{\[]'; then
    echo "✅ デプロイが完了しました (JSON)"
    echo "$DEPLOY_JSON"
    # Nodeを使って堅牢にJSONを解析（jq不要）
    if command -v node >/dev/null 2>&1; then
        DEPLOYMENT_ID=$(node -e 'const fs=require("fs");const s=fs.readFileSync(0,"utf8");try{const o=JSON.parse(s);if(o.deploymentId){console.log(o.deploymentId)}else if(o.result&&o.result.deploymentId){console.log(o.result.deploymentId)}else if(o.entryPoints){const w=o.entryPoints.find(e=>e.webApp&&e.webApp.url);if(w&&w.webApp&&w.webApp.url){const m=w.webApp.url.match(/\/macros\/s\/([^/]+)\//);if(m)console.log(m[1]);}}}catch(e){}' <<< "$DEPLOY_JSON" || true)
        WEB_APP_URL=$(node -e 'const fs=require("fs");const s=fs.readFileSync(0,"utf8");try{const o=JSON.parse(s);if(o.webAppUrl){console.log(o.webAppUrl)}else if(o.entryPoints){const w=o.entryPoints.find(e=>e.webApp&&e.webApp.url);if(w&&w.webApp&&w.webApp.url)console.log(w.webApp.url);} }catch(e){}' <<< "$DEPLOY_JSON" || true)
    fi
else
    # JSON出力が使えないclaspの場合のフォールバック
    DEPLOY_OUTPUT=$(clasp deploy "${DEPLOY_ARGS[@]}")
    if [ $? -ne 0 ]; then
        echo "❌ デプロイに失敗しました"
        exit 1
    fi
    echo "✅ デプロイが完了しました"
    echo "$DEPLOY_OUTPUT"
    # WebApp URLを出力から抽出
    WEB_APP_URL=$(echo "$DEPLOY_OUTPUT" | tr -d '\r' | grep -Eo 'https://script.google.com/macros/s/[^[:space:]]+' | head -n1)
    # URLからdeploymentIdを抽出
    if [ -n "$WEB_APP_URL" ]; then
        DEPLOYMENT_ID=$(echo "$WEB_APP_URL" | sed -n 's|.*/macros/s/\([^/]*\)/.*|\1|p')
    fi
    # それでも取れない場合はdeploymentId行から抽出
    if [ -z "$DEPLOYMENT_ID" ]; then
        DEPLOYMENT_ID=$(echo "$DEPLOY_OUTPUT" | tr -d '\r' | grep -Ei 'deployment id|deploymentId' | grep -Eo 'AKf[[:alnum:]_\-]+' | head -n1)
    fi
fi

# Script IDは参照リンク用に取得
SCRIPT_ID=$(grep '"scriptId"' .clasp.json | cut -d '"' -f4 | tr -d '\r')

# デプロイメント一覧から@HEADのDeployment IDを取得（既存IDが無い場合のみ）
if [ -z "$DEPLOYMENT_ID" ] && [ -z "$WEB_APP_URL" ]; then
    echo "📋 デプロイメント情報を取得中..."
    DEPLOYMENTS_OUTPUT=$(clasp deployments 2>/dev/null)
    if [ -n "$DEPLOYMENTS_OUTPUT" ]; then
        # @HEADのDeployment IDを抽出（最初のAKfで始まる文字列）
        HEAD_DEPLOYMENT_ID=$(echo "$DEPLOYMENTS_OUTPUT" | grep '@HEAD' | grep -Eo 'AKf[[:alnum:]_\-]+' | head -n1)
        if [ -n "$HEAD_DEPLOYMENT_ID" ]; then
            DEPLOYMENT_ID="$HEAD_DEPLOYMENT_ID"
            WEB_APP_URL="https://script.google.com/macros/s/$HEAD_DEPLOYMENT_ID/exec"
        fi
    fi
fi

echo ""
echo "=========================================="
echo "🌟 Webアプリケーションの情報"
echo "=========================================="
if [ -n "$DEPLOY_TIMESTAMP" ]; then
    printf '%s %s\n' "📅 デプロイ時刻:" "$DEPLOY_TIMESTAMP"
fi
if [ -n "$DEPLOYMENT_ID" ]; then
    printf '%s %s\n' "🆔 Deployment ID:" "$DEPLOYMENT_ID"
fi
if [ -n "$WEB_APP_URL" ]; then
    echo ""
    echo "🌐 Web App URL:"
    echo "   $WEB_APP_URL"
    echo ""
elif [ -n "$DEPLOYMENT_ID" ]; then
    ADMIN_WEB_URL="https://script.google.com/macros/s/$DEPLOYMENT_ID/exec"
    echo ""
    echo "🌐 Web App URL:"
    echo "   $ADMIN_WEB_URL"
    echo ""
fi
if [ -n "$SCRIPT_ID" ]; then
    printf '%s %s\n' "📋 Script ID:" "$SCRIPT_ID"
    ADMIN_EDIT_URL="https://script.google.com/home/projects/$SCRIPT_ID/edit"
    printf '%s %s\n' "⚙️  管理画面:" "$ADMIN_EDIT_URL"
fi
echo "=========================================="

echo ""
echo "📖 次のステップ:"
echo "1. 管理画面でデプロイ設定を確認"
echo "2. アクセス権限を設定（全員 または 組織内のユーザー）"
echo "3. Web App URLを共有してアプリを使用開始"

# デプロイ情報をキャッシュして再利用
if [ -n "$DEPLOYMENT_ID" ] || [ -n "$WEB_APP_URL" ]; then
    if command -v node >/dev/null 2>&1; then
        DEPLOYMENT_ID="$DEPLOYMENT_ID" WEB_APP_URL="$WEB_APP_URL" node - "$DEPLOY_CACHE_FILE" <<'NODE'
const fs = require('fs');
const path = process.argv[2];
const data = {};
if (process.env.DEPLOYMENT_ID) {
  data.deploymentId = process.env.DEPLOYMENT_ID;
}
if (process.env.WEB_APP_URL) {
  data.webAppUrl = process.env.WEB_APP_URL;
}
fs.writeFileSync(path, JSON.stringify(data, null, 2));
NODE
    else
        {
            echo "{"
            if [ -n "$DEPLOYMENT_ID" ]; then
                echo "  \"deploymentId\": \"$DEPLOYMENT_ID\"${WEB_APP_URL:+,}"
            fi
            if [ -n "$WEB_APP_URL" ]; then
                echo "  \"webAppUrl\": \"$WEB_APP_URL\""
            fi
            echo "}"
        } > "$DEPLOY_CACHE_FILE"
    fi
fi

# アクセス権限の警告（302/401などの場合）
if [ -n "$WEB_APP_URL" ] && command -v curl >/dev/null 2>&1; then
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WEB_APP_URL")
    if [ "$HTTP_STATUS" = "302" ] || [ "$HTTP_STATUS" = "401" ]; then
        echo "⚠️  Web App が HTTP $HTTP_STATUS を返しました。公開設定が『全員』になっているか確認してください。"
    fi
fi

echo ""
echo "🎉 デプロイが正常に完了しました！"
echo "📚 詳細な使用方法はREADME.mdを参照してください"
