import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
//  VEIL — Premium Sci-Fi Climbing Experience
// ═══════════════════════════════════════════════════════════════

// ─── Utilities ───────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => Math.random() * (hi - lo) + lo;
const hash = (n) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
const rectHit = (x1,y1,w1,h1,x2,y2,w2,h2) =>
  x1 < x2+w2 && x1+w1 > x2 && y1 < y2+h2 && y1+h1 > y2;

// ─── Internal canvas resolution (always 400×700) ────────────
const CW = 400, CH = 700;

// ─── Config ──────────────────────────────────────────────────
const CFG = {
  GRAVITY: 0.55, JUMP: -15.5, DJUMP: -12.5,
  SPEED: 7.5, DASH_SPD: 20, DASH_DUR: 11, DASH_CD: 44,
  WALL_SLIDE: 1.5, WALL_JX: 9.0, WALL_JY: -14.5,
  MAX_FALL: 16, COYOTE: 8, JBUF: 10,
  PW: 18, PH: 30,
  STAM_MAX: 100, STAM_REGEN: 0.26, STAM_WALL: 0.48, STAM_DASH: 22,
  FLOW_MAX: 100, FLOW_J: 4, FLOW_WJ: 9, FLOW_D: 5, FLOW_DECAY: 0.13,
  CHUNK: 560, GAP_LO: 72, GAP_HI: 162, PW_LO: 65, PW_HI: 215,
  ALT_SCALE: 0.07,
};

// ─── Biomes ──────────────────────────────────────────────────
const BIOMES = [
  { id:0, name:"NEON MEGACITY", alt:0,
    p:"#00f5ff", s:"#ff0080", a:"#aa00ff",
    sky:["#040012","#080025"], bc:["#060018","#090028","#040015"],
    wc:"#00f5ff", fog:"rgba(0,8,45,0.07)", weather:"rain" },
  { id:1, name:"INDUSTRIAL SKY FORGE", alt:150,
    p:"#ff8c00", s:"#ffcc00", a:"#ff4400",
    sky:["#0d0700","#1a0e00"], bc:["#160900","#200f00","#100600"],
    wc:"#ffaa00", fog:"rgba(55,18,0,0.06)", weather:"embers" },
  { id:2, name:"STORM TOWERS", alt:400,
    p:"#8844ff", s:"#00aaff", a:"#ff44cc",
    sky:["#04001e","#0b003c"], bc:["#070020","#0f0040","#050018"],
    wc:"#8844ff", fog:"rgba(28,0,80,0.08)", weather:"lightning" },
  { id:3, name:"ORBITAL RUINS", alt:750,
    p:"#00ff88", s:"#ff4400", a:"#00ccff",
    sky:["#000c10","#00181e"], bc:["#001010","#001818","#000c0c"],
    wc:"#00ff88", fog:"rgba(0,22,18,0.05)", weather:"debris" },
  { id:4, name:"FROZEN STRATOSPHERE", alt:1200,
    p:"#aaddff", s:"#ffffff", a:"#4488ff",
    sky:["#000916","#001028"], bc:["#000e1c","#001628","#000a14"],
    wc:"#aaddff", fog:"rgba(0,16,40,0.07)", weather:"snow" },
];
const getBiome = (alt) => {
  for (let i = BIOMES.length-1; i >= 0; i--)
    if (alt >= BIOMES[i].alt) return BIOMES[i];
  return BIOMES[0];
};

