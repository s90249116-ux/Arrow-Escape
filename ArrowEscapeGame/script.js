(() => {
  "use strict";

  const N = 6, TOTAL = 120;
  const SAVE_KEY = "arrowEscapeExtremeSaveV4";
  const $ = id => document.getElementById(id);

  const SKINS = [
    { id:"white", name:"Pure White", price:0, color:"#fff", glow:"#fff" },
    { id:"ice", name:"Ice White", price:100, color:"#dff8ff", glow:"#82e6ff" },
    { id:"gold", name:"Golden Light", price:180, color:"#fce3a3", glow:"#f8c651" },
    { id:"mint", name:"Mint Glow", price:250, color:"#b7ffca", glow:"#5af48d" },
    { id:"violet", name:"Violet Edge", price:350, color:"#e4c8ff", glow:"#a369e4" }
  ];

  const ACHIEVEMENTS = [
    {id:"first",name:"First Escape",desc:"Complete one level.",test:s=>s.totalWins>=1},
    {id:"ten",name:"Getting Serious",desc:"Complete 10 levels.",test:s=>s.totalWins>=10},
    {id:"25",name:"Puzzle Hunter",desc:"Complete 25 levels.",test:s=>s.totalWins>=25},
    {id:"100",name:"Century Club",desc:"Complete 100 levels.",test:s=>s.totalWins>=100},
    {id:"stars",name:"Star Collector",desc:"Earn 30 stars.",test:s=>s.stars>=30},
    {id:"nohint",name:"Think for Yourself",desc:"Win without a hint.",test:s=>s.noHintWins>=1},
    {id:"daily",name:"Daily Challenger",desc:"Complete a daily puzzle.",test:s=>s.dailyWins>=1},
    {id:"streak",name:"On a Roll",desc:"Reach a 3-day streak.",test:s=>s.bestStreak>=3},
    {id:"rich",name:"Coin Collector",desc:"Hold 500 coins.",test:s=>s.coins>=500},
    {id:"timed",name:"Speed Thinker",desc:"Win a Time Attack.",test:s=>s.timeWins>=1}
  ];
  

  function defaults() {
    return {
      coins:60, stars:0, unlocked:1, currentLevel:1,
      bestStars:{}, claimedLevels:[], levelStats:{},
      totalWins:0, noHintWins:0, dailyWins:0, timeWins:0,
      achievements:[], dailyDate:"", dailyDone:false,
      streak:0, bestStreak:0, lastDailyDate:"",
      sound:true, vibration:true, ownedSkins:["white"],
      activeSkin:"white", totalMoves:0, totalCoinsEarned:0,
      claimedTimedDates:[]
    };
  }

  
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!raw || typeof raw !== "object") return defaults();
      const d = {...defaults(), ...raw};
      for (const key of ["bestStars","levelStats"]) {
        if (!d[key] || typeof d[key] !== "object" || Array.isArray(d[key])) d[key] = {};
      }
      for (const key of ["claimedLevels","achievements","ownedSkins","claimedTimedDates"]) {
        if (!Array.isArray(d[key])) d[key] = [];
      }
      d.coins = Math.max(0, Number(d.coins)||0);
      d.stars = Math.max(0, Number(d.stars)||0);
      d.unlocked = Math.max(1, Math.min(TOTAL, Number(d.unlocked)||1));
      d.currentLevel = Math.max(1, Math.min(d.unlocked, Number(d.currentLevel)||1));
      if (!SKINS.some(s=>s.id===d.activeSkin)) d.activeSkin = "white";
      if (!d.ownedSkins.includes("white")) d.ownedSkins.push("white");
      return d;
    } catch { return defaults(); }
  }

  let save = load();
  let level = save.currentLevel;
  let arrows = [], initial = [], history = [];
  let solution = [];
  let moves = 0, busy = false, hintUsed = false;
  let daily = false, timed = false, timerId = null, timerStart = 0;
  let elapsed = 0, timeLeft = 0, timeLimit = 0;
  let started = false, toastId = null, audio = null;

  const E = {
    board:$("board"), coins:$("coinCount"), stars:$("starCount"),
    progress:$("progressText"), bar:$("progressBar"),
    title:$("levelTitle"), mode:$("modeLabel"), subtitle:$("subtitle"),
    arrowCount:$("arrowCount"), moveCount:$("moveCount"),
    timer:$("timer"), timerMode:$("timerMode"),
    timerRow:document.querySelector(".timer-row"),
    hint:$("hintBtn"), undo:$("undoBtn"), restart:$("restartBtn"),
    levels:$("levelsBtn"), daily:$("dailyBtn"), dailyStatus:$("dailyStatus"),
    time:$("timeBtn"), achievements:$("achievementsBtn"),
    achievementCount:$("achievementCount"), stats:$("statsBtn"), shop:$("shopBtn"),
    sound:$("soundBtn"), vibration:$("vibrationBtn"),
    backdrop:$("modalBackdrop"), close:$("modalClose"),
    icon:$("modalIcon"), eyebrow:$("modalEyebrow"), modalTitle:$("modalTitle"),
    text:$("modalText"), extra:$("modalExtra"), actions:$("modalActions"),
    toast:$("toast")
  };

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  function dateBefore(s) {
    const d = new Date(`${s}T12:00:00`);
    d.setDate(d.getDate()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function hash(s) {
    let h = 2166136261;
    for (let i=0;i<s.length;i++) h = Math.imul(h ^ s.charCodeAt(i),16777619);
    return h >>> 0;
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t>>>15),t|1);
      t ^= t + Math.imul(t ^ (t>>>7),t|61);
      return ((t ^ (t>>>14))>>>0)/4294967296;
    };
  }


  const copy = x => JSON.parse(JSON.stringify(x));
  const cellsOf = a => Array.from({length:a.len},(_,i) =>
    `${a.row+(a.dir==="v"?i:0)},${a.col+(a.dir==="h"?i:0)}`
  );

  function occupied(list) {
    const s = new Set();
    for (const a of list) for (const c of cellsOf(a)) s.add(c);
    return s;
  }

  function clearPath(a, occ) {
    let r=a.row, c=a.col, dr=0, dc=0;
    if (a.dir==="h") {
      c = a.face==="right" ? a.col+a.len-1 : a.col;
      dc = a.face==="right" ? 1 : -1;
    } else {
      r = a.face==="down" ? a.row+a.len-1 : a.row;
      dr = a.face==="down" ? 1 : -1;
    }
    r+=dr; c+=dc;
    while (r>=0 && r<N && c>=0 && c<N) {
      if (occ.has(`${r},${c}`)) return false;
      r+=dr; c+=dc;
    }
    return true;
  }

  function canRemove(a,list) {
    return clearPath(a,occupied(list.filter(b=>b.id!==a.id)));
  }
  
  function solvePuzzle(list, nodeLimit=180000) {
    const n=list.length;
    if (n>30) return null;
    const full=(1n<<BigInt(n))-1n;
    const memo=new Set();
    let nodes=0;

    function dfs(mask) {
      if (mask===0n) return [];
      if (++nodes>nodeLimit) return null;
      const key=mask.toString();
      if (memo.has(key)) return null;
      
      const remaining=[];
      for (let i=0;i<n;i++) if (mask & (1n<<BigInt(i))) remaining.push(list[i]);

      const occ=occupied(remaining);
      const choices=[];
      for (const a of remaining) {
        if (clearPath(a,occ)) {
          const blockers=remaining.reduce((count,b)=>
            count+(b.id!==a.id && cellsOf(b).some(c=>rayCells(a).includes(c))?1:0),0);
          choices.push({a,score:blockers});
        }
      }

      // Most constrained candidates first; this often exposes deep chains.
      choices.sort((a,b)=>b.score-a.score);

      for (const {a} of choices) {
        const i=list.findIndex(x=>x.id===a.id);
        const result=dfs(mask & ~(1n<<BigInt(i)));
        if (result) return [a.id,...result];
      }
      memo.add(key);
      return null;
    }

    return dfs(full);
  }

  function rayCells(a) {
    const out=[];
    let r=a.row, c=a.col, dr=0, dc=0;
    if (a.dir==="h") {
      c=a.face==="right"?a.col+a.len-1:a.col;
      dc=a.face==="right"?1:-1;
    } else {
      r=a.face==="down"?a.row+a.len-1:a.row;
      dr=a.face==="down"?1:-1;
    }
    r+=dr;c+=dc;
    while(r>=0&&r<N&&c>=0&&c<N){out.push(`${r},${c}`);r+=dr;c+=dc;}
    return out;
  }

 
  function generate(levelNo, seedOverride=null) {
    const target=Math.min(21,12+Math.floor((levelNo-1)/12));
    const seed=seedOverride ?? (levelNo*92821+7717);

    for(let attempt=0;attempt<18;attempt++) {
      const random=rng(seed+attempt*100003);
      const list=[];
      let tries=0;
      const maxTries=5000+target*350;

      while(list.length<target && tries++<maxTries) {
        const dir=random()<.5?"h":"v";
        const len=2+(random()<.24 && levelNo>8?1:0);
        const row=Math.floor(random()*(dir==="h"?N:N-len+1));
        const col=Math.floor(random()*(dir==="h"?N-len+1:N));
        const face=dir==="h"
          ?(random()<.5?"left":"right")
          :(random()<.5?"up":"down");

        const a={id:`L${levelNo}A${list.length}`,row,col,len,dir,face};
        const occ=occupied(list);
        if(cellsOf(a).some(c=>occ.has(c))) continue;
        if(!clearPath(a,occ)) continue;
        list.push(a);
      }

      // Check both the constructive solution and an independent search.
      const constructive=list.slice().reverse().map(a=>a.id);
      if(list.length===target && verifyOrder(list,constructive)) {
        const solved=solvePuzzle(list);
        if(solved) return {arrows:list,solution:solved};
      }
    }

    // Guaranteed safe fallback: each arrow has a clear left exit.
    const fallback=Array.from({length:N},(_,row)=>({
      id:`fallback-${levelNo}-${row}`,row,col:1,len:2,dir:"h",face:"left"
    }));
    const solved=solvePuzzle(fallback);
    return {arrows:fallback,solution:solved || fallback.map(a=>a.id)};
  }

  function verifyOrder(list,order) {
    let remaining=copy(list);
    for(const id of order) {
      const a=remaining.find(x=>x.id===id);
      if(!a || !canRemove(a,remaining)) return false;
      remaining=remaining.filter(x=>x.id!==id);
    }
    return remaining.length===0;
  }

  function applySkin() {
    const s=SKINS.find(x=>x.id===save.activeSkin)||SKINS[0];
    document.documentElement.style.setProperty("--arrow",s.color);
    document.documentElement.style.setProperty("--glow",s.glow);
  }

  function persist() {
    try { localStorage.setItem(SAVE_KEY,JSON.stringify(save)); }
    catch { toast("Browser storage unavailable. Progress may not save."); }
    updateHeader();
  }

  function updateHeader() {
    E.coins.textContent=save.coins;
    E.stars.textContent=save.stars;
    E.progress.textContent=`${Math.min(TOTAL,save.unlocked-1)} / ${TOTAL}`;
    E.bar.style.width=`${Math.min(TOTAL,save.unlocked-1)/TOTAL*100}%`;
    E.achievementCount.textContent=`${save.achievements.length} unlocked`;
    E.dailyStatus.textContent=save.dailyDone&&save.dailyDate===today()
      ?`Completed · ${save.streak}-day streak`
      :`Current streak: ${save.streak}`;
    E.sound.textContent=`Sound: ${save.sound?"ON":"OFF"}`;
    E.vibration.textContent=`Vibration: ${save.vibration?"ON":"OFF"}`;
    E.undo.disabled=!history.length||busy||!started;
    E.hint.disabled=busy||!started;
    E.restart.disabled=busy;
    E.levels.disabled=busy;
  }

  function fmt(seconds) {
    seconds=Math.max(0,Math.floor(seconds));
    return `${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId=null;
    started=false;
  }

  function runTimer() {
    stopTimer();
    timerStart=Date.now();
    started=true;
    timerId=setInterval(()=>{
      if(busy||!started) return;
      const passed=Math.floor((Date.now()-timerStart)/1000);
      if(timed) {
        timeLeft=Math.max(0,timeLimit-passed);
        E.timer.textContent=fmt(timeLeft);
        E.timerRow.classList.toggle("urgent",timeLeft<=15);
        if(timeLeft===0) {
          stopTimer();
          timedFail();
        }
      } else {
        elapsed=passed;
        E.timer.textContent=fmt(elapsed);
      }
    },250);
  }

  function makeArrow(a) {
    const ns="http://www.w3.org/2000/svg";
    const g=document.createElementNS(ns,"g");
    g.setAttribute("class","arrow-group");
    g.dataset.id=a.id;
    g.setAttribute("tabindex","0");
    g.setAttribute("role","button");
    g.setAttribute("aria-label",`Arrow pointing ${a.face}`);

    let x1,y1,x2,y2,points,dx=0,dy=0;
    const cx=a.col*100+50, cy=a.row*100+50;

    if(a.dir==="h") {
      const left=a.col*100+22, right=(a.col+a.len-1)*100+78;
      y1=y2=cy;
      if(a.face==="right") {
        x1=left;x2=right;
        points=`${right+12},${cy} ${right-12},${cy-18} ${right-12},${cy+18}`;
        dx=100;
      } else {
        x1=right;x2=left;
        points=`${left-12},${cy} ${left+12},${cy-18} ${left+12},${cy+18}`;
        dx=-100;
      }
    } else {
      const top=a.row*100+22, bottom=(a.row+a.len-1)*100+78;
      x1=x2=cx;
      if(a.face==="down") {
        y1=top;y2=bottom;
        points=`${cx},${bottom+12} ${cx-18},${bottom-12} ${cx+18},${bottom-12}`;
        dy=100;
      } else {
        y1=bottom;y2=top;
        points=`${cx},${top-12} ${cx-18},${top+12} ${cx+18},${top+12}`;
        dy=-100;
      }
    }
    g.style.setProperty("--dx",`${dx}%`);
    g.style.setProperty("--dy",`${dy}%`);

    const line=document.createElementNS(ns,"line");
    for(const [k,v] of Object.entries({x1,y1,x2,y2,class:"arrow-line"})) line.setAttribute(k,v);

    const head=document.createElementNS(ns,"polygon");
    head.setAttribute("points",points);
    head.setAttribute("class","arrow-head");

    const hit=document.createElementNS(ns,"line");
    for(const [k,v] of Object.entries({x1,y1,x2,y2,class:"arrow-hit"})) hit.setAttribute(k,v);

    g.append(line,head,hit);
    return g;
  }

  function render() {
    const grid=document.createDocumentFragment();
    for(let i=0;i<N*N;i++) {
      const cell=document.createElement("div");
      cell.className="cell";
      grid.appendChild(cell);
    }
    E.board.replaceChildren(grid);

    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("class","arrow-layer");
    svg.setAttribute("viewBox","0 0 600 600");
    svg.setAttribute("preserveAspectRatio","none");
    for(const a of arrows) svg.appendChild(makeArrow(a));
    E.board.appendChild(svg);

    E.arrowCount.textContent=`${arrows.length} arrows left`;
    E.moveCount.textContent=`${moves} moves`;
    E.timerMode.textContent=timed?"TIME ATTACK":"STOPWATCH";
    updateHeader();
  }

  function showToast(message) {
    E.toast.textContent=message;
    E.toast.classList.add("show");
    clearTimeout(toastId);
    toastId=setTimeout(()=>E.toast.classList.remove("show"),2300);
  }

  function vibrate(pattern=25) {
    if(!save.vibration||!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch {}
  }

  function beep(type="tap") {
    if(!save.sound) return;
    try {
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return;
      audio=audio||new AC();
      if(audio.state==="suspended") audio.resume();
      const osc=audio.createOscillator(), gain=audio.createGain();
      const now=audio.currentTime;
      const cfg=type==="win"?[660,990,.18]:type==="blocked"?[180,120,.08]:[420,580,.07];
      osc.type="sine";
      osc.frequency.setValueAtTime(cfg[0],now);
      osc.frequency.exponentialRampToValueAtTime(cfg[1],now+cfg[2]);
      gain.gain.setValueAtTime(.0001,now);
      gain.gain.exponentialRampToValueAtTime(.1,now+.01);
      gain.gain.exponentialRampToValueAtTime(.0001,now+cfg[2]+.02);
      osc.connect(gain);gain.connect(audio.destination);
      osc.start(now);osc.stop(now+cfg[2]+.03);
    } catch {}
  }

  function openModal({icon="✦",eyebrow="ARROW ESCAPE",title,text="",extra="",actions=[]}) {
    E.icon.textContent=icon;
    E.eyebrow.textContent=eyebrow;
    E.modalTitle.textContent=title;
    E.text.textContent=text;
    E.extra.replaceChildren();
    if(typeof extra==="string"&&extra) {
      const wrapper=document.createElement("div");
      wrapper.innerHTML=extra;
      E.extra.appendChild(wrapper);
    } else if(extra instanceof Node) E.extra.appendChild(extra);
    E.actions.replaceChildren();

    for(const a of actions) {
      const b=document.createElement("button");
      b.className=a.primary?"primary":"secondary";
      b.textContent=a.label;
      b.addEventListener("click",a.run);
      E.actions.appendChild(b);
    }
    E.backdrop.classList.remove("hidden");
  }

  function closeModal() { E.backdrop.classList.add("hidden"); }

  function startLevel(levelNo, options={}) {
    level=Math.max(1,Math.min(TOTAL,levelNo));
    daily=!!options.daily;
    timed=!!options.timed;
    moves=0;history=[];busy=false;hintUsed=false;
    elapsed=0;timeLimit=options.timeLimit||Math.max(40,85-Math.floor(level/3));
    timeLeft=timeLimit;

    const generated=generate(level,daily?hash(today()):null);
    arrows=copy(generated.arrows);
    initial=copy(arrows);
    solution=generated.solution||[];

    closeModal();
    E.mode.textContent=daily?"DAILY CHALLENGE":timed?"TIME ATTACK":"EXTREME MODE";
    E.title.textContent=daily?"Daily Puzzle":`Level ${level}`;
    const tag=document.createElement("span");
    tag.className="tag";
    tag.textContent=daily?"TODAY":timed?"TIMED":"EXTREME";
    E.title.appendChild(document.createTextNode(" "));
    E.title.appendChild(tag);
    E.subtitle.textContent=daily?"One special puzzle for today":timed?"Escape before the countdown reaches zero":"Plan your escape. Every move matters.";
    E.timer.textContent=fmt(timed?timeLeft:0);
    E.timerRow.classList.remove("urgent");
    if(!daily&&!timed) {
      save.currentLevel=level;
      persist();
    }
    render();
    runTimer();
  }

  function exitArrow(a) {
    if(!a||busy||!started) return;
    if(!canRemove(a,arrows)) {
      beep("blocked");vibrate(35);
      const el=[...E.board.querySelectorAll(".arrow-group")].find(x=>x.dataset.id===a.id);
      if(el) el.animate(
        [{transform:"translateX(0)"},{transform:"translateX(-4px)"},{transform:"translateX(4px)"},{transform:"translateX(0)"}],
        {duration:170}
      );
      showToast("Blocked! Pehle doosra arrow nikalo.");
      return;
    }

    history.push({arrows:copy(arrows),moves});
    moves++;
    busy=true;
    const el=[...E.board.querySelectorAll(".arrow-group")].find(x=>x.dataset.id===a.id);
    if(el) el.classList.add("leaving");
    beep("tap");vibrate(18);
    updateHeader();

    setTimeout(()=>{
      arrows=arrows.filter(x=>x.id!==a.id);
      busy=false;
      render();
      if(arrows.length===0) complete();
    },280);
  }

  function hint() {
    if(busy||!started) return;
    const cost=30;
    if(save.coins<cost) {
      showToast(`Hint ke liye ${cost} coins chahiye.`);
      return;
    }
    const next=arrows.find(a=>canRemove(a,arrows));
    if(!next) { showToast("No safe move found."); return; }

    save.coins-=cost;
    hintUsed=true;
    persist();
    const el=[...E.board.querySelectorAll(".arrow-group")].find(x=>x.dataset.id===next.id);
    if(el) {
      el.classList.add("hinted");
      setTimeout(()=>el.classList.remove("hinted"),1700);
    }
    beep();showToast("Glowing arrow ko tap karo.");
  }

  function undo() {
    if(busy||!started||!history.length) return;
    const prev=history.pop();
    arrows=prev.arrows;
    moves=prev.moves;
    render();
    beep();
    showToast("Last move undo ho gaya.");
  }

  function restart() {
    if(busy) return;
    arrows=copy(initial);history=[];moves=0;hintUsed=false;
    render();runTimer();
    showToast("Puzzle restart ho gaya.");
  }

  function starsForLevel() {
    const n=initial.length;
    const perfect=n+Math.ceil(n*.08);
    const good=n+Math.ceil(n*.25);
    return moves<=perfect?3:moves<=good?2:1;
  }

  function addCoins(n) {
    save.coins+=n;
    save.totalCoinsEarned+=n;
  }

  function checkAchievements() {
    const fresh=[];
    for(const a of ACHIEVEMENTS) {
      if(!save.achievements.includes(a.id)&&a.test(save)) {
        save.achievements.push(a.id);
        fresh.push(a);
      }
    }
    return fresh;
  }

  function completionHTML(stars,reward,seconds) {
    const wrap=document.createElement("div");
    const rewardLine=document.createElement("div");
    rewardLine.className="reward-line";
    const s=document.createElement("span");
    s.textContent=`${"★".repeat(stars)}${"☆".repeat(3-stars)} stars`;
    const c=document.createElement("span");
    c.textContent=`● +${reward} coins`;
    rewardLine.append(s,c);
    const stats=document.createElement("div");
    stats.className="stat-grid";
    for(const [value,label] of [[String(moves),"Moves"],[fmt(seconds),"Time"]]) {
      const box=document.createElement("div");
      box.className="stat-box";
      const strong=document.createElement("strong");
      strong.textContent=value;
      const span=document.createElement("span");
      span.textContent=label;
      box.append(strong,span);stats.appendChild(box);
    }
    wrap.append(rewardLine,stats);
    return wrap;
  }

  function complete() {
    stopTimer();
    beep("win");vibrate([30,45,30]);
    const seconds=timed?Math.max(0,timeLimit-timeLeft):elapsed;
    const stars=starsForLevel();
    const baseReward=10+stars*5;
    let reward=0, first=false, newBest=false;
    let extra=document.createElement("div");

    if(daily) {
      const date=today();
      const already=save.dailyDone&&save.dailyDate===date;
      if(!already) {
        reward=baseReward;
        addCoins(reward);
        save.stars+=stars;
        save.dailyWins++;
        save.streak=save.lastDailyDate===dateBefore(date)
          ?save.streak+1:1;
        save.bestStreak=Math.max(save.bestStreak,save.streak);
        save.lastDailyDate=date;
        save.dailyDate=date;
        save.dailyDone=true;
      }
      const fresh=checkAchievements();
      persist();
      extra=completionHTML(stars,reward,seconds);
      if(already) {
        const note=document.createElement("p");
        note.className="shop-note";
        note.textContent="Daily reward already claimed today.";
        extra.appendChild(note);
      }
      for(const a of fresh) {
        const p=document.createElement("p");p.className="shop-note";
        p.textContent=`Achievement unlocked: ${a.name}`;extra.appendChild(p);
      }
      openModal({
        icon:"✦",eyebrow:"DAILY CHALLENGE",title:"Daily puzzle complete!",
        text:`Your streak: ${save.streak} day${save.streak===1?"":"s"}.`,
        extra,actions:[
          {label:"Level map",run:openLevels},
          {label:"Play classic",primary:true,run:()=>startLevel(save.currentLevel)}
        ]
      });
      return;
    }

    if(timed) {
      const date=today();
      save.timeWins++;
      if(!save.claimedTimedDates.includes(date)) {
        save.claimedTimedDates.push(date);
        reward=baseReward+10;
        addCoins(reward);
      }
    } else {
      const key=String(level);
      const oldStars=Number(save.bestStars[key]||0);
      const old=save.levelStats[key]||{};
      newBest=seconds<(old.bestTime??Infinity);
      first=!save.claimedLevels.includes(level);

      if(stars>oldStars) save.stars+=stars-oldStars;
      save.bestStars[key]=Math.max(oldStars,stars);
      save.levelStats[key]={
        bestTime:Math.min(old.bestTime??Infinity,seconds),
        bestMoves:Math.min(old.bestMoves??Infinity,moves),
        plays:(old.plays||0)+1,
        wins:(old.wins||0)+1
      };
      save.totalMoves+=moves;
      if(first) {
        save.claimedLevels.push(level);
        save.totalWins++;
        if(!hintUsed) save.noHintWins++;
        reward=baseReward;
        addCoins(reward);
      }
      save.unlocked=Math.max(save.unlocked,Math.min(TOTAL,level+1));
    }

    const fresh=checkAchievements();
    persist();
    extra=completionHTML(stars,reward,seconds);

    const note=document.createElement("p");
    note.className="shop-note";
    note.textContent=timed
      ?(reward?"Time Attack daily reward claimed.":"Time Attack reward already claimed today.")
      :first?"First-clear reward claimed.":"Replay complete: no duplicate level reward.";
    extra.appendChild(note);

    if(newBest) {
      const best=document.createElement("p");
      best.className="shop-note";best.textContent="✦ New personal best time!";
      extra.appendChild(best);
    }
    for(const a of fresh) {
      const p=document.createElement("p");p.className="shop-note";
      p.textContent=`Achievement unlocked: ${a.name}`;
      extra.appendChild(p);
    }

    openModal({
      icon:"✦",eyebrow:timed?"TIME ATTACK":"EXTREME MODE",
      title:!timed&&level===TOTAL?"All 120 levels cleared!":"Level cleared!",
      text:`Completed in ${moves} moves.`,
      extra,actions:[
        {label:"Level map",run:openLevels},
        {label:timed?"Play again":level<TOTAL?"Next level →":"Play again",primary:true,
          run:()=>startLevel(timed?level:level<TOTAL?level+1:1,{timed})}
      ]
    });
  }

  function timedFail() {
    busy=false;vibrate([100,60,100]);beep("blocked");
    openModal({
      icon:"◷",eyebrow:"TIME ATTACK",title:"Time's up!",
      text:"Countdown khatam ho gaya. Restart karke phir try karo.",
      extra:`<div class="reward-line"><span>${arrows.length} arrows left</span><span>${moves} moves</span></div>`,
      actions:[
        {label:"Exit",run:()=>startLevel(save.currentLevel)},
        {label:"Try again",primary:true,run:()=>startLevel(level,{timed:true})}
      ]
    });
  }

  function openLevels() {
    if(busy) return;
    const grid=document.createElement("div");
    grid.className="level-grid";
    for(let n=1;n<=TOTAL;n++) {
      const b=document.createElement("button");
      b.className=`level-cell ${n===level&&!daily&&!timed?"current":""}`;
      b.disabled=n>save.unlocked;
      b.textContent=n>save.unlocked?"🔒":String(n);
      const stars=document.createElement("span");
      stars.className="level-stars";
      const count=Number(save.bestStars[String(n)]||0);
      stars.textContent="★".repeat(count)+"☆".repeat(3-count);
      b.appendChild(stars);
      b.addEventListener("click",()=>{if(n<=save.unlocked)startLevel(n);});
      grid.appendChild(b);
    }
    openModal({
      icon:"▦",eyebrow:"YOUR JOURNEY",title:"Choose a level",
      text:`Unlocked ${save.unlocked} of ${TOTAL} levels.`,
      extra:grid,actions:[{label:"Close",primary:true,run:closeModal}]
    });
  }

  function openDaily() {
    const date=today();
    if(save.dailyDone&&save.dailyDate===date) {
      openModal({
        icon:"✓",eyebrow:"DAILY CHALLENGE",title:"Already completed!",
        text:`Your current streak is ${save.streak}. Come back tomorrow for another daily reward.`,
        actions:[{label:"Play classic",primary:true,run:()=>startLevel(save.currentLevel)}]
      });
      return;
    }
    startLevel(save.currentLevel,{daily:true});
  }

  function openTime() {
    startLevel(save.currentLevel,{timed:true});
    showToast(`Time Attack: ${fmt(Math.max(40,85-Math.floor(save.currentLevel/3)))} available.`);
  }

  function openAchievements() {
    const list=document.createElement("div");list.className="item-list";
    for(const a of ACHIEVEMENTS) {
      const unlocked=save.achievements.includes(a.id);
      const row=document.createElement("div");row.className="list-item";
      const icon=document.createElement("div");icon.className="item-symbol";
      icon.textContent=unlocked?a.id==="rich"?"●":"★":"🔒";
      const copy=document.createElement("div");copy.className="item-copy";
      const name=document.createElement("b");name.textContent=a.name;
      const desc=document.createElement("small");desc.textContent=a.desc;
      copy.append(name,desc);row.append(icon,copy);list.appendChild(row);
    }
    openModal({
      icon:"♜",eyebrow:"MILESTONES",title:"Achievements",
      text:`${save.achievements.length} of ${ACHIEVEMENTS.length} unlocked.`,
      extra:list,actions:[{label:"Close",primary:true,run:closeModal}]
    });
  }

  function openStats() {
    const all=Object.values(save.levelStats);
    const bestTime=all.reduce((v,s)=>Math.min(v,s.bestTime??Infinity),Infinity);
    const bestMoves=all.reduce((v,s)=>Math.min(v,s.bestMoves??Infinity),Infinity);
    const grid=document.createElement("div");grid.className="stat-grid";
    const stats=[
      [save.claimedLevels.length,"Unique levels cleared"],
      [all.reduce((v,s)=>v+(s.plays||0),0),"Classic attempts"],
      [save.totalWins,"First-clear wins"],
      [Number.isFinite(bestTime)?fmt(bestTime):"—","Best time"],
      [Number.isFinite(bestMoves)?bestMoves:"—","Best moves"],
      [save.totalMoves,"Moves recorded"],
      [save.streak,"Current streak"],
      [save.bestStreak,"Best streak"],
      [save.timeWins,"Time Attack wins"],
      [save.totalCoinsEarned,"Coins earned"]
    ];
    for(const [value,label] of stats) {
      const box=document.createElement("div");box.className="stat-box";
      const strong=document.createElement("strong");strong.textContent=value;
      const span=document.createElement("span");span.textContent=label;
      box.append(strong,span);grid.appendChild(box);
    }
    openModal({
      icon:"◴",eyebrow:"PERSONAL RECORDS",title:"Statistics",
      text:"Progress saved in this browser.",extra:grid,
      actions:[{label:"Close",primary:true,run:closeModal}]
    });
  }

  function openShop() {
    const list=document.createElement("div");list.className="item-list";
    const note=document.createElement("p");note.className="shop-note";
    note.textContent=`Balance: ${save.coins} coins. Hints cost 30 coins.`;
    list.appendChild(note);

    for(const skin of SKINS) {
      const owned=save.ownedSkins.includes(skin.id);
      const active=save.activeSkin===skin.id;
      const row=document.createElement("div");row.className="list-item";
      const icon=document.createElement("div");icon.className="item-symbol";
      icon.textContent="➜";icon.style.color=skin.color;
      icon.style.textShadow=`0 0 10px ${skin.glow}`;
      const copy=document.createElement("div");copy.className="item-copy";
      const name=document.createElement("b");name.textContent=skin.name;
      const desc=document.createElement("small");desc.textContent=owned?"Owned skin":`Unlock for ${skin.price} coins`;
      copy.append(name,desc);
      const b=document.createElement("button");
      b.className=`item-button ${active?"equipped":""}`;
      b.textContent=active?"Equipped":owned?"Equip":`● ${skin.price}`;
      b.disabled=active||(!owned&&save.coins<skin.price);
      b.addEventListener("click",()=>{
        if(!owned) {
          if(save.coins<skin.price) return;
          save.coins-=skin.price;save.ownedSkins.push(skin.id);
        }
        save.activeSkin=skin.id;applySkin();persist();render();
        beep("win");showToast(`${skin.name} selected.`);
        openShop();
      });
      row.append(icon,copy,b);list.appendChild(row);
    }
    openModal({
      icon:"◇",eyebrow:"CUSTOMIZATION",title:"Arrow skin shop",
      text:"Unlock a skin once and equip it anytime.",
      extra:list,actions:[{label:"Close",primary:true,run:closeModal}]
    });
  }

  E.board.addEventListener("click",event=>{
    const group=event.target.closest(".arrow-group");
    if(group) exitArrow(arrows.find(a=>a.id===group.dataset.id));
  });
  E.board.addEventListener("keydown",event=>{
    if((event.key==="Enter"||event.key===" ")&&event.target.classList.contains("arrow-group")) {
      event.preventDefault();
      exitArrow(arrows.find(a=>a.id===event.target.dataset.id));
    }
  });

  E.hint.addEventListener("click",hint);
  E.undo.addEventListener("click",undo);
  E.restart.addEventListener("click",restart);
  E.levels.addEventListener("click",openLevels);
  E.daily.addEventListener("click",openDaily);
  E.time.addEventListener("click",openTime);
  E.achievements.addEventListener("click",openAchievements);
  E.stats.addEventListener("click",openStats);
  E.shop.addEventListener("click",openShop);
  E.close.addEventListener("click",closeModal);
  E.backdrop.addEventListener("click",event=>{if(event.target===E.backdrop)closeModal();});

  E.sound.addEventListener("click",()=>{
    save.sound=!save.sound;persist();if(save.sound)beep();
  });
  E.vibration.addEventListener("click",()=>{
    save.vibration=!save.vibration;persist();if(save.vibration)vibrate(20);
  });

  // Replaying an already-completed daily puzzle never reopens its reward.
  if(save.dailyDate!==today()) save.dailyDone=false;

  applySkin();
  persist();
  startLevel(level);
})();


let hearts = 3;

function updateHearts() {
  const heartElements = document.querySelectorAll(".hearts-box span");

  heartElements.forEach((heart, index) => {
    heart.classList.toggle("lost", index >= hearts);
  });
}

function loseHeart() {
  if (hearts <= 0) return;

  hearts--;
  updateHearts();

  if (hearts === 0) {
    alert("💔 Game Over! Restart karke dobara khelo.");
  }
}

function resetHearts() {
  hearts = 3;
  updateHearts();
}

updateHearts();