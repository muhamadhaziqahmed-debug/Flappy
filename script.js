/* ================================================================
   FLAPSTER — Flappy Bird Clone
   ================================================================
   Architecture
   ────────────
   §1  CONFIG          — all magic numbers in one place
   §2  STATE           — single mutable game state object
   §3  ASSET HELPERS   — pixel-art drawing functions
   §4  GAME OBJECTS    — Bird, Pipe, Background classes
   §5  COLLISION       — AABB + pixel-perfect circle check
   §6  CORE LOOP       — update, render, requestAnimationFrame
   §7  HUD / SCREENS   — start, score, game-over overlays
   §8  INPUT           — keyboard + touch/click
   §9  BOOT            — kick everything off
   ================================================================ */

'use strict';

/* ================================================================
   §1  CONFIG
   ================================================================ */
const CFG = {
  /* Canvas */
  W: 400,
  H: 600,

  /* Bird */
  BIRD_X:        90,      // fixed horizontal position
  BIRD_RADIUS:   14,      // collision circle radius
  BIRD_DRAW_W:   38,      // sprite draw width
  BIRD_DRAW_H:   30,      // sprite draw height
  JUMP_VEL:     -8.5,     // upward velocity on flap
  GRAVITY:       0.42,    // pixels-per-frame² pulled downward
  MAX_FALL_VEL:  12,      // terminal velocity
  TILT_UP:      -25,      // degrees when rising
  TILT_DOWN:     70,      // max degrees when falling

  /* Pipes */
  PIPE_W:        58,
  PIPE_GAP:      148,     // vertical gap between top & bottom pipe
  PIPE_SPEED:    2.6,     // pixels per frame
  PIPE_SPAWN_X:  420,     // spawn off right edge
  PIPE_INTERVAL: 1700,    // ms between pipe spawns

  /* Ground */
  GROUND_H:      80,
  GROUND_Y:      520,     // top of ground strip (H - GROUND_H)

  /* Visual */
  WING_FRAMES:   3,       // number of wing animation frames
  WING_SPEED:    120,     // ms per frame

  /* Scoring */
  SCORE_X_THRESHOLD: 90, // pipe cleared when pipe.x + PIPE_W < this
};


/* ================================================================
   §2  STATE
   ================================================================ */
const state = {
  phase: 'START',     // 'START' | 'PLAYING' | 'DEAD'

  bird: null,
  pipes: [],
  clouds: [],
  stars: [],

  score:     0,
  bestScore: parseInt(localStorage.getItem('flapster_best') || '0', 10),

  lastPipeTime: 0,
  lastFrameTime: 0,

  animFrame: null,
};


/* ================================================================
   §3  ASSET HELPERS — drawing with Canvas 2D API
   ================================================================ */

/**
 * Draw the bird sprite (pixel-art style, no images needed).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  — center x
 * @param {number} y  — center y
 * @param {number} angle — rotation in degrees
 * @param {number} wingFrame — 0|1|2 for wing position
 */
