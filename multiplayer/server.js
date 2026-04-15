// ============================================================
// レイヴン・ポータル オンライン対戦サーバー
// Node.js 標準モジュールのみ（外部ライブラリ不要）
// ポート: 3461
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3461;
const rooms = {};

// ===== ユーティリティ =====
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function dist(x1, y1, x2, y2) { return Math.abs(x1 - x2) + Math.abs(y1 - y2); }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function genRoomCode() {
  let code;
  do { code = String(randInt(1000, 9999)); } while (rooms[code]);
  return code;
}

// ===== 定数 =====
const MAP_W = 25, MAP_H = 25, VIEWPORT = 13, VP_WIN = 30;
const TILE_FLOOR = 0, TILE_WALL = 1, TILE_BOSS_FLOOR = 8;
const HAND_SIZE = 5, BASE_MP = 3;
const MOB_CAP = 25; // モブ上限引き上げ
const FOG_VISION_RANGE = 2; // フォグ・オブ・ウォー視界範囲

// マップ縮小スケジュール
const SHRINK_SCHEDULE = [
  { turn: 10, layer: 1 }, // 最外周1マス → 23x23
  { turn: 15, layer: 2 }, // さらに1マス → 21x21
  { turn: 20, layer: 3 }, // さらに1マス → 19x19
  { turn: 25, layer: 4 }, // さらに1マス → 17x17
];

// WAVEスポーン設定
function getWaveInfo(turnNumber) {
  if (turnNumber <= 8) return { wave: 1, interval: 3, count: 2 };
  if (turnNumber <= 15) return { wave: 2, interval: 2, count: 3 };
  if (turnNumber <= 22) return { wave: 3, interval: 1, count: 3 };
  return { wave: 4, interval: 1, count: 4 };
}

// ===== カード定義 =====
const CONST_SUPPLY = [
  { id: 'mura', name: '村', type: '道具', ap: 0, noise: 1, xpCost: 3, desc: 'AP+2、ドロー+1', apGain: 2, draw: 1, stock: 6, tier: 0, constant: true },
  { id: 'yashiki', name: '屋敷', type: '勝利点', ap: 99, noise: 0, xpCost: 2, desc: '1VP', vpValue: 1, stock: 8, tier: 0, isVP: true, constant: true },
  { id: 'kouryou', name: '公領', type: '勝利点', ap: 99, noise: 0, xpCost: 4, desc: '3VP', vpValue: 3, stock: 8, tier: 0, isVP: true, constant: true },
  { id: 'zoushou', name: '属州', type: '勝利点', ap: 99, noise: 0, xpCost: 7, desc: '6VP', vpValue: 6, stock: 8, tier: 0, isVP: true, constant: true },
  { id: 'seinomi', name: '生命の実', type: 'HP強化', ap: 99, noise: 0, xpCost: 3, desc: '最大HP+1（即HP全回復）', hpUp: 1, stock: 6, tier: 0, isHP: true, constant: true },
];

const ALL_RANDOM_CARDS = [
  { id: 'shunsoku', name: '俊足の薬', type: '道具', ap: 1, noise: 0, xpCost: 2, desc: '今ターンのMP+3', mpGain: 3, stock: 6, tier: 1 },
  { id: 'kogatana', name: '小刀', type: '武器', ap: 1, noise: 2, xpCost: 1, desc: '攻撃2、射程1', power: 2, range: 1, stock: 10, tier: 1 },
  { id: 'kinotsue', name: '木の杖', type: '杖', ap: 1, noise: 1, xpCost: 2, desc: '直線1ダメ、射程4、壁で停止', power: 1, range: 4, isStaff: true, stock: 6, tier: 1 },
  { id: 'miharashi', name: '見張り台', type: '道具', ap: 1, noise: 0, xpCost: 1, desc: 'ソナーピン（1回方向ヒント）', sonar: true, stock: 6, tier: 1 },
  { id: 'gabyou', name: '画鋲', type: '罠', ap: 1, noise: 0, xpCost: 1, desc: '罠設置:1ダメ+ノイズ爆発', trapDmg: 1, trapNoise: 3, stock: 8, tier: 1 },
  { id: 'douka', name: '銅貨', type: '道具', ap: 0, noise: 0, xpCost: 1, desc: 'XP+1', xpGain: 1, stock: 10, tier: 1 },
  { id: 'yakusou', name: '薬草', type: '道具', ap: 1, noise: 0, xpCost: 1, desc: 'HP+2回復', healPower: 2, stock: 8, tier: 1 },
  { id: 'shuuchuu', name: '集中', type: '道具', ap: 0, noise: 0, xpCost: 2, desc: 'AP+2', apGain: 2, stock: 6, tier: 1 },
  { id: 'teisatsu', name: '偵察', type: '巻物', ap: 1, noise: 1, xpCost: 2, desc: '周囲3マス可視化(2T)', recon: 3, reconTurns: 2, stock: 6, tier: 1 },
  { id: 'kajiya', name: '鍛冶屋', type: '道具', ap: 1, noise: 0, xpCost: 4, desc: 'ドロー+3', draw: 3, stock: 5, tier: 2 },
  { id: 'reihaido', name: '礼拝堂', type: '道具', ap: 1, noise: 0, xpCost: 3, desc: '手札から最大2枚除外', trash: 2, stock: 4, tier: 2 },
  { id: 'majo', name: '魔女', type: '巻物', ap: 1, noise: 2, xpCost: 5, desc: '全敵に呪い追加', curse: true, stock: 4, tier: 2 },
  { id: 'minpei', name: '民兵', type: '巻物', ap: 1, noise: 2, xpCost: 4, desc: '全敵次ターン手札上限3枚', militia: true, stock: 4, tier: 2 },
  { id: 'dorobou', name: '泥棒', type: '巻物', ap: 1, noise: 2, xpCost: 4, desc: '直線射程3、敵デッキ2枚公開→1枚奪取', thief: true, range: 3, stock: 4, tier: 2 },
  { id: 'kaichiku', name: '改築', type: '道具', ap: 1, noise: 0, xpCost: 4, desc: '手札1枚除外→XP+2以下獲得', remodel: true, stock: 4, tier: 2 },
  { id: 'tetsuyari', name: '鉄の槍', type: '武器', ap: 1, noise: 2, xpCost: 3, desc: '攻撃3、射程1', power: 3, range: 1, stock: 6, tier: 2 },
  { id: 'togenowana', name: 'とげの罠', type: '罠', ap: 1, noise: 0, xpCost: 3, desc: '罠設置:2ダメ+1T移動不可', trapDmg: 2, trapFreeze: 1, stock: 5, tier: 2 },
  { id: 'shounin', name: '商人', type: '道具', ap: 0, noise: 0, xpCost: 4, desc: '購入+1、ドロー+1', buyPlus: 1, draw: 1, stock: 5, tier: 2 },
  { id: 'koorinotsue', name: '氷の杖', type: '杖', ap: 1, noise: 2, xpCost: 5, desc: '直線射撃、2Tフリーズ', power: 1, range: 5, isStaff: true, freeze: 2, stock: 4, tier: 2 },
  { id: 'jirai', name: '地雷', type: '罠', ap: 1, noise: 0, xpCost: 6, desc: '罠設置:4ダメ+周囲1マス2ダメ', trapDmg: 4, trapAoe: 2, stock: 3, tier: 3 },
  { id: 'daichinomakimono', name: '大地の巻物', type: '巻物', ap: 1, noise: 4, xpCost: 6, desc: '指定3x3範囲に2ダメ', earthquake: true, eqDmg: 2, stock: 3, tier: 3 },
  { id: 'teien', name: '庭園', type: '道具', ap: 99, noise: 0, xpCost: 6, desc: 'デッキ5枚ごとに1VP', garden: true, stock: 4, tier: 3, isVP: true },
  // Tier4 (XP7-8) stock:3
  { id: 'honoonotsue', name: '炎の杖', type: '杖', ap: 1, noise: 3, xpCost: 7, desc: '直線射程5+着弾点周囲1ダメ', power: 2, range: 5, isStaff: true, staffAoe: 1, stock: 3, tier: 4 },
  { id: 'zenchinome', name: '全知の目', type: '巻物', ap: 1, noise: 0, xpCost: 7, desc: 'マップ全体3T可視化', fullVision: 3, stock: 3, tier: 4 },
  { id: 'kikan', name: '帰還の巻物', type: '巻物', ap: 1, noise: 5, xpCost: 7, desc: '自陣にテレポート(旗持ち中不可)', returnHome: true, stock: 3, tier: 4 },
  { id: 'shinotoiki', name: '死の吐息', type: '巻物', ap: 1, noise: 4, xpCost: 7, desc: '周囲2マス全てに2ダメ', deathBreath: true, deathBreathDmg: 2, deathBreathRange: 2, stock: 3, tier: 4 },
  { id: 'ougonnohai', name: '黄金の杯', type: '道具', ap: 1, noise: 0, xpCost: 8, desc: 'AP+2、ドロー+2、XP+2', apGain: 2, draw: 2, xpGain: 2, stock: 3, tier: 4 },
  { id: 'shinigaminokama', name: '死神の鎌', type: '武器', ap: 1, noise: 4, xpCost: 8, desc: '攻撃5+射程2+周囲1ダメ', power: 5, range: 2, aoeDmg: 1, stock: 3, tier: 4 },
  { id: 'inseki', name: '隕石の巻物', type: '巻物', ap: 1, noise: 5, xpCost: 8, desc: 'ランダム3箇所に3x3で3ダメ', meteor: true, meteorDmg: 3, meteorCount: 3, stock: 3, tier: 4 },
  // Tier5 伝説 (XP9-10) stock:1
  { id: 'tenbatsu', name: '天罰の雷', type: '巻物', ap: 2, noise: 5, xpCost: 9, desc: '全マップの全敵に3ダメージ', divineStrike: true, divineStrikeDmg: 3, stock: 1, tier: 5 },
  { id: 'tokinosuna', name: '時の砂時計', type: '道具', ap: 0, noise: 0, xpCost: 10, desc: '追加ターン獲得', extraTurn: true, stock: 1, tier: 5 },
  { id: 'ryuumyaku', name: '龍脈の杖', type: '杖', ap: 1, noise: 4, xpCost: 10, desc: '指定直線の全マスに4ダメ（貫通）', power: 4, range: 99, isStaff: true, dragonVein: true, stock: 1, tier: 5 },
  { id: 'kyomunomon', name: '虚無の門', type: '巻物', ap: 1, noise: 5, xpCost: 9, desc: '全モブ即死+ボスに5ダメ', voidGate: true, voidGateDmg: 5, stock: 1, tier: 5 },
  { id: 'eiyuunoshou', name: '英雄の証', type: '道具', ap: 0, noise: 0, xpCost: 10, desc: '即座に5VP獲得（使用後除外）', instantVP: 5, stock: 1, tier: 5 },
];

