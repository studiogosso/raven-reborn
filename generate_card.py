#!/usr/bin/env python3
"""
RAVEN REBORN - AI Card Generator Pipeline
LLM (Ollama) → Card Design → ComfyUI (Image) → Game Integration

Usage: python generate_card.py "新しい火属性の攻撃カードを作って"
       python generate_card.py "tier3の罠カードを作って"
"""
import json, sys, urllib.request, time, os

# Config
# For Ollama: run via SSH tunnel or locally
OLLAMA_URLS = ["http://localhost:11434", "http://100.107.112.67:11434"]
COMFY_URLS = ["http://renderpc:8188"]  # RenderPC has SDXL ready
# To use Japan PC's Ollama: ssh -L 11434:localhost:11434 studi@100.107.112.67
USE_SSH_OLLAMA = True  # If True, run ollama via SSH on Japan PC
SSH_HOST = "studi@100.107.112.67"
SPRITE_DIR = os.path.join(os.path.dirname(__file__), "sprites", "cards")
GAME_FILE = os.path.join(os.path.dirname(__file__), "raven_reborn.html")

def ollama_chat(prompt, model="qwen2.5:32b"):
    """Ask Ollama to design a card - via SSH if configured"""
    if USE_SSH_OLLAMA:
        import subprocess
        payload = json.dumps({
            "model": model,
            "messages": [{"role": "system", "content": """あなたはRAVEN REBORNというローグライクデッキビルダーゲームのカードデザイナーです。
ユーザーの要望に基づいて新しいカードをJSON形式で設計してください。

既存カードタイプ: 武器、杖、罠、巻物、道具、財宝、勝利点
ティア: 0(基本), 1(安い), 2(中), 3(高い), 4(レア), 5(伝説)

必ず以下のJSON形式のみ出力（説明文不要）:
{"id":"英語ID","name":"日本語名","type":"カードタイプ","ap":AP消費,"noise":ノイズ,"xpCost":XPコスト,"desc":"効果説明","tier":ティア,"stock":在庫数,"art_prompt":"dark fantasy RPG item illustration, 英語の絵の説明, centered, dark background, dramatic lighting"}"""},
                {"role": "user", "content": prompt}],
            "stream": False
        }, ensure_ascii=False)
        try:
            result = subprocess.run(
                ["ssh", SSH_HOST, "curl", "-s", "http://localhost:11434/api/chat",
                 "-d", payload],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode == 0 and result.stdout:
                resp = json.loads(result.stdout)
                return resp.get("message", {}).get("content", "")
        except Exception as e:
            print(f"  SSH Ollama failed: {e}")

    for url in OLLAMA_URLS:
        try:
            data = json.dumps({
                "model": model,
                "messages": [{"role": "system", "content": """あなたはRAVEN REBORNというローグライクデッキビルダーゲームのカードデザイナーです。
ユーザーの要望に基づいて新しいカードをJSON形式で設計してください。

既存カードタイプ: 武器、杖、罠、巻物、道具、財宝、勝利点
ティア: 0(基本), 1(安い), 2(中), 3(高い), 4(レア), 5(伝説)

必ず以下のJSON形式で出力:
{
  "id": "英語ID",
  "name": "日本語名",
  "type": "カードタイプ",
  "ap": AP消費(0-2),
  "noise": ノイズ(0-5),
  "xpCost": XPコスト(1-13),
  "desc": "効果説明",
  "tier": ティア(1-5),
  "stock": 在庫数(1-12),
  "art_prompt": "英語のSDXLプロンプト(dark fantasy RPG item illustration, centered, dark background)"
}

効果プロパティ例: power(攻撃力), range(射程), healPower(回復), draw(ドロー), trapDmg(罠ダメ), etc.
バランスに注意: ティアが高いほど強力だがXPコストも高い。"""},
                    {"role": "user", "content": prompt}],
                "stream": False
            }).encode()
            req = urllib.request.Request(f"{url}/api/chat", data=data,
                headers={"Content-Type": "application/json"})
            resp = urllib.request.urlopen(req, timeout=120)
            result = json.loads(resp.read())
            return result["message"]["content"]
        except Exception as e:
            print(f"  Ollama {url} failed: {e}")
            continue
    return None

def extract_json(text):
    """Extract JSON from LLM response"""
    import re
    match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except:
            pass
    return None

def generate_art(prompt, card_id, comfy_url):
    """Generate card art via ComfyUI SDXL"""
    workflow = {
        "3": {"class_type": "KSampler", "inputs": {"seed": hash(card_id) % 100000, "steps": 25, "cfg": 7.0,
            "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0,
            "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]}},
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {
            "text": "text, letters, watermark, blurry, person, realistic photo, white background",
            "clip": ["4", 1]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "10": {"class_type": "ImageScale", "inputs": {"upscale_method": "lanczos",
            "width": 96, "height": 96, "crop": "center", "image": ["8", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": f"card_{card_id}", "images": ["10", 0]}}
    }
    payload = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(f"{comfy_url}/prompt", data=payload,
        headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    prompt_id = json.loads(resp.read()).get("prompt_id")

    # Wait for completion
    for _ in range(60):
        time.sleep(2)
        req = urllib.request.Request(f"{comfy_url}/history/{prompt_id}")
        resp = urllib.request.urlopen(req)
        history = json.loads(resp.read())
        if prompt_id in history:
            outputs = history[prompt_id].get("outputs", {})
            for node_id, output in outputs.items():
                if "images" in output:
                    img = output["images"][0]
                    img_url = f"{comfy_url}/view?filename={img['filename']}&subfolder={img.get('subfolder','')}&type={img['type']}"
                    return img_url
    return None

def download_image(url, path):
    """Download generated image"""
    urllib.request.urlretrieve(url, path)

def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_card.py \"カードの説明\"")
        print("Example: python generate_card.py \"tier3の氷属性の攻撃魔法カード\"")
        sys.exit(1)

    user_prompt = " ".join(sys.argv[1:])
    print(f"\n=== RAVEN REBORN AI Card Generator ===")
    print(f"リクエスト: {user_prompt}\n")

    # Step 1: LLM designs the card
    print("[1/3] LLMがカードを設計中...")
    response = ollama_chat(user_prompt)
    if not response:
        print("ERROR: LLM接続失敗")
        sys.exit(1)

    card = extract_json(response)
    if not card:
        print(f"ERROR: JSONパース失敗\nLLM応答:\n{response}")
        sys.exit(1)

    print(f"  カード名: {card.get('name')}")
    print(f"  タイプ: {card.get('type')} | ティア: {card.get('tier')}")
    print(f"  効果: {card.get('desc')}")
    print(f"  コスト: XP{card.get('xpCost')} | AP{card.get('ap')} | ノイズ{card.get('noise')}")

    # Step 2: Generate card art
    art_prompt = card.get("art_prompt", f"dark fantasy RPG item illustration, {card.get('name')}, dark background")
    print(f"\n[2/3] カードアートを生成中...")
    print(f"  プロンプト: {art_prompt[:80]}...")

    img_url = None
    for comfy_url in COMFY_URLS:
        try:
            img_url = generate_art(art_prompt, card["id"], comfy_url)
            if img_url:
                break
        except Exception as e:
            print(f"  ComfyUI {comfy_url} failed: {e}")

    if img_url:
        art_path = os.path.join(SPRITE_DIR, f"card_{card['id']}.png")
        os.makedirs(SPRITE_DIR, exist_ok=True)
        download_image(img_url, art_path)
        print(f"  保存: {art_path}")
    else:
        print("  WARNING: アート生成失敗（カードデータのみ出力）")

    # Step 3: Output card JSON for game integration
    print(f"\n[3/3] ゲーム用JSONを出力:")

    # Remove art_prompt from game data
    game_card = {k: v for k, v in card.items() if k != "art_prompt"}
    print(json.dumps(game_card, ensure_ascii=False, indent=2))

    # Save to file
    output_path = os.path.join(os.path.dirname(__file__), f"generated_card_{card['id']}.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(game_card, f, ensure_ascii=False, indent=2)
    print(f"\n保存: {output_path}")
    print(f"\n=== 完了! ===")
    print(f"ゲームに追加するには、raven_reborn.html の CARD_DEFS 配列にJSONを追加してください。")

if __name__ == "__main__":
    main()
