(function(){
  'use strict';

  /* ===== Error → status pill ===== */
  function report(where, err){
    try{
      const el = document.getElementById('status');
      const msg = (err && err.message) ? err.message : String(err);
      if (el) el.textContent = `error@${where}: ${msg}`;
      console.error(`error@${where}`, err);
    }catch(_){}
  }
  window.addEventListener('error', e => report('window', e.error || e.message));
  window.addEventListener('unhandledrejection', e => report('promise', e.reason));

  try{
    /* ===== DOM ===== */
    const $  = (s, r=document) => r.querySelector(s);
    const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

    const padgrid  = $('#padgrid');
    const statusEl = $('#status');

    // Panels / header
    const kitEditor     = $('#kitEditor');
    const editKitBtn    = $('#editKitBtn');
    const seqPanel      = $('#seqPanel');
    const midiPanel     = $('#midiPanel');
    const fxPanel       = $('#fxPanel');
    const samplerPanel  = $('#samplerPanel');

    $('#toggleSeqBtn').onclick   = ()=> seqPanel.classList.toggle('show');
    $('#toggleMidiBtn').onclick  = ()=> midiPanel.classList.toggle('show');
    $('#toggleFxBtn').onclick    = ()=> fxPanel.classList.toggle('show');
    $('#toggleSamplerBtn').onclick=()=> {
      samplerPanel.classList.toggle('show');
      if (samplerPanel.classList.contains('show')) {
        drawWave();
        rebuildPiano();
        refreshLayerList();
      }
    };
    $('#toggleKitMgrBtn').onclick= ()=> { const p = $('#kitMgrPanel'); p.classList.toggle('show'); refreshKitList(); };
    $('#stopAllBtn').onclick = ()=>{ for (let i=0;i<PAD_COUNT;i++) stopPadVoices(i, true); status('Stopped all'); };

    // Kit Editor internals
    const saveKitBtn  = $('#saveKitBtn');
    const loadKitBtn  = $('#loadKitBtn');
    const loadKitFile = $('#loadKitFile');
    const kitRows     = $('#kitRows');

    // Sequencer controls
    const seqPlayBtn     = $('#seqPlayBtn');
    const seqGridEl      = $('#seqGrid');
    const seqBPMInput    = $('#seqBPM');
    const seqBPMNum      = $('#seqBPMNum');
    const seqSwingInput  = $('#seqSwing');
    const seqStepsInput  = $('#seqSteps');
    const seqLAInput     = $('#seqLookAhead');
    const q16Btn         = $('#q16');
    const q8tBtn         = $('#q8t');
    const seqStatus      = $('#seqStatus');

    // Scene & song UI
    const sceneBtns   = $$('[data-scene]');
    const songModeBtn = $('#songModeBtn');
    const chainEditBtn= $('#chainEditBtn');
    const chainClearBtn=$('#chainClearBtn');
    const chainView   = $('#chainView');

    // FX
    const fxDelayTime    = $('#fxDelayTime');
    const fxDelayFB      = $('#fxDelayFB');
    const fxDelayMix     = $('#fxDelayMix');
    const fxReverbMix    = $('#fxReverbMix');
    const fxReverbDecay  = $('#fxReverbDecay');
    const fxMasterGain   = $('#fxMasterGain');
    const recordBtn      = $('#recordBtn');
    const recStatus      = $('#recStatus');

    // Sampler
    const samplerFile    = $('#samplerFile');
    const samplerDrop    = $('#samplerDrop');
    const samplerWave    = $('#samplerWave');
    const samplerPlay    = $('#samplerPlay');
    const samplerStop    = $('#samplerStop');
    const samplerOneShot = $('#samplerOneShotRec');
    const samplerLive    = $('#samplerLive');
    const samplerClear   = $('#samplerClear');
    const samplerExportSel = $('#samplerExportSel');
    const samplerExportAll = $('#samplerExportAll');
    const samplerZoom    = $('#samplerZoom');
    const sStartEl       = $('#sStart');
    const sEndEl         = $('#sEnd');
    const sNormalize     = $('#sNormalize');
    const samplerPad     = $('#samplerPad');
    const samplerAssign  = $('#samplerAssign');
    const samplerSliceRow= $('#samplerSliceRow');

    // Sampler Piano UI
    const samplerKeys = document.getElementById('samplerKeys');
    const whiteKeysWrap = samplerKeys ? samplerKeys.querySelector('.white-keys') : null;
    const octDown = document.getElementById('octDown');
    const octUp = document.getElementById('octUp');
    const octLabel = document.getElementById('octLabel');
    const sampModeBtn = document.getElementById('sampModeBtn');

    // Layers UI
    const layerList = document.getElementById('layerList');
    const layerModeBtn = document.getElementById('layerModeBtn');
    const layerClearWin = document.getElementById('layerClearWin');
    const layerClearAll = document.getElementById('layerClearAll');

    // Kits manager
    const kitName   = $('#kitName');
    const kitSaveAs = $('#kitSaveAs');
    const kitExport = $('#kitExport');
    const kitImportBtn = $('#kitImportBtn');
    const kitImportFile= $('#kitImportFile');
    const kitList   = $('#kitList');

    /* ===== Audio ===== */
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const masterGain = ctx.createGain(); masterGain.gain.value = Number(fxMasterGain.value || 1);
    let limiterNode  = null;

    // FX Sends
    const sendA = ctx.createGain(); sendA.gain.value = 0.0; // Delay send
    const sendB = ctx.createGain(); sendB.gain.value = 0.0; // Reverb send

    // Delay
    const delayNode = ctx.createDelay(1.0); delayNode.delayTime.value = Number(fxDelayTime.value || 0.25);
    const delayFBG  = ctx.createGain(); delayFBG.gain.value = Number(fxDelayFB.value || 0.35);
    const delayOut  = ctx.createGain(); delayOut.gain.value = Number(fxDelayMix.value || 1.0);
    sendA.connect(delayNode).connect(delayFBG).connect(delayNode);
    delayNode.connect(delayOut);

    // Reverb
    const convolver = ctx.createConvolver();
    convolver.buffer = makeSimpleImpulse(ctx, Number(fxReverbDecay.value || 2.5));
    const reverbWet  = ctx.createGain(); reverbWet.gain.value = Number(fxReverbMix.value || 0.2);
    sendB.connect(convolver).connect(reverbWet);

    // FX → Master
    const fxSum = ctx.createGain();
    delayOut.connect(fxSum);
    reverbWet.connect(fxSum);
    fxSum.connect(masterGain);

    // Compressor + limiter
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value=-10; comp.knee.value=20; comp.ratio.value=3;
    comp.attack.value=0.003; comp.release.value=0.25;

    const limiterWorklet = `
      class Brickwall extends AudioWorkletProcessor{
        static get parameterDescriptors(){ return [{name:'ceiling', defaultValue:0.99}]}
        process(inputs, outputs, params){
          const out = outputs[0]; const ceil = params.ceiling[0];
          for (let ch=0; ch<out.length; ch++){
            const o = out[ch];
            for (let i=0;i<o.length;i++){
              const s = o[i]; o[i] = Math.max(-ceil, Math.min(ceil, s));
            }
          }
          return true;
        }
      }
      registerProcessor('brickwall', Brickwall);
    `;
    async function ensureLimiter(){
      try{
        if (limiterNode) return;
        const blob = new Blob([limiterWorklet], {type:'application/javascript'});
        await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
        limiterNode = new AudioWorkletNode(ctx, 'brickwall', {numberOfInputs:1, numberOfOutputs:1});
        masterGain.connect(comp).connect(limiterNode).connect(ctx.destination);
      }catch(e){
        masterGain.connect(comp).connect(ctx.destination);
      }
    }
    ensureLimiter();

    /* ===== Pads state ===== */
    const PAD_COUNT = 64;

    const PadMode = Object.freeze({
      RETRIGGER: 'retrigger',
      TOGGLE_START: 'toggle_start',
      TOGGLE_RESUME: 'toggle_resume',
      RECORD: 'record'
    });

    const pads = Array.from({length:PAD_COUNT}, (_,i)=>({
      name:`Pad ${String(i+1).padStart(2,'0')}`,
      buffer:null, b64:null, duration:0,
      gain:1.0, pan:0.0,
      filterType:'lowpass', cutoff:18000, q:0.0001,
      env:{a:0.001,d:0.02,s:1.0,r:0.04},
      tune:0, fine:0,
      loop:false, reverse:false,
      choke:0,
      sendA:0.0, sendB:0.0,
      mode:PadMode.RETRIGGER,
      voices:[],
      toggleOn:false, savedOffset:0, voice:null
    }));

    /* === Pad audio chain === */
    function makePadChain(){
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();
      const f = ctx.createBiquadFilter();
      const a = ctx.createGain();
      g.connect(f).connect(p).connect(a);
      const sa = ctx.createGain(); sa.gain.value=0;
      const sb = ctx.createGain(); sb.gain.value=0;
      a.connect(masterGain);
      a.connect(sa).connect(sendA);
      a.connect(sb).connect(sendB);
      return {g,p,f,a,sa,sb};
    }

    function makeSimpleImpulse(ctx, seconds){
      const sr = ctx.sampleRate;
      const len = Math.floor(Math.max(0.2, seconds)*sr);
      const ir = ctx.createBuffer(2, len, sr);
      for (let c=0;c<2;c++){
        const d = ir.getChannelData(c);
        for (let i=0;i<len;i++){
          const t = i/len;
          d[i] = (Math.random()*2-1) * Math.pow(1-t, 2.2) * 0.6;
        }
      }
      return ir;
    }

    /* ===== Rotary knobs ===== */
    function initKnobsIn(root=document){
      function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
      function fmt(n){ return (Math.abs(n) >= 100 ? n.toFixed(0) : (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2))); }
      function valToAngle(v,min,max,sweep){ const half=sweep/2; const t=(v-min)/(max-min||1); return -half + t*sweep; }
      function angleToVal(ang,min,max,sweep){ const half=sweep/2; const t=(ang+half)/sweep; return min + t*(max-min); }
      function eventAngle(e, face){
        const r = face.getBoundingClientRect();
        const cx = r.left + r.width/2;
        const cy = r.top  + r.height/2;
        const x = (e.touches ? e.touches[0].clientX : e.clientX);
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const theta = Math.atan2(y - cy, x - cx);
        return (Math.PI/2 - theta) * 180/Math.PI;
      }

      $$('.knob', root).forEach(k=>{
        if (k.__wired) return;
        const forId = k.dataset.for;
        const min   = Number(k.dataset.min ?? 0);
        const max   = Number(k.dataset.max ?? 1);
        const step  = Number(k.dataset.step ?? 0.01);
        const label = k.dataset.label || '';
        const sweep = Number(k.dataset.sweep || 300);

        let startVal;
        if (forId){
          const linked = document.getElementById(forId);
          if (linked && !isNaN(Number(linked.value))) startVal = Number(linked.value);
        }
        if (startVal===undefined || isNaN(startVal)) startVal = min;

        k.innerHTML = `
          <div class="k-face"><div class="k-mark"></div></div>
          <div class="k-label">${label}</div>
          <div class="k-val"></div>
        `;
        const face = k.firstElementChild;
        const vTxt = k.lastElementChild;

        let value = startVal;

        function set(v, emit){
          v = clamp(v, min, max);
          if (step>0){ v = Math.round((v-min)/step)*step + min; }
          value = Number(v.toFixed(6));
          face.style.setProperty('--ang', valToAngle(value, min, max, sweep)+'deg');
          vTxt.textContent = fmt(value);
          if (forId){
            const inp = document.getElementById(forId);
            if (inp){
              inp.value = String(value);
              if (emit) inp.dispatchEvent(new Event('input', {bubbles:true}));
            }
          }
        }
        set(value, false);

        let dragging=false;
        function onDown(e){
          dragging=true;
          face.setPointerCapture && face.setPointerCapture(e.pointerId);
          const ang = Math.max(-sweep/2, Math.min(sweep/2, eventAngle(e, face)));
          set(angleToVal(ang, min, max, sweep), true);
          e.preventDefault && e.preventDefault();
        }
        function onMove(e){
          if (!dragging) return;
          const ang = Math.max(-sweep/2, Math.min(sweep/2, eventAngle(e, face)));
          set(angleToVal(ang, min, max, sweep), true);
          e.preventDefault && e.preventDefault();
        }
        function onUp(){ dragging=false; }

        face.addEventListener('pointerdown', onDown);
        face.addEventListener('pointermove', onMove);
        face.addEventListener('pointerup', onUp);
        face.addEventListener('pointercancel', onUp);
        face.addEventListener('pointerleave', onUp);

        k.addEventListener('wheel', (e)=>{
          e.preventDefault();
          const dir = Math.sign(e.deltaY) * -1;
          const span = (max - min || 1);
          const inc = Math.max(step, span/200);
          set(value + dir*inc, true);
        }, {passive:false});

        k.__wired = true;
      });
    }
    function setHiddenInput(inp, v){
      inp.value = String(v);
      inp.dispatchEvent(new Event('input', {bubbles:true}));
      const k = document.querySelector(`.knob[data-for="${inp.id}"]`);
      if (k){ k.dataset.value = String(v); initKnobsIn(k.parentElement); }
    }

    /* ===== Pads & Kit UI ===== */
    function buildGrid(){
      padgrid.innerHTML = '';
      for (let i=0;i<PAD_COUNT;i++){
        const row = Math.floor(i / 8);
        const col = i % 8;
        const quad = (row<4 ? (col<4 ? 0 : 1) : (col<4 ? 2 : 3));

        const pad = document.createElement('button');
        pad.className = `pad quad${quad}`;
        pad.dataset.index = i;
        pad.innerHTML = `<div class="title">${pads[i].name}</div><div class="sub">${i+1}</div>`;
        pad.addEventListener('mousedown', ()=> onPadPress(i, 1.0));
        pad.addEventListener('touchstart', (e)=>{ e.preventDefault(); onPadPress(i, 1.0); }, {passive:false});
        padgrid.appendChild(pad);
      }
      rebuildKitEditor();
    }

    function sliderCell(id, label, min, max, step, value, dataK, suffix){
      return `
        <div class="vcol">
          <div class="vlabel">${label}</div>
          <input class="vslider" id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-k="${dataK}" />
          <div class="vval" data-for="${id}">${formatVal(value, suffix)}</div>
        </div>
      `;
    }
    function formatVal(v, suffix){
      if (suffix==='Hz') {
        const n = Number(v);
        return n>=1000 ? (n/1000).toFixed(2)+'kHz' : n.toFixed(0)+'Hz';
      }
      if (suffix==='s') return Number(v).toFixed(3)+'s';
      return String(Number(v.toFixed ? v.toFixed(2) : v));
    }

    function rebuildKitEditor(){
      kitRows.innerHTML = '';
      for (let i=0;i<PAD_COUNT;i++){
        const idGain=`k_gain_${i}`, idPan=`k_pan_${i}`, idCut=`k_cut_${i}`, idQ=`k_q_${i}`,
              idA=`k_a_${i}`, idD=`k_d_${i}`, idS=`k_s_${i}`, idR=`k_r_${i}`,
              idTune=`k_tune_${i}`, idFine=`k_fine_${i}`, idSA=`k_sa_${i}`, idSB=`k_sb_${i}`,
              fileId=`k_file_${i}`;

        const row = document.createElement('div');
        row.className = 'kit-row';
        row.innerHTML = `
          <div>${i+1}</div>
          <div class="namecell">
            <input type="text" value="${pads[i].name}" data-k="name" placeholder="Pad name">
            <div class="fileline">
              <input class="sr-hide" id="${fileId}" type="file" accept="audio/*" data-k="sample">
              <label class="btn small" for="${fileId}">Choose file</label>
              <span class="dur">${pads[i].duration ? (pads[i].duration.toFixed(2)+'s') : '—'}</span>
            </div>
          </div>
          <div class="kit-controls">
            ${sliderCell(idGain, 'Gain', 0, 2, 0.01, pads[i].gain, 'gain')}
            ${sliderCell(idPan,  'Pan', -1, 1, 0.01, pads[i].pan, 'pan')}
            ${sliderCell(idCut,  'Cut', 50, 20000, 1, pads[i].cutoff, 'cutoff','Hz')}
            ${sliderCell(idQ,    'Res', 0.0001, 30, 0.0001, pads[i].q, 'q')}
            ${sliderCell(idTune, 'Semi', -24, 24, 1, pads[i].tune, 'tune')}
            ${sliderCell(idFine, 'Fine', -100, 100, 1, pads[i].fine, 'fine')}
            <div class="rightcell">
              <label>Mode
                <select data-k="mode">
                  <option value="retrigger" ${pads[i].mode==='retrigger'?'selected':''}>Drum / Retrigger</option>
                  <option value="toggle_start" ${pads[i].mode==='toggle_start'?'selected':''}>Toggle • From Start</option>
                  <option value="toggle_resume" ${pads[i].mode==='toggle_resume'?'selected':''}>Toggle • Resume</option>
                  <option value="record" ${pads[i].mode==='record'?'selected':''}>Sample (press to rec)</option>
                </select>
              </label>
              <label>Filter
                <select data-k="filterType">
                  ${['lowpass','bandpass','highpass','notch','lowshelf','highshelf'].map(t=>`<option ${pads[i].filterType===t?'selected':''}>${t}</option>`).join('')}
                </select>
              </label>
              <label>Choke
                <select data-k="choke">
                  ${['0','1','2','3','4','5','6','7','8'].map(v=>`<option ${String(pads[i].choke)===v?'selected':''}>${v}</option>`).join('')}
                </select>
              </label>
              <div class="checks">
                <label><input type="checkbox" ${pads[i].loop?'checked':''} data-k="loop"> Loop</label>
                <label><input type="checkbox" ${pads[i].reverse?'checked':''} data-k="reverse"> Rev</label>
              </div>
            </div>
            ${sliderCell(idA,   'A', 0, 1, 0.001, pads[i].env.a, 'env.a','s')}
            ${sliderCell(idD,   'D', 0, 1, 0.001, pads[i].env.d, 'env.d','s')}
            ${sliderCell(idS,   'S', 0, 1.2, 0.001, pads[i].env.s, 'env.s')}
            ${sliderCell(idR,   'R', 0, 1, 0.001, pads[i].env.r, 'env.r','s')}
            ${sliderCell(idSA,  'Send A', 0, 1, 0.01, pads[i].sendA, 'sendA')}
            ${sliderCell(idSB,  'Send B', 0, 1, 0.01, pads[i].sendB, 'sendB')}
          </div>
        `;
        row.addEventListener('input', async (e)=>{
          const t = e.target;
          const k = t.dataset.k;
          if (!k) return;

          if (t.classList.contains('vslider')){
            const v = t.value;
            const vv = row.querySelector(`.vval[data-for="${t.id}"]`);
            if (vv){
              const isHz = (t.id===idCut), isSec = (t.id===idA||t.id===idD||t.id===idR);
              vv.textContent = isHz ? formatVal(Number(v), 'Hz') : (isSec ? formatVal(Number(v), 's') : formatVal(Number(v)));
            }
          }

          const idx = i;
          if (k === 'sample'){
            try{
              const file = t.files && t.files[0]; if (!file) return;
              await loadSampleToPad(idx, file);
              rebuildKitEditor();
            }catch(err){ report('loadSample', err); }
            return;
          }
          setByPath(pads[idx], k, parseInputValue(t, getByPath(pads[idx], k)));
        });

        kitRows.appendChild(row);
      }
    }

    function parseInputValue(input, current){
      if (input.type === 'checkbox') return !!input.checked;
      if (input.tagName === 'SELECT') return input.value;
      const v = input.value;
      if (typeof current === 'number') return Number(v);
      return v;
    }
    function setByPath(obj, path, val){
      const parts = path.split('.');
      let o = obj;
      for (let i=0;i<parts.length-1;i++) o = o[parts[i]];
      o[parts[parts.length-1]] = val;
    }
    function getByPath(obj, path){
      return path.split('.').reduce((o,k)=>o&&o[k], obj);
    }

    /* ===== Load & Play helpers ===== */
    async function loadSampleToPad(idx, file){
      const arr = await file.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr.slice(0));
      pads[idx].buffer = buf;
      pads[idx].duration = buf.duration;
      pads[idx].b64 = await arrayBufferToBase64Wav(arr).catch(()=>null);
      pads[idx].name = file.name.replace(/\.[^/.]+$/,'');
      pads[idx].toggleOn=false; pads[idx].savedOffset=0; pads[idx].voice=null;
      status('Loaded → Pad '+(idx+1));
      buildGrid();
    }

    function stopPadVoices(idx, forceAll=false){
      if (forceAll){
        const voices = pads[idx].voices;
        while (voices.length){ try{ voices.pop().src.stop(); }catch{} }
      }else if (pads[idx].voice){
        try{ pads[idx].voice.src.stop(); }catch(_){}
        pads[idx].voice = null;
      }
    }

    function triggerRetriggerPad(idx, vel=1.0){
      const p = pads[idx];
      if (!p.buffer) return;

      if (p.choke){
        for (let i=0;i<PAD_COUNT;i++){
          if (i!==idx && pads[i].choke===p.choke) stopPadVoices(i, true);
        }
      }

      const {g,p:pan, f,a,sa,sb} = makePadChain();
      g.gain.value = p.gain * vel;
      pan.pan.value = p.pan;
      f.type = p.filterType;
      f.frequency.value = p.cutoff;
      f.Q.value = p.q;
      sa.gain.value = p.sendA;
      sb.gain.value = p.sendB;

      const src = ctx.createBufferSource();
      src.buffer = p.reverse ? reverseBuffer(p.buffer) : p.buffer;
      src.loop = !!p.loop;

      const semis = p.tune + (p.fine/100);
      const rate = Math.pow(2, semis/12);
      src.playbackRate.value = rate;

      const now = ctx.currentTime;
      const {a:att,d:dec,s:sus,r:rel} = p.env;
      a.gain.cancelScheduledValues(now);
      a.gain.setValueAtTime(0, now);
      a.gain.linearRampToValueAtTime(1, now+att);
      a.gain.linearRampToValueAtTime(sus, now+att+dec);
      const estDur = Math.max(0.02, p.buffer.duration / rate);
      a.gain.setTargetAtTime(0, now + estDur, Math.max(0.001, rel));

      src.connect(g);
      src.start(now);

      p.voices.push({src, a});
      src.onended = ()=>{ p.voices = p.voices.filter(v=>v.src!==src); };

      flashPad(idx);
    }

    function togglePad(idx, resume){
      const p = pads[idx];
      if (!p.buffer) return;

      if (p.toggleOn){
        const v = p.voice;
        if (v){
          const now = ctx.currentTime;
          if (resume){
            const elapsed = (now - v.startTime) * v.playbackRate;
            const newOff = v.startOffset + elapsed;
            p.savedOffset = p.loop ? (newOff % p.buffer.duration) : Math.min(newOff, p.buffer.duration);
          }else{
            p.savedOffset = 0;
          }
          try{
            v.a.gain.cancelScheduledValues(now);
            v.a.gain.setTargetAtTime(0, now, Math.max(0.001, p.env.r));
            v.src.stop(now + Math.max(0.015, p.env.r + 0.01));
          }catch(_){}
        }
        p.toggleOn=false; p.voice=null;
        flashPad(idx);
        return;
      }

      if (p.choke){
        for (let i=0;i<PAD_COUNT;i++){
          if (i!==idx && pads[i].choke===p.choke) stopPadVoices(i, true);
        }
      }

      const {g,p:pan, f,a,sa,sb} = makePadChain();
      g.gain.value = p.gain;
      pan.pan.value = p.pan;
      f.type = p.filterType;
      f.frequency.value = p.cutoff;
      f.Q.value = p.q;
      sa.gain.value = p.sendA;
      sb.gain.value = p.sendB;

      const src = ctx.createBufferSource();
      src.buffer = p.reverse ? reverseBuffer(p.buffer) : p.buffer;
      src.loop = !!p.loop;

      const semis = p.tune + (p.fine/100);
      const rate = Math.pow(2, semis/12);
      src.playbackRate.value = rate;

      const now = ctx.currentTime;
      const {a:att,d:dec,s:sus} = p.env;

      a.gain.cancelScheduledValues(now);
      a.gain.setValueAtTime(0, now);
      a.gain.linearRampToValueAtTime(1, now+att);
      a.gain.linearRampToValueAtTime(sus, now+att+dec);

      const startOffset = resume ? (p.savedOffset||0) : 0;
      src.connect(g);
      try{
        src.start(now, Math.min(startOffset, src.buffer.duration-0.001));
      }catch(e){ try{ src.start(now); }catch(_){ } }

      p.toggleOn = true;
      p.voice = {src, a, startTime: now, startOffset, playbackRate: rate};

      src.onended = ()=>{
        if (p.voice && p.voice.src === src){
          p.toggleOn = false; p.voice = null; p.savedOffset = 0;
        }
      };

      flashPad(idx);
    }

    /* === Pad RECORD mode === */
    let micStream = null;
    const padRecorders = new Map();

    document.addEventListener('pointerdown', async function onFirstPointer(){
      try{ if (!micStream){ micStream = await navigator.mediaDevices.getUserMedia({audio:true}); } }catch(_){}
      document.removeEventListener('pointerdown', onFirstPointer);
    }, { once:true });

    async function ensureMic(){
      if (micStream) return micStream;
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
      return micStream;
    }

    function setPadRecordingIndicator(idx, on){
      const el = padgrid.children[idx];
      if (el) el.classList.toggle('recording', !!on);
    }

    async function startPadRecording(idx){
      try{
        const stream = await ensureMic();
        const rec = new MediaRecorder(stream);
        const state = {rec, chunks:[], active:true};
        padRecorders.set(idx, state);
        rec.ondataavailable = e=> state.chunks.push(e.data);
        rec.onstop = async ()=>{
          state.active=false;
          try{
            const blob = new Blob(state.chunks, {type:'audio/webm'});
            const arr = await blob.arrayBuffer();
            const buf = await ctx.decodeAudioData(arr.slice(0));
            pads[idx].buffer = buf;
            pads[idx].duration = buf.duration;
            pads[idx].b64 = null;
            pads[idx].name = `Pad ${String(idx+1).padStart(2,'0')} (rec)`;
            pads[idx].toggleOn=false; pads[idx].savedOffset=0; pads[idx].voice=null;
            buildGrid();
            status(`Recorded → Pad ${idx+1}`);
          }catch(err){ report('padRecDecode', err); }
          setPadRecordingIndicator(idx, false);
        };
        rec.start();
        setPadRecordingIndicator(idx, true);
        status(`Recording pad ${idx+1}…`);
      }catch(e){ report('padRecStart', e); }
    }
    function stopPadRecording(idx){
      const st = padRecorders.get(idx);
      if (st && st.active){
        try{ st.rec.stop(); }catch(_){}
        padRecorders.delete(idx);
      }
    }

    function onPadPress(idx, vel=1){
      const m = pads[idx].mode || PadMode.RETRIGGER;
      if (m === PadMode.RETRIGGER) return triggerRetriggerPad(idx, vel);
      if (m === PadMode.TOGGLE_START) return togglePad(idx, false);
      if (m === PadMode.TOGGLE_RESUME) return togglePad(idx, true);
      if (m === PadMode.RECORD){
        const st = padRecorders.get(idx);
        if (st && st.active){ stopPadRecording(idx); }
        else { startPadRecording(idx); }
        return;
      }
    }

    function reverseBuffer(buf){
      const rev = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let c=0;c<buf.numberOfChannels;c++){
        const src = buf.getChannelData(c);
        const dst = rev.getChannelData(c);
        for (let i=0, j=src.length-1; i<src.length; i++, j--){ dst[i] = src[j]; }
      }
      return rev;
    }
    function flashPad(idx){
      const el = padgrid.children[idx];
      if (el){
        el.classList.add('playing');
        setTimeout(()=>el.classList.remove('playing'), 85);
      }
    }

    /* ===== Sequencer ===== */
    const tracks = 8;
    let stepsPerBar = Number(seqStepsInput.value || 16);
    let quant = '1/16';
    let bpm = Number(seqBPMInput.value || 120);
    let swingPct = Number(seqSwingInput.value || 50);
    let playing = false;
    let curStep = 0;
    let nextNoteTime = 0;

    const SCENE_COUNT = 8;
    let currentScene = 0;
    const sceneLabels = ['A1','A2','A3','A4','B1','B2','B3','B4'];
    let scenes = Array.from({length:SCENE_COUNT}, ()=> null);
    let pattern = null;

    function blankPattern(len){
      return Array.from({length:tracks}, ()=> Array.from({length: len}, ()=> false));
    }
    function ensureScene(idx){
      if (!scenes[idx]){
        scenes[idx] = { steps: stepsPerBar, data: blankPattern(stepsPerBar) };
      }
    }
    function resizePattern(data, newLen){
      for (let tr=0; tr<tracks; tr++){
        const row = data[tr];
        if (row.length === newLen) continue;
        if (row.length > newLen) data[tr] = row.slice(0, newLen);
        else {
          const extra = Array.from({length:newLen-row.length}, ()=> false);
          data[tr] = row.concat(extra);
        }
      }
    }
    function setScene(idx){
      ensureScene(idx);
      currentScene = idx;
      stepsPerBar = scenes[idx].steps;
      pattern = scenes[idx].data;
      setHiddenInput(seqStepsInput, stepsPerBar);
      updateSceneBar();
      buildSeqGrid();
      status('Scene: '+sceneLabels[idx]);
    }
    function updateSceneBar(){
      sceneBtns.forEach((b,bi)=> b.setAttribute('aria-pressed', bi===currentScene ? 'true' : 'false'));
    }

    let songMode = false;
    let chainEdit = false;
    let chain = [];
    let chainPos = 0;
    let pendingSceneSwitch = false;

    songModeBtn.onclick = ()=>{
      songMode = !songMode;
      songModeBtn.setAttribute('aria-pressed', songMode?'true':'false');
      status(songMode?'Song Mode: on':'Song Mode: off');
    };
    chainEditBtn.onclick = ()=>{
      chainEdit = !chainEdit;
      chainEditBtn.setAttribute('aria-pressed', chainEdit?'true':'false');
      status(chainEdit?'Chain edit: tap scenes to append':'Chain edit: off');
    };
    chainClearBtn.onclick = ()=>{ chain.length = 0; chainPos = 0; renderChain(); status('Chain cleared'); };

    sceneBtns.forEach((btn, i)=>{
      btn.onclick = ()=>{
        if (chainEdit){ chain.push(i); renderChain(); }
        else { setScene(i); }
      };
    });

    function renderChain(){
      chainView.textContent = chain.length ? chain.map(i=>sceneLabels[i]).join(' • ') : '—';
    }
    function defaultChain(){ return [0,1,2,3,4,5,6,7]; }
    function advanceSceneInSong(){
      pendingSceneSwitch = false;
      if (!songMode || !playing) return;
      if (chain.length===0) chain = defaultChain();
      chainPos = (chainPos + 1) % chain.length;
      setScene(chain[chainPos]);
    }

    function buildSeqGrid(){
      seqGridEl.innerHTML = '';
      seqGridEl.style.gridTemplateColumns = `120px repeat(${stepsPerBar}, 1fr)`;
      for (let tr=0; tr<tracks; tr++){
        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = `Track ${tr+1}`;
        seqGridEl.appendChild(label);
        for (let st=0; st<stepsPerBar; st++){
          const cell = document.createElement('div');
          cell.className = 'step';
          const b = Math.floor(st/4) % 4;
          cell.classList.add('b'+b);
          if (st%4===0) cell.classList.add('beatStart');
          cell.dataset.tr = tr;
          cell.dataset.st = st;
          if (pattern && pattern[tr] && pattern[tr][st]) cell.classList.add('on');
          cell.addEventListener('click', ()=>{
            pattern[tr][st] = !pattern[tr][st];
            cell.classList.toggle('on', pattern[tr][st]);
          });
          seqGridEl.appendChild(cell);
        }
      }
      highlightStep(curStep % stepsPerBar);
    }

    function secondsPerStep(){
      const beat = 60 / bpm;
      if (quant === '1/16') return beat/4;
      if (quant === '1/8T') return beat/3;
      return beat/4;
    }
    function swingOffset(stepIdx){
      if (swingPct<=50 || quant!=='1/16') return 0;
      const swingAmt = (swingPct-50)/100;
      return (stepIdx%2===1) ? secondsPerStep()*swingAmt : 0;
    }
    function getLookAheadMs(){ return Number(seqLAInput.value || 25); }

    function scheduleNotes(){
      const la = getLookAheadMs()/1000;
      while (nextNoteTime < ctx.currentTime + la){
        const s = curStep % stepsPerBar;
        highlightStep(s);
        for (let tr=0; tr<tracks; tr++){
          if (pattern[tr][s]){
            const padIndex = tr;
            setTimeout(()=>triggerRetriggerPad(padIndex, 1.0), 0);
          }
        }
        const sp = secondsPerStep() + swingOffset(s);
        if (songMode && s === stepsPerBar-1 && !pendingSceneSwitch){
          pendingSceneSwitch = true;
          const whenMs = Math.max(0, (nextNoteTime + sp - ctx.currentTime) * 1000);
          setTimeout(()=>advanceSceneInSong(), whenMs);
        }
        nextNoteTime += sp;
        curStep++;
      }
      if (playing) setTimeout(scheduleNotes, getLookAheadMs());
    }
    function highlightStep(s){
      const cells = $$('.step', seqGridEl);
      cells.forEach(c=>c.classList.remove('cur'));
      for (let tr=0; tr<tracks; tr++){
        const idx = tr*stepsPerBar + s;
        const cell = cells[idx];
        if (cell) cell.classList.add('cur');
      }
    }

    // Sequencer inputs + BPM numeric sync
    seqBPMInput.oninput = ()=>{
      bpm = Number(seqBPMInput.value);
      seqBPMNum.value = String(bpm);
      status('BPM '+bpm);
    };
    seqBPMNum.oninput = ()=>{
      let v = Math.max(50, Math.min(300, Number(seqBPMNum.value||120)));
      seqBPMNum.value = String(v);
      setHiddenInput(seqBPMInput, v);
    };
    seqSwingInput.oninput  = ()=>{ swingPct = Number(seqSwingInput.value); };
    seqStepsInput.oninput  = ()=>{
      const newSteps = Number(seqStepsInput.value);
      stepsPerBar = newSteps;
      ensureScene(currentScene);
      scenes[currentScene].steps = newSteps;
      resizePattern(scenes[currentScene].data, newSteps);
      pattern = scenes[currentScene].data;
      buildSeqGrid();
      status('Steps '+newSteps+' (per current scene)');
    };
    q16Btn.onclick = ()=>{ quant='1/16'; q16Btn.setAttribute('aria-pressed','true'); q8tBtn.setAttribute('aria-pressed','false'); };
    q8tBtn.onclick = ()=>{ quant='1/8T'; q8tBtn.setAttribute('aria-pressed','true'); q16Btn.setAttribute('aria-pressed','false'); };
    seqPlayBtn.onclick = ()=>{
      if (!playing){
        playing = true; seqPlayBtn.setAttribute('aria-pressed','true'); seqPlayBtn.textContent = 'Stop';
        if (songMode){
          if (chain.length===0) chain = [0,1,2,3,4,5,6,7];
          chainPos = 0;
          setScene(chain[chainPos]);
        }else{
          setScene(currentScene);
        }
        nextNoteTime = ctx.currentTime + 0.05; curStep = 0;
        scheduleNotes(); seqStatus.textContent = 'playing';
      }else{
        playing = false; seqPlayBtn.setAttribute('aria-pressed','false'); seqPlayBtn.textContent = 'Play';
        seqStatus.textContent = 'stopped';
      }
    };

    setScene(0);
    renderChain();

    /* ===== MIDI ===== */
    let midiAccess = null;
    let midiEnabled = false;
    const midiLabel = $('#midiLabel');
    const midiLearnBtn = $('#midiLearnBtn');
    let midiLearning = false;
    const defaultBaseNote = 36;
    function noteToPad(note){ const n = note - defaultBaseNote; return (n<0 || n>=64) ? -1 : n; }
    async function enableMIDI(){
      if (midiEnabled) return;
      try{
        midiAccess = await navigator.requestMIDIAccess();
        midiEnabled = true;
        midiLabel.textContent = 'on';
        midiAccess.inputs.forEach(input=> input.onmidimessage = onMIDIMessage);
        status('MIDI enabled');
      }catch(e){ status('MIDI failed: '+(e && e.message ? e.message : e)); }
    }
    $('#midiEnableBtn').onclick = enableMIDI;
    midiLearnBtn.onclick = ()=>{ const on = midiLearnBtn.getAttribute('aria-pressed')!=='true'; midiLearnBtn.setAttribute('aria-pressed', on?'true':'false'); midiLearning = on; };
    function onMIDIMessage(e){
      const [st, d1, d2] = e.data;
      const cmd = st & 0xF0;
      if (cmd===0x90 && d2>0){
        const p = noteToPad(d1);
        if (p>=0) onPadPress(p, d2/127);
      }
      if ((st & 0xF0)===0xB0){
        const val = d2/127;
        if (midiLearning){
          setHiddenInput(fxMasterGain, (val*1.5));
        }
      }
    }

    /* ===== Recording (Master) ===== */
    let mediaRecorder = null, recChunks=[];
    async function toggleRecord(){
      try{
        if (!mediaRecorder){
          const dest = ctx.createMediaStreamDestination();
          const outNode = limiterNode ? limiterNode : comp;
          comp.disconnect();
          outNode.connect(dest);
          const stream = dest.stream;
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = e=> recChunks.push(e.data);
          mediaRecorder.onstop = ()=>{
            const blob = new Blob(recChunks, {type:'audio/webm'});
            recChunks = [];
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'soundboard_master.webm';
            a.click();
            recStatus.textContent = 'saved';
          };
          recStatus.textContent = 'armed';
        }
        if (mediaRecorder.state === 'recording'){
          mediaRecorder.stop();
          recordBtn.setAttribute('aria-pressed','false');
          recStatus.textContent = 'stopped';
        }else{
          mediaRecorder.start();
          recordBtn.setAttribute('aria-pressed','true');
          recStatus.textContent = 'recording…';
        }
      }catch(e){ report('record', e); }
    }
    recordBtn.onclick = toggleRecord;

    /* ===== Kit serialize/deserialize (includes sequencer) ===== */
    function serializeSeq(){
      const scenesOut = scenes.map(s=>{
        if (!s) return null;
        return {
          steps: s.steps,
          data: s.data.map(row=> row.map(v=> v?1:0))
        };
      });
      return { bpm, swing: swingPct, quant, currentScene, chain, scenes: scenesOut };
    }
    function applySeqToUI(s){
      if (!s) return;
      if (typeof s.bpm==='number') { setHiddenInput(seqBPMInput, s.bpm); seqBPMNum.value = String(s.bpm); }
      if (typeof s.swing==='number') setHiddenInput(seqSwingInput, s.swing);
      if (s.quant==='1/8T'){ quant='1/8T'; q8tBtn.setAttribute('aria-pressed','true'); q16Btn.setAttribute('aria-pressed','false'); }
      else { quant='1/16'; q16Btn.setAttribute('aria-pressed','true'); q8tBtn.setAttribute('aria-pressed','false'); }
      if (Array.isArray(s.chain)){ chain = s.chain.slice(0); renderChain(); }
      const scArr = Array.isArray(s.scenes) ? s.scenes : [];
      scenes = Array.from({length:8}, (_,i)=>{
        const src = scArr[i];
        if (!src || !Array.isArray(src.data)) return null;
        const steps = Math.max(1, Number(src.steps||16));
        const data = src.data.map(row=> row.map(n=> !!n));
        const norm = Array.from({length:8}, (__,tr)=> data[tr] ? data[tr].slice(0) : Array.from({length:steps}, ()=>false));
        return {steps, data:norm};
      });
      const targetScene = (typeof s.currentScene==='number' && s.currentScene>=0 && s.currentScene<8) ? s.currentScene : 0;
      setScene(targetScene);
    }

    function serializeKit(){
      return pads.map(p=>({
        name:p.name, b64:p.b64, gain:p.gain, pan:p.pan, filterType:p.filterType, cutoff:p.cutoff, q:p.q,
        env:p.env, tune:p.tune, fine:p.fine, loop:p.loop, reverse:p.reverse, choke:p.choke, sendA:p.sendA, sendB:p.sendB,
        mode:p.mode
      }));
    }
    async function deserializeKit(arr){
      for (let i=0;i<Math.min(arr.length, PAD_COUNT);i++){
        const src = arr[i], dst = pads[i];
        Object.assign(dst, src);
        if (!dst.mode) dst.mode = PadMode.RETRIGGER;
        if (src.b64){
          const wav = base64ToArrayBuffer(src.b64);
          const buf = await ctx.decodeAudioData(wav.slice(0));
          dst.buffer = buf; dst.duration = buf.duration;
        }
        dst.toggleOn=false; dst.savedOffset=0; dst.voice=null; dst.voices=[];
      }
      buildGrid();
      status('Kit loaded');
    }

    saveKitBtn.onclick = ()=>{
      const payload = { pads: serializeKit(), seq: serializeSeq() };
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kit.json'; a.click();
    };
    loadKitBtn.onclick = ()=> loadKitFile.click();
    loadKitFile.onchange = async ()=>{
      const f = loadKitFile.files[0]; if (!f) return;
      const txt = await f.text();
      try{
        const obj = JSON.parse(txt);
        if (Array.isArray(obj)) { await deserializeKit(obj); }
        else{
          if (obj.pads) await deserializeKit(obj.pads);
          if (obj.seq)  applySeqToUI(obj.seq);
        }
      }catch(e){ report('kitImport', e); }
    };

    /* ===== Local Kit Manager ===== */
    const LS_KEY = 'soundboard.kits.v2';
    function loadKitStore(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }catch(_){ return {}; } }
    function saveKitStore(obj){ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }
    function refreshKitList(){
      const store = loadKitStore();
      kitList.innerHTML = '';
      const names = Object.keys(store).sort();
      if (names.length===0){ kitList.innerHTML = '<div class="muted small">No kits saved.</div>'; return; }
      names.forEach(name=>{
        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid var(--line);border-radius:10px;padding:10px;background:#0f1519;display:flex;gap:8px;align-items:center';
        const title = document.createElement('div');
        title.textContent = name;
        title.style.cssText = 'font-weight:700;flex:1';
        const loadBtn = document.createElement('button');
        loadBtn.className='btn small'; loadBtn.textContent='Load';
        const renBtn = document.createElement('button');
        renBtn.className='btn small ghost'; renBtn.textContent='Rename';
        const delBtn = document.createElement('button');
        delBtn.className='btn small ghost'; delBtn.textContent='Delete';
        loadBtn.onclick = async ()=>{
          const obj = store[name];
          if (obj.pads) await deserializeKit(obj.pads);
          if (obj.seq)  applySeqToUI(obj.seq);
          kitName.value = name;
          status('Loaded kit: '+name);
        };
        renBtn.onclick = ()=>{
          const nn = prompt('Rename kit', name);
          if (!nn || nn===name) return;
          const s = loadKitStore();
          s[nn] = s[name]; delete s[name]; saveKitStore(s); refreshKitList();
          kitName.value = nn;
        };
        delBtn.onclick = ()=>{
          if (!confirm('Delete kit "'+name+'"?')) return;
          const s = loadKitStore(); delete s[name]; saveKitStore(s); refreshKitList();
        };
        card.appendChild(title);
        const buttons = document.createElement('div'); buttons.style.display='flex'; buttons.style.gap='8px';
        buttons.appendChild(loadBtn); buttons.appendChild(renBtn); buttons.appendChild(delBtn);
        card.appendChild(buttons);
        kitList.appendChild(card);
      });
    }
    kitSaveAs.onclick = ()=>{
      const name = (kitName.value || '').trim() || ('Kit '+new Date().toLocaleString());
      const s = loadKitStore();
      s[name] = { pads: serializeKit(), seq: serializeSeq() };
      saveKitStore(s);
      refreshKitList();
      status('Saved kit: '+name);
    };
    kitExport.onclick = ()=>{
      const name = (kitName.value || '').trim() || 'exported_kit';
      const payload = { pads: serializeKit(), seq: serializeSeq() };
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name+'.json'; a.click();
    };
    kitImportBtn.onclick = ()=> kitImportFile.click();
    kitImportFile.onchange = async ()=>{
      const f = kitImportFile.files[0]; if (!f) return;
      const txt = await f.text();
      try{
        const obj = JSON.parse(txt);
        if (Array.isArray(obj)) { await deserializeKit(obj); }
        else{
          if (obj.pads) await deserializeKit(obj.pads);
          if (obj.seq)  applySeqToUI(obj.seq);
        }
        status('Imported kit file');
      }catch(e){ report('kitImport', e); }
    };

    /* ===== Sampler ===== */
    let sampBuf = null;
    let sampZoom = 1;
    let selA = 0, selB = 0;
    let sampSrc = null;

    // Multilayer by 2-oct window
    let windowLayers = []; // {start,end,center,buffer}
    let layerMultiOn = true;

    function fillPadSelect(){
      samplerPad.innerHTML = '';
      for (let i=0;i<PAD_COUNT;i++){
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `${String(i+1).padStart(2,'0')} — ${pads[i].name}`;
        samplerPad.appendChild(opt);
      }
    }
    function secondsFmt(s){ return (s||0).toFixed(2)+'s'; }

    async function handleSamplerFile(file){
      const arr = await file.arrayBuffer();
      const buf = await ctx.decodeAudioData(arr.slice(0));
      sampBuf = buf;
      selA = 0; selB = buf.duration;
      drawWave();
      sStartEl.textContent = secondsFmt(selA);
      sEndEl.textContent = secondsFmt(selB);
      status('Sampler: loaded '+file.name);
    }

    samplerFile.onchange = ()=>{ const f = samplerFile.files[0]; if (f) handleSamplerFile(f); };
    samplerDrop.ondragover = (e)=>{ e.preventDefault(); samplerDrop.style.borderColor='rgba(66,198,255,.7)'; };
    samplerDrop.ondragleave= ()=>{ samplerDrop.style.borderColor='rgba(255,255,255,.25)'; };
    samplerDrop.ondrop = (e)=>{
      e.preventDefault(); samplerDrop.style.borderColor='rgba(255,255,255,.25)';
      const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleSamplerFile(f);
    };

    function stopSamp(){
      if (sampSrc){ try{ sampSrc.stop(); }catch(_){ } sampSrc = null; }
    }
    samplerPlay.onclick = ()=>{
      if (!sampBuf) return;
      stopSamp();
      sampSrc = ctx.createBufferSource();
      sampSrc.buffer = sampBuf;
      const g = ctx.createGain(); g.gain.value = 1;
      sampSrc.connect(g).connect(masterGain);
      const start = Math.max(0, Math.min(selA, sampBuf.duration-0.001));
      const dur = Math.max(0.001, Math.min(selB, sampBuf.duration) - start);
      sampSrc.start(0, start, dur);
    };
    samplerStop.onclick = ()=> stopSamp();

    /* Mic capture into sampler buffer (and now: layer by window) */
    let micRec = null, micChunks = [];
    let micRecOS = null, micChunksOS = [];

    function storeWindowLayer(buf){
      const start = pianoBase;
      const end = pianoBase + 24;
      const center = start + 12;
      const existing = windowLayers.findIndex(w=> w.start===start && w.end===end);
      if (existing>=0){ windowLayers[existing].buffer = buf; }
      else { windowLayers.push({start,end,center,buffer:buf}); }
      refreshLayerList();
    }
    function windowLabel(w){ return noteName(w.start)+'–'+noteName(w.end); }
    function refreshLayerList(){
      if (!layerList){ return; }
      if (!windowLayers.length){ layerList.textContent = '—'; return; }
      layerList.innerHTML = windowLayers.map(w=>{
        const cur = (w.start===pianoBase && w.end===pianoBase+24);
        return `<span class="pill" style="${cur?'outline:2px solid rgba(66,198,255,.4)':''}">${windowLabel(w)}</span>`;
      }).join(' ');
    }
    function bufferForMidi(midi){
      if (!layerMultiOn || windowLayers.length===0) return sampBuf;
      let best = null, bestDist = Infinity;
      for (const w of windowLayers){
        const d = Math.abs(midi - w.center);
        if (d < bestDist){ bestDist = d; best = w; }
      }
      return best ? best.buffer : sampBuf;
    }

    samplerLive.onclick = async ()=>{
      try{
        if (!micRec || micRec.state === 'inactive'){
          if (!micStream){ micStream = await navigator.mediaDevices.getUserMedia({audio:true}); }
          micChunks = [];
          micRec = new MediaRecorder(micStream);
          micRec.ondataavailable = e=> micChunks.push(e.data);
          micRec.onstop = async ()=>{
            try{
              const blob = new Blob(micChunks, {type:'audio/webm'});
              const arr = await blob.arrayBuffer();
              const buf = await ctx.decodeAudioData(arr.slice(0));
              sampBuf = buf;
              selA = 0; selB = buf.duration;
              drawWave();
              sStartEl.textContent = secondsFmt(selA);
              sEndEl.textContent = secondsFmt(selB);
              samplerLive.textContent = 'Live Sample';
              storeWindowLayer(buf); // <-- save to current window
              status('Live sample captured → saved to '+currentOctLabel());
            }catch(err){ report('liveSampleDecode', err); samplerLive.textContent = 'Live Sample'; }
          };
          micRec.start();
          samplerLive.textContent = 'Stop Live';
          status('Recording mic…');
        }else{
          micRec.stop();
        }
      }catch(e){ report('liveSample', e); }
    };

    samplerOneShot.onclick = async ()=>{
      try{
        if (!micRecOS || micRecOS.state === 'inactive'){
          if (!micStream){ micStream = await navigator.mediaDevices.getUserMedia({audio:true}); }
          micChunksOS = [];
          micRecOS = new MediaRecorder(micStream);
          micRecOS.ondataavailable = e=> micChunksOS.push(e.data);
          micRecOS.onstop = async ()=>{
            try{
              const blob = new Blob(micChunksOS, {type:'audio/webm'});
              const arr = await blob.arrayBuffer();
              const buf = await ctx.decodeAudioData(arr.slice(0));
              sampBuf = buf; selA = 0; selB = buf.duration;
              drawWave();
              sStartEl.textContent = secondsFmt(selA);
              sEndEl.textContent = secondsFmt(selB);
              samplerOneShot.textContent = 'One-shot Rec';
              storeWindowLayer(buf); // <-- save to current window
              status('One-shot recorded → saved to '+currentOctLabel());
            }catch(err){ report('oneshotDecode', err); samplerOneShot.textContent = 'One-shot Rec'; }
          };
          micRecOS.start();
          samplerOneShot.textContent = 'Stop One-shot';
          status('Recording one-shot…');
        }else{
          micRecOS.stop();
        }
      }catch(e){ report('oneShot', e); }
    };

    /* ===== Sampler Piano (2 octaves + shift, one-shot/gate, multilayer) ===== */
    const BLACKS = new Set([1,3,6,8,10]);
    let pianoBase = 48; // C3
    let sampOneShot = true;
    const pianoVoices = new Map();

    function noteName(m){
      const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      return names[m%12] + Math.floor(m/12 - 1);
    }
    function currentOctLabel(){
      const left = pianoBase;
      const right = pianoBase + 24;
      return noteName(left) + '–' + noteName(right);
    }
    function clearPiano(){
      if (!samplerKeys) return;
      if (whiteKeysWrap) whiteKeysWrap.innerHTML = '';
      Array.from(samplerKeys.querySelectorAll('.key.black')).forEach(n=> n.remove());
    }
    function rebuildPiano(){
      if (!samplerKeys || !whiteKeysWrap) return;
      clearPiano();
      const whites = [];
      for (let m=pianoBase; m<pianoBase+24; m++){
        if (!BLACKS.has(m%12)) whites.push(m);
      }
      whites.forEach((m)=>{
        const el = document.createElement('button');
        el.className = 'key white';
        el.dataset.midi = String(m);
        el.title = noteName(m);
        attachKeyHandlers(el, m);
        whiteKeysWrap.appendChild(el);
      });
      const offsets = {1:0.66, 3:1.66, 6:3.66, 8:4.66, 10:5.66};
      for (let m=pianoBase; m<pianoBase+24; m++){
        const pc = m%12;
        if (!BLACKS.has(pc)) continue;
        const el = document.createElement('button');
        el.className = 'key black';
        el.dataset.midi = String(m);
        el.title = noteName(m);
        attachKeyHandlers(el, m);
        samplerKeys.appendChild(el);
        const octaveIndex = Math.floor((m - pianoBase)/12);
        const leftUnits = (octaveIndex*7) + offsets[pc];
        el.style.left = `calc((100% / 14) * ${leftUnits})`;
      }
      if (octLabel) octLabel.textContent = currentOctLabel();
      refreshLayerList();
    }
    function attachKeyHandlers(el, midi){
      function start(){
        const usingLayer = layerMultiOn && windowLayers.length>0;
        const selBuf = usingLayer ? bufferForMidi(midi) : sampBuf;
        if (!selBuf) return;

        const src = ctx.createBufferSource();
        src.buffer = selBuf;
        const g = ctx.createGain(); g.gain.value = 1;
        src.connect(g).connect(masterGain);

        const rate = Math.pow(2, (midi - 60)/12);
        src.playbackRate.setValueAtTime(rate, ctx.currentTime);

        let startSec = 0, endSec = selBuf.duration;
        if (!usingLayer && sampBuf){ // only honor selection for the base buffer
          const reg = regionForPlay();
          startSec = reg.start; endSec = reg.end;
        }
        const dur = Math.max(0.001, (endSec - startSec) / rate);
        try{
          src.start(0, startSec, sampOneShot ? dur : Math.max(dur, 600));
        }catch(e){ try{ src.start(); }catch(_){ } }
        if (!sampOneShot){ pianoVoices.set(midi, {src}); }
        el.classList.add('active');
      }
      function end(){
        el.classList.remove('active');
        if (sampOneShot) return;
        const v = pianoVoices.get(midi);
        if (v){ try{ v.src.stop(); }catch(_){ } pianoVoices.delete(midi); }
      }
      el.addEventListener('pointerdown', (e)=>{ e.preventDefault(); start(); }, {passive:false});
      el.addEventListener('pointerup', end);
      el.addEventListener('pointerleave', end);
      el.addEventListener('pointercancel', end);
    }
    function regionForPlay(){
      if (!sampBuf) return {start:0, end:0};
      const a = Math.min(selA, selB);
      const b = Math.max(selA, selB);
      const start = Math.max(0, Math.min(a, Math.max(0, sampBuf.duration-0.001)));
      const end   = Math.max(start+0.001, Math.min(b, sampBuf.duration));
      return {start, end};
    }
    if (octDown) octDown.onclick = ()=>{ pianoBase = Math.max(0, pianoBase - 12); rebuildPiano(); };
    if (octUp)   octUp.onclick   = ()=>{ pianoBase = Math.min(120, pianoBase + 12); rebuildPiano(); };
    if (sampModeBtn){
      sampModeBtn.textContent = 'One-shot';
      sampModeBtn.setAttribute('aria-pressed','true');
      sampModeBtn.onclick = ()=>{
        const on = sampModeBtn.getAttribute('aria-pressed')!=='true';
        sampModeBtn.setAttribute('aria-pressed', on?'true':'false');
        sampOneShot = on;
        sampModeBtn.textContent = sampOneShot ? 'One-shot' : 'Gate';
      };
    }

    // Layer controls
    if (layerModeBtn){
      layerModeBtn.onclick = ()=>{
        const on = layerModeBtn.getAttribute('aria-pressed')!=='true';
        layerModeBtn.setAttribute('aria-pressed', on?'true':'false');
        layerMultiOn = on;
        layerModeBtn.textContent = layerMultiOn ? 'Multi-Layers On' : 'Multi-Layers Off';
        status('Keyboard layers: '+(layerMultiOn?'on':'off'));
      };
    }
    if (layerClearWin){
      layerClearWin.onclick = ()=>{
        const start = pianoBase, end = pianoBase+24;
        const before = windowLayers.length;
        windowLayers = windowLayers.filter(w=> !(w.start===start && w.end===end));
        refreshLayerList();
        status(before===windowLayers.length ? 'No layer in current window' : 'Cleared current window layer');
      };
    }
    if (layerClearAll){
      layerClearAll.onclick = ()=>{
        windowLayers = [];
        refreshLayerList();
        status('Cleared all keyboard layers');
      };
    }
    window.addEventListener('resize', rebuildPiano);

    // Clear + Export WAV
    samplerClear.onclick = ()=>{
      stopSamp();
      sampBuf = null; selA = 0; selB = 0;
      drawWave();
      status('Sampler: cleared (keyboard layers preserved)');
      rebuildPiano();
    };
    samplerExportSel.onclick = ()=>{
      if (!sampBuf){ status('No sample'); return; }
      const a = Math.min(selA, selB), b = Math.max(selA, selB);
      const sliced = sliceBuffer(sampBuf, a, b, sNormalize.checked);
      exportBufferAsWav(sliced, 'sampler_selection.wav');
    };
    samplerExportAll.onclick = ()=>{
      if (!sampBuf){ status('No sample'); return; }
      exportBufferAsWav(sampBuf, 'sampler_all.wav');
    };

    const c = samplerWave;
    const ctx2d = c.getContext('2d');

    function drawWave(){
      ctx2d.clearRect(0,0,c.width,c.height);
      ctx2d.fillStyle = '#0f1519';
      ctx2d.fillRect(0,0,c.width,c.height);
      ctx2d.strokeStyle = 'rgba(255,255,255,.12)';
      ctx2d.strokeRect(0.5,0.5,c.width-1,c.height-1);

      if (!sampBuf) return;

      const ch = Math.min(2, sampBuf.numberOfChannels);
      const dataL = sampBuf.getChannelData(0);
      const dataR = ch>1 ? sampBuf.getChannelData(1) : dataL;

      const samples = sampBuf.length;
      const px = c.width;
      const zoomWindow = Math.floor(samples / sampZoom);
      const startSample = 0;
      const endSample = startSample + zoomWindow;

      ctx2d.fillStyle = 'rgba(66,198,255,.45)';
      const mid = c.height/2;
      for (let x=0; x<px; x++){
        const s0 = Math.floor(startSample + x*zoomWindow/px);
        const s1 = Math.min(samples, Math.floor(startSample + (x+1)*zoomWindow/px));
        let min=1, max=-1;
        for (let s=s0; s<s1; s++){
          const v = (dataL[s] + dataR[s]) * 0.5;
          if (v<min) min=v; if (v>max) max=v;
        }
        const y0 = mid + min*mid;
        const y1 = mid + max*mid;
        ctx2d.fillRect(x, y0, 1, Math.max(1, y1-y0));
      }

      const xa = Math.max(0, Math.min(1, selA / sampBuf.duration)) * px;
      const xb = Math.max(0, Math.min(1, selB / sampBuf.duration)) * px;
      const left = Math.min(xa, xb), right = Math.max(xa, xb);
      ctx2d.fillStyle = 'rgba(255,255,255,.08)';
      ctx2d.fillRect(left, 0, right-left, c.height);
      ctx2d.strokeStyle = 'rgba(255,255,255,.5)';
      ctx2d.beginPath(); ctx2d.moveTo(left,0); ctx2d.lineTo(left,c.height); ctx2d.moveTo(right,0); ctx2d.lineTo(right,c.height); ctx2d.stroke();

      sStartEl.textContent = secondsFmt(Math.min(selA, selB));
      sEndEl.textContent   = secondsFmt(Math.max(selA, selB));
    }

    let selecting=false, whichEdge=null;
    c.addEventListener('pointerdown', (e)=>{
      if (!sampBuf) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = (x / c.width) * sampBuf.duration;
      const dA = Math.abs(t - selA), dB = Math.abs(t - selB);
      whichEdge = (dA < dB) ? 'A' : 'B';
      if (!e.shiftKey){ if (whichEdge==='A') selA = t; else selB = t; }
      else { selA = Math.min(t, selA); selB = Math.max(t, selB); }
      selecting = true;
      drawWave();
    });
    c.addEventListener('pointermove', (e)=>{
      if (!selecting || !sampBuf) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = Math.max(0, Math.min(sampBuf.duration, (x / c.width) * sampBuf.duration));
      if (whichEdge==='A') selA = t; else selB = t;
      drawWave();
    });
    const endSel = ()=>{ selecting=false; whichEdge=null; };
    c.addEventListener('pointerup', endSel);
    c.addEventListener('pointercancel', endSel);
    c.addEventListener('pointerleave', endSel);
    samplerZoom.oninput = ()=>{ sampZoom = Number(samplerZoom.value); drawWave(); };

    function sliceBuffer(buf, startSec, endSec, normalize){
      const start = Math.max(0, Math.floor(startSec * buf.sampleRate));
      const end   = Math.min(buf.length, Math.floor(endSec * buf.sampleRate));
      const frames = Math.max(0, end - start);
      const out = ctx.createBuffer(buf.numberOfChannels, frames, buf.sampleRate);
      for (let ch=0; ch<buf.numberOfChannels; ch++){
        const src = buf.getChannelData(ch).subarray(start, end);
        const dst = out.getChannelData(ch);
        dst.set(src);
        if (normalize){
          let peak = 0; for (let i=0;i<dst.length;i++){ const a = Math.abs(dst[i]); if (a>peak) peak=a; }
          if (peak>0){ const g = 1/peak * 0.98; for (let i=0;i<dst.length;i++){ dst[i]*=g; } }
        }
      }
      return out;
    }

    samplerAssign.onclick = ()=>{
      if (!sampBuf) return;
      const idx = Number(samplerPad.value || 0);
      const a = Math.min(selA, selB), b = Math.max(selA, selB);
      const sliced = sliceBuffer(sampBuf, a, b, sNormalize.checked);
      pads[idx].buffer = sliced;
      pads[idx].duration = sliced.duration;
      pads[idx].name = 'Sample';
      pads[idx].b64 = null;
      pads[idx].toggleOn=false; pads[idx].savedOffset=0; pads[idx].voice=null;
      buildGrid();
      rebuildKitEditor();
      status('Assigned selection → Pad '+(idx+1));
    };
    samplerSliceRow.onclick = ()=>{
      if (!sampBuf) return;
      const idx = Number(samplerPad.value || 0);
      const rowStart = Math.floor(idx/8)*8;
      const parts = 8;
      const a = Math.min(selA, selB), b = Math.max(selA, selB);
      const total = Math.max(0.05, b - a);
      for (let s=0; s<parts; s++){
        const st = a + (s/parts)*total;
        const en = a + ((s+1)/parts)*total;
        const slice = sliceBuffer(sampBuf, st, en, sNormalize.checked);
        const padIdx = rowStart+s;
        pads[padIdx].buffer = slice;
        pads[padIdx].duration = slice.duration;
        pads[padIdx].name = `Slice ${s+1}`;
        pads[padIdx].b64 = null;
        pads[padIdx].toggleOn=false; pads[padIdx].savedOffset=0; pads[padIdx].voice=null;
      }
      buildGrid();
      rebuildKitEditor();
      status('Sliced selection ×8 → Row '+(Math.floor(idx/8)+1));
    };

    /* ===== WAV utils ===== */
    async function arrayBufferToBase64Wav(rawArrayBuffer){
      const buf = await ctx.decodeAudioData(rawArrayBuffer.slice(0)).catch(()=>null);
      if (!buf) return null;
      const wav = encodeWav(buf);
      const b64 = btoa(String.fromCharCode(...new Uint8Array(wav)));
      return 'data:audio/wav;base64,'+b64;
    }
    function base64ToArrayBuffer(b64){
      const x = b64.split(',').pop();
      const bin = atob(x);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    function encodeWav(buffer){
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const samples = buffer.length;
      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;
      const byteRate = sampleRate * blockAlign;
      const dataSize = samples * blockAlign;
      const headerSize = 44;
      const totalSize = headerSize + dataSize;
      const ab = new ArrayBuffer(totalSize);
      const view = new DataView(ab);

      writeStr(view, 0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      writeStr(view, 8, 'WAVE');
      writeStr(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, byteRate, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 16, true);
      writeStr(view, 36, 'data');
      view.setUint32(40, dataSize, true);

      const interleaved = interleave(buffer);
      floatTo16BitPCM(view, 44, interleaved);
      return ab;
    }
    function writeStr(view, offset, str){ for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); }
    function interleave(buf){
      const ch = buf.numberOfChannels;
      const len = buf.length;
      const out = new Float32Array(len*ch);
      for (let i=0;i<len;i++){ for (let c=0;c<ch;c++){ out[i*ch+c] = buf.getChannelData(c)[i]; } }
      return out;
    }
    function floatTo16BitPCM(view, offset, input){
      let pos = offset;
      for (let i=0;i<input.length;i++){
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(pos, s<0 ? s*0x8000 : s*0x7FFF, true);
        pos += 2;
      }
    }
    function exportBufferAsWav(buffer, filename){
      const ab = encodeWav(buffer);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ab], {type:'audio/wav'}));
      a.download = filename;
      a.click();
      status('Exported '+filename);
    }

    /* ===== UI helpers & wires ===== */
    function status(msg){ if (statusEl) statusEl.textContent = msg; }

    editKitBtn.onclick = ()=>{
      kitEditor.classList.toggle('show');
      editKitBtn.textContent = kitEditor.classList.contains('show') ? 'Close Editor' : 'Kit Editor';
    };

    // FX inputs
    fxDelayTime.oninput   = ()=>{ delayNode.delayTime.value = Number(fxDelayTime.value); };
    fxDelayFB.oninput     = ()=>{ delayFBG.gain.value       = Number(fxDelayFB.value);   };
    fxDelayMix.oninput    = ()=>{ delayOut.gain.value       = Number(fxDelayMix.value);  };
    fxReverbMix.oninput   = ()=>{ reverbWet.gain.value      = Number(fxReverbMix.value); };
    fxReverbDecay.oninput = ()=>{ convolver.buffer          = makeSimpleImpulse(ctx, Number(fxReverbDecay.value)); };
    fxMasterGain.oninput  = ()=>{ masterGain.gain.value     = Number(fxMasterGain.value);};

    function init(){
      buildGrid();
      initKnobsIn(document);
      fillPadSelect();
      rebuildPiano();
      updateSceneBar();
      seqBPMNum.value = String(Number(seqBPMInput.value||120));
      if (layerModeBtn) layerModeBtn.setAttribute('aria-pressed','true');
      refreshLayerList();
      status('ready');
    }
    init();

  }catch(e){
    report('boot', e);
  }
})();