const MOB_DEFS = [
  { name: '影蟲', icon: '蟲', rank: 'E', hp: 1, atk: 1, xp: 1 },
  { name: '闇鼠', icon: '鼠', rank: 'E', hp: 1, atk: 1, xp: 1 },
  { name: '骸蝙蝠', icon: '蝙', rank: 'D', hp: 2, atk: 1, xp: 2 },
  { name: '毒蛙', icon: '蛙', rank: 'D', hp: 2, atk: 1, xp: 2 },
  { name: '幽霊蜘蛛', icon: '蛛', rank: 'C', hp: 3, atk: 1, xp: 3 },
  { name: '腐食蛇', icon: '蛇', rank: 'C', hp: 3, atk: 2, xp: 3 },
  { name: '呪いの目', icon: '目', rank: 'B', hp: 4, atk: 2, xp: 4 },
  { name: '灰狼', icon: '狼', rank: 'B', hp: 5, atk: 2, xp: 5 },
];

// ===== カテゴリ判定 =====
function isAPCard(c) { return c.id === 'shuuchuu' || c.id === 'mura' || c.id === 'ougonnohai'; }
function isMoveCard(c) { return !!c.mpGain; }
function isAttackCard(c) { return !!c.power || !!c.trapDmg || !!c.earthquake || !!c.curse || !!c.lightning || !!c.scytheAoe || !!c.deathBreath || !!c.meteor || !!c.divineStrike || !!c.voidGate; }

// ===== マップ生成 =====
function generateMap() {
  const map = [];
  const rms = [];
  for (let y = 0; y < MAP_H; y++) { map[y] = []; for (let x = 0; x < MAP_W; x++) map[y][x] = TILE_WALL; }
  const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
  const bossW = 6, bossH = 6, bx = cx - 3, by = cy - 3;
  const bossRoom = { x: bx, y: by, w: bossW, h: bossH, cx, cy, isBoss: true };
  rms.push(bossRoom);
  for (let dy = 0; dy < bossH; dy++) for (let dx = 0; dx < bossW; dx++) {
    if (by + dy >= 0 && by + dy < MAP_H && bx + dx >= 0 && bx + dx < MAP_W) map[by + dy][bx + dx] = TILE_BOSS_FLOOR;
  }
  const numSurr = randInt(4, 5);
  const radius = 9;
  const angleOff = Math.random() * Math.PI * 2;
  for (let i = 0; i < numSurr; i++) {
    const angle = angleOff + (Math.PI * 2 * i / numSurr);
    const rcx = Math.round(cx + radius * Math.cos(angle));
    const rcy = Math.round(cy + radius * Math.sin(angle));
    const rw = randInt(5, 7), rh = randInt(5, 7);
    const rx = Math.max(1, Math.min(MAP_W - rw - 1, rcx - Math.floor(rw / 2)));
    const ry = Math.max(1, Math.min(MAP_H - rh - 1, rcy - Math.floor(rh / 2)));
    const room = { x: rx, y: ry, w: rw, h: rh, cx: Math.floor(rx + rw / 2), cy: Math.floor(ry + rh / 2) };
    rms.push(room);
    for (let dy = 0; dy < rh; dy++) for (let dx = 0; dx < rw; dx++) {
      if (ry + dy >= 0 && ry + dy < MAP_H && rx + dx >= 0 && rx + dx < MAP_W) map[ry + dy][rx + dx] = TILE_FLOOR;
    }
  }
  function carveCorrH(y, x1, x2) {
    const mn = Math.min(x1, x2), mx = Math.max(x1, x2);
    for (let x = mn; x <= mx; x++) for (let dy = 0; dy < 2; dy++) {
      const yy = y + dy; if (yy >= 0 && yy < MAP_H && x >= 0 && x < MAP_W && map[yy][x] === TILE_WALL) map[yy][x] = TILE_FLOOR;
    }
  }
  function carveCorrV(x, y1, y2) {
    const mn = Math.min(y1, y2), mx = Math.max(y1, y2);
    for (let y = mn; y <= mx; y++) for (let dx = 0; dx < 2; dx++) {
      const xx = x + dx; if (y >= 0 && y < MAP_H && xx >= 0 && xx < MAP_W && map[y][xx] === TILE_WALL) map[y][xx] = TILE_FLOOR;
    }
  }
  function connectWide(a, b) {
    if (Math.random() > 0.5) { carveCorrH(a.cy, a.cx, b.cx); carveCorrV(b.cx, a.cy, b.cy); }
    else { carveCorrV(a.cx, a.cy, b.cy); carveCorrH(b.cy, a.cx, b.cx); }
  }
  for (let i = 1; i < rms.length; i++) {
    const next = (i + 1 < rms.length) ? i + 1 : 1;
    connectWide(rms[i], rms[next]);
    connectWide(rms[i], rms[0]);
  }
  // Ensure connectivity
  function bfs(sx, sy) {
    const vis = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
    const q = [{ x: sx, y: sy }]; vis[sy][sx] = true;
    while (q.length) {
      const { x, y } = q.shift();
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && !vis[ny][nx] && map[ny][nx] !== TILE_WALL) { vis[ny][nx] = true; q.push({ x: nx, y: ny }); }
      }
    }
    return vis;
  }
  let tries = 0;
  while (tries < 200) {
    const vis = bfs(rms[1].cx, rms[1].cy);
    if (vis[rms[0].cy] && vis[rms[0].cy][rms[0].cx]) break;
    let carved = false;
    for (let y = 1; y < MAP_H - 1 && !carved; y++) for (let x = 1; x < MAP_W - 1 && !carved; x++) {
      if (vis[y][x] && map[y][x] !== TILE_WALL) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = x + dx, ny = y + dy;
          if (nx > 0 && nx < MAP_W - 1 && ny > 0 && ny < MAP_H - 1 && map[ny][nx] === TILE_WALL) { map[ny][nx] = TILE_FLOOR; carved = true; break; }
        }
      }
    }
    tries++;
  }
  const surr = rms.slice(1);
  const half = Math.floor(surr.length / 2);
  const p1Start = { x: surr[0].cx, y: surr[0].cy };
  const p2Start = { x: surr[half].cx, y: surr[half].cy };
  map[p1Start.y][p1Start.x] = TILE_FLOOR;
  map[p2Start.y][p2Start.x] = TILE_FLOOR;
  return { map, rooms: rms, p1Start, p2Start };
}

// ===== サプライ生成 =====
function generateSupply() {
  const constSup = CONST_SUPPLY.map(c => ({ ...c, remaining: c.stock }));
  let pool = [...ALL_RANDOM_CARDS];
  let chosen = [];
  function pickOneFrom(filterFn) {
    const candidates = pool.filter(filterFn);
    if (candidates.length === 0) return;
    const c = candidates[randInt(0, candidates.length - 1)];
    pool = pool.filter(p => p.id !== c.id);
    chosen.push(c);
  }
  pickOneFrom(isAPCard);
  pickOneFrom(isMoveCard);
  pickOneFrom(isAttackCard);
  shuffle(pool);
  while (chosen.length < 10 && pool.length > 0) chosen.push(pool.shift());
  const randSup = chosen.map(c => ({ ...c, remaining: c.stock }));
  randSup.sort((a, b) => a.tier - b.tier || a.xpCost - b.xpCost);
  return { constSupply: constSup, randomSupply: randSup };
}