// ─── Particle Pool ───────────────────────────────────────────
class Particles {
  constructor(max = 700) {
    this.pool = Array.from({length:max}, () => ({
      x:0,y:0,vx:0,vy:0,life:0,maxLife:1,r:2,color:"#fff",glow:false,active:false
    }));
    this.live = [];
  }
  emit(cfg) {
    const p = this.pool.find(p => !p.active);
    if (!p) return;
    Object.assign(p, { active:true, life:0, vy: cfg.vy??0, vx: cfg.vx??0, ...cfg });
    this.live.push(p);
  }
  update() {
    for (let i = this.live.length-1; i >= 0; i--) {
      const p = this.live[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.04; p.vx *= 0.97;
      p.life++;
      if (p.life >= p.maxLife) { p.active = false; this.live.splice(i,1); }
    }
  }
  draw(ctx, cx, cy) {
    for (const p of this.live) {
      const a = 1 - p.life/p.maxLife;
      ctx.save();
      ctx.globalAlpha = a * 0.88;
      if (p.glow) { ctx.shadowBlur = p.r * 3; ctx.shadowColor = p.color; }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - cx, p.y - cy, p.r * (0.4 + 0.6*a), 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ─── World Generator ─────────────────────────────────────────
class World {
  constructor() { this.platforms = []; this.checkpoints = []; this.genY = 0; this.startY = 0; }
  init(startY) {
    this.platforms = []; this.checkpoints = []; this.startY = this.genY = startY;
    this.platforms.push({ x:CW/2-130, y:startY+CFG.PH+4, w:260, h:14, type:"solid", id:0, active:true, gp:0 });
    for (let i = 0; i < 4; i++) this.genChunk();
  }
  genChunk() {
    const topY = this.genY - CFG.CHUNK;
    let y = this.genY - CFG.GAP_LO;
    let idx = this.platforms.length;
    while (y > topY) {
      const diff = 1 + (this.startY - y) / 5500;
      const gap = rand(CFG.GAP_LO, CFG.GAP_HI) * Math.min(diff, 1.6);
      const pw = rand(CFG.PW_LO / Math.min(diff, 2.2), CFG.PW_HI);
      const px = rand(10, CW - pw - 10);
      const type = this.pickType(diff);
      const p = { x:px, y, w:pw, h:12, type, id:idx, active:true, gp:Math.random()*Math.PI*2 };
      if (type === "moving") { p.ox=px; p.range=rand(38,108); p.spd=rand(0.9,2.1); p.phase=Math.random()*Math.PI*2; }
      if (type === "crumble") p.crumbleT = -1;
      this.platforms.push(p);
      y -= gap + 12; idx++;
    }
    this.genY = topY;
  }
  pickType(d) {
    const r = Math.random();
    if (r < 0.56) return "solid";
    if (r < 0.73) return "moving";
    if (r < 0.83) return "thin";
    if (d > 1.3 && r < 0.92) return "crumble";
    return "solid";
  }
  update(camTop) {
    while (this.genY > camTop - CFG.CHUNK) this.genChunk();
    const cullY = camTop + CH + 450;
    this.platforms = this.platforms.filter(p => p.y < cullY);
    for (const p of this.platforms) {
      if (p.type === "moving") { p.phase += 0.018 * p.spd; p.x = p.ox + Math.sin(p.phase) * p.range; }
      if (p.type === "crumble" && p.crumbleT > 0) { p.crumbleT--; if (p.crumbleT <= 0) p.active = false; }
    }
  }
  nearby(px, py, pw, ph, mg=32) {
    return this.platforms.filter(p =>
      p.active && p.y < py+ph+mg && p.y+p.h > py-mg && p.x < px+pw+mg && p.x+p.w > px-mg
    );
  }
}

// ─── Player ──────────────────────────────────────────────────
class Player {
  constructor(x, y, startY) { this.startY = startY; this.reset(x, y); }
  reset(x, y) {
    this.x=x; this.y=y; this.vx=0; this.vy=0;
    this.w=CFG.PW; this.h=CFG.PH; this.face=1;
    this.state="idle"; this.onGround=false; this.onWall=0;
    this.coyote=0; this.jbuf=0; this.djump=true;
    this.dashCD=0; this.dashT=0; this.dashing=false; this.dvx=0; this.dvy=0;
    this.wjCD=0; this.wjLock=0;
    this.stamina=CFG.STAM_MAX; this.flow=0;
    this.score=0; this.altitude=0; this.maxAlt=0;
    this.trail=[]; this.glow=0; this.shakeT=0;
    this.dead=false; this.deadT=0;
    this.emitJumpFX=false; this.emitWallJumpFX=false; this.emitDashFX=false; this.emitLandFX=0;
  }
  get cx() { return this.x + this.w/2; }
  get cy() { return this.y + this.h/2; }
  update(keys, world) {
    if (this.dead) {
      this.deadT++;
      this.vy = Math.min(this.vy + CFG.GRAVITY*0.4, 12);
      this.x += this.vx; this.y += this.vy; this.vx *= 0.94;
      return;
    }
    if (this.coyote>0) this.coyote--;
    if (this.jbuf>0) this.jbuf--;
    if (this.dashCD>0) this.dashCD--;
    if (this.wjCD>0) this.wjCD--;
    if (this.wjLock>0) this.wjLock--;
    if (this.shakeT>0) this.shakeT--;
    if (keys.jumpPressed) this.jbuf = CFG.JBUF;
    const prevX = this.x, prevY = this.y;
    if (this.dashing) {
      this.dashT--;
      this.vx = this.dvx * CFG.DASH_SPD; this.vy = this.dvy * CFG.DASH_SPD * 0.38;
      if (this.dashT <= 0) { this.dashing=false; this.vx*=0.28; this.vy=Math.min(this.vy,2); }
    } else {
      this.vy = Math.min(this.vy + CFG.GRAVITY, CFG.MAX_FALL);
      if (this.onWall!==0 && this.vy>0 && this.stamina>0) {
        this.vy = Math.min(this.vy, CFG.WALL_SLIDE); this.stamina -= CFG.STAM_WALL;
      }
      const mx = keys.left?-1:keys.right?1:0;
      if (mx!==0) this.face=mx;
      if (this.wjLock===0) { const acc=this.onGround?0.78:0.4; this.vx=lerp(this.vx,mx*CFG.SPEED,acc); }
      else if (mx!==0) this.vx=lerp(this.vx,mx*CFG.SPEED,0.1);
      if (this.jbuf>0) {
        if (this.onGround||this.coyote>0) {
          this.vy=CFG.JUMP; this.jbuf=0; this.coyote=0; this.djump=true;
          this.flow=Math.min(CFG.FLOW_MAX,this.flow+CFG.FLOW_J); this.emitJumpFX=true;
        } else if (this.onWall!==0 && this.wjCD===0 && this.stamina>8) {
          this.vy=CFG.WALL_JY; this.vx=-this.onWall*CFG.WALL_JX; this.jbuf=0;
          this.wjCD=18; this.wjLock=16; this.djump=true; this.stamina-=8;
          this.flow=Math.min(CFG.FLOW_MAX,this.flow+CFG.FLOW_WJ); this.emitWallJumpFX=true;
        } else if (this.djump) {
          this.vy=CFG.DJUMP; this.jbuf=0; this.djump=false;
          this.flow=Math.min(CFG.FLOW_MAX,this.flow+CFG.FLOW_J); this.emitJumpFX=true;
        }
      }
      if (keys.dashPressed && this.dashCD===0 && this.stamina>=CFG.STAM_DASH) {
        const dx=keys.left?-1:keys.right?1:this.face;
        const dy=keys.up?-1:0;
        const len=Math.hypot(dx,dy)||1;
        this.dvx=dx/len; this.dvy=dy/len;
        this.dashing=true; this.dashT=CFG.DASH_DUR; this.dashCD=CFG.DASH_CD;
        this.stamina-=CFG.STAM_DASH; this.djump=true;
        this.flow=Math.min(CFG.FLOW_MAX,this.flow+CFG.FLOW_D); this.emitDashFX=true;
      }
    }
    this.x += this.vx;
    this.onWall=0;
    for (const p of world.nearby(this.x,this.y,this.w,this.h)) {
      if (!rectHit(this.x,this.y,this.w,this.h,p.x,p.y,p.w,p.h)) continue;
      if (p.type==="thin") continue;
      if (prevX+this.w<=p.x+4) { this.x=p.x-this.w; this.vx=Math.min(this.vx,0); this.onWall=1; }
      else if (prevX>=p.x+p.w-4) { this.x=p.x+p.w; this.vx=Math.max(this.vx,0); this.onWall=-1; }
    }
    this.y += this.vy;
    this.onGround=false;
    for (const p of world.nearby(this.x,this.y,this.w,this.h)) {
      if (!rectHit(this.x,this.y,this.w,this.h,p.x,p.y,p.w,p.h)) continue;
      if (prevY+this.h<=p.y+3) {
        this.y=p.y-this.h; const imp=this.vy; this.vy=0;
        this.onGround=true; this.coyote=CFG.COYOTE; this.djump=true;
        if (imp>3) { this.shakeT=Math.min(imp*2,15); this.emitLandFX=imp; }
        if (p.type==="crumble"&&p.crumbleT<0) p.crumbleT=26;
      } else if (prevY>=p.y+p.h-3 && p.type!=="thin") {
        this.y=p.y+p.h; this.vy=Math.max(0,this.vy);
      }
    }
    if (this.onGround) this.coyote=CFG.COYOTE;
    const wallSliding = this.onWall!==0 && !this.onGround && this.vy>=0;
    if (!wallSliding && !this.dashing) this.stamina=Math.min(CFG.STAM_MAX,this.stamina+CFG.STAM_REGEN);
    this.flow=Math.max(0,this.flow-CFG.FLOW_DECAY);
    if (this.dashing) this.state="dash";
    else if (!this.onGround&&this.onWall!==0&&this.vy>=0) this.state="wall";
    else if (!this.onGround&&this.vy<0) this.state="jump";
    else if (!this.onGround) this.state="fall";
    else if (Math.abs(this.vx)>0.5) this.state="run";
    else this.state="idle";
    this.altitude=(this.startY-this.y)*CFG.ALT_SCALE;
    if (this.altitude>this.maxAlt) {
      this.maxAlt=this.altitude;
      this.score=Math.floor(this.maxAlt*10*(1+this.flow/CFG.FLOW_MAX*2));
    }
    if (Math.abs(this.vx)>0.5||Math.abs(this.vy)>0.5) {
      this.trail.unshift({x:this.cx,y:this.cy});
      if (this.trail.length>20) this.trail.pop();
    }
    const tg = (this.flow/CFG.FLOW_MAX)*18+(this.dashing?28:0);
    this.glow=lerp(this.glow,tg,0.12);
    if (this.y>this.startY+520) { this.dead=true; this.vx=(Math.random()-0.5)*8; this.vy=-6; }
  }
  draw(ctx, cx, cy, biome) {
    const sx=this.x-cx, sy=this.y-cy;
    const pc=biome.p, flowT=this.flow/CFG.FLOW_MAX;
    ctx.save();
    // Trail
    for (let i=1;i<this.trail.length;i++) {
      const t=this.trail[i], prog=1-i/this.trail.length;
      ctx.globalAlpha=prog*0.22*(this.dashing?1.8:1);
      ctx.fillStyle=this.dashing?"#ffffff":pc;
      ctx.beginPath(); ctx.arc(t.x-cx,t.y-cy,5*prog,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=this.dead?Math.max(0,1-this.deadT/55):1;
    if (this.glow>2) { ctx.shadowBlur=this.glow; ctx.shadowColor=pc; }
    const bodyC=this.dashing?"#ffffff":this.state==="wall"?biome.s:"rgba(192,218,255,0.95)";
    ctx.fillStyle=bodyC;
    rr(ctx,sx,sy,this.w,this.h,this.w/2); ctx.fill();
    ctx.fillStyle="rgba(0,0,0,0.32)";
    rr(ctx,sx+3,sy+4,this.w-6,this.h-8,this.w/2-1); ctx.fill();
    ctx.shadowBlur=10; ctx.shadowColor=pc; ctx.fillStyle=pc;
    const vx=this.face>0?sx+this.w*0.4:sx+this.w*0.1;
    ctx.fillRect(vx,sy+7,this.w*0.42,6);
    if (flowT>0.22) {
      ctx.globalAlpha=(flowT-0.22)*0.65*(this.dead?0:1);
      ctx.strokeStyle=pc; ctx.lineWidth=1.5; ctx.shadowBlur=16;
      rr(ctx,sx-3,sy-3,this.w+6,this.h+6,this.w/2+2); ctx.stroke();
    }
    ctx.shadowBlur=0; ctx.globalAlpha=1; ctx.restore();
  }
}
const rr = (ctx,x,y,w,h,r) => {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
};

// ─── Draw Helpers ────────────────────────────────────────────
const drawPlatform = (ctx,p,cx,cy,biome,t) => {
  const sx=p.x-cx, sy=p.y-cy;
  if (sx>CW+10||sx+p.w<-10||sy>CH+10||sy<-24) return;
  const col=p.type==="crumble"?biome.s:p.type==="grapple"?biome.a:biome.p;
  ctx.save();
  ctx.shadowBlur=7+Math.sin(t*0.04+p.gp)*2.5; ctx.shadowColor=col;
  ctx.fillStyle="rgba(7,4,18,0.9)"; ctx.fillRect(sx,sy,p.w,p.h);
  ctx.fillStyle=col; ctx.globalAlpha=0.88; ctx.fillRect(sx,sy,p.w,2);
  ctx.globalAlpha=0.28; ctx.fillRect(sx,sy+2,2,p.h-2); ctx.fillRect(sx+p.w-2,sy+2,2,p.h-2);
  if (p.type==="crumble"&&p.crumbleT>0) {
    const cp=1-p.crumbleT/26;
    ctx.globalAlpha=cp*0.75; ctx.strokeStyle=biome.s; ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(sx+p.w*0.33,sy); ctx.lineTo(sx+p.w*0.48,sy+p.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx+p.w*0.67,sy); ctx.lineTo(sx+p.w*0.57,sy+p.h); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (p.type==="moving") {
    const pulse=(Math.sin(t*0.06)+1)/2;
    ctx.globalAlpha=0.22+pulse*0.32; ctx.fillStyle=biome.s;
    ctx.fillRect(sx+p.w*0.1,sy+3,p.w*0.8,4);
  }
  ctx.shadowBlur=0; ctx.globalAlpha=1; ctx.restore();
};

const drawCheckpoint = (ctx,cp,cx,cy,t) => {
  const sx=cp.x-cx, sy=cp.y-cy;
  const pulse=(Math.sin(t*0.05)+1)/2;
  ctx.save();
  ctx.shadowBlur=10+pulse*10; ctx.shadowColor="#00ff88";
  ctx.strokeStyle="#00ff88"; ctx.lineWidth=2; ctx.strokeRect(sx,sy,cp.w,cp.h);
  ctx.globalAlpha=0.18+pulse*0.28; ctx.fillStyle="#00ff88"; ctx.fillRect(sx+2,sy+2,cp.w-4,cp.h-4);
  ctx.globalAlpha=0.12+pulse*0.12; ctx.fillRect(sx+cp.w/2-1,sy-28,2,28);
  ctx.shadowBlur=0; ctx.globalAlpha=1; ctx.restore();
};

// ─── Background ──────────────────────────────────────────────
const drawBackground = (ctx,camY,biome,t) => {
  const g=ctx.createLinearGradient(0,0,0,CH);
  g.addColorStop(0,biome.sky[0]); g.addColorStop(1,biome.sky[1]);
  ctx.fillStyle=g; ctx.fillRect(0,0,CW,CH);
  if (biome.id>=3) {
    const sa=(biome.id-2)*0.45;
    for (let i=0;i<70;i++) {
      const tw=0.5+0.5*Math.sin(t*0.028+i);
      ctx.fillStyle=`rgba(200,215,255,${sa*tw*(0.3+0.7*hash(i*9.3))})`;
      ctx.fillRect(hash(i*3.7)*CW, hash(i*5.1)*CH, 1.5, 1.5);
    }
  }
  drawCityLayer(ctx,camY*0.07,biome,0.38,777,t,110,275);
  drawCityLayer(ctx,camY*0.16,biome,0.62,333,t,65,175);
  ctx.fillStyle=biome.fog; ctx.fillRect(0,0,CW,CH);
  const hg=ctx.createLinearGradient(0,CH*0.35,0,CH);
  hg.addColorStop(0,"transparent"); hg.addColorStop(1,biome.p+"08");
  ctx.fillStyle=hg; ctx.fillRect(0,CH*0.35,CW,CH*0.65);
};

const drawCityLayer = (ctx,scrollY,biome,alpha,seed,t,minH,maxH) => {
  const tileH=maxH+55;
  const offset=((scrollY%tileH)+tileH)%tileH;
  for (let tile=0;tile<2;tile++) {
    const baseY=CH-offset+tile*tileH;
    let bx=0,idx=seed;
    while (bx<CW+12) {
      const bw=20+hash(idx)*54, bh=minH+hash(idx+77)*(maxH-minH);
      const by=baseY-bh;
      if (by<CH+12) {
        ctx.globalAlpha=alpha*0.88;
        ctx.fillStyle=biome.bc[Math.floor(hash(idx+11)*3)];
        ctx.fillRect(bx,by,bw,bh+Math.max(0,CH-baseY+12));
        if (bh>38) {
          const cols=Math.floor(bw/8), rows=Math.floor(Math.min(bh,CH-by)/10);
          for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
            const ws=idx*100+r*10+c;
            if (hash(ws)>0.43) {
              ctx.globalAlpha=alpha*(0.35+0.4*Math.sin(t*0.025+ws))*0.55;
              ctx.fillStyle=biome.wc; ctx.fillRect(bx+c*8+2,by+r*10+2,4,5);
            }
          }
        }
      }
      bx+=bw+3; idx++;
    }
  }
  ctx.globalAlpha=1;
};

// ─── Weather ─────────────────────────────────────────────────
class Weather {
  constructor() { this.pts=[]; this.type="none"; this.lightT=0; this.lightA=0; }
  init(type) {
    this.type=type; this.pts=[];
    const counts={rain:250,snow:150,embers:100,debris:60,lightning:0,none:0};
    for (let i=0;i<(counts[type]||0);i++) this.spawn(true);
  }
  spawn(rnd=false) {
    const t=this.type, p={x:rand(0,CW),y:rnd?rand(0,CH):-10};
    if (t==="rain") Object.assign(p,{vx:-0.9,vy:rand(13,19),len:rand(8,16),a:rand(0.18,0.48)});
    else if (t==="snow") Object.assign(p,{vx:rand(-0.3,0.3),vy:rand(0.7,2.4),r:rand(1.5,4),a:rand(0.4,0.8),drift:rand(-0.012,0.012)});
    else if (t==="embers") Object.assign(p,{vx:rand(-0.4,1.6),vy:rand(-3,-0.5),r:rand(1.5,3.5),a:rand(0.3,0.7),life:rand(55,120),maxLife:rand(55,120)});
    else if (t==="debris") Object.assign(p,{vx:rand(-2,2),vy:rand(1,4),sz:rand(2,7),a:rand(0.2,0.5)});
    this.pts.push(p);
  }
  update() {
    for (let i=this.pts.length-1;i>=0;i--) {
      const p=this.pts[i]; p.x+=p.vx; p.y+=p.vy;
      if (this.type==="snow") { p.vx+=p.drift; p.vx=clamp(p.vx,-1,1); }
      if (this.type==="embers") { p.life--; if(p.life<=0){this.pts.splice(i,1);this.spawn();continue;} }
      if (p.y>CH+22||(this.type==="embers"&&p.y<-22)) { this.pts.splice(i,1); this.spawn(); }
    }
    if (this.type==="lightning") {
      this.lightT--; if(this.lightT<=0){this.lightA=0.55;this.lightT=rand(80,210)|0;}
      this.lightA=Math.max(0,this.lightA-0.04);
    }
  }
  draw(ctx) {
    ctx.save();
    for (const p of this.pts) {
      ctx.globalAlpha=p.a;
      if (this.type==="rain") {
        ctx.strokeStyle="rgba(140,185,255,0.55)"; ctx.lineWidth=0.9;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.vx*1.4,p.y+p.len*0.5); ctx.stroke();
      } else if (this.type==="snow") {
        ctx.fillStyle="rgba(210,228,255,0.9)"; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      } else if (this.type==="embers") {
        ctx.fillStyle="#ff8800"; ctx.shadowBlur=6; ctx.shadowColor="#ff5500";
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0;
      } else if (this.type==="debris") {
        ctx.fillStyle="rgba(95,75,55,0.6)"; ctx.fillRect(p.x,p.y,p.sz,p.sz*0.4);
      }
    }
    if (this.lightA>0) { ctx.globalAlpha=this.lightA; ctx.fillStyle="rgba(155,148,255,1)"; ctx.fillRect(0,0,CW,CH); }
    ctx.globalAlpha=1; ctx.restore();
  }
}

// ─── Flying Objects ──────────────────────────────────────────
class FlyingObjs {
  constructor() { this.objs=[]; for(let i=0;i<7;i++) this.spawn(true); }
  spawn(rnd=false) {
    const dir=Math.random()>0.5?1:-1;
    this.objs.push({
      x:dir===1?-90:CW+90, y:rnd?rand(18,CH*0.62):rand(18,CH*0.62),
      vx:dir*rand(0.6,2.3), sz:rand(7,18),
      type:Math.random()>0.44?"vehicle":"drone",
      lc:Math.random()>0.5?"#00f5ff":"#ff0080",
      phase:rand(0,Math.PI*2), dir,
    });
  }
  update() {
    for (let i=this.objs.length-1;i>=0;i--) {
      const o=this.objs[i]; o.x+=o.vx; o.phase+=0.042;
      if((o.dir===1&&o.x>CW+130)||(o.dir===-1&&o.x<-130)){this.objs.splice(i,1);this.spawn();}
    }
  }
  draw(ctx) {
    ctx.save(); ctx.globalAlpha=0.68;
    for (const o of this.objs) {
      const lOn=Math.sin(o.phase)>0.25;
      if (o.type==="vehicle") {
        ctx.fillStyle="rgba(14,11,28,0.92)"; ctx.fillRect(o.x-o.sz,o.y-o.sz*0.3,o.sz*2,o.sz*0.6);
        ctx.fillStyle=lOn?o.lc:"rgba(55,55,100,0.25)";
        if(lOn){ctx.shadowBlur=8;ctx.shadowColor=o.lc;}
        ctx.fillRect(o.x-o.sz*0.4,o.y-o.sz*0.18,o.sz*0.7,o.sz*0.28);
      } else {
        ctx.fillStyle="rgba(18,15,32,0.88)";
        ctx.fillRect(o.x-o.sz*0.38,o.y-o.sz*0.1,o.sz*0.76,o.sz*0.2);
        ctx.fillRect(o.x-o.sz*0.1,o.y-o.sz*0.38,o.sz*0.2,o.sz*0.76);
        ctx.fillStyle=lOn?o.lc:"rgba(70,70,115,0.25)";
        if(lOn){ctx.shadowBlur=10;ctx.shadowColor=o.lc;}
        ctx.beginPath(); ctx.arc(o.x,o.y,o.sz*0.14,0,Math.PI*2); ctx.fill();
      }
      ctx.shadowBlur=0;
    }
    ctx.globalAlpha=1; ctx.restore();
  }
}

// ─── HUD ─────────────────────────────────────────────────────
const HUD = ({alt,stam,flow,score,biome}) => {
  const ft=flow/CFG.FLOW_MAX, st=stam/CFG.STAM_MAX;
  const pc=biome?.p||"#00f5ff";
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",fontFamily:"'Courier New',monospace"}}>
      <div style={{position:"absolute",top:14,left:14,right:14,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:9,letterSpacing:3,color:pc,opacity:0.55,marginBottom:2}}>ALTITUDE</div>
          <div style={{fontSize:26,fontWeight:900,color:"#fff",letterSpacing:2,textShadow:`0 0 22px ${pc}`}}>
            {String(Math.floor(Math.max(0,alt))).padStart(5,"0")}
          </div>
          <div style={{fontSize:8,color:pc,opacity:0.4,letterSpacing:2,marginTop:1}}>METERS</div>
        </div>
        {biome&&<div style={{fontSize:8,letterSpacing:3,color:pc,opacity:0.62,textShadow:`0 0 8px ${pc}`,marginTop:5}}>{biome.name}</div>}
        <div style={{textAlign:"right"}}>
          <div style={{fontSize:9,letterSpacing:3,color:pc,opacity:0.55,marginBottom:2}}>SCORE</div>
          <div style={{fontSize:18,fontWeight:700,color:"#fff",letterSpacing:1,textShadow:`0 0 16px ${pc}`}}>
            {String(score).padStart(6,"0")}
          </div>
        </div>
      </div>
      <div style={{position:"absolute",bottom:22,left:14,right:14}}>
        <div style={{marginBottom:8}}>
          <span style={{fontSize:8,color:pc,opacity:0.5,letterSpacing:2}}>STAMINA</span>
          <div style={{height:2,background:"rgba(255,255,255,0.08)",borderRadius:1,marginTop:3}}>
            <div style={{height:"100%",width:`${st*100}%`,borderRadius:1,background:st>0.3?pc:"#ff4040",boxShadow:`0 0 5px ${st>0.3?pc:"#ff4040"}`,transition:"width 0.08s,background 0.3s"}}/>
          </div>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:8,color:pc,opacity:0.5,letterSpacing:2}}>FLOW</span>
            {ft>0.05&&<span style={{fontSize:9,color:"#fff",letterSpacing:1,textShadow:`0 0 8px ${pc}`}}>×{(1+ft*2).toFixed(1)}</span>}
          </div>
          <div style={{height:2,background:"rgba(255,255,255,0.08)",borderRadius:1}}>
            <div style={{height:"100%",width:`${ft*100}%`,borderRadius:1,background:`linear-gradient(90deg,${pc},#fff)`,boxShadow:`0 0 8px ${pc}`,transition:"width 0.06s"}}/>
          </div>
        </div>
      </div>
      {ft>0.76&&<div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:9,letterSpacing:5,color:pc,textShadow:`0 0 22px ${pc}`,opacity:(ft-0.76)*3.5}}>FLOW STATE</div>}
    </div>
  );
};

