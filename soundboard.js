/* 
PATH: /js/soundboard.js
FILE: soundboard.js
PURPOSE: Medical Sound Pad logic — per-group boards with selectable colors, per-group Kit Editor, per-pad sampling & mic record, optional per-pad image, sentence builder (single track) with scenes & story chain, save/load (incl. sentences & images). 
Update: **TTS fallback now works on both Sentence Play and immediate Pad Press** (if pad has no sample and “TTS if empty” is checked). No layout changes.
Created by Scott Russo.
*/
(function(){
  'use strict';

  /* ========= helpers ========= */
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const statusEl = $('#status');
  function status(msg){ if (statusEl) statusEl.textContent = msg; }
  function report(where, err){
    console.error(`error@${where}`, err);
    status(`error@${where}: ${(err && err.message) ? err.message : String(err)}`);
  }
  window.addEventListener('error', e => report('window', e.error || e.message));
  window.addEventListener('unhandledrejection', e => report('promise', e.reason));

  function hexToRgbString(hex){
    let h = hex.replace('#',''); if (h.length===3){ h = h.split('').map(x=>x+x).join(''); }
    const n = parseInt(h,16); const r = (n>>16)&255, g=(n>>8)&255, b=n&255;
    return `${r},${g},${b}`;
  }

  // ---- TTS helper (used for sentence play and pad-press fallback) ----
  function ttsSpeak(text, gapMs){
    return new Promise((res)=>{
      if (!('speechSynthesis' in window)){ res(); return; }
      const s = (text||'').trim(); if (!s){ res(); return; }
      try{ window.speechSynthesis.cancel(); }catch(_){}
      const utt = new SpeechSynthesisUtterance(s);
      utt.rate = 1.0; utt.pitch = 1.0;
      utt.onend = ()=> setTimeout(res, Math.max(0, Number(gapMs)||0));
      try{ window.speechSynthesis.speak(utt); }catch(_){ res(); }
    });
  }

  /* Local vocabulary (shared key with keyboard) */
  const VOCAB_KEY = 'medpad_vocabulary';
  function loadVocab(){ try{ return JSON.parse(localStorage.getItem(VOCAB_KEY))||[] }catch(_){ return [] } }

  /* ========= DOM refs ========= */
  const boardsWrap   = $('#boards');
  const groupsBtn    = $('#groupsBtn');
  const groupsPanel  = $('#groupsPanel');
  const groupList    = $('#groupList');

  const newGroupName = $('#newGroupName');
  const newRows      = $('#newRows');
  const newCols      = $('#newCols');
  const newColor     = $('#newColor');
  const addGroupBtn  = $('#addGroupBtn');

  const kitEditor    = $('#kitEditor');
  const closeKitBtn  = $('#closeKitBtn');
  const kitGroupDot  = $('#kitGroupDot');
  const kitGroupName = $('#kitGroupName');
  const kitRows      = $('#kitRows');

  // Sentence Builder
  const seqPanel         = $('#seqPanel');
  const toggleSeqBtn     = $('#toggleSeqBtn');
  const composeBtn       = $('#composeBtn');
  const sentencePlayBtn  = $('#sentencePlayBtn');
  const sentenceStopBtn  = $('#sentenceStopBtn');
  const sentenceBackBtn  = $('#sentenceBackBtn');
  const sentenceClearBtn = $('#sentenceClearBtn');
  const sentenceListEl   = $('#sentenceList');
  const transcriptEl     = $('#transcript');
  const seqStatus        = $('#seqStatus');
  const wpmNum           = $('#wpmNum');
  const gapMsNum         = $('#gapMsNum');
  const ttsFallbackChk   = $('#ttsFallbackChk');

  // Scenes & Chain
  const sceneBtns    = $$('[data-scene]');
  const songModeBtn  = $('#songModeBtn');
  const chainEditBtn = $('#chainEditBtn');
  const chainClearBtn= $('#chainClearBtn');
  const chainView    = $('#chainView');

  const stopAllBtn   = $('#stopAllBtn');

  const saveKitBtn   = $('#saveKitBtn');
  const loadKitBtn   = $('#loadKitBtn');
  const loadKitFile  = $('#loadKitFile');

  const kitMgrPanel  = $('#kitMgrPanel');
  const kitNameInp   = $('#kitName');
  const kitSaveAsBtn = $('#kitSaveAs');
  const kitExportBtn = $('#kitExport');
  const kitImportBtn = $('#kitImportBtn');
  const kitImportFile= $('#kitImportFile');
  const kitList      = $('#kitList');

  const toggleKitMgrBtn = $('#toggleKitMgrBtn');

  /* ========= audio ========= */
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const master = actx.createGain(); master.gain.value = 1; master.connect(actx.destination);
  window.addEventListener('pointerdown', async function once(){ try{ await actx.resume(); }catch{} window.removeEventListener('pointerdown', once); }, {once:true});

  function makePadChain(){
    const g = actx.createGain();
    const p = actx.createStereoPanner();
    const f = actx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=18000; f.Q.value=0.0001;
    const a = actx.createGain();
    g.connect(f).connect(p).connect(a).connect(master);
    return {g,p,f,a};
  }

  /* ========= data model ========= */
  const PadMode = Object.freeze({ RETRIGGER:'retrigger', TOGGLE_START:'toggle_start', TOGGLE_RESUME:'toggle_resume', RECORD:'record' });

  function makePad(i){
    const nm = `Pad ${String(i+1).padStart(2,'0')}`;
    return { name:nm, phrase:nm, buffer:null, b64:null, duration:0,
      img:null,
      gain:1.0, pan:0.0, filterType:'lowpass', cutoff:18000, q:0.0001,
      env:{a:0.005,d:0.02,s:1.0,r:0.04}, tune:0, fine:0, loop:false, reverse:false, choke:0,
      mode:PadMode.RETRIGGER, voices:[], toggleOn:false, savedOffset:0, voice:null };
  }

  const DEFAULT_COLORS = ['#30f39b','#42c6ff','#ffcc66','#ff6961','#c38bff','#68e2b6','#ffa3a3','#a0f','#3cf','#7dff6b'];

  let NEXT_GROUP_ID = 1;
  function makeGroup(name, rows, cols, color){
    const count = rows*cols;
    return { id: 'g'+(NEXT_GROUP_ID++), name: name || 'Group', rows: rows|0, cols: cols|0,
      color: color || DEFAULT_COLORS[(NEXT_GROUP_ID-2)%DEFAULT_COLORS.length],
      pads: Array.from({length:count}, (_,i)=> makePad(i)) };
  }

  const App = { 
    groups: [], 
    visible: new Set(), 
    editGid: null,
    sentence: [], // [{gid,idx,name,text,color}]
  };

  /* ========= boards ========= */
  function renderBoards(){
    if (!boardsWrap) return;
    boardsWrap.innerHTML = '';
    for (const g of App.groups){
      if (!App.visible.has(g.id)) continue;

      const board = document.createElement('div');
      board.className = 'board';
      board.style.setProperty('--ac', g.color);
      board.style.setProperty('--ac-rgb', hexToRgbString(g.color));

      const grid = document.createElement('div');
      grid.className = 'padgrid';
      grid.style.gridTemplateColumns = `repeat(${g.cols}, minmax(64px,1fr))`;
      grid.dataset.groupId = g.id;

      for (let i=0;i<g.pads.length;i++){
        const p = g.pads[i];
        const el = document.createElement('button');
        el.className='pad'; el.title = (p.phrase && p.phrase.trim()) || p.name;
        el.innerHTML = p.img
          ? `<img alt="${p.name}" src="${p.img}"><div class="badge">${i+1}</div>`
          : `<div>${p.name}</div><div class="badge">${i+1}</div>`;
        el.addEventListener('mousedown', ()=> onPadPress(g.id, i, 1.0));
        el.addEventListener('touchstart', (e)=>{ e.preventDefault(); onPadPress(g.id, i, 1.0); }, {passive:false});
        grid.appendChild(el);
      }

      const hdr = document.createElement('div'); hdr.className = 'title';
      const dot = document.createElement('div'); dot.className='dot';
      const name = document.createElement('div'); name.textContent = g.name;

      const colorPick = document.createElement('input');
      colorPick.type = 'color'; colorPick.value = g.color; colorPick.className='colorpick'; colorPick.title='Pick group color';
      colorPick.oninput = (e)=>{ g.color = e.target.value || g.color; renderBoards(); renderGroupList(); if (App.editGid===g.id) updateEditorBadge(g); };

      const btns = document.createElement('div'); btns.className='hdr-btns';
      const editBtn = document.createElement('button'); editBtn.className='btn small';
      editBtn.textContent = (App.editGid===g.id && kitEditor.classList.contains('show')) ? 'Close' : 'Edit';
      editBtn.onclick = ()=> toggleKitForGroup(g.id);
      btns.appendChild(colorPick); btns.appendChild(editBtn);

      const sub = document.createElement('div'); sub.className='sub'; sub.textContent = `(${g.rows}×${g.cols})`;

      hdr.appendChild(dot); hdr.appendChild(name); hdr.appendChild(btns); hdr.appendChild(sub);
      board.appendChild(hdr); board.appendChild(grid); boardsWrap.appendChild(board);
    }
  }

  function flashPad(gid, idx){
    const board = Array.from(boardsWrap.querySelectorAll('.padgrid')).find(pg => pg.dataset.groupId===gid);
    if (!board) return; const el = board.children[idx]; if (!el) return;
    el.classList.add('playing'); setTimeout(()=>el.classList.remove('playing'), 120);
  }
  function setPadRecordingIndicator(gid, idx, on){
    const board = Array.from(boardsWrap.querySelectorAll('.padgrid')).find(pg => pg.dataset.groupId===gid);
    if (!board) return; const el = board.children[idx]; if (el) el.classList.toggle('recording', !!on);
  }

  /* ========= groups panel ========= */
  function renderGroupList(){
    groupList.innerHTML = '';
    for (const g of App.groups){
      const card = document.createElement('div');
      card.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px;background:#0f1519;display:flex;gap:12px;align-items:center';
      const dot = document.createElement('div'); dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${g.color};box-shadow:0 0 10px ${g.color}88;border:1px solid rgba(255,255,255,.22)`;
      const left = document.createElement('div'); left.style.cssText='display:flex;flex-direction:column;gap:6px;flex:1';
      left.innerHTML = `<div style="font-weight:700">${g.name}</div><div class="muted small">${g.rows}×${g.cols} • ${g.pads.length} pads</div>`;
      const vis = document.createElement('label'); vis.className = 'small';
      vis.innerHTML = `<input type="checkbox" ${App.visible.has(g.id)?'checked':''}> Visible`;
      vis.querySelector('input').onchange = (e)=>{ const on=e.target.checked; if(on) App.visible.add(g.id); else App.visible.delete(g.id); renderBoards(); };

      const colorLabel = document.createElement('label'); colorLabel.className='small';
      colorLabel.innerHTML = `Color <input type="color" value="${g.color}" style="height:26px;margin-left:6px;border:1px solid var(--line);border-radius:6px;background:#0f1519">`;
      colorLabel.querySelector('input').oninput = (e)=>{ g.color = e.target.value || g.color; renderBoards(); renderGroupList(); if (App.editGid===g.id) updateEditorBadge(g); };

      const renameBtn = document.createElement('button'); renameBtn.className='btn small ghost'; renameBtn.textContent='Rename';
      renameBtn.onclick = ()=>{ const nv=prompt('Rename group', g.name); if (!nv) return; g.name=nv; renderGroupList(); renderBoards(); if(App.editGid===g.id) updateEditorBadge(g); };

      const resizeBtn = document.createElement('button'); resizeBtn.className='btn small ghost'; resizeBtn.textContent='Resize';
      resizeBtn.onclick = ()=>{ const rv=prompt('Rows (1–12)', g.rows); const cv=prompt('Cols (1–12)', g.cols); const r=Number(rv), c=Number(cv); if(!r||!c) return; resizeGroup(g, r, c); renderBoards(); if (App.editGid===g.id) rebuildEditor(); };

      const editBtn = document.createElement('button'); editBtn.className='btn small'; editBtn.textContent = (App.editGid===g.id && kitEditor.classList.contains('show')) ? 'Close Editor' : 'Edit Pads';
      editBtn.onclick = ()=> toggleKitForGroup(g.id);

      const delBtn = document.createElement('button'); delBtn.className='btn small ghost'; delBtn.textContent='Delete';
      delBtn.onclick = ()=>{ if(!confirm(`Delete group "${g.name}"?`)) return; App.groups = App.groups.filter(x=>x.id!==g.id); App.visible.delete(g.id); if(App.editGid===g.id){ App.editGid=null; kitEditor.classList.remove('show'); } renderGroupList(); renderBoards(); rebuildEditor(); };

      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px'; right.style.alignItems='center';
      right.appendChild(vis); right.appendChild(colorLabel); right.appendChild(renameBtn); right.appendChild(resizeBtn); right.appendChild(editBtn); right.appendChild(delBtn);

      card.appendChild(dot); card.appendChild(left); card.appendChild(right);
      groupList.appendChild(card);
    }
  }
  function resizeGroup(g, rows, cols){
    rows = Math.max(1, Math.min(12, rows|0));
    cols = Math.max(1, Math.min(12, cols|0));
    const old = g.pads.slice(0);
    const count = rows*cols;
    const out = Array.from({length:count}, (_,i)=> old[i] ? old[i] : makePad(i));
    g.rows = rows; g.cols = cols; g.pads = out;
  }

  groupsBtn.onclick = ()=> groupsPanel.classList.toggle('show');
  toggleSeqBtn.onclick = ()=> seqPanel.classList.toggle('show');
  toggleKitMgrBtn.onclick = ()=> kitMgrPanel.classList.toggle('show');

  document.querySelectorAll('[data-preset]').forEach(b=>{
    b.onclick = ()=>{ const [r,c] = b.dataset.preset.split('x').map(n=>Number(n)); newRows.value = String(r); newCols.value = String(c); };
  });
  addGroupBtn.onclick = ()=>{
    const name = (newGroupName.value||'').trim() || 'Group';
    const r = Math.max(1, Math.min(12, Number(newRows.value||4)));
    const c = Math.max(1, Math.min(12, Number(newCols.value||4)));
    const col = newColor.value || DEFAULT_COLORS[(NEXT_GROUP_ID-1)%DEFAULT_COLORS.length];
    const g = makeGroup(name, r, c, col);
    App.groups.push(g); App.visible.add(g.id);
    newGroupName.value='';
    renderGroupList(); renderBoards();
    status(`Added group "${g.name}"`);
  };

  /* ========= audio play + record ========= */
  function reverseBuffer(buf){
    const rev = actx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c=0;c<buf.numberOfChannels;c++){
      const src = buf.getChannelData(c); const dst = rev.getChannelData(c);
      for (let i=0,j=src.length-1;i<src.length;i++,j--){ dst[i]=src[j]; }
    }
    return rev;
  }
  function stopPadVoices(p, all=true){
    if (all){ while (p.voices.length){ try{ p.voices.pop().src.stop(); }catch{} } }
    else if (p.voice){ try{ p.voice.src.stop(); }catch(_){} p.voice=null; }
  }
  function effectiveRate(p){ return Math.pow(2, (p.tune + (p.fine/100))/12); }
  function triggerRetrigger(p, vel=1){
    if (!p.buffer) return;
    const {g,p:pan,f,a} = makePadChain();
    g.gain.value = p.gain * vel; pan.pan.value = p.pan; f.type = p.filterType; f.frequency.value=p.cutoff; f.Q.value=p.q;
    const src = actx.createBufferSource(); src.buffer = p.reverse ? reverseBuffer(p.buffer) : p.buffer; src.loop = !!p.loop;
    const rate = effectiveRate(p); src.playbackRate.value = rate;
    const now = actx.currentTime; const {a:att,d:dec,s:sus,r:rel} = p.env;
    a.gain.cancelScheduledValues(now); a.gain.setValueAtTime(0, now); a.gain.linearRampToValueAtTime(1, now+att); a.gain.linearRampToValueAtTime(sus, now+att+dec);
    const estDur = Math.max(0.02, p.buffer.duration / rate); a.gain.setTargetAtTime(0, now + estDur, Math.max(0.001, rel));
    src.connect(g); src.start(now);
    p.voices.push({src, a}); src.onended = ()=>{ p.voices = p.voices.filter(v=>v.src!==src); };
  }
  function togglePad(p, resume){
    if (!p.buffer) return;
    if (p.toggleOn){
      const v = p.voice; if (v){ const now = actx.currentTime;
        if (resume){ const elapsed = (now - v.startTime) * v.playbackRate; const newOff = v.startOffset + elapsed; p.savedOffset = p.loop ? (newOff % p.buffer.duration) : Math.min(newOff, p.buffer.duration); }
        else { p.savedOffset = 0; }
        try{ v.src.stop(); }catch(_){}
      }
      p.toggleOn=false; p.voice=null; return;
    }
    const {g,p:pan,f,a} = makePadChain(); g.gain.value=p.gain; pan.pan.value=p.pan; f.type=p.filterType; f.frequency.value=p.cutoff; f.Q.value=p.q;
    const src = actx.createBufferSource(); src.buffer = p.reverse ? reverseBuffer(p.buffer) : p.buffer; src.loop = !!p.loop;
    const rate = effectiveRate(p); src.playbackRate.value = rate;
    const now = actx.currentTime; const {a:att,d:dec,s:sus} = p.env;
    a.gain.cancelScheduledValues(now); a.gain.setValueAtTime(0, now); a.gain.linearRampToValueAtTime(1, now+att); a.gain.linearRampToValueAtTime(sus, now+att+dec);
    const startOffset = resume ? (p.savedOffset||0) : 0;
    src.connect(g); try{ src.start(now, Math.min(startOffset, Math.max(0, src.buffer.duration-0.001))); }catch(e){ try{ src.start(now); }catch(_){} }
    p.toggleOn = true; p.voice = {src, a, startTime: now, startOffset, playbackRate: rate};
    src.onended = ()=>{ if (p.voice && p.voice.src===src){ p.toggleOn=false; p.voice=null; p.savedOffset=0; } };
  }

  /* mic record per pad */
  let micStream = null;
  const padRecorders = new Map();
  document.addEventListener('pointerdown', async function first(){ try{ if (!micStream){ micStream = await navigator.mediaDevices.getUserMedia({audio:true}); } }catch(_){ } document.removeEventListener('pointerdown', first); }, {once:true});
  async function ensureMic(){ if (micStream) return micStream; micStream = await navigator.mediaDevices.getUserMedia({audio:true}); return micStream; }
  async function startPadRecording(p, gid, idx){
    try{
      const stream = await ensureMic(); const rec = new MediaRecorder(stream);
      const state = {rec, chunks:[], active:true}; padRecorders.set(p, state);
      rec.ondataavailable = e=> state.chunks.push(e.data);
      rec.onstop = async ()=>{
        state.active=false;
        try{
          const blob = new Blob(state.chunks, {type:'audio/webm'});
          const arr = await blob.arrayBuffer(); const buf = await actx.decodeAudioData(arr.slice(0));
          p.buffer = buf; p.duration=buf.duration; p.b64 = bufferToBase64Wav(buf);
          p.toggleOn=false; p.savedOffset=0; p.voice=null; renderBoards(); status(`Recorded → ${p.name}`);
        }catch(e){ report('padRecDecode', e); }
        setPadRecordingIndicator(gid, idx, false);
      };
      rec.start(); setPadRecordingIndicator(gid, idx, true); status(`Recording ${p.name}…`);
    }catch(e){ report('padRecStart', e); }
  }
  function stopPadRecording(p, gid, idx){
    const st = padRecorders.get(p); if (st && st.active){ try{ st.rec.stop(); }catch(_){ } padRecorders.delete(p); }
  }

  /* ========= sentence builder ========= */
  let composeMode = false;
  let playingSentence = false;
  let playAbort = false;
  let currentTimeout = null;

  function setCompose(on){
    composeMode = !!on;
    composeBtn.setAttribute('aria-pressed', composeMode?'true':'false');
    composeBtn.textContent = 'Compose: ' + (composeMode ? 'On' : 'Off');
    status(composeMode ? 'Compose: tap pads to append words' : 'Compose off');
  }

  composeBtn.onclick = ()=> setCompose(!composeMode);

  function sentenceToText(arr){ return arr.map(t=> (t.text && t.text.trim()) || t.name || '—').join(' '); }

  function renderSentence(){
    sentenceListEl.innerHTML = '';
    const s = App.sentence;
    for (let i=0;i<s.length;i++){
      const t = s[i];
      const chip = document.createElement('div'); chip.className='chip';
      const dot = document.createElement('div'); dot.className='dot'; dot.style.background = t.color || '#42c6ff';
      const label = document.createElement('div'); label.textContent = (t.text && t.text.trim()) || t.name;
      const x = document.createElement('button'); x.className='x'; x.textContent='×'; x.title='Remove';
      x.onclick = ()=>{ App.sentence.splice(i,1); renderSentence(); };
      chip.appendChild(dot); chip.appendChild(label); chip.appendChild(x);
      sentenceListEl.appendChild(chip);
    }
    transcriptEl.textContent = s.length ? sentenceToText(s) : '—';
  }

  function msFromWPM(wpm){ wpm = Math.max(1, Number(wpm)||120); return Math.round(60000 / wpm); }
  function wpmFromMs(ms){ ms = Math.max(1, Number(ms)||250); return Math.max(1, Math.round(60000 / ms)); }

  async function playWordToken(tok){
    const g = App.groups.find(x=>x.id===tok.gid);
    const p = g ? g.pads[tok.idx] : null;
    const spoken = (tok.text && tok.text.trim()) || tok.name || 'blank';
    const useTTS = (!p || !p.buffer) && ttsFallbackChk.checked && 'speechSynthesis' in window;
    if (p && p.buffer){
      const rate = Math.pow(2, (p.tune + (p.fine/100))/12);
      const durMs = Math.max(10, Math.round((p.buffer.duration / rate) * 1000));
      triggerRetrigger(p, 1.0);
      return new Promise(res=>{ currentTimeout = setTimeout(res, durMs + Number(gapMsNum.value||250)); });
    }else if (useTTS){
      return ttsSpeak(spoken, Number(gapMsNum.value||250));
    }else{
      return new Promise(res=>{ currentTimeout = setTimeout(res, Number(gapMsNum.value||250)); });
    }
  }

  async function playSentence(arr){
    if (!arr || arr.length===0) return;
    playingSentence = true; playAbort=false; if (seqStatus) seqStatus.textContent='playing';
    for (let i=0;i<arr.length;i++){
      if (playAbort) break;
      await playWordToken(arr[i]);
    }
    playingSentence = false; if (seqStatus) seqStatus.textContent='ready';
  }

  function stopSentence(){
    playAbort = true;
    if (currentTimeout){ clearTimeout(currentTimeout); currentTimeout = null; }
    try{ if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }catch(_){}
    playingSentence = false;
    if (seqStatus) seqStatus.textContent='ready';
  }

  sentencePlayBtn.onclick = async ()=>{
    if (playingSentence){ stopSentence(); return; }
    if (songMode){
      if (chain.length===0){ chain = defaultChain(); }
      for (let i=0;i<chain.length;i++){
        if (playAbort) break;
        const idx = chain[i];
        ensureScene(idx);
        await playSentence(scenes[idx].sentence);
      }
      playingSentence=false; if (seqStatus) seqStatus.textContent='ready';
      return;
    }
    await playSentence(App.sentence);
  };
  sentenceStopBtn.onclick = stopSentence;
  sentenceBackBtn.onclick = ()=>{ App.sentence.pop(); renderSentence(); };
  sentenceClearBtn.onclick= ()=>{ App.sentence.length=0; renderSentence(); };

  function onPadPress(gid, idx, vel){
    const g = App.groups.find(x=>x.id===gid); if (!g) return;
    const p = g.pads[idx]; if (!p) return;

    // Play or record
    if (p.mode===PadMode.RETRIGGER) triggerRetrigger(p, vel);
    else if (p.mode===PadMode.TOGGLE_START) togglePad(p, false);
    else if (p.mode===PadMode.TOGGLE_RESUME) togglePad(p, true);
    else if (p.mode===PadMode.RECORD){
      const st = padRecorders.get(p); if (st && st.active) stopPadRecording(p, gid, idx); else startPadRecording(p, gid, idx);
    }

    // NEW: If no sample and TTS fallback is enabled, speak immediately on pad press
    if ((!p.buffer) && ttsFallbackChk && ttsFallbackChk.checked){
      const spoken = (p.phrase && p.phrase.trim()) ? p.phrase.trim() : p.name;
      ttsSpeak(spoken, Number(gapMsNum.value||250));
    }

    // Compose appends token
    if (composeMode){
      const text = (p.phrase && p.phrase.trim()) ? p.phrase.trim() : p.name;
      App.sentence.push({ gid, idx, name: p.name, text, color: g.color });
      renderSentence();
    }

    flashPad(gid, idx);
  }

  /* ========= Kit Editor (per-group) ========= */
  function updateEditorBadge(g){ kitGroupName.textContent = `${g.name} (${g.rows}×${g.cols})`; kitGroupDot.style.background = g.color; }
  function toggleKitForGroup(gid){
    if (App.editGid===gid && kitEditor.classList.contains('show')){
      App.editGid = null; kitEditor.classList.remove('show'); renderBoards(); renderGroupList(); return;
    }
    App.editGid = gid; rebuildEditor(); kitEditor.classList.add('show'); groupsPanel.classList.remove('show'); renderBoards(); renderGroupList();
  }
  closeKitBtn.onclick = ()=> { App.editGid = null; kitEditor.classList.remove('show'); renderBoards(); renderGroupList(); };

  function rebuildEditor(){
    kitRows.innerHTML = '';
    const g = App.groups.find(x=>x.id===App.editGid) || App.groups[0];
    if (!g){ kitGroupName.textContent='—'; return; }
    updateEditorBadge(g);

    const vocab = loadVocab(); // caregiver-saved words from on-screen keyboard

    for (let i=0;i<g.pads.length;i++){
      const p = g.pads[i];
      const row = document.createElement('div'); row.className='kit-row';
      const fileId = `file_${g.id}_${i}`;
      const imgId  = `img_${g.id}_${i}`;
      row.innerHTML = `
        <div class="namecell">
          <div class="padid">${g.name} • Pad ${i+1}</div>
          <input type="text" value="${p.name}" data-k="name" placeholder="Button label (short)">
          <input type="text" value="${p.phrase || ''}" data-k="phrase" placeholder="Phrase for sentence (long, optional)">
          <div class="fileline">
            <input id="${fileId}" type="file" accept="audio/*" hidden>
            <label class="btn small" for="${fileId}">Choose audio</label>
            <span class="dur">${p.duration ? p.duration.toFixed(2)+'s' : '—'}</span>
          </div>
          <div class="fileline">
            <input id="${imgId}" type="file" accept="image/*" hidden>
            <label class="btn small" for="${imgId}">Choose image</label>
            <img src="${p.img ? p.img : ''}" alt="" style="height:28px;border-radius:4px;${p.img?'':'display:none'}">
            <button class="btn small ghost" data-k="imgclear">Clear</button>
          </div>
        </div>
        <div class="kit-controls">
          <label>Mode
            <select data-k="mode">
              <option value="retrigger" ${p.mode==='retrigger'?'selected':''}>Retrigger</option>
              <option value="toggle_start" ${p.mode==='toggle_start'?'selected':''}>Toggle (Start)</option>
              <option value="toggle_resume" ${p.mode==='toggle_resume'?'selected':''}>Toggle (Resume)</option>
              <option value="record" ${p.mode==='record'?'selected':''}>Record on Pad</option>
            </select>
          </label>
          <label>Gain <input type="number" min="0" max="2" step="0.01" value="${p.gain}" data-k="gain" style="width:90px"></label>
          <label>Pan  <input type="number" min="-1" max="1" step="0.01" value="${p.pan}" data-k="pan" style="width:90px"></label>
          <label>Loop <input type="checkbox" ${p.loop?'checked':''} data-k="loop"></label>
          <label>Reverse <input type="checkbox" ${p.reverse?'checked':''} data-k="reverse"></label>
        </div>
      `;

      // Vocabulary → Pad picker
      if (Array.isArray(vocab) && vocab.length){
        const controls = row.querySelector('.kit-controls');
        const wrap = document.createElement('div');
        wrap.style.display = 'flex'; wrap.style.gap = '8px'; wrap.style.alignItems='center';

        const lab = document.createElement('span');
        lab.className = 'small muted';
        lab.textContent = 'Vocabulary → Pad';

        const sel = document.createElement('select');
        sel.style.minWidth = '180px';
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = 'Pick a word/phrase…';
        sel.appendChild(ph);
        vocab.slice(0,500).forEach(w=>{
          const o = document.createElement('option');
          o.value = w; o.textContent = w;
          sel.appendChild(o);
        });

        const useBtn = document.createElement('button');
        useBtn.className = 'btn small';
        useBtn.textContent = 'Use';
        useBtn.onclick = ()=>{
          const val = sel.value;
          if(!val) return;
          const prevName = p.name;
          p.name = val;
          if (!p.phrase || p.phrase.trim()==='' || p.phrase===prevName){ p.phrase = val; }
          const nameInp = row.querySelector('[data-k="name"]');
          const phrInp  = row.querySelector('[data-k="phrase"]');
          if (nameInp) nameInp.value = p.name;
          if (phrInp)  phrInp.value  = p.phrase;
          renderBoards(); renderSentence();
          status(`Mapped vocabulary → ${p.name}`);
        };

        wrap.appendChild(lab);
        wrap.appendChild(sel);
        wrap.appendChild(useBtn);
        controls.appendChild(wrap);
      }

      // Keep phrase synced / default to name on blank
      row.addEventListener('input', (e)=>{
        const t = e.target, k = t.dataset.k; if (!k) return;
        if (t.type==='checkbox'){ p[k]=!!t.checked; }
        else if (t.tagName==='SELECT'){ p[k]=t.value; }
        else if (k==='name'){
          const prevName = p.name;
          p.name = t.value;
          if (!p.phrase || p.phrase.trim()==='' || p.phrase===prevName){
            p.phrase = p.name;
            const phr = row.querySelector('[data-k="phrase"]'); if (phr) phr.value = p.phrase;
          }
          renderBoards(); renderSentence();
        }
        else if (k==='phrase'){
          if (t.value.trim()===''){ p.phrase = ''; } else { p.phrase = t.value; }
          renderSentence();
        }
        else { const num = Number(t.value); if (!isNaN(num)) p[k]=num; }
      });
      const phraseInput = row.querySelector('[data-k="phrase"]');
      phraseInput.addEventListener('blur', ()=>{
        if (!phraseInput.value.trim()){ p.phrase = p.name; phraseInput.value = p.name; renderSentence(); }
      });

      // audio file
      row.querySelector('#'+fileId).onchange = async (e)=>{
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try{
          const arr = await f.arrayBuffer(); const buf = await actx.decodeAudioData(arr.slice(0));
          p.buffer = buf; p.duration=buf.duration;
          const inferred = f.name.replace(/\.[^.]+$/,'');
          if (!p.name || /^Pad\s\d+/.test(p.name)) { const prevName = p.name; p.name = inferred;
            if (!p.phrase || p.phrase.trim()==='' || p.phrase===prevName){ p.phrase = p.name; phraseInput.value = p.phrase; }
          }
          p.b64 = bufferToBase64Wav(buf);
          rebuildEditor(); renderBoards(); renderSentence(); status(`Loaded ${p.name}`);
        }catch(err){ report('loadPadFile', err); }
      };

      // image file
      row.querySelector('#'+imgId).onchange = (e)=>{
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const fr = new FileReader();
        fr.onload = ()=>{ p.img = fr.result; rebuildEditor(); renderBoards(); };
        fr.readAsDataURL(f);
      };
      row.querySelector('[data-k="imgclear"]').onclick = ()=>{
        p.img = null; rebuildEditor(); renderBoards();
      };

      kitRows.appendChild(row);
    }
  }

  /* ========= Stop All ========= */
  stopAllBtn.onclick = ()=>{
    for (const g of App.groups){ for (const p of g.pads){ stopPadVoices(p, true); p.toggleOn=false; p.voice=null; p.savedOffset=0; } }
    try{ if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }catch(_){}
    stopSentence();
    status('Stopped all');
  };

  /* ========= Save/Load (kits + sentences/scenes) ========= */
  function encodeWav(buffer){
    const numChannels = buffer.numberOfChannels, sampleRate = buffer.sampleRate, samples = buffer.length;
    const bytesPerSample = 2, blockAlign = numChannels * bytesPerSample, byteRate = sampleRate * blockAlign, dataSize = samples * blockAlign, headerSize = 44;
    const ab = new ArrayBuffer(headerSize + dataSize), view = new DataView(ab);
    function writeStr(off, str){ for(let i=0;i<str.length;i++) view.setUint8(off+i, str.charCodeAt(i)); }
    writeStr(0,'RIFF'); view.setUint32(4,36+dataSize,true); writeStr(8,'WAVE'); writeStr(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true);
    writeStr(36,'data'); view.setUint32(40,dataSize,true);
    let pos=44; const tmp = new Float32Array(samples*numChannels);
    for (let i=0;i<samples;i++){ for (let c=0;c<numChannels;c++){ tmp[i*numChannels+c] = buffer.getChannelData(c)[i]; } }
    for (let i=0;i<tmp.length;i++){ let s = Math.max(-1, Math.min(1, tmp[i])); view.setInt16(pos, s<0 ? s*0x8000 : s*0x7FFF, true); pos+=2; }
    return ab;
  }
  function bufferToBase64Wav(buffer){
    const wav = encodeWav(buffer); const bytes = new Uint8Array(wav); let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function base64ToArrayBuffer(b64){
    const x = b64.split(',').pop(); const bin = atob(x); const len = bin.length; const bytes = new Uint8Array(len);
    for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer;
  }

  function serializeSeq(){
    return {
      composeMode,
      ttsFallback: !!ttsFallbackChk.checked,
      currentScene,
      chain,
      scenes: scenes.map(s=> s ? { gapMs: s.gapMs, sentence: s.sentence.map(t=>({gid:t.gid,idx:t.idx,name:t.name,text:t.text,color:t.color})) } : null )
    };
  }
  function applySeq(s){
    if (!s) return;
    setCompose(!!s.composeMode);
    if (ttsFallbackChk) ttsFallbackChk.checked = !!s.ttsFallback;
    const scArr = Array.isArray(s.scenes) ? s.scenes : [];
    scenes = Array.from({length:SCENE_COUNT}, (_,i)=>{
      const src = scArr[i]; if(!src) return null;
      const gap = (src.gapMs|0) || 250;
      const sent = Array.isArray(src.sentence)
        ? src.sentence.map(t=> ({gid:t.gid, idx:t.idx, name:t.name, text: (t.text && t.text.trim()) || t.name, color:t.color}))
        : [];
      return { gapMs: gap, sentence: sent };
    });
    const target = (typeof s.currentScene==='number' && s.currentScene>=0 && s.currentScene<SCENE_COUNT) ? s.currentScene : 0;
    setScene(target);
    if (Array.isArray(s.chain)){ chain=s.chain.slice(0); renderChain(); }
  }

  function serialize(){
    return {
      groups: App.groups.map(g=>({
        id:g.id, name:g.name, rows:g.rows, cols:g.cols, color:g.color,
        pads: g.pads.map(p=>({
          name:p.name, phrase:(p.phrase && p.phrase.trim()) ? p.phrase : p.name, // ensure default when blank
          b64:p.b64, img:p.img,
          gain:p.gain, pan:p.pan, filterType:p.filterType, cutoff:p.cutoff, q:p.q,
          env:p.env, tune:p.tune, fine:p.fine, loop:p.loop, reverse:p.reverse, choke:p.choke, mode:p.mode
        }))
      })),
      visible: Array.from(App.visible),
      seq: serializeSeq()
    };
  }
  async function deserialize(obj){
    App.groups.length=0; App.visible.clear(); App.editGid=null; kitEditor.classList.remove('show');
    if (Array.isArray(obj.groups)){
      for (const gsrc of obj.groups){
        const g = makeGroup(gsrc.name||'Group', Number(gsrc.rows||4), Number(gsrc.cols||4), gsrc.color || DEFAULT_COLORS[(NEXT_GROUP_ID-1)%DEFAULT_COLORS.length]);
        const count = Math.min(g.pads.length, Array.isArray(gsrc.pads)?gsrc.pads.length:0);
        for (let i=0;i<count;i++){
          const src = gsrc.pads[i], dst = g.pads[i];
          Object.assign(dst, src);
          if (!dst.phrase || dst.phrase.trim()==='') dst.phrase = dst.name; // back-compat/default
          if (!dst.mode) dst.mode = PadMode.RETRIGGER;
          if (src.b64){ try{ const wav = base64ToArrayBuffer(src.b64); const buf = await actx.decodeAudioData(wav.slice(0)); dst.buffer=buf; dst.duration=buf.duration; }catch(_){} }
          dst.toggleOn=false; dst.savedOffset=0; dst.voice=null; dst.voices=[];
        }
        g.id = gsrc.id || g.id; App.groups.push(g);
      }
      if (Array.isArray(obj.visible)){ for (const id of obj.visible){ App.visible.add(id); } }
      if (obj.seq) applySeq(obj.seq);
    }else if (Array.isArray(obj.pads)){
      const n = obj.pads.length, side = Math.ceil(Math.sqrt(n));
      const g = makeGroup('Group', side, side);
      for (let i=0;i<Math.min(n, g.pads.length);i++){
        Object.assign(g.pads[i], obj.pads[i]);
        if (!g.pads[i].phrase || g.pads[i].phrase.trim()==='') g.pads[i].phrase = g.pads[i].name;
      }
      App.groups=[g]; App.visible.add(g.id);
    }
    renderGroupList(); renderBoards(); renderSentence();
    status('Kit loaded');
  }

  saveKitBtn.onclick = ()=>{
    const payload = serialize(); const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'medpad_kit.json'; a.click();
  };
  loadKitBtn.onclick = ()=> loadKitFile.click();
  loadKitFile.onchange = async ()=>{ const f = loadKitFile.files[0]; if (!f) return; try{ const txt = await f.text(); const obj = JSON.parse(txt); await deserialize(obj); } catch(e){ report('kitImport', e); } };

  /* ========= Local library ========= */
  const LS_KEY = 'medpad.kits.v3';
  function loadLib(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }catch(_){ return {}; } }
  function saveLib(obj){ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }
  function refreshKitList(){
    const store = loadLib(); kitList.innerHTML = ''; const names = Object.keys(store).sort();
    if (names.length===0){ kitList.innerHTML = '<div class="muted small">No kits saved.</div>'; return; }
    names.forEach(name=>{
      const card = document.createElement('div'); card.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px;background:#0f1519;display:flex;gap:8px;align-items:center';
      const title = document.createElement('div'); title.textContent=name; title.style.cssText='font-weight:700;flex:1';
      const loadBtn = document.createElement('button'); loadBtn.className='btn small'; loadBtn.textContent='Load';
      const renBtn  = document.createElement('button'); renBtn.className='btn small ghost'; renBtn.textContent='Rename';
      const delBtn  = document.createElement('button'); delBtn.className='btn small ghost'; delBtn.textContent='Delete';
      loadBtn.onclick = async ()=>{ await deserialize(store[name]); kitNameInp.value = name; status('Loaded kit: '+name); };
      renBtn.onclick = ()=>{ const nn=prompt('Rename kit', name); if(!nn||nn===name) return; const s=loadLib(); s[nn]=s[name]; delete s[name]; saveLib(s); refreshKitList(); kitNameInp.value=nn; };
      delBtn.onclick = ()=>{ if(!confirm('Delete kit "'+name+'"?')) return; const s=loadLib(); delete s[name]; saveLib(s); refreshKitList(); };
      const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px';
      right.appendChild(loadBtn); right.appendChild(renBtn); right.appendChild(delBtn);
      card.appendChild(title); card.appendChild(right); kitList.appendChild(card);
    });
  }
  kitSaveAsBtn.onclick = ()=>{ const name=(kitNameInp.value||'').trim() || ('Kit '+new Date().toLocaleString()); const s=loadLib(); s[name]=serialize(); saveLib(s); refreshKitList(); status('Saved kit: '+name); };
  kitExportBtn.onclick = ()=>{ const name=(kitNameInp.value||'').trim() || 'exported_kit'; const blob=new Blob([JSON.stringify(serialize())],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name+'.json'; a.click(); };
  kitImportBtn.onclick = ()=> kitImportFile.click();
  kitImportFile.onchange = async ()=>{ const f=kitImportFile.files[0]; if(!f) return; try{ const obj=JSON.parse(await f.text()); await deserialize(obj); status('Imported kit file'); }catch(e){ report('kitImport', e); } };

  /* ========= Scenes & Story ========= */
  const SCENE_COUNT = 8;
  const sceneLabels = ['A1','A2','A3','A4','B1','B2','B3','B4'];
  let scenes = Array.from({length:SCENE_COUNT}, ()=> null);
  let currentScene = 0;
  let songMode=false, chainEdit=false, chain=[];

  function renderChain(){ chainView.textContent = chain.length ? chain.map(i=>sceneLabels[i]).join(' • ') : '—'; }
  function defaultChain(){ return [0,1,2,3,4,5,6,7]; }

  function ensureScene(idx){
    if (!scenes[idx]) scenes[idx] = { gapMs: Number(gapMsNum.value||250), sentence: [] };
    return scenes[idx];
  }
  function saveCurrentScene(){
    const sc = ensureScene(currentScene);
    sc.gapMs = Number(gapMsNum.value||250);
    sc.sentence = App.sentence.slice(0);
  }
  function setScene(idx){
    saveCurrentScene();
    currentScene = idx;
    const sc = ensureScene(idx);
    gapMsNum.value = String(sc.gapMs|0 || 250);
    wpmNum.value   = String(wpmFromMs(gapMsNum.value));
    App.sentence = sc.sentence.slice(0);
    renderSentence();
    updateSceneBar();
    status('Scene: '+sceneLabels[idx]);
  }
  function updateSceneBar(){ sceneBtns.forEach((b,bi)=> b.setAttribute('aria-pressed', bi===currentScene?'true':'false')); }

  songModeBtn.onclick  = ()=>{ songMode = !songMode; songModeBtn.setAttribute('aria-pressed', songMode?'true':'false'); status(songMode?'Story Mode: on':'Story Mode: off'); };
  chainEditBtn.onclick = ()=>{ chainEdit = !chainEdit; chainEditBtn.setAttribute('aria-pressed', chainEdit?'true':'false'); status(chainEdit?'Chain edit: tap scenes':'Chain edit: off'); };
  chainClearBtn.onclick= ()=>{ chain.length=0; renderChain(); status('Chain cleared'); };
  sceneBtns.forEach((btn, i)=>{ btn.onclick = ()=>{ if (chainEdit){ chain.push(i); renderChain(); } else setScene(i); }; });

  /* ========= boot ========= */
  function initDefaults(){
    const nouns = makeGroup('Nouns', 4, 4, '#30f39b');
    const verbs = makeGroup('Verbs', 3, 3, '#42c6ff');
    App.groups.push(nouns, verbs); App.visible.add(nouns.id); App.visible.add(verbs.id);
    App.editGid = null;
  }

  function init(){
    try{
      initDefaults(); renderGroupList(); renderBoards();
      ensureScene(0); setScene(0); renderChain();
      refreshKitList();
      setCompose(false);
      status('ready');
      window.__MEDPAD_READY = true;
    }catch(e){
      report('init', e);
    }
  }
  init();
})();