// ===== 初期デッキ =====
function makeInitialDeck() {
  return [
    { id: 'kogatana', name: '小刀', type: '武器', ap: 1, noise: 2, desc: '攻撃2、射程1', power: 2, range: 1, starter: true },
    { id: 'douka', name: '銅貨', type: '道具', ap: 0, noise: 0, desc: 'XP+1', xpGain: 1, starter: true },
    { id: 'shuuchuu', name: '集中', type: '道具', ap: 0, noise: 0, desc: 'AP+2', apGain: 2, starter: true },
  ].map(c => ({ ...c, uid: uid() }));
}

// ===== プレイヤー初期化 =====
function makePlayer(startPos) {
  const p = {
    x: startPos.x, y: startPos.y,
    startX: startPos.x, startY: startPos.y,
    hp: 1, maxHp: 1, xp: 0,
    deck: [], hand: [], discard: [],
    ap: 1, buys: 1, noise: 0, turnNoise: 0,
    mp: BASE_MP,
    hasFlag: false, alive: true,
    kills: 0, flagVP: 0, bossKill: 0,
    cardsPlayedThisTurn: 0,
    stealthTurns: 0, frozenTurns: 0,
    reconTurns: 0, reconRadius: 0,
    fullVisionTurns: 0,
    handLimit: HAND_SIZE,
    nextNoiseZero: false,
    explored: {}, // フォグ・オブ・ウォー: 探索済みマス {key: true}
  };
  p.deck = makeInitialDeck();
  shuffle(p.deck);
  return p;
}

// 探索済みマスを更新（視界範囲内のマスをexploredに追加）
function updateExplored(room, player) {
  const px = player.x, py = player.y;
  for (let dy = -FOG_VISION_RANGE; dy <= FOG_VISION_RANGE; dy++) {
    for (let dx = -FOG_VISION_RANGE; dx <= FOG_VISION_RANGE; dx++) {
      const mx = px + dx, my = py + dy;
      if (mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H) continue;
      if (Math.abs(dx) + Math.abs(dy) <= FOG_VISION_RANGE) {
        // LOS check for fog vision
        if (hasLOS(room.map, px, py, mx, my)) {
          player.explored[my * MAP_W + mx] = true;
        }
      }
    }
  }
}

// ===== デッキ操作 =====
function drawCards(entity, count) {
  for (let i = 0; i < count; i++) {
    if (entity.deck.length === 0) {
      if (entity.discard.length === 0) break;
      entity.deck = shuffle([...entity.discard]);
      entity.discard = [];
    }
    if (entity.deck.length === 0) break;
    entity.hand.push(entity.deck.pop());
  }
}

function getAllCards(entity) { return [...entity.deck, ...entity.hand, ...entity.discard]; }

function calcVP(entity) {
  let vp = 0;
  const allCards = getAllCards(entity);
  for (const c of allCards) {
    if (c.vpValue) vp += c.vpValue;
    if (c.garden) vp += Math.floor(allCards.length / 5);
    if (c.id === 'noroi') vp -= 1;
  }
  vp += entity.flagVP;
  vp += entity.kills * 3;
  vp += entity.bossKill * 5;
  return vp;
}

// ===== LOS =====
function hasLOS(map, x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy, cx = x1, cy = y1;
  while (true) {
    if (cx === x2 && cy === y2) return true;
    if (map[cy] && map[cy][cx] === TILE_WALL && !(cx === x1 && cy === y1)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 < dx) { err += dx; cy += sy; }
  }
}

function isVisible(map, px, py, mx, my, reconTurns, reconRadius, fullVisionTurns) {
  if (fullVisionTurns > 0) return true;
  if (reconTurns > 0 && dist(px, py, mx, my) <= reconRadius) return true;
  if (dist(px, py, mx, my) <= 6 && hasLOS(map, px, py, mx, my)) return true;
  return false;
}

// フォグ・オブ・ウォー: 現在の視界範囲内かどうか
function isInFogVision(map, px, py, mx, my, reconTurns, reconRadius, fullVisionTurns) {
  if (fullVisionTurns > 0) return true;
  if (reconTurns > 0 && dist(px, py, mx, my) <= reconRadius) return true;
  if (dist(px, py, mx, my) <= FOG_VISION_RANGE && hasLOS(map, px, py, mx, my)) return true;
  return false;
}

function isWalkable(map, x, y) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return false;
  return map[y][x] !== TILE_WALL;
}

// ===== パスファインディング =====
function findPath(map, sx, sy, tx, ty, room) {
  if (!isWalkable(map, tx, ty)) return null;
  const key = (x, y) => y * MAP_W + x;
  const open = [{ x: sx, y: sy, g: 0, h: dist(sx, sy, tx, ty), f: dist(sx, sy, tx, ty), parent: null }];
  const closed = new Set();
  const best = new Map();
  best.set(key(sx, sy), 0);
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const c = open.shift();
    if (c.x === tx && c.y === ty) {
      const path = []; let n = c; while (n) { path.unshift({ x: n.x, y: n.y }); n = n.parent; } return path;
    }
    closed.add(key(c.x, c.y));
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (!isWalkable(map, nx, ny) || closed.has(key(nx, ny))) continue;
      const ng = c.g + 1;
      const k = key(nx, ny);
      if (!best.has(k) || ng < best.get(k)) {
        best.set(k, ng);
        open.push({ x: nx, y: ny, g: ng, h: dist(nx, ny, tx, ty), f: ng + dist(nx, ny, tx, ty), parent: c });
      }
    }
  }
  return null;
}

function isOccupied(room, x, y, exclude) {
  for (let pi = 0; pi < room.players.length; pi++) {
    const p = room.players[pi];
    if (p !== exclude && p.alive && p.x === x && p.y === y) return true;
  }
  if (room.boss && room.boss.alive && room.boss.x === x && room.boss.y === y) return true;
  if (room.mobs.some(m => m.alive && m.x === x && m.y === y)) return true;
  return false;
}

// ===== ノイズ =====
function emitNoise(entity, amount) {
  if (entity.nextNoiseZero) { amount = 0; entity.nextNoiseZero = false; }
  entity.turnNoise += amount;
}

function getNoiseLevel(distance) {
  if (distance <= 2) return '大';
  if (distance <= 5) return '中';
  if (distance <= 10) return '小';
  return null;
}

// ===== トラップ =====
function placeTrap(room, owner, ownerIdx, x, y, dmg, noise, freeze, aoe, type) {
  room.traps.push({ x, y, ownerIdx, dmg: dmg || 1, noise: noise || 0, freeze: freeze || 0, aoe: aoe || 0, type: type || '画鋲' });
}

function checkTraps(room, entity, entityIdx) {
  for (let i = room.traps.length - 1; i >= 0; i--) {
    const t = room.traps[i];
    if (t.x === entity.x && t.y === entity.y && t.ownerIdx !== entityIdx) {
      entity.hp -= t.dmg;
      room.logs.push(`${entityIdx === 0 ? 'P1' : entityIdx === 1 ? 'P2' : entity.name}が${t.type}を踏んだ! ${t.dmg}ダメ!`);
      if (t.noise > 0) emitNoise(entity, t.noise);
      if (t.freeze > 0) entity.frozenTurns = Math.max(entity.frozenTurns || 0, t.freeze);
      if (t.aoe > 0) {
        for (let pi = 0; pi < room.players.length; pi++) {
          const e = room.players[pi];
          if (e === entity || !e.alive) continue;
          if (dist(e.x, e.y, t.x, t.y) <= 1) { e.hp -= t.aoe; room.logs.push(`爆風: P${pi + 1}に${t.aoe}ダメ!`); }
        }
        for (const m of room.mobs) {
          if (!m.alive) continue;
          if (dist(m.x, m.y, t.x, t.y) <= 1) { m.hp -= t.aoe; if (m.hp <= 0) m.alive = false; }
        }
      }
      room.traps.splice(i, 1);
      if (entity.hp <= 0) handleDeath(room, entity, entityIdx);
      break;
    }
  }
}

// ===== 死亡・リスポーン =====
function handleDeath(room, entity, entityIdx) {
  entity.alive = false;
  if (entity.hasFlag) {
    entity.hasFlag = false;
    room.flagPos = { x: entity.x, y: entity.y };
    room.logs.push(`P${entityIdx + 1}が倒れた! 旗がドロップ!`);
  } else {
    room.logs.push(`P${entityIdx + 1}が倒れた!`);
  }
  // Immediate respawn
  entity.alive = true;
  entity.hp = entity.maxHp;
  entity.x = entity.startX;
  entity.y = entity.startY;
  entity.stealthTurns = 0;
  entity.frozenTurns = 0;
  room.logs.push(`P${entityIdx + 1}がリスポーン!`);
}