function drawBird(ctx, x, y, angle, wingFrame) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);

  const hw = CFG.BIRD_DRAW_W / 2;
  const hh = CFG.BIRD_DRAW_H / 2;

  /* ── Shadow ── */
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(2, hh + 4, hw * 0.7, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ── Wing (drawn behind body) ── */
  const wingY = wingFrame === 0 ? 4 : wingFrame === 1 ? 0 : -6;
  ctx.fillStyle = '#ff9500';
  ctx.beginPath();
  ctx.ellipse(-4, wingY, 12, 7, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Wing highlight
  ctx.fillStyle = '#ffb732';
  ctx.beginPath();
  ctx.ellipse(-5, wingY - 2, 8, 4, -0.3, 0, Math.PI * 2);
  ctx.fill();

  /* ── Body ── */
  ctx.fillStyle = '#ffd700';
  ctx.beginPath();
  ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ── Body gradient sheen ── */
  const grad = ctx.createRadialGradient(-6, -6, 2, 0, 0, hw);
  grad.addColorStop(0, 'rgba(255,255,220,0.7)');
  grad.addColorStop(1, 'rgba(200,130,0,0.3)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ── Belly ── */
  ctx.fillStyle = '#ffe866';
  ctx.beginPath();
  ctx.ellipse(6, 4, 10, 8, 0.3, 0, Math.PI * 2);
  ctx.fill();

  /* ── Eye white ── */
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(10, -5, 7, 0, Math.PI * 2);
  ctx.fill();

  /* ── Pupil ── */
  ctx.fillStyle = '#1a0533';
  ctx.beginPath();
  ctx.arc(12, -5, 4, 0, Math.PI * 2);
  ctx.fill();

  /* ── Eye shine ── */
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(13, -7, 1.5, 0, Math.PI * 2);
  ctx.fill();

  /* ── Beak ── */
  ctx.fillStyle = '#ff6b00';
  ctx.beginPath();
  ctx.moveTo(16, -1);
  ctx.lineTo(26, 2);
  ctx.lineTo(16, 5);
  ctx.closePath();
  ctx.fill();
  // Beak highlight
  ctx.fillStyle = '#ff9a3c';
  ctx.beginPath();
  ctx.moveTo(16, -1);
  ctx.lineTo(26, 2);
  ctx.lineTo(16, 2);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Draw a single pipe (top or bottom).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x      left edge of pipe
 * @param {number} y      top edge of pipe body
 * @param {number} height pipe body height
 * @param {boolean} isTop draw cap on bottom (top pipe) or top (bottom pipe)
 */
function drawPipe(ctx, x, y, height, isTop) {
  const CAP_H = 22;
  const CAP_OVERHANG = 6;

  /* ── Pipe body ── */
  // Dark base
  ctx.fillStyle = '#1e6b1e';
  ctx.fillRect(x, y, CFG.PIPE_W, height);

  // Mid green stripe
  ctx.fillStyle = '#2e8b2e';
  ctx.fillRect(x + 5, y, CFG.PIPE_W - 10, height);

  // Light edge highlight (left)
  ctx.fillStyle = '#3daf3d';
  ctx.fillRect(x + 5, y, 8, height);

  // Dark shadow (right)
  ctx.fillStyle = '#155515';
  ctx.fillRect(x + CFG.PIPE_W - 8, y, 8, height);

  /* ── Cap ── */
  const capY = isTop ? y + height - CAP_H : y;
  // Cap base
  ctx.fillStyle = '#1e6b1e';
  ctx.fillRect(x - CAP_OVERHANG, capY, CFG.PIPE_W + CAP_OVERHANG * 2, CAP_H);
  // Cap mid
  ctx.fillStyle = '#2e8b2e';
  ctx.fillRect(x - CAP_OVERHANG + 4, capY + 3, CFG.PIPE_W + CAP_OVERHANG * 2 - 8, CAP_H - 6);
  // Cap highlight
  ctx.fillStyle = '#3daf3d';
  ctx.fillRect(x - CAP_OVERHANG + 4, capY + 3, 10, CAP_H - 6);
  // Cap shadow
  ctx.fillStyle = '#155515';
  ctx.fillRect(x - CAP_OVERHANG + CFG.PIPE_W - 6, capY + 3, 10, CAP_H - 6);
}

/**
 * Draw the scrolling ground strip.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} scrollOffset — horizontal scroll for parallax texture
 */
function drawGround(ctx, scrollOffset) {
  const y = CFG.GROUND_Y;
  const h = CFG.GROUND_H;

  /* ── Dirt base ── */
  ctx.fillStyle = '#8b5e3c';
  ctx.fillRect(0, y, CFG.W, h);

  /* ── Dirt mid ── */
  ctx.fillStyle = '#a0713d';
  ctx.fillRect(0, y + 8, CFG.W, h - 8);

  /* ── Grass strip ── */
  ctx.fillStyle = '#3daf3d';
  ctx.fillRect(0, y, CFG.W, 14);
  // Grass highlight
  ctx.fillStyle = '#5cd65c';
  ctx.fillRect(0, y, CFG.W, 5);

  /* ── Scrolling dirt texture tiles ── */
  ctx.fillStyle = '#7a4e2e';
  const tileW = 40;
  const offset = scrollOffset % tileW;
  for (let tx = -offset; tx < CFG.W; tx += tileW) {
    ctx.fillRect(tx + 8, y + 22, 24, 6);
    ctx.fillRect(tx + 4, y + 38, 18, 5);
    ctx.fillRect(tx + 20, y + 52, 14, 4);
  }
}

/**
 * Draw the sky gradient + stars + clouds.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} stars    pre-generated star positions
 * @param {Array} clouds   cloud objects with x, y, scale
 * @param {number} elapsed time for twinkling
 */
function drawBackground(ctx, stars, clouds, elapsed) {
  /* ── Sky gradient ── */
  const skyGrad = ctx.createLinearGradient(0, 0, 0, CFG.GROUND_Y);
  skyGrad.addColorStop(0,   '#1a0533');
  skyGrad.addColorStop(0.4, '#3d0d6b');
  skyGrad.addColorStop(0.75,'#c2410c');
  skyGrad.addColorStop(1,   '#ff9a3c');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, CFG.W, CFG.GROUND_Y);

  /* ── Stars (twinkle with sine) ── */
  stars.forEach(s => {
    const alpha = 0.4 + 0.5 * Math.sin((elapsed / 800 + s.phase) * Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,220,${alpha.toFixed(2)})`;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  });

  /* ── Moon ── */
  ctx.fillStyle = '#fff8dc';
  ctx.beginPath();
  ctx.arc(340, 60, 26, 0, Math.PI * 2);
  ctx.fill();
  // Moon craters
  ctx.fillStyle = 'rgba(200,190,160,0.4)';
  [[330,52,5],[352,68,3],[322,72,4]].forEach(([cx,cy,r]) => {
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  });
  // Moon glow halo
  const moonGlow = ctx.createRadialGradient(340,60,26,340,60,55);
  moonGlow.addColorStop(0, 'rgba(255,248,220,0.15)');
  moonGlow.addColorStop(1, 'rgba(255,248,220,0)');
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(340, 60, 55, 0, Math.PI * 2);
  ctx.fill();

  /* ── Clouds ── */
  clouds.forEach(c => drawCloud(ctx, c.x, c.y, c.scale));
}

function drawCloud(ctx, x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(255,230,200,0.18)';
  [[0,0,28],[22,-10,20],[42,0,24],[62,4,18],[-18,4,18]].forEach(([cx,cy,r]) => {
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  });
  ctx.restore();
}


/* ================================================================
   §4  GAME OBJECTS
   ================================================================ */

/** Create a fresh bird object */
function createBird() {
  return {
    x:         CFG.BIRD_X,
    y:         260,
    vy:        0,            // vertical velocity
    angle:     0,            // current tilt angle
    wingFrame: 0,            // 0=up, 1=mid, 2=down
    wingTimer: 0,            // ms since last wing frame
    alive:     true,
    deathY:    0,            // used for death bounce animation
    deathVY:   0,
  };
}

/** Create a pipe pair at the right edge */
function createPipe() {
  // Random gap position between min/max margins from top/bottom
  const minTop = 60;
  const maxTop = CFG.GROUND_Y - CFG.PIPE_GAP - 60;
  const gapTop = minTop + Math.random() * (maxTop - minTop);

  return {
    x:        CFG.PIPE_SPAWN_X,
    gapTop,                              // y where gap starts
    gapBot:   gapTop + CFG.PIPE_GAP,     // y where gap ends
    scored:   false,                     // have we counted this pipe?
  };
}

/** Generate static star positions once */
function generateStars(count) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x:     Math.random() * CFG.W,
      y:     Math.random() * (CFG.GROUND_Y * 0.6),
      size:  Math.random() < 0.3 ? 2 : 1,
      phase: Math.random(),
    });
  }
  return stars;
}

/** Create cloud objects */
function generateClouds() {
  return [
    { x: 50,  y: 90,  scale: 1.1, speed: 0.3 },
    { x: 200, y: 130, scale: 0.8, speed: 0.5 },
    { x: 310, y: 80,  scale: 1.3, speed: 0.25 },
    { x: 130, y: 200, scale: 0.7, speed: 0.4 },
  ];
}


/* ================================================================
   §5  COLLISION DETECTION
   ================================================================ */

/**
 * Check if the bird circle overlaps any pipe rectangle or the ground.
 * Uses AABB vs circle test for accuracy without pixel scanning.
 * @param {Object} bird
 * @param {Array}  pipes
 * @returns {boolean} true = collision detected
 */
function checkCollision(bird, pipes) {
  const bx = bird.x;
  const by = bird.y;
  const br = CFG.BIRD_RADIUS;

  /* ── Ground collision ── */
  if (by + br >= CFG.GROUND_Y) return true;

  /* ── Ceiling collision ── */
  if (by - br <= 0) return true;

  /* ── Pipe collision (circle vs two rectangles) ── */
  for (const pipe of pipes) {
    const px = pipe.x;
    const pw = CFG.PIPE_W;

    // Compute nearest point on top pipe rect to bird center
    // Top pipe rect: (px, 0) → (px+pw, pipe.gapTop)
    const nearTopX = Math.max(px, Math.min(bx, px + pw));
    const nearTopY = Math.max(0,  Math.min(by, pipe.gapTop));
    const dTopX = bx - nearTopX;
    const dTopY = by - nearTopY;
    if (dTopX * dTopX + dTopY * dTopY < br * br) return true;

    // Bottom pipe rect: (px, pipe.gapBot) → (px+pw, GROUND_Y)
    const nearBotX = Math.max(px, Math.min(bx, px + pw));
    const nearBotY = Math.max(pipe.gapBot, Math.min(by, CFG.GROUND_Y));
    const dBotX = bx - nearBotX;
    const dBotY = by - nearBotY;
    if (dBotX * dBotX + dBotY * dBotY < br * br) return true;
  }

  return false;
}


/* ================================================================
   §6  CORE GAME LOOP
   ================================================================ */

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

/* Ground scroll — independent of pipe movement */
let groundScroll   = 0;
let elapsed        = 0;       // total ms since boot (for star twinkle)

/**
 * Main update function — called once per frame.
 * @param {number} dt  delta time in milliseconds
 */
function update(dt) {
  const { bird, pipes, clouds } = state;
  if (state.phase !== 'PLAYING') return;

  /* ── Bird physics ── */
  bird.vy = Math.min(bird.vy + CFG.GRAVITY, CFG.MAX_FALL_VEL);
  bird.y  += bird.vy;

  /* ── Bird tilt (proportional to velocity) ── */
  const targetAngle = Math.max(CFG.TILT_UP, Math.min(CFG.TILT_DOWN, bird.vy * 4));
  bird.angle += (targetAngle - bird.angle) * 0.18; // smooth interpolation

  /* ── Wing animation ── */
  bird.wingTimer += dt;
  if (bird.wingTimer >= CFG.WING_SPEED) {
    bird.wingFrame = (bird.wingFrame + 1) % CFG.WING_FRAMES;
    bird.wingTimer = 0;
  }

  /* ── Clouds (slow parallax scroll) ── */
  clouds.forEach(c => {
    c.x -= c.speed;
    if (c.x < -150) c.x = CFG.W + 80;
  });

  /* ── Ground scroll ── */
  groundScroll += CFG.PIPE_SPEED;

  /* ── Pipe spawning ── */
  const now = performance.now();
  if (now - state.lastPipeTime >= CFG.PIPE_INTERVAL) {
    pipes.push(createPipe());
    state.lastPipeTime = now;
  }

  /* ── Pipe movement + scoring ── */
  for (let i = pipes.length - 1; i >= 0; i--) {
    pipes[i].x -= CFG.PIPE_SPEED;

    // Score: pipe fully passed bird's x
    if (!pipes[i].scored && pipes[i].x + CFG.PIPE_W < CFG.BIRD_X) {
      state.score++;
      pipes[i].scored = true;
    }

    // Remove off-screen pipes
    if (pipes[i].x + CFG.PIPE_W < -20) {
      pipes.splice(i, 1);
    }
  }

  /* ── Collision detection ── */
  if (checkCollision(bird, pipes)) {
    killBird();
  }
}

/** Trigger death sequence */
function killBird() {
  state.bird.alive = false;
  state.phase      = 'DEAD';

  // Save best score
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    localStorage.setItem('flapster_best', String(state.bestScore));
  }
}

/**
 * Main render function — draws the full frame.
 */
function render() {
  ctx.clearRect(0, 0, CFG.W, CFG.H);

  /* ── Background ── */
  drawBackground(ctx, state.stars, state.clouds, elapsed);

  /* ── Pipes (drawn behind bird) ── */
  state.pipes.forEach(pipe => {
    // Top pipe: from y=0 down to gap
    drawPipe(ctx, pipe.x, 0, pipe.gapTop, true);
    // Bottom pipe: from gapBot down to ground
    drawPipe(ctx, pipe.x, pipe.gapBot, CFG.GROUND_Y - pipe.gapBot, false);
  });

  /* ── Ground ── */
  drawGround(ctx, groundScroll);

  /* ── Bird ── */
  if (state.phase !== 'START') {
    drawBird(ctx, state.bird.x, state.bird.y, state.bird.angle, state.bird.wingFrame);
  }

  /* ── HUD overlays ── */
  if (state.phase === 'START')   drawStartScreen(ctx);
  if (state.phase === 'PLAYING') drawHUD(ctx);
  if (state.phase === 'DEAD')    drawGameOverScreen(ctx);
}

/**
 * The animation loop — ties update + render together.
 * Uses delta time so game speed is framerate-independent.
 */
function loop(timestamp) {
  const dt = Math.min(timestamp - state.lastFrameTime, 50); // cap to 50ms
  state.lastFrameTime = timestamp;
  elapsed += dt;

  /* Idle bird bob on start screen */
  if (state.phase === 'START') {
    state.bird.y = 260 + Math.sin(elapsed / 400) * 10;
    state.bird.wingTimer += dt;
    if (state.bird.wingTimer >= CFG.WING_SPEED) {
      state.bird.wingFrame = (state.bird.wingFrame + 1) % CFG.WING_FRAMES;
      state.bird.wingTimer = 0;
    }
    state.clouds.forEach(c => { c.x -= c.speed * 0.4; if (c.x < -150) c.x = CFG.W + 80; });
    groundScroll += 0.6;
  }

  update(dt);
  render();

  state.animFrame = requestAnimationFrame(loop);
}


/* ================================================================
   §7  HUD / SCREENS
   ================================================================ */

function drawHUD(ctx) {
  /* ── Score (centered at top) ── */
  ctx.textAlign    = 'center';
  ctx.font         = '22px "Press Start 2P"';

  // Drop shadow
  ctx.fillStyle    = 'rgba(0,0,0,0.6)';
  ctx.fillText(state.score, CFG.W / 2 + 3, 60 + 3);

  // Main text
  ctx.fillStyle    = '#fff';
  ctx.fillText(state.score, CFG.W / 2, 60);

  // Gold outline for high scores
  ctx.strokeStyle  = '#ffd700';
  ctx.lineWidth    = 1.5;
  ctx.strokeText(state.score, CFG.W / 2, 60);
}

function drawStartScreen(ctx) {
  /* ── Semi-transparent panel ── */
  roundRect(ctx, 60, 140, 280, 200, 12, 'rgba(10,0,20,0.78)');
  strokeRoundRect(ctx, 60, 140, 280, 200, 12, '#9b00db', 2);

  /* ── Title ── */
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd700';
  ctx.font      = '18px "Press Start 2P"';
  ctx.fillText('FLAPSTER', CFG.W / 2, 183);

  // Subtitle glow
  ctx.shadowColor = '#ffd700';
  ctx.shadowBlur  = 12;
  ctx.fillText('FLAPSTER', CFG.W / 2, 183);
  ctx.shadowBlur  = 0;

  /* ── Divider ── */
  ctx.strokeStyle = 'rgba(255,215,0,0.3)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(80, 196); ctx.lineTo(320, 196);
  ctx.stroke();

  /* ── Instructions ── */
  ctx.fillStyle = '#c8a0e8';
  ctx.font      = '8px "Press Start 2P"';
  ctx.fillText('PRESS SPACE OR TAP', CFG.W / 2, 226);
  ctx.fillText('TO START FLAPPING', CFG.W / 2, 244);

  /* ── Best score ── */
  if (state.bestScore > 0) {
    ctx.fillStyle = 'rgba(255,215,0,0.55)';
    ctx.font      = '7px "Press Start 2P"';
    ctx.fillText(`BEST: ${state.bestScore}`, CFG.W / 2, 272);
  }

  /* ── Animated press prompt ── */
  const blink = Math.sin(elapsed / 350) > 0;
  if (blink) {
    ctx.fillStyle = '#fff';
    ctx.font      = '7px "Press Start 2P"';
    ctx.fillText('▼ ▼ ▼', CFG.W / 2, 298);
  }

  /* ── Bird preview (already drawn by main render) ── */
}

function drawGameOverScreen(ctx) {
  /* ── Darken game ── */
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, CFG.W, CFG.H);

  /* ── Panel ── */
  roundRect(ctx, 50, 130, 300, 280, 14, 'rgba(10,0,20,0.9)');
  strokeRoundRect(ctx, 50, 130, 300, 280, 14, '#ff3a3a', 2.5);

  /* ── GAME OVER ── */
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ff4444';
  ctx.font      = '18px "Press Start 2P"';
  // Glitch shadow effect
  ctx.fillStyle = '#ff000060';
  ctx.fillText('GAME OVER', CFG.W / 2 - 3, 174);
  ctx.fillStyle = '#ff4444';
  ctx.fillText('GAME OVER', CFG.W / 2, 172);

  /* ── Divider ── */
  ctx.strokeStyle = 'rgba(255,68,68,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(70, 186); ctx.lineTo(330, 186); ctx.stroke();

  /* ── Score ── */
  ctx.fillStyle = '#ccc';
  ctx.font      = '8px "Press Start 2P"';
  ctx.fillText('SCORE', CFG.W / 2, 215);
  ctx.fillStyle = '#ffd700';
  ctx.font      = '28px "Press Start 2P"';
  ctx.fillText(state.score, CFG.W / 2, 252);

  /* ── Best score ── */
  const isNew = state.score === state.bestScore && state.score > 0;
  ctx.font      = '7px "Press Start 2P"';
  ctx.fillStyle = isNew ? '#ffd700' : 'rgba(255,215,0,0.5)';
  ctx.fillText(isNew ? `★ NEW BEST: ${state.bestScore} ★` : `BEST: ${state.bestScore}`, CFG.W / 2, 278);

  /* ── Medals ── */
  const medal = state.score >= 30 ? '🥇' : state.score >= 20 ? '🥈' : state.score >= 10 ? '🥉' : null;
  if (medal) {
    ctx.font = '28px serif';
    ctx.fillText(medal, CFG.W / 2, 318);
  }

  /* ── Retry prompt ── */
  const blink2 = Math.sin(elapsed / 400) > 0;
  ctx.fillStyle = blink2 ? '#fff' : 'rgba(255,255,255,0.4)';
  ctx.font      = '8px "Press Start 2P"';
  ctx.fillText('PRESS SPACE TO RETRY', CFG.W / 2, 356);

  /* ── Back to menu hint ── */
  ctx.fillStyle = 'rgba(180,150,220,0.6)';
  ctx.font      = '6px "Press Start 2P"';
  ctx.fillText('TAP / CLICK TO RETRY', CFG.W / 2, 382);
}

/* ── Canvas shape helpers ── */
function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
function strokeRoundRect(ctx, x, y, w, h, r, stroke, lw) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = lw;
  ctx.stroke();
}


/* ================================================================
   §8  INPUT HANDLING
   ================================================================ */

/** The single action the player can take: FLAP */
function handleFlap() {
  if (state.phase === 'START') {
    beginGame();
    return;
  }

  if (state.phase === 'DEAD') {
    // Brief pause before allowing restart (prevents accidental double-tap)
    setTimeout(resetGame, 80);
    return;
  }

  if (state.phase === 'PLAYING' && state.bird.alive) {
    /* Apply upward velocity (jump) */
    state.bird.vy = CFG.JUMP_VEL;
    /* Immediately tilt up for responsive feel */
    state.bird.angle = CFG.TILT_UP;
  }
}

/* Keyboard */
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault(); // prevent page scroll
    handleFlap();
  }
});

/* Touch / click on canvas */
document.getElementById('canvasWrap').addEventListener('pointerdown', e => {
  e.preventDefault();
  handleFlap();
});


/* ================================================================
   §9  BOOT / RESET
   ================================================================ */

/** Initial game state setup */
function initState() {
  state.phase        = 'START';
  state.bird         = createBird();
  state.pipes        = [];
  state.clouds       = generateClouds();
  state.stars        = generateStars(60);
  state.score        = 0;
  state.lastPipeTime = performance.now();
}

/** Called once: START → PLAYING */
function beginGame() {
  state.phase        = 'PLAYING';
  state.bird.vy      = CFG.JUMP_VEL; // small jump on start
  state.lastPipeTime = performance.now() + 800; // delay first pipe
}

/** Called on restart after death */
function resetGame() {
  state.pipes        = [];
  state.score        = 0;
  state.bird         = createBird();
  state.phase        = 'PLAYING';
  state.bird.vy      = CFG.JUMP_VEL;
  state.lastPipeTime = performance.now() + 800;
}

/* Kick it all off */
initState();
state.lastFrameTime = performance.now();
state.animFrame = requestAnimationFrame(loop);