// ─── Touch Controls ──────────────────────────────────────────
const TouchControls = ({keysRef}) => {
  const btnStyle = (r,g,b) => ({
    width:52,height:52,
    background:`rgba(${r},${g},${b},0.14)`,
    border:`1px solid rgba(${r},${g},${b},0.42)`,
    color:`rgba(${r},${g},${b},0.88)`,
    fontSize:10,letterSpacing:1,fontFamily:"'Courier New',monospace",
    display:"flex",alignItems:"center",justifyContent:"center",
    userSelect:"none",WebkitUserSelect:"none",touchAction:"none",cursor:"pointer",
  });
  const tap = (key,val) => (e) => { e.preventDefault(); keysRef.current[key]=val; };
  return (
    <div style={{position:"absolute",bottom:16,left:0,right:0,display:"flex",justifyContent:"space-between",padding:"0 12px",pointerEvents:"none"}}>
      <div style={{display:"flex",gap:6,pointerEvents:"auto"}}>
        <div style={btnStyle(0,245,255)} onPointerDown={tap("left",true)} onPointerUp={tap("left",false)} onPointerLeave={tap("left",false)}>◀</div>
        <div style={btnStyle(0,245,255)} onPointerDown={tap("right",true)} onPointerUp={tap("right",false)} onPointerLeave={tap("right",false)}>▶</div>
      </div>
      <div style={{display:"flex",gap:6,pointerEvents:"auto"}}>
        <div style={btnStyle(180,0,255)} onPointerDown={e=>{e.preventDefault();keysRef.current.dashPressed=true;}}>DASH</div>
      </div>
    </div>
  );
};