// ===== マップ縮小 =====
function shrinkMap(room, layer) {
  // 外周layerマス分を壁に変換
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x < layer || x >= MAP_W - layer || y < layer || y >= MAP_H - layer) {
        if (room.map[y][x] !== TILE_WALL) {
          room.map[y][x] = TILE_WALL;
        }
      }
    }
  }
  // 壁になったマスにプレイヤー/モブがいたら内側に押し出す
  for (const p of room.players) {
    if (!p.alive) continue;
    if (room.map[p.y][p.x] === TILE_WALL) {
      pushEntityInward(room, p, layer);
    }
  }
  for (const m of room.mobs) {
    if (!m.alive) continue;
    if (room.map[m.y][m.x] === TILE_WALL) {
      pushEntityInward(room, m, layer);
    }
  }
  if (room.boss && room.boss.alive && room.map[room.boss.y][room.boss.x] === TILE_WALL) {
    pushEntityInward(room, room.boss, layer);
  }
  // 旗も押し出す
  if (room.flagPos && room.map[room.flagPos.y] && room.map[room.flagPos.y][room.flagPos.x] === TILE_WALL) {
    const center = Math.floor(MAP_W / 2);
    for (let r = 0; r < MAP_W; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = center + dx, ny = center + dy;
          if (nx >= 0 && nx < MAP_W && ny >= 0 && ny < MAP_H && room.map[ny][nx] !== TILE_WALL) {
            room.flagPos = { x: nx, y: ny };
            return;
          }
        }
      }
    }
  }
}

function pushEntityInward(room, entity, layer) {
  // BFS from entity position to find nearest walkable tile
  const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
  let bestDist = 999, bestX = cx, bestY = cy;
  for (let y = layer; y < MAP_H - layer; y++) {
    for (let x = layer; x < MAP_W - layer; x++) {
      if (room.map[y][x] !== TILE_WALL) {
        const d = dist(entity.x, entity.y, x, y);
        if (d < bestDist) {
          bestDist = d;
          bestX = x;
          bestY = y;
        }
      }
    }
  }
  entity.x = bestX;
  entity.y = bestY;
}

// ===== モブ =====
function spawnInitialMobs(room) {
  room.mobs = [];
  for (let i = 0; i < 5; i++) spawnOneMob(room);
}

function spawnOneMob(room) {
  if (room.mobs.filter(m => m.alive).length >= MOB_CAP) return;
  let def;
  // 後半ほど強いモブが出る（WAVE対応）
  const t = room.turnNumber;
  if (t <= 8) def = MOB_DEFS[randInt(0, 3)];
  else if (t <= 15) def = MOB_DEFS[randInt(1, 5)];
  else if (t <= 22) def = MOB_DEFS[randInt(2, 6)];
  else def = MOB_DEFS[randInt(4, 7)];
  for (let att = 0; att < 200; att++) {
    const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
    if (room.map[y][x] !== TILE_WALL) {
      let tooClose = false;
      for (const p of room.players) { if (dist(x, y, p.x, p.y) <= 5) tooClose = true; }
      if (!tooClose && !room.mobs.some(m => m.alive && m.x === x && m.y === y)) {
        room.mobs.push({ x, y, hp: def.hp, maxHp: def.hp, name: def.name, icon: def.icon, rank: def.rank, atk: def.atk, xpReward: def.xp, alive: true });
        return;
      }
    }
  }
}

function mobsTurn(room) {
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const m of room.mobs) {
    if (!m.alive) continue;
    if (Math.random() < 0.4) continue;
    // Find nearest player
    let nearestP = null, nearestDist = 999;
    for (let pi = 0; pi < room.players.length; pi++) {
      const p = room.players[pi];
      if (!p.alive) continue;
      const d = dist(m.x, m.y, p.x, p.y);
      if (d < nearestDist) { nearestDist = d; nearestP = pi; }
    }
    if (nearestDist <= 4 && nearestP !== null) {
      const p = room.players[nearestP];
      const path = findPath(room.map, m.x, m.y, p.x, p.y, room);
      if (path && path.length > 1) {
        const n = path[1];
        if (isWalkable(room.map, n.x, n.y) && !isOccupied(room, n.x, n.y, m) && !room.mobs.some(m2 => m2.alive && m2 !== m && m2.x === n.x && m2.y === n.y)) {
          m.x = n.x; m.y = n.y;
        }
      }
    } else {
      const sh = shuffle([...dirs]);
      for (const [dx, dy] of sh) {
        const nx = m.x + dx, ny = m.y + dy;
        if (isWalkable(room.map, nx, ny) && !isOccupied(room, nx, ny, m) && !room.mobs.some(m2 => m2.alive && m2 !== m && m2.x === nx && m2.y === ny)) {
          m.x = nx; m.y = ny; break;
        }
      }
    }
    // Attack adjacent players
    for (let pi = 0; pi < room.players.length; pi++) {
      const p = room.players[pi];
      if (p.alive && dist(m.x, m.y, p.x, p.y) <= 1) {
        p.hp -= m.atk;
        room.logs.push(`${m.name}がP${pi + 1}に${m.atk}ダメージ!`);
        if (p.hp <= 0) handleDeath(room, p, pi);
      }
    }
  }
  // Boss behavior
  if (room.boss && room.boss.alive) {
    let nearestP = null, nearestDist = 999;
    for (let pi = 0; pi < room.players.length; pi++) {
      const p = room.players[pi];
      if (!p.alive) continue;
      const d = dist(room.boss.x, room.boss.y, p.x, p.y);
      if (d < nearestDist) { nearestDist = d; nearestP = pi; }
    }
    if (nearestP !== null) {
      const p = room.players[nearestP];
      const path = findPath(room.map, room.boss.x, room.boss.y, p.x, p.y, room);
      if (path && path.length > 1) {
        const n = path[1];
        if (isWalkable(room.map, n.x, n.y) && !room.mobs.some(m => m.alive && m.x === n.x && m.y === n.y)) {
          room.boss.x = n.x; room.boss.y = n.y;
        }
      }
    }
    for (let pi = 0; pi < room.players.length; pi++) {
      const p = room.players[pi];
      if (p.alive && dist(room.boss.x, room.boss.y, p.x, p.y) <= 1) {
        p.hp -= room.boss.atk;
        room.logs.push(`ボスがP${pi + 1}に${room.boss.atk}ダメージ!`);
        if (p.hp <= 0) handleDeath(room, p, pi);
      }
    }
  }

  // WAVEベースのモブスポーン
  const waveInfo = getWaveInfo(room.turnNumber);
  if (room.turnNumber % waveInfo.interval === 0) {
    for (let i = 0; i < waveInfo.count; i++) {
      spawnOneMob(room);
    }
  }
}

// ===== ゲーム部屋作成 =====
function createRoom() {
  const code = genRoomCode();
  const { map, rooms: rms, p1Start, p2Start } = generateMap();
  const { constSupply, randomSupply } = generateSupply();
  const room = {
    code,
    map,
    rooms: rms,
    p1Start, p2Start,
    constSupply,
    randomSupply,
    players: [],
    playerTokens: [],
    turnNumber: 1,
    currentTurn: 0, // 0 = P1, 1 = P2
    phase: 'waiting', // 'waiting', 'playing', 'over'
    flagPos: { x: rms[0].cx, y: rms[0].cy },
    mobs: [],
    boss: { x: rms[0].cx, y: rms[0].cy + 1, hp: 8, maxHp: 8, atk: 3, alive: true, name: '深淵の守護者' },
    traps: [],
    logs: [],
    logIndex: 0,
    winner: null,
    stateVersion: 0,
    pendingTarget: null, // {type:'staff'|'earthquake', card, playerIdx}
    shrinkLevel: 0, // 現在の縮小レベル
    lastShrinkEvent: 0, // 最後に縮小したターン
    createdAt: Date.now(),
    lastActivity: Date.now(),
    turnDeadline: 0, // ターンタイマー期限
    endedAt: 0, // ゲーム終了時刻
  };
  rooms[code] = room;
  return room;
}

function joinRoom(room) {
  let startPos;
  if (room.players.length === 0) startPos = room.p1Start;
  else startPos = room.p2Start;
  const p = makePlayer(startPos);
  const idx = room.players.length;
  room.players.push(p);
  const token = uid();
  room.playerTokens.push(token);
  return { token, playerIndex: idx };
}

function startGame(room) {
  room.phase = 'playing';
  room.currentTurn = 0;
  room.turnNumber = 1;
  room.turnDeadline = Date.now() + 60000;
  room.lastActivity = Date.now();
  // Draw initial hands
  for (const p of room.players) {
    drawCards(p, HAND_SIZE);
    // 初期位置を探索済みにする
    updateExplored(room, p);
  }
  spawnInitialMobs(room);
  room.logs.push('ゲーム開始! P1のターン');
  room.logs.push(`サプライ: ${room.randomSupply.map(c => c.name).join(', ')}`);
  room.stateVersion++;
}

// ===== ターン管理 =====
function startNextTurn(room) {
  // Switch turn
  room.currentTurn = 1 - room.currentTurn;
  if (room.currentTurn === 0) {
    // New round: mob turn between rounds
    mobsTurn(room);
    room.turnNumber++;

    // マップ縮小チェック
    for (const sched of SHRINK_SCHEDULE) {
      if (room.turnNumber === sched.turn && room.shrinkLevel < sched.layer) {
        room.shrinkLevel = sched.layer;
        room.lastShrinkEvent = room.turnNumber;
        shrinkMap(room, sched.layer);
        const effectiveSize = MAP_W - sched.layer * 2;
        room.logs.push(`--- マップ縮小! (${effectiveSize}x${effectiveSize}) ---`);
      }
    }
  }
  const p = room.players[room.currentTurn];
  // Reset turn state
  p.ap = 1;
  p.buys = 1;
  p.mp = BASE_MP;
  p.turnNoise = 0;
  p.cardsPlayedThisTurn = 0;
  p.nextNoiseZero = false;
  if (p.frozenTurns > 0) p.frozenTurns--;
  if (p.stealthTurns > 0) p.stealthTurns--;
  if (p.reconTurns > 0) p.reconTurns--;
  if (p.fullVisionTurns > 0) p.fullVisionTurns--;
  // Discard previous hand
  p.discard.push(...p.hand);
  p.hand = [];
  // Draw new hand
  drawCards(p, p.handLimit);
  p.handLimit = HAND_SIZE; // Reset militia
  room.turnDeadline = Date.now() + 60000;
  room.lastActivity = Date.now();
  room.logs.push(`ターン${room.turnNumber}: P${room.currentTurn + 1}のターン`);
  room.stateVersion++;
  checkWinCondition(room);
}

function checkWinCondition(room) {
  if (room.phase !== 'playing') return;
  for (let pi = 0; pi < room.players.length; pi++) {
    const vp = calcVP(room.players[pi]);
    if (vp >= VP_WIN) {
      room.phase = 'over';
      room.winner = pi;
      room.endedAt = Date.now();
      room.logs.push(`P${pi + 1}の勝利! (${vp}VP)`);
      room.stateVersion++;
      return;
    }
  }
}

// ===== アクション処理 =====
function processAction(room, playerIdx, action) {
  if (room.phase !== 'playing') return { ok: false, error: 'ゲームは進行中ではありません' };
  if (room.currentTurn !== playerIdx && action.type !== 'poll') return { ok: false, error: '自分のターンではありません' };
  room.lastActivity = Date.now();

  const p = room.players[playerIdx];
  const opIdx = 1 - playerIdx;
  const opponent = room.players[opIdx];

  switch (action.type) {
    case 'move': {
      if (!p.alive) return { ok: false, error: '死亡中' };
      if (p.frozenTurns > 0) return { ok: false, error: '凍結中で移動不可' };
      if (p.mp <= 0) return { ok: false, error: 'MPがありません' };
      if (room.pendingTarget) return { ok: false, error: 'ターゲット選択中' };
      const { dx, dy } = action;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return { ok: false, error: '不正な移動' };
      const nx = p.x + dx, ny = p.y + dy;
      if (!isWalkable(room.map, nx, ny)) return { ok: false, error: '壁' };
      if (isOccupied(room, nx, ny, p)) return { ok: false, error: '占有されている' };
      p.x = nx; p.y = ny; p.mp--;
      emitNoise(p, 1);
      // 探索済みマス更新
      updateExplored(room, p);
      // Flag pickup
      if (room.flagPos && room.flagPos.x === p.x && room.flagPos.y === p.y && !p.hasFlag) {
        p.hasFlag = true; room.flagPos = null;
        room.logs.push(`P${playerIdx + 1}が旗を取得!`);
      }
      // Flag delivery
      if (p.hasFlag && p.x === p.startX && p.y === p.startY) {
        p.hasFlag = false; p.flagVP += 20;
        room.flagPos = { x: room.rooms[0].cx, y: room.rooms[0].cy };
        room.logs.push(`P${playerIdx + 1}が旗を持ち帰った! VP+20!`);
      }
      checkTraps(room, p, playerIdx);
      room.stateVersion++;
      checkWinCondition(room);
      return { ok: true };
    }

    case 'playCard': {
      if (!p.alive) return { ok: false, error: '死亡中' };
      if (room.pendingTarget) return { ok: false, error: 'ターゲット選択中' };
      const { cardIndex } = action;
      if (cardIndex < 0 || cardIndex >= p.hand.length) return { ok: false, error: '不正なカード' };
      const card = p.hand[cardIndex];
      if (card.isVP || card.ap === 99 || card.id === 'noroi') return { ok: false, error: 'プレイ不可' };
      if (card.ap > 0 && p.ap < card.ap) return { ok: false, error: 'AP不足' };
      // Consume AP
      if (card.ap > 0) p.ap -= card.ap;
      p.cardsPlayedThisTurn++;
      emitNoise(p, card.noise);
      // Remove from hand
      p.hand.splice(cardIndex, 1);
      room.logs.push(`P${playerIdx + 1}: ${card.name}使用`);

      // --- 効果処理 ---
      if (card.apGain) p.ap += card.apGain;
      if (card.draw) drawCards(p, card.draw);
      if (card.buyPlus) p.buys += card.buyPlus;
      if (card.xpGain) { p.xp += card.xpGain; room.logs.push(`P${playerIdx + 1}: XP+${card.xpGain}`); }
      if (card.healPower) {
        const healed = Math.min(card.healPower, p.maxHp - p.hp);
        p.hp += healed;
        if (healed > 0) room.logs.push(`P${playerIdx + 1}: HP+${healed}回復`);
      }
      if (card.mpGain) {
        p.mp += card.mpGain;
        room.logs.push(`P${playerIdx + 1}: MP+${card.mpGain}`);
      }
      if (card.sonar) {
        const dx = opponent.x - p.x, dy = opponent.y - p.y;
        let dir = '';
        if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? '東' : '西';
        else dir = dy > 0 ? '南' : '北';
        room.logs.push(`P${playerIdx + 1}: ソナー → 敵は${dir}方向`);
      }
      if (card.recon) {
        p.reconTurns = card.reconTurns || 2;
        p.reconRadius = card.recon;
      }
      if (card.fullVision) {
        p.fullVisionTurns = card.fullVision;
      }

      // Melee weapons
      if (card.power && card.range && !card.isStaff) {
        if (card.range <= 2) {
          const targets = [];
          const allTargets = [...room.mobs.filter(m => m.alive && dist(p.x, p.y, m.x, m.y) <= card.range)];
          if (opponent.alive && dist(p.x, p.y, opponent.x, opponent.y) <= card.range) allTargets.push(opponent);
          if (room.boss && room.boss.alive && dist(p.x, p.y, room.boss.x, room.boss.y) <= card.range) allTargets.push(room.boss);
          if (card.id === 'shinigaminokama') {
            targets.push(...allTargets);
          } else {
            if (allTargets.length > 0) targets.push(allTargets[0]);
          }
          for (const t of targets) {
            t.hp -= card.power;
            const nm = t === opponent ? `P${opIdx + 1}` : t === room.boss ? 'ボス' : (t.name || '敵');
            room.logs.push(`${nm}に${card.power}ダメージ!`);
            if (card.aoeDmg) {
              for (const e2 of [...room.players, ...room.mobs]) {
                if (!e2.alive || e2 === t || e2 === p || dist(e2.x, e2.y, t.x, t.y) > 1) continue;
                e2.hp -= card.aoeDmg;
              }
            }
            if (t.hp <= 0) {
              if (t === opponent) { p.kills++; room.logs.push(`P${playerIdx + 1}がP${opIdx + 1}を撃破! VP+3`); handleDeath(room, opponent, opIdx); }
              else if (t === room.boss) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push(`ボス撃破! XP+10, VP+5`); }
              else { t.alive = false; p.xp += (t.xpReward || 1); room.logs.push(`${t.name}撃破! XP+${t.xpReward || 1}`); }
            }
          }
          if (targets.length === 0) room.logs.push('射程内に敵がいない!');
        }
      }

      // Staff - needs target
      if (card.isStaff) {
        room.pendingTarget = { type: 'staff', card, playerIdx };
        p.discard.push(card);
        room.stateVersion++;
        return { ok: true, needTarget: 'staff' };
      }

      // Traps
      if (card.trapDmg) {
        placeTrap(room, p, playerIdx, p.x, p.y, card.trapDmg, card.trapNoise || 0, card.trapFreeze || 0, card.trapAoe || 0, card.name);
        room.logs.push(`P${playerIdx + 1}: ${card.name}を設置!`);
      }

      // Chapel (trash)
      if (card.trash) {
        room.pendingTarget = { type: 'trash', card, playerIdx, max: card.trash };
        p.discard.push(card);
        room.stateVersion++;
        return { ok: true, needTarget: 'trash' };
      }

      // Remodel
      if (card.remodel) {
        room.pendingTarget = { type: 'remodel', card, playerIdx };
        p.discard.push(card);
        room.stateVersion++;
        return { ok: true, needTarget: 'remodel' };
      }

      // Witch
      if (card.curse) {
        const curseCard = { id: 'noroi', name: '呪い', type: '呪い', ap: 99, noise: 0, desc: '-1VP デッドカード', uid: uid() };
        opponent.discard.push(curseCard);
        room.logs.push(`P${opIdx + 1}に呪いカード追加!`);
      }

      // Militia
      if (card.militia) {
        opponent.handLimit = 3;
        room.logs.push(`P${opIdx + 1}の次ターン手札上限3枚!`);
      }

      // Thief
      if (card.thief) {
        if (opponent.deck.length > 0) {
          const stolen = opponent.deck.pop();
          p.discard.push({ ...stolen, uid: uid() });
          room.logs.push(`P${playerIdx + 1}がP${opIdx + 1}から${stolen.name}を奪取!`);
        }
      }

      // Earthquake - needs target
      if (card.earthquake) {
        room.pendingTarget = { type: 'earthquake', card, playerIdx };
        p.discard.push(card);
        room.stateVersion++;
        return { ok: true, needTarget: 'earthquake' };
      }

      // Return home
      if (card.returnHome) {
        if (p.hasFlag) {
          room.logs.push('旗持ち中は帰還不可!');
        } else {
          p.x = p.startX; p.y = p.startY;
          updateExplored(room, p);
          room.logs.push(`P${playerIdx + 1}が自陣にテレポート!`);
        }
      }

      // Death Breath (shinotoiki) - 2 damage to all enemies within range 2
      if (card.deathBreath) {
        const dbDmg = card.deathBreathDmg || 2;
        const dbRange = card.deathBreathRange || 2;
        room.logs.push(`P${playerIdx + 1}: 死の吐息発動!`);
        if (opponent.alive && dist(p.x, p.y, opponent.x, opponent.y) <= dbRange) {
          opponent.hp -= dbDmg;
          room.logs.push(`P${opIdx + 1}に${dbDmg}ダメージ!`);
          if (opponent.hp <= 0) { p.kills++; handleDeath(room, opponent, opIdx); }
        }
        if (room.boss && room.boss.alive && dist(p.x, p.y, room.boss.x, room.boss.y) <= dbRange) {
          room.boss.hp -= dbDmg;
          room.logs.push(`ボスに${dbDmg}ダメージ!`);
          if (room.boss.hp <= 0) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push('ボス撃破!'); }
        }
        for (const m of room.mobs) {
          if (m.alive && dist(p.x, p.y, m.x, m.y) <= dbRange) {
            m.hp -= dbDmg;
            if (m.hp <= 0) { m.alive = false; p.xp += (m.xpReward || 1); room.logs.push(`${m.name}撃破!`); }
          }
        }
      }

      // Meteor (inseki) - 3 random 3x3 zones for 3 damage each
      if (card.meteor) {
        const mDmg = card.meteorDmg || 3;
        const mCount = card.meteorCount || 3;
        room.logs.push(`P${playerIdx + 1}: 隕石落下!`);
        for (let mi = 0; mi < mCount; mi++) {
          let mx, my, attempts = 0;
          do {
            mx = randInt(1, MAP_W - 2);
            my = randInt(1, MAP_H - 2);
            attempts++;
          } while (room.map[my][mx] === TILE_WALL && attempts < 100);
          room.logs.push(`隕石${mi + 1}: (${mx},${my})に着弾!`);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const ex = mx + dx, ey = my + dy;
            if (ex < 0 || ex >= MAP_W || ey < 0 || ey >= MAP_H) continue;
            if (opponent.alive && opponent.x === ex && opponent.y === ey) {
              opponent.hp -= mDmg;
              room.logs.push(`P${opIdx + 1}に${mDmg}ダメージ!`);
              if (opponent.hp <= 0) { p.kills++; handleDeath(room, opponent, opIdx); }
            }
            if (room.boss && room.boss.alive && room.boss.x === ex && room.boss.y === ey) {
              room.boss.hp -= mDmg;
              if (room.boss.hp <= 0) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push('ボス撃破!'); }
            }
            for (const m of room.mobs) {
              if (m.alive && m.x === ex && m.y === ey) {
                m.hp -= mDmg; if (m.hp <= 0) { m.alive = false; p.xp += (m.xpReward || 1); }
              }
            }
          }
        }
      }

      // Divine Strike (tenbatsu) - 3 damage to ALL enemies on map
      if (card.divineStrike) {
        const dsDmg = card.divineStrikeDmg || 3;
        room.logs.push(`P${playerIdx + 1}: 天罰の雷!`);
        if (opponent.alive) {
          opponent.hp -= dsDmg;
          room.logs.push(`P${opIdx + 1}に${dsDmg}ダメージ!`);
          if (opponent.hp <= 0) { p.kills++; handleDeath(room, opponent, opIdx); }
        }
        if (room.boss && room.boss.alive) {
          room.boss.hp -= dsDmg;
          room.logs.push(`ボスに${dsDmg}ダメージ!`);
          if (room.boss.hp <= 0) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push('ボス撃破!'); }
        }
        for (const m of room.mobs) {
          if (m.alive) {
            m.hp -= dsDmg;
            if (m.hp <= 0) { m.alive = false; p.xp += (m.xpReward || 1); room.logs.push(`${m.name}撃破!`); }
          }
        }
      }

      // Extra Turn (tokinosuna)
      if (card.extraTurn) {
        room.logs.push(`P${playerIdx + 1}: 追加ターン獲得!`);
        p._extraTurn = true;
      }

      // Void Gate (kyomunomon) - kill all mobs + 5 damage to boss/players
      if (card.voidGate) {
        const vgDmg = card.voidGateDmg || 5;
        room.logs.push(`P${playerIdx + 1}: 虚無の門!`);
        for (const m of room.mobs) {
          if (m.alive) { m.alive = false; p.xp += (m.xpReward || 1); }
        }
        room.logs.push('全モブ消滅!');
        if (room.boss && room.boss.alive) {
          room.boss.hp -= vgDmg;
          room.logs.push(`ボスに${vgDmg}ダメージ!`);
          if (room.boss.hp <= 0) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push('ボス撃破!'); }
        }
        if (opponent.alive) {
          opponent.hp -= vgDmg;
          room.logs.push(`P${opIdx + 1}に${vgDmg}ダメージ!`);
          if (opponent.hp <= 0) { p.kills++; handleDeath(room, opponent, opIdx); }
        }
      }

      // Instant VP (eiyuunoshou) - 5 VP, card is exiled (not sent to discard)
      if (card.instantVP) {
        p.flagVP += card.instantVP;
        room.logs.push(`P${playerIdx + 1}: ${card.instantVP}VP獲得!`);
        room.stateVersion++;
        checkWinCondition(room);
        return { ok: true };
      }

      p.discard.push(card);
      room.stateVersion++;
      checkWinCondition(room);
      return { ok: true };
    }

    case 'target': {
      if (!room.pendingTarget || room.pendingTarget.playerIdx !== playerIdx) return { ok: false, error: 'ターゲット選択不要' };
      const pt = room.pendingTarget;
      if (pt.type === 'staff') {
        const { tx, ty } = action;
        const card = pt.card;
        const dx = tx - p.x, dy = ty - p.y;
        if (dx === 0 && dy === 0) return { ok: false, error: '自分の位置は選択不可' };
        let dirX = 0, dirY = 0;
        if (Math.abs(dx) >= Math.abs(dy)) dirX = dx > 0 ? 1 : -1;
        else dirY = dy > 0 ? 1 : -1;
        let cx = p.x + dirX, cy = p.y + dirY;
        const isPiercing = !!card.dragonVein;
        let hitTargets = [];
        let hitTarget = null;
        for (let i = 0; i < (card.range || 4); i++) {
          if (!isWalkable(room.map, cx, cy)) break;
          if (opponent.alive && opponent.x === cx && opponent.y === cy) {
            if (isPiercing) { hitTargets.push(opponent); } else { hitTarget = opponent; break; }
          }
          if (room.boss && room.boss.alive && room.boss.x === cx && room.boss.y === cy) {
            if (isPiercing) { hitTargets.push(room.boss); } else { hitTarget = room.boss; break; }
          }
          const mob = room.mobs.find(m => m.alive && m.x === cx && m.y === cy);
          if (mob) {
            if (isPiercing) { hitTargets.push(mob); } else { hitTarget = mob; break; }
          }
          cx += dirX; cy += dirY;
        }
        // For non-piercing, process single target
        if (!isPiercing && hitTarget) hitTargets = [hitTarget];
        if (hitTargets.length > 0) {
          for (const ht of hitTargets) {
            ht.hp -= (card.power || 1);
            const nm = ht === opponent ? `P${opIdx + 1}` : ht === room.boss ? 'ボス' : (ht.name || '敵');
            room.logs.push(`${card.name}: ${nm}に${card.power || 1}ダメージ!`);
            if (card.freeze) ht.frozenTurns = Math.max(ht.frozenTurns || 0, card.freeze);
            if (card.staffAoe) {
              const aoeTargets = [...room.players.filter(e => e !== p), ...room.mobs];
              if (room.boss && room.boss.alive) aoeTargets.push(room.boss);
              for (const e of aoeTargets) {
                if (!e.alive || e === ht || dist(e.x, e.y, ht.x, ht.y) > 1) continue;
                e.hp -= card.staffAoe;
              }
            }
            if (ht.hp <= 0) {
              if (ht === opponent) { p.kills++; handleDeath(room, opponent, opIdx); room.logs.push(`P${opIdx + 1}撃破!`); }
              else if (ht === room.boss) { room.boss.alive = false; p.xp += 10; p.bossKill++; room.logs.push('ボス撃破!'); }
              else { ht.alive = false; p.xp += (ht.xpReward || 1); }
            }
          }
        } else {
          room.logs.push(`${card.name}: 外れた!`);
        }
      } else if (pt.type === 'earthquake') {
        const { tx, ty } = action;
        const dmg = pt.card.eqDmg || 2;
        room.logs.push(`大地の巻物: (${tx},${ty})中心に攻撃!`);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const ex = tx + dx, ey = ty + dy;
          if (opponent.alive && opponent.x === ex && opponent.y === ey) {
            opponent.hp -= dmg;
            if (opponent.hp <= 0) { p.kills++; handleDeath(room, opponent, opIdx); }
          }
          if (room.boss && room.boss.alive && room.boss.x === ex && room.boss.y === ey) {
            room.boss.hp -= dmg;
            if (room.boss.hp <= 0) { room.boss.alive = false; p.xp += 10; p.bossKill++; }
          }
          for (const m of room.mobs) {
            if (m.alive && m.x === ex && m.y === ey) { m.hp -= dmg; if (m.hp <= 0) { m.alive = false; p.xp += (m.xpReward || 1); } }
          }
        }
      } else if (pt.type === 'trash') {
        const { indices } = action;
        if (!Array.isArray(indices) || indices.length > pt.max) return { ok: false, error: '不正な除外選択' };
        const sorted = [...indices].sort((a, b) => b - a);
        for (const i of sorted) {
          if (i >= 0 && i < p.hand.length) {
            const c = p.hand.splice(i, 1)[0];
            room.logs.push(`P${playerIdx + 1}: ${c.name}を除外`);
          }
        }
      } else if (pt.type === 'remodel') {
        const { removeIndex, gainId } = action;
        if (removeIndex === undefined) return { ok: false, error: '除外カード未指定' };
        if (removeIndex < 0 || removeIndex >= p.hand.length) return { ok: false, error: '不正なカード' };
        const removed = p.hand.splice(removeIndex, 1)[0];
        const maxXp = (removed.xpCost || 0) + 2;
        room.logs.push(`P${playerIdx + 1}: ${removed.name}を除外(改築)`);
        if (gainId) {
          const allSup = [...room.constSupply, ...room.randomSupply];
          const s = allSup.find(c => c.id === gainId && c.remaining > 0 && c.xpCost <= maxXp);
          if (s) {
            s.remaining--;
            const card = { ...s, uid: uid() };
            delete card.stock; delete card.remaining;
            p.discard.push(card);
            room.logs.push(`改築: ${s.name}を獲得!`);
          }
        }
      }
      room.pendingTarget = null;
      room.stateVersion++;
      checkWinCondition(room);
      return { ok: true };
    }

    case 'buy': {
      const { supplyId } = action;
      if (p.buys <= 0) return { ok: false, error: '購入回数なし' };
      const allSup = [...room.constSupply, ...room.randomSupply];
      const s = allSup.find(c => c.id === supplyId && c.remaining > 0);
      if (!s) return { ok: false, error: 'サプライなし' };
      if (p.xp < s.xpCost) return { ok: false, error: 'XP不足' };
      p.xp -= s.xpCost;
      p.buys--;
      s.remaining--;
      if (s.hpUp) {
        p.maxHp += s.hpUp;
        p.hp = p.maxHp;
        room.logs.push(`P${playerIdx + 1}: 生命の実購入 (最大HP+${s.hpUp})`);
      } else {
        const card = { ...s, uid: uid() };
        delete card.stock; delete card.remaining;
        p.discard.push(card);
      }
      room.logs.push(`P${playerIdx + 1}: 購入: ${s.name}`);
      room.stateVersion++;
      checkWinCondition(room);
      return { ok: true };
    }

    case 'fuse': {
      if (!p.alive) return { ok: false, error: '死亡中' };
      if (room.pendingTarget) return { ok: false, error: 'ターゲット選択中' };
      if (p.ap < 1) return { ok: false, error: 'AP不足（合成に1AP必要）' };
      const { weaponIndex, staffIndex } = action;
      if (weaponIndex === undefined || staffIndex === undefined) return { ok: false, error: '武器と杖を指定してください' };
      if (weaponIndex === staffIndex) return { ok: false, error: '同じカードは選択不可' };
      if (weaponIndex < 0 || weaponIndex >= p.hand.length || staffIndex < 0 || staffIndex >= p.hand.length) return { ok: false, error: '不正なカード' };
      const weaponCard = p.hand[weaponIndex];
      const staffCard = p.hand[staffIndex];
      if (weaponCard.type !== '武器' || weaponCard.fused) return { ok: false, error: '武器カードを選択してください' };
      if (staffCard.type !== '杖' || staffCard.fused) return { ok: false, error: '杖カードを選択してください' };
      // Remove source cards (higher index first to avoid shift issues)
      const idxs = [weaponIndex, staffIndex].sort((a, b) => b - a);
      for (const i of idxs) p.hand.splice(i, 1);
      p.ap -= 1;
      // Create fused card
      const fused = {
        id: 'fused_' + weaponCard.id + '_' + staffCard.id,
        name: weaponCard.name + '×' + staffCard.name,
        type: '融合武器',
        ap: 1,
        noise: (weaponCard.noise || 0) + (staffCard.noise || 0),
        desc: `攻撃${(weaponCard.power || 0) + (staffCard.power || 0)} 射程${staffCard.range || 4} 貫通`,
        power: (weaponCard.power || 0) + (staffCard.power || 0),
        range: staffCard.range || 4,
        isStaff: true,
        fused: true,
        uid: uid(),
        staffAoe: (staffCard.staffAoe || 0) || (weaponCard.aoeDmg || 0) ? Math.max(staffCard.staffAoe || 0, weaponCard.aoeDmg || 0) : 0,
        freeze: staffCard.freeze || 0,
        dragonVein: staffCard.dragonVein || false,
        scytheAoe: weaponCard.scytheAoe || false,
      };
      if (fused.staffAoe === 0) delete fused.staffAoe;
      p.hand.push(fused);
      room.logs.push(`P${playerIdx + 1}: 合成! ${fused.name} (攻撃${fused.power} 射程${fused.range})`);
      room.stateVersion++;
      return { ok: true };
    }

    case 'endTurn': {
      if (room.pendingTarget && room.pendingTarget.playerIdx === playerIdx) {
        room.pendingTarget = null; // Cancel pending
      }
      // Check stealth
      if (p.cardsPlayedThisTurn === 0 && p.mp === BASE_MP) {
        p.turnNoise = 0;
        room.logs.push(`P${playerIdx + 1}: 潜伏（完全ステルス）`);
      }
      // Extra turn check (tokinosuna)
      const hasExtraTurn = !!p._extraTurn;
      if (hasExtraTurn) {
        p._extraTurn = false;
        // Reset turn state for extra turn
        p.ap = 1;
        p.buys = 1;
        p.mp = BASE_MP;
        p.turnNoise = 0;
        p.cardsPlayedThisTurn = 0;
        p.nextNoiseZero = false;
        p.discard.push(...p.hand);
        p.hand = [];
        drawCards(p, p.handLimit);
        p.handLimit = HAND_SIZE;
        room.logs.push(`P${playerIdx + 1}: 追加ターン!`);
        room.stateVersion++;
        return { ok: true };
      }
      // Discard remaining hand
      p.discard.push(...p.hand);
      p.hand = [];
      room.stateVersion++;
      startNextTurn(room);
      return { ok: true };
    }

    default:
      return { ok: false, error: '不明なアクション' };
  }
}