// ─── Main Menu ───────────────────────────────────────────────
const MainMenu = ({onStart}) => {
  const bgRef=useRef(null); const raf=useRef(null);
  const [phase,setPhase]=useState(0); const [sel,setSel]=useState(0);
  const chars=[
    {name:"KGAETSII",desc:"SPEED × PRECISION",col:"#00f5ff"},
    {name:"LESIAMO",desc:"STEALTH × POWER",col:"#aa00ff"},
    {name:"MALOME",desc:"FLIGHT × ENDURANCE",col:"#ff8c00"},
  ];
  useEffect(()=>{
    const c=bgRef.current; if(!c) return;
    const ctx=c.getContext("2d"); let t=0;
    const ghosts=Array.from({length:5},()=>({x:rand(40,360),y:rand(200,680),vy:-rand(0.5,1.4),vx:rand(-0.2,0.2),a:rand(0.1,0.24),sz:rand(8,14),trail:[]}));
    const anim=()=>{
      t++;
      ctx.clearRect(0,0,400,700);
      const bg=ctx.createLinearGradient(0,0,0,700); bg.addColorStop(0,"#03000e"); bg.addColorStop(1,"#07001c");
      ctx.fillStyle=bg; ctx.fillRect(0,0,400,700);
      for(let i=0;i<95;i++){
        const tw=0.5+0.5*Math.sin(t*0.028+i);
        ctx.fillStyle=`rgba(200,210,255,${(0.18+0.6*hash(i*9.3))*tw})`;
        ctx.fillRect(hash(i*3.7)*400,hash(i*5.1)*700,1.5,1.5);
      }
      let bx=0,bi=0;
      while(bx<400){
        const bw=22+hash(bi+500)*52,bh=60+hash(bi+600)*200;
        ctx.fillStyle="rgba(4,0,18,0.92)"; ctx.fillRect(bx,700-bh,bw,bh);
        const cols=Math.floor(bw/7),rows=Math.floor(bh/9);
        for(let r=1;r<rows-1;r++) for(let c=1;c<cols-1;c++){
          const ws=bi*200+r*10+c;
          if(hash(ws)>0.45){
            const fa=(0.12+0.32*Math.sin(t*0.022+ws))*(hash(ws+100)>0.3?1:0.25);
            ctx.fillStyle=`rgba(0,200,255,${fa})`; ctx.fillRect(bx+c*7+1,700-bh+r*9+1,4,5);
          }
        }
        bx+=bw+2; bi++;
      }
      const hg=ctx.createLinearGradient(0,0,400,0);
      hg.addColorStop(0,"transparent"); hg.addColorStop(0.35,"rgba(0,200,255,0.18)"); hg.addColorStop(0.65,"rgba(160,0,255,0.18)"); hg.addColorStop(1,"transparent");
      ctx.fillStyle=hg; ctx.fillRect(0,495,400,2);
      for(let r=0;r<75;r++){
        const rx=(hash(r*7)*400+t*0.5)%400,ry=(t*10+r*35)%700;
        ctx.strokeStyle=`rgba(110,155,255,${0.06+hash(r)*0.14})`; ctx.lineWidth=0.8;
        ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx-0.8,ry+9); ctx.stroke();
      }
      for(let i=0;i<2;i++){
        const bX=130+i*150+Math.sin(t*0.01+i)*14;
        const bg2=ctx.createRadialGradient(bX,700,0,bX,350,380);
        bg2.addColorStop(0,"rgba(0,100,200,0.06)"); bg2.addColorStop(1,"transparent");
        ctx.fillStyle=bg2; ctx.fillRect(bX-140,0,280,700);
      }
      for(const g of ghosts){
        g.y+=g.vy; g.x+=g.vx+Math.sin(t*0.03+g.x)*0.14;
        g.trail.unshift({x:g.x,y:g.y});
        if(g.trail.length>12) g.trail.pop();
        if(g.y<-30){g.y=730;g.x=rand(40,360);g.trail=[];}
        for(let ti=1;ti<g.trail.length;ti++){
          const tr=g.trail[ti],prog=1-ti/g.trail.length;
          ctx.globalAlpha=g.a*prog*0.5; ctx.fillStyle="#00f5ff";
          ctx.beginPath(); ctx.arc(tr.x,tr.y,5*prog,0,Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha=g.a; ctx.shadowBlur=12; ctx.shadowColor="#00f5ff";
        ctx.fillStyle="rgba(160,212,255,0.65)"; ctx.fillRect(g.x-g.sz/2,g.y-g.sz,g.sz,g.sz*2);
        ctx.shadowBlur=0; ctx.globalAlpha=1;
      }
      for(let i=0;i<4;i++){
        const vx=((t*(0.6+i*0.3)+i*200)%520)-60,vy2=75+i*78+Math.sin(t*0.008+i)*14;
        const lOn=Math.sin(t*0.05+i)>0, lc=i%2?"#ff0080":"#00f5ff";
        ctx.fillStyle="rgba(10,8,24,0.9)"; ctx.fillRect(vx-20,vy2-4,40,8);
        ctx.fillStyle=lOn?lc:"rgba(45,45,90,0.2)";
        if(lOn){ctx.shadowBlur=8;ctx.shadowColor=lc;}
        ctx.beginPath(); ctx.arc(vx+18,vy2,3,0,Math.PI*2); ctx.fill();
        ctx.shadowBlur=0;
      }
      raf.current=requestAnimationFrame(anim);
    };
    anim(); return ()=>cancelAnimationFrame(raf.current);
  },[]);
  const btn={background:"linear-gradient(135deg,rgba(0,245,255,0.1),rgba(0,100,255,0.1))",border:"1px solid rgba(0,245,255,0.48)",color:"#fff",padding:"14px 0",width:228,fontSize:11,letterSpacing:4,fontFamily:"'Courier New',monospace",cursor:"pointer",display:"block",margin:"0 auto",boxShadow:"0 0 14px rgba(0,245,255,0.14)",transition:"all 0.2s"};
  const ghostBtn={...btn,background:"transparent",border:"1px solid rgba(255,255,255,0.14)",color:"rgba(255,255,255,0.38)",boxShadow:"none"};
  return (
    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <canvas ref={bgRef} width={400} height={700} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:400,textAlign:"center",padding:"0 26px"}}>
        <div style={{marginBottom:46}}>
          <div style={{fontSize:86,fontWeight:900,letterSpacing:22,color:"#fff",fontFamily:"'Courier New',monospace",lineHeight:1,textShadow:"0 0 50px rgba(0,245,255,0.88),0 0 100px rgba(0,100,255,0.48)"}}>VEIL</div>
          <div style={{fontSize:9,letterSpacing:6,color:"rgba(0,245,255,0.52)",marginTop:10}}>ASCEND BEYOND THE HORIZON</div>
        </div>
        {phase===0&&(
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button style={btn}
              onClick={()=>setPhase(1)}
              onMouseEnter={e=>e.currentTarget.style.boxShadow="0 0 34px rgba(0,245,255,0.44)"}
              onMouseLeave={e=>e.currentTarget.style.boxShadow="0 0 14px rgba(0,245,255,0.14)"}
            >BEGIN ASCENT</button>
            <button style={ghostBtn} onClick={()=>setPhase(2)}>LEADERBOARD</button>
            <button style={ghostBtn}>SETTINGS</button>
          </div>
        )}
        {phase===1&&(
          <div>
            <div style={{fontSize:9,letterSpacing:4,color:"rgba(0,245,255,0.52)",marginBottom:18}}>SELECT OPERATOR</div>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:20}}>
              {chars.map((ch,i)=>(
                <div key={i} onClick={()=>setSel(i)} style={{border:sel===i?`2px solid ${ch.col}`:"2px solid rgba(255,255,255,0.1)",padding:"13px 6px",cursor:"pointer",width:84,background:sel===i?`${ch.col}14`:"rgba(0,0,0,0.28)",boxShadow:sel===i?`0 0 18px ${ch.col}38`:"none",transition:"all 0.2s"}}>
                  <div style={{width:26,height:46,margin:"0 auto 8px",background:sel===i?ch.col:"rgba(255,255,255,0.22)",clipPath:"polygon(38% 0%,62% 0%,68% 14%,78% 14%,78% 40%,62% 40%,62% 56%,82% 100%,18% 100%,38% 56%,38% 40%,22% 40%,22% 14%,32% 14%)",boxShadow:sel===i?`0 0 12px ${ch.col}`:"none"}}/>
                  <div style={{fontSize:7,letterSpacing:0.8,lineHeight:1.4,color:sel===i?ch.col:"rgba(255,255,255,0.32)"}}>
                    {ch.name.split(" ").map((w,j)=><div key={j}>{w}</div>)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{fontSize:8,color:"rgba(0,245,255,0.44)",letterSpacing:3,marginBottom:16}}>{chars[sel].desc}</div>
            <button style={{...btn,border:`1px solid ${chars[sel].col}`,background:`${chars[sel].col}14`,boxShadow:`0 0 24px ${chars[sel].col}32`}} onClick={()=>onStart(sel)}>ASCEND</button>
            <button onClick={()=>setPhase(0)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.28)",fontSize:9,letterSpacing:2,cursor:"pointer",fontFamily:"'Courier New',monospace",marginTop:14,display:"block",margin:"14px auto 0"}}>← BACK</button>
          </div>
        )}
        {phase===2&&(
          <div>
            <div style={{fontSize:10,letterSpacing:4,color:"rgba(0,245,255,0.8)",marginBottom:24}}>LEADERBOARD</div>
            <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:24}}>
              {chars.map((ch,i)=>{
                 const scores = JSON.parse(localStorage.getItem('veil_scores') || '{"0":0,"1":0,"2":0}');
                 return (
                   <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${ch.col}44`,paddingBottom:8}}>
                     <div style={{color:ch.col,fontSize:10,letterSpacing:2}}>{ch.name}</div>
                     <div style={{color:"#fff",fontSize:14,letterSpacing:2}}>{String(scores[i]).padStart(6,"0")}</div>
                   </div>
                 )
              })}
            </div>
            <button onClick={()=>setPhase(0)} style={{...ghostBtn,marginTop:14}}>← BACK</button>
          </div>
        )}
        <div style={{position:"absolute",bottom:-65,left:0,right:0,fontSize:8,color:"rgba(255,255,255,0.18)",letterSpacing:2,lineHeight:2.1}}>
          <div>WASD · ARROWS — MOVE</div><div>SPACE — JUMP · SHIFT — DASH</div>
        </div>
      </div>
    </div>
  );
};

// ─── Game Over ───────────────────────────────────────────────
const GameOver = ({alt,score,onRestart,onMenu}) => (
  <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"radial-gradient(ellipse at center,rgba(0,0,20,0.95) 0%,rgba(0,0,0,0.99) 100%)",fontFamily:"'Courier New',monospace"}}>
    <div style={{fontSize:9,letterSpacing:6,color:"rgba(255,55,55,0.68)",marginBottom:14}}>SIGNAL LOST</div>
    <div style={{fontSize:52,color:"#fff",letterSpacing:10,marginBottom:42,textShadow:"0 0 40px rgba(255,55,55,0.55)"}}>FALLEN</div>
    <div style={{display:"flex",gap:44,marginBottom:48}}>
      {[["ALTITUDE",Math.floor(Math.max(0,alt)),"METERS"],["SCORE",score,""]].map(([l,v,u],i)=>(
        <div key={i} style={{textAlign:"center"}}>
          <div style={{fontSize:8,letterSpacing:3,color:"rgba(0,245,255,0.58)",marginBottom:6}}>{l}</div>
          <div style={{fontSize:32,color:"#fff",letterSpacing:2}}>{v}</div>
          {u&&<div style={{fontSize:7,color:"rgba(0,245,255,0.38)",letterSpacing:2,marginTop:2}}>{u}</div>}
        </div>
      ))}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <button onClick={onRestart} style={{background:"linear-gradient(135deg,rgba(0,245,255,0.1),rgba(0,100,255,0.1))",border:"1px solid rgba(0,245,255,0.5)",color:"#fff",padding:"13px 0",width:218,fontSize:11,letterSpacing:4,fontFamily:"'Courier New',monospace",cursor:"pointer",boxShadow:"0 0 18px rgba(0,245,255,0.18)"}}>ASCEND AGAIN</button>
      <button onClick={onMenu} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.14)",color:"rgba(255,255,255,0.38)",padding:"12px 0",width:218,fontSize:10,letterSpacing:4,fontFamily:"'Courier New',monospace",cursor:"pointer"}}>MAIN MENU</button>
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────
export default function VEIL() {
  const canvasRef=useRef(null);
  const [screen,setScreen]=useState("menu");
  const [hud,setHud]=useState({alt:0,stam:CFG.STAM_MAX,flow:0,score:0,biome:BIOMES[0]});
  const [stats,setStats]=useState({alt:0,score:0});
  const [scale,setScale]=useState(1);
  const activeOpRef=useRef(0);
  const gameRef=useRef(null);
  const rafRef=useRef(null);
  const keysRef=useRef({left:false,right:false,up:false,down:false,jumpPressed:false,dashPressed:false});

  useEffect(()=>{
    const resize=()=>setScale(Math.min(window.innerWidth/CW,window.innerHeight/CH));
    resize(); window.addEventListener("resize",resize);
    return ()=>window.removeEventListener("resize",resize);
  },[]);

  useEffect(()=>{
    const dn=(e)=>{
      const k=keysRef.current;
      if(e.key==="ArrowLeft"||e.key==="a"||e.key==="A") k.left=true;
      if(e.key==="ArrowRight"||e.key==="d"||e.key==="D") k.right=true;
      if(e.key==="ArrowUp"||e.key==="w"||e.key==="W") k.up=true;
      if(e.key==="ArrowDown"||e.key==="s"||e.key==="S") k.down=true;
      if(e.key===" "){k.jumpPressed=true;e.preventDefault();}
      if(e.key==="Shift"){k.dashPressed=true;e.preventDefault();}
    };
    const up=(e)=>{
      const k=keysRef.current;
      if(e.key==="ArrowLeft"||e.key==="a"||e.key==="A") k.left=false;
      if(e.key==="ArrowRight"||e.key==="d"||e.key==="D") k.right=false;
      if(e.key==="ArrowUp"||e.key==="w"||e.key==="W") k.up=false;
      if(e.key==="ArrowDown"||e.key==="s"||e.key==="S") k.down=false;
    };
    window.addEventListener("keydown",dn); window.addEventListener("keyup",up);
    return ()=>{window.removeEventListener("keydown",dn);window.removeEventListener("keyup",up);};
  },[]);

  const startGame=useCallback(()=>{
    const canvas=canvasRef.current; if(!canvas) return;
    const ctx=canvas.getContext("2d");
    const startX=CW/2-CFG.PW/2, startY=CH-95;
    const world=new World(); world.init(startY);
    const player=new Player(startX,startY,startY);
    const particles=new Particles();
    const weather=new Weather(); weather.init("rain");
    const flyObjs=new FlyingObjs();
    const cam={x:0,y:startY-CH*0.55,trauma:0,sx:0,sy:0};
    let biome=BIOMES[0], time=0;
    gameRef.current={running:true};
    const loop=()=>{
      if(!gameRef.current?.running) return;
      time++;
      const nb=getBiome(player.maxAlt);
      if(nb.id!==biome.id){biome=nb;weather.init(biome.weather);}
      player.update(keysRef.current,world);
      keysRef.current.jumpPressed=false; keysRef.current.dashPressed=false;
      // FX Emissions
      if(player.emitJumpFX){
        for(let i=0;i<8;i++) particles.emit({x:player.cx,y:player.y+player.h,vx:rand(-3,3),vy:-rand(2,6),maxLife:22,r:rand(1.5,3.5),color:biome.p,glow:true});
        player.emitJumpFX=false;
      }
      if(player.emitWallJumpFX){
        for(let i=0;i<11;i++) particles.emit({x:player.x+(player.onWall===1?0:player.w),y:player.cy,vx:-player.onWall*rand(2,5.5),vy:rand(-4,-0.8),maxLife:22,r:rand(1.5,3.5),color:biome.s,glow:true});
        player.emitWallJumpFX=false;
      }
      if(player.emitDashFX){
        for(let i=0;i<16;i++) particles.emit({x:player.cx+rand(-10,10),y:player.cy+rand(-10,10),vx:-player.dvx*rand(3,8)+rand(-2,2),vy:-player.dvy*rand(2,5)+rand(-2,2),maxLife:18,r:rand(1.5,4),color:"#fff",glow:true});
        player.emitDashFX=false;
      }
      if(player.emitLandFX>3){
        for(let i=0;i<6;i++) particles.emit({x:player.x+rand(0,player.w),y:player.y+player.h,vx:rand(-3,3),vy:-rand(1.2,4),maxLife:20,r:rand(1.5,3.2),color:biome.p,glow:false});
        player.emitLandFX=0;
      }
      if(player.dashing&&time%2===0) particles.emit({x:player.cx,y:player.cy,vx:rand(-1,1),vy:rand(-1,1),maxLife:12,r:rand(2,5),color:"#fff",glow:true});
      if(player.state==="wall"&&time%4===0) particles.emit({x:player.x+(player.onWall===1?0:player.w),y:player.y+player.h*0.7,vx:-player.onWall*rand(1,3),vy:rand(0.8,3),maxLife:15,r:rand(1,2.5),color:biome.p,glow:false});
      particles.update(); world.update(cam.y); weather.update(); flyObjs.update();
      // Camera
      const tcx=player.cx-CW/2, tcy=player.y-CH*0.54+player.vy*3.5;
      cam.x=lerp(cam.x,tcx,0.095); cam.y=lerp(cam.y,tcy,0.1);
      cam.trauma=Math.max(0,cam.trauma-0.052);
      if(player.shakeT>0) cam.trauma=Math.max(cam.trauma,player.shakeT/15*0.65);
      const shk=cam.trauma*cam.trauma*7;
      cam.sx=(Math.random()-0.5)*shk; cam.sy=(Math.random()-0.5)*shk;
      const cx=cam.x+cam.sx, cy=cam.y+cam.sy;
      // RENDER
      ctx.clearRect(0,0,CW,CH);
      drawBackground(ctx,cam.y,biome,time);
      flyObjs.draw(ctx);
      weather.draw(ctx);
      for(const p of world.platforms) { if(!p.active) continue; drawPlatform(ctx,p,cx,cy,biome,time); }
      for(const cp of world.checkpoints){
        if(cp.reached) continue;
        drawCheckpoint(ctx,cp,cx,cy,time);
        if(rectHit(player.x,player.y,player.w,player.h,cp.x,cp.y,cp.w,cp.h)) cp.reached=true;
      }
      particles.draw(ctx,cx,cy);
      player.draw(ctx,cx,cy,biome);
      // Scanlines
      for(let y=0;y<CH;y+=4){ctx.fillStyle="rgba(0,0,0,0.022)";ctx.fillRect(0,y,CW,1);}
      // Death overlay
      if(player.dead){
        ctx.fillStyle=`rgba(175,0,0,${Math.min(0.62,player.deadT/75)})`;
        ctx.fillRect(0,0,CW,CH);
        if(player.deadT>75&&gameRef.current?.running){
          gameRef.current.running=false;
          const op = activeOpRef.current;
          const scores = JSON.parse(localStorage.getItem('veil_scores') || '{"0":0,"1":0,"2":0}');
          if(player.score > scores[op]) {
            scores[op] = player.score;
            localStorage.setItem('veil_scores', JSON.stringify(scores));
          }
          setStats({alt:Math.max(0,player.maxAlt),score:player.score});
          setScreen("gameover"); return;
        }
      }
      // HUD data
      if(time%5===0) setHud({alt:player.altitude,stam:player.stamina,flow:player.flow,score:player.score,biome});
      rafRef.current=requestAnimationFrame(loop);
    };
    rafRef.current=requestAnimationFrame(loop);
  },[]);

  useEffect(()=>{
    if(screen!=="game"){cancelAnimationFrame(rafRef.current);if(gameRef.current) gameRef.current.running=false;return;}
    startGame(); return ()=>{cancelAnimationFrame(rafRef.current);if(gameRef.current) gameRef.current.running=false;};
  },[screen,startGame]);

  return (
    <div style={{width:"100vw",height:"100dvh",background:"#000",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",touchAction:"none"}}>
      <div style={{position:"relative",width:CW,height:CH,transform:`scale(${scale})`,transformOrigin:"center center",overflow:"hidden"}}>
        <canvas ref={canvasRef} width={CW} height={CH} style={{display:"block",background:"#000",touchAction:"none"}} onPointerDown={(e)=>{keysRef.current.jumpPressed=true; e.preventDefault();}}/>
        {screen==="game"&&<><HUD alt={hud.alt} stam={hud.stam} flow={hud.flow} score={hud.score} biome={hud.biome}/><TouchControls keysRef={keysRef}/></>}
        {screen==="menu"&&<MainMenu onStart={(sel)=>{activeOpRef.current=sel; setScreen("game");}}/>}
        {screen==="gameover"&&<GameOver alt={stats.alt} score={stats.score} onRestart={()=>setScreen("game")} onMenu={()=>setScreen("menu")}/>}
      </div>
    </div>
  );
}