// ===== フォグ適用済み状態を返す =====
function getStateForPlayer(room, playerIdx) {
  if (room.phase === 'waiting') {
    return {
      phase: room.phase,
      playerCount: room.players.length,
      code: room.code,
      stateVersion: room.stateVersion,
    };
  }

  const p = room.players[playerIdx];
  const opIdx = 1 - playerIdx;
  const op = room.players[opIdx];

  // フォグ・オブ・ウォー: 現在の視界範囲(2マス)
  const visionSet = new Set();
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (isInFogVision(room.map, p.x, p.y, x, y, p.reconTurns, p.reconRadius, p.fullVisionTurns)) {
      visionSet.add(y * MAP_W + x);
    }
  }

  // 探索済みマスのセット
  const exploredSet = p.explored;

  // マップデータ: フォグ・オブ・ウォー適用
  // 視界内: 完全な情報、探索済み: 地形のみ、未探索: -1(不明)
  const fogMap = [];
  for (let y = 0; y < MAP_H; y++) {
    fogMap[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      const key = y * MAP_W + x;
      if (visionSet.has(key)) {
        fogMap[y][x] = room.map[y][x]; // 完全な情報
      } else if (exploredSet[key]) {
        fogMap[y][x] = room.map[y][x]; // 地形のみ（敵はvisibleMobsで制御）
      } else {
        fogMap[y][x] = -1; // 未探索
      }
    }
  }

  // Opponent visibility - 視界内かつ近い場合のみ
  const showOpponent = op.hasFlag ||
    p.fullVisionTurns > 0 ||
    (p.reconTurns > 0 && dist(p.x, p.y, op.x, op.y) <= p.reconRadius) ||
    (visionSet.has(op.y * MAP_W + op.x) && dist(p.x, p.y, op.x, op.y) <= FOG_VISION_RANGE);

  // Noise info
  let opNoiseLevel = null;
  if (op.turnNoise > 0 || op.hasFlag) {
    const d = dist(p.x, p.y, op.x, op.y);
    opNoiseLevel = op.hasFlag ? '大' : getNoiseLevel(d);
  }

  // Visible mobs - 視界内のみ（探索済みでも敵は見えない）
  const visibleMobs = room.mobs.filter(m => m.alive && visionSet.has(m.y * MAP_W + m.x)).map(m => ({
    x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, name: m.name, icon: m.icon, rank: m.rank,
  }));

  // Boss
  let bossInfo = null;
  if (room.boss && room.boss.alive) {
    const bv = visionSet.has(room.boss.y * MAP_W + room.boss.x);
    bossInfo = {
      visible: bv,
      x: bv ? room.boss.x : undefined,
      y: bv ? room.boss.y : undefined,
      hp: room.boss.hp,
      maxHp: room.boss.maxHp,
      alive: room.boss.alive,
    };
  }

  // Traps (own traps only, or full vision)
  const visibleTraps = room.traps.filter(t => t.ownerIdx === playerIdx || p.fullVisionTurns > 0);

  // Flag - 視界内のみ
  let flagInfo = null;
  if (room.flagPos && visionSet.has(room.flagPos.y * MAP_W + room.flagPos.x)) {
    flagInfo = { x: room.flagPos.x, y: room.flagPos.y };
  }

  // Supply
  const supply = {
    const: room.constSupply.map(s => ({ id: s.id, name: s.name, type: s.type, desc: s.desc, xpCost: s.xpCost, ap: s.ap, remaining: s.remaining, tier: s.tier, noise: s.noise })),
    random: room.randomSupply.map(s => ({ id: s.id, name: s.name, type: s.type, desc: s.desc, xpCost: s.xpCost, ap: s.ap, remaining: s.remaining, tier: s.tier, noise: s.noise })),
  };

  // WAVE情報
  const waveInfo = getWaveInfo(room.turnNumber);

  // 次の縮小までのターン数
  let shrinkWarning = null;
  for (const sched of SHRINK_SCHEDULE) {
    if (room.turnNumber < sched.turn) {
      shrinkWarning = { turnsLeft: sched.turn - room.turnNumber, targetSize: MAP_W - sched.layer * 2 };
      break;
    }
  }

  return {
    phase: room.phase,
    code: room.code,
    stateVersion: room.stateVersion,
    turnNumber: room.turnNumber,
    currentTurn: room.currentTurn,
    myIndex: playerIdx,
    isMyTurn: room.currentTurn === playerIdx,
    winner: room.winner,
    pendingTarget: room.pendingTarget && room.pendingTarget.playerIdx === playerIdx ? room.pendingTarget.type : null,
    map: fogMap,
    wave: waveInfo.wave,
    shrinkWarning,
    shrinkLevel: room.shrinkLevel,
    lastShrinkEvent: room.lastShrinkEvent,
    turnTimeLeft: Math.max(0, room.turnDeadline - Date.now()),
    me: {
      x: p.x, y: p.y,
      startX: p.startX, startY: p.startY,
      hp: p.hp, maxHp: p.maxHp, xp: p.xp,
      ap: p.ap, buys: p.buys, mp: p.mp,
      turnNoise: p.turnNoise,
      hasFlag: p.hasFlag, alive: p.alive,
      kills: p.kills, flagVP: p.flagVP, bossKill: p.bossKill,
      frozenTurns: p.frozenTurns, reconTurns: p.reconTurns,
      fullVisionTurns: p.fullVisionTurns,
      reconRadius: p.reconRadius,
      hand: p.hand.map(c => ({ id: c.id, name: c.name, type: c.type, desc: c.desc, ap: c.ap, noise: c.noise, isVP: c.isVP, vpValue: c.vpValue, isStaff: c.isStaff, power: c.power, range: c.range, xpCost: c.xpCost, uid: c.uid, garden: c.garden, earthquake: c.earthquake, remodel: c.remodel, trash: c.trash, fused: c.fused, deathBreath: c.deathBreath, meteor: c.meteor, divineStrike: c.divineStrike, extraTurn: c.extraTurn, voidGate: c.voidGate, instantVP: c.instantVP, returnHome: c.returnHome, fullVision: c.fullVision, dragonVein: c.dragonVein, staffAoe: c.staffAoe, freeze: c.freeze, aoeDmg: c.aoeDmg })),
      deckCount: p.deck.length,
      discardCount: p.discard.length,
      vp: calcVP(p),
      totalCards: getAllCards(p).length,
      cardVP: getAllCards(p).reduce((s, c) => s + (c.vpValue || 0) + (c.garden ? Math.floor(getAllCards(p).length / 5) : 0) - (c.id === 'noroi' ? 1 : 0), 0),
    },
    opponent: {
      hp: op.hp, maxHp: op.maxHp,
      hasFlag: op.hasFlag, alive: op.alive,
      visible: showOpponent,
      x: showOpponent ? op.x : undefined,
      y: showOpponent ? op.y : undefined,
      vp: calcVP(op),
      noiseLevel: opNoiseLevel,
      flagVP: op.flagVP,
      kills: op.kills,
      bossKill: op.bossKill,
      cardVP: getAllCards(op).reduce((s, c) => s + (c.vpValue || 0) + (c.garden ? Math.floor(getAllCards(op).length / 5) : 0) - (c.id === 'noroi' ? 1 : 0), 0),
    },
    mobs: visibleMobs,
    boss: bossInfo,
    traps: visibleTraps,
    flag: flagInfo,
    supply,
    logs: room.logs.slice(-50),
    opponentStartX: room.players[opIdx].startX,
    opponentStartY: room.players[opIdx].startY,
  };
}

// ===== HTTPサーバー =====
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, data, status = 200) {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Serve index.html
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    try {
      const html = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end('index.html not found');
    }
    return;
  }

  // API routes
  if (pathname === '/api/create' && req.method === 'POST') {
    const room = createRoom();
    const { token, playerIndex } = joinRoom(room);
    sendJSON(res, { code: room.code, token, playerIndex });
    return;
  }

  const joinMatch = pathname.match(/^\/api\/join\/(\w+)$/);
  if (joinMatch && req.method === 'POST') {
    const code = joinMatch[1];
    const room = rooms[code];
    if (!room) { sendJSON(res, { error: '部屋が見つかりません' }, 404); return; }
    if (room.players.length >= 2) { sendJSON(res, { error: '部屋が満員です' }, 400); return; }
    const { token, playerIndex } = joinRoom(room);
    if (room.players.length === 2) startGame(room);
    sendJSON(res, { token, playerIndex });
    return;
  }

  const actionMatch = pathname.match(/^\/api\/action\/(\w+)$/);
  if (actionMatch && req.method === 'POST') {
    const code = actionMatch[1];
    const room = rooms[code];
    if (!room) { sendJSON(res, { error: '部屋が見つかりません' }, 404); return; }
    const body = await parseBody(req);
    const { token, action } = body;
    const pidx = room.playerTokens.indexOf(token);
    if (pidx === -1) { sendJSON(res, { error: '認証エラー' }, 403); return; }
    const result = processAction(room, pidx, action);
    sendJSON(res, result);
    return;
  }

  const stateMatch = pathname.match(/^\/api\/state\/(\w+)$/);
  if (stateMatch && req.method === 'GET') {
    const code = stateMatch[1];
    const room = rooms[code];
    if (!room) { sendJSON(res, { error: '部屋が見つかりません' }, 404); return; }
    const token = url.searchParams.get('token');
    const pidx = room.playerTokens.indexOf(token);
    if (pidx === -1) { sendJSON(res, { error: '認証エラー' }, 403); return; }
    const state = getStateForPlayer(room, pidx);
    sendJSON(res, state);
    return;
  }

  // 404
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================`);
  console.log(`  レイヴン・ポータル 対戦サーバー`);
  console.log(`  ポート: ${PORT}`);
  console.log(`====================================`);
  console.log(`ローカル: http://localhost:${PORT}`);
  // Show IP
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`LAN: http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`\n友達に部屋コードを共有してプレイ!`);
  console.log(`同じWiFi: サーバーPCのIP:${PORT} でアクセス`);
  console.log(`外部: ngrok http ${PORT} でトンネリング`);
});

// ターンタイマーチェック（5秒ごと）
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    if (room.phase !== 'playing') continue;
    if (room.players.length < 2) continue;
    if (room.turnDeadline > 0 && now >= room.turnDeadline) {
      const pi = room.currentTurn;
      const p = room.players[pi];
      room.logs.push(`P${pi + 1}の時間切れ! ターン自動終了`);
      // Cancel pending target if any
      if (room.pendingTarget && room.pendingTarget.playerIdx === pi) {
        room.pendingTarget = null;
      }
      // Discard remaining hand
      p.discard.push(...p.hand);
      p.hand = [];
      room.stateVersion++;
      startNextTurn(room);
    }
  }
}, 5000);

// 部屋クリーンアップ（60秒ごと）
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    const room = rooms[code];
    // ゲーム終了後5分経過
    if (room.phase === 'over' && room.endedAt && now - room.endedAt > 5 * 60 * 1000) {
      delete rooms[code];
      continue;
    }
    // 待機中で10分経過
    if (room.phase === 'waiting' && room.createdAt && now - room.createdAt > 10 * 60 * 1000) {
      delete rooms[code];
      continue;
    }
    // 15分間操作なし
    if (room.lastActivity && now - room.lastActivity > 15 * 60 * 1000) {
      delete rooms[code];
      continue;
    }
  }
}, 60000);
