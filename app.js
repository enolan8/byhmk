// app.js — Phase1: 多格式导入/导出、粘贴、IndexedDB 本地历史、预览、深色模式
(function(){
    const State = {
        rawItems: [], // { original, normalized, source }
        uniqueMap: new Map(),
        historyKey: 'phone_tool_history_v1',
        exportFields: ['original','normalized','carrier','line_type'],
        theme: localStorage.getItem('theme') || 'light'
    };

    // DOM
    const DOM = {
        fileInput: document.getElementById('fileInput'),
        dropZone: document.getElementById('dropZone'),
        fileInfoWrap: document.getElementById('fileInfoWrap'),
        pasteBtn: document.getElementById('pasteBtn'),
        formatSelect: document.getElementById('formatSelect'),
        previewBody: document.getElementById('previewBody'),
        exportModal: document.getElementById('exportModal'),
        exportFieldsBtn: document.getElementById('exportFieldsBtn'),
        closeExportModal: document.getElementById('closeExportModal'),
        applyExportFields: document.getElementById('applyExportFields'),
        exportCsvBtn: document.getElementById('exportCsvBtn'),
        exportXlsxBtn: document.getElementById('exportXlsxBtn'),
        exportFieldChecks: () => Array.from(document.querySelectorAll('.exportField')),
        themeToggle: document.getElementById('themeToggle'),
        selectAllDupBtn: document.getElementById('selectAllDupBtn'),
        quickExportMobileBtn: document.getElementById('quickExportMobileBtn')
    };

    // 初始化
    function init(){
        bindEvents();
        applyTheme(State.theme);
        loadHistoryFromIndexedDB();
    }

    function bindEvents(){
        if(DOM.fileInput) DOM.fileInput.addEventListener('change', handleFiles);
        if(DOM.dropZone){ ['dragenter','dragover','dragleave','drop'].forEach(ev=> DOM.dropZone.addEventListener(ev, preventDefaults)); DOM.dropZone.addEventListener('drop', handleDrop); }
        if(DOM.pasteBtn) DOM.pasteBtn.addEventListener('click', handlePaste);
        if(DOM.exportFieldsBtn) DOM.exportFieldsBtn.addEventListener('click', ()=> DOM.exportModal.classList.remove('hidden'));
        if(DOM.closeExportModal) DOM.closeExportModal.addEventListener('click', ()=> DOM.exportModal.classList.add('hidden'));
        if(DOM.applyExportFields) DOM.applyExportFields.addEventListener('click', applyExportAndExport);
        if(DOM.exportCsvBtn) DOM.exportCsvBtn.addEventListener('click', ()=> exportSelected('csv'));
        if(DOM.exportXlsxBtn) DOM.exportXlsxBtn.addEventListener('click', ()=> exportSelected('xlsx'));
        if(DOM.themeToggle) DOM.themeToggle.addEventListener('click', toggleTheme);
        if(DOM.selectAllDupBtn) DOM.selectAllDupBtn.addEventListener('click', selectAllDuplicates);
        if(DOM.quickExportMobileBtn) DOM.quickExportMobileBtn.addEventListener('click', quickExportMobile);
    }

    function preventDefaults(e){ e.preventDefault(); e.stopPropagation(); }
    function handleDrop(e){ const dt = e.dataTransfer; const files = dt.files; processFileList(files); }

    // 处理文件列表（支持多个）
    function handleFiles(e){ const files = e.target.files; processFileList(files); }

    async function processFileList(fileList){
        const files = Array.from(fileList || []);
        if(files.length===0) return;
        let totalCount=0; let processed=0;
        for(const f of files){
            const text = await f.text();
            const items = parseTextToPhones(text, f.name);
            items.forEach(it=> addRawItem(it));
            processed++; totalCount += items.length;
        }
        DOM.fileInfoWrap.innerHTML = `<p class="text-sm text-gray-600">已导入 ${files.length} 个文件，新增 ${totalCount} 条记录（去重后 ${State.uniqueMap.size} 条）</p>`;
        renderPreview();
        saveHistorySnapshot();
    }

    // 解析文本（CSV/TXT）为号码列表
    function parseTextToPhones(text, source){
        const lines = text.split(/[\r\n]+/);
        const out = [];
        for(const line of lines){
            if(!line) continue;
            // 尝试从行中提取手机号（支持带备注，例如：张三 123-456-7890）
            const match = line.match(/(\+?1?[-.\s()]*(\d{3})[-.\s()]*(\d{3})[-.\s()]*(\d{4}))/);
            if(match){
                const raw = match[1];
                out.push({ original: line.trim(), raw: raw, source });
            } else {
                // 可能是CSV每列
                const parts = line.split(/[,;\t]+/).map(p=>p.trim()).filter(Boolean);
                for(const p of parts){ const m = p.match(/(\+?1?\d{10}|\d{10})/); if(m) out.push({ original: p, raw: m[1], source }); }
            }
        }
        return out;
    }

    function addRawItem(item){
        const norm = normalizeNumber(item.raw);
        const key = norm; if(!key) return;
        const existing = State.uniqueMap.get(key);
        if(existing){ existing.count++; existing.sources.push(item.source); // 保留更长的 original
            if(item.original.length > existing.original.length) existing.original = item.original; }
        else State.uniqueMap.set(key, { original: item.original, normalized: norm, count:1, sources:[item.source] });
    }

    // 将数字标准化为10位纯数字
    function normalizeNumber(raw){ if(!raw) return null; const digits = String(raw).replace(/\D/g,''); if(digits.length===11 && digits.startsWith('1')) return digits.slice(1); if(digits.length===10) return digits; return null; }

    // 渲染预览
    function renderPreview(){
        const rows = Array.from(State.uniqueMap.values()).slice(0,10);
        DOM.previewBody.innerHTML = rows.map(r=>`<tr><td class="px-2 py-1">${escapeHtml(r.original)}</td><td class="px-2 py-1">${formatBySelect(r.normalized)}</td></tr>`).join('');
    }

    function formatBySelect(normalized){ const f = DOM.formatSelect?.value || 'readable'; if(!normalized) return ''; if(f==='readable') return `(${normalized.slice(0,3)}) ${normalized.slice(3,6)}-${normalized.slice(6)}`; if(f==='international') return `+1 ${normalized.slice(0,3)}-${normalized.slice(3,6)}-${normalized.slice(6)}`; if(f==='e164') return `1${normalized}`; return normalized; }

    // 粘贴处理
    async function handlePaste(){
        try{ const text = await navigator.clipboard.readText(); const items = parseTextToPhones(text, 'clipboard'); items.forEach(it=> addRawItem(it)); DOM.fileInfoWrap.innerHTML = `<p class="text-sm text-gray-600">已从剪贴板导入 ${items.length} 条，去重后 ${State.uniqueMap.size} 条</p>`; renderPreview(); saveHistorySnapshot(); } catch(err){ alert('粘贴失败，请允许访问剪贴板或手动粘贴'); }
    }

    // 导出：弹窗选择字段后导出
    function applyExportAndExport(){
        const checks = DOM.exportFieldChecks(); State.exportFields = checks.filter(c=>c.checked).map(c=>c.value);
        DOM.exportModal.classList.add('hidden');
        exportSelected('csv');
    }

    function exportSelected(type){
        const data = Array.from(State.uniqueMap.values()).map(v=>{
            const obj = {};
            (State.exportFields||[]).forEach(f=> obj[f]= f==='normalized'? formatBySelect(v.normalized) : (v[f]||'') );
            return obj;
        });
        if(type==='csv') downloadCsv(data, `phones-${new Date().toISOString().slice(0,10)}.csv`);
        else if(type==='xlsx') downloadXlsx(data, `phones-${new Date().toISOString().slice(0,10)}.xlsx`);
    }

    function downloadCsv(data, filename){ if(!data || data.length===0){ alert('无数据可导出'); return; } const keys = Object.keys(data[0]); const lines = [keys.join(',')]; for(const row of data){ lines.push(keys.map(k=>`"${String(row[k]||'').replace(/"/g,'""')}"`).join(',')); } const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' }); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.style.display='none'; document.body.appendChild(a); a.click(); document.body.removeChild(a); }

    function downloadXlsx(data, filename){
        if(!window.XLSX){ alert('XLSX 库未加载'); return; }
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'sheet1');
        XLSX.writeFile(wb, filename);
    }

    // 历史快照（IndexedDB via localForage）
    async function saveHistorySnapshot(){
        try{
            const arr = Array.from(State.uniqueMap.values()).map(v=>({ original:v.original, normalized:v.normalized, count:v.count, sources:v.sources }));
            await localforage.setItem(State.historyKey, { timestamp: Date.now(), data: arr });
        }catch(err){ console.error('保存本地历史失败', err); }
    }
    async function loadHistoryFromIndexedDB(){ try{ const record = await localforage.getItem(State.historyKey); if(record){ console.log('加载本地历史', record); } }catch(err){ console.error(err); } }

    // 快捷操作
    // 快捷操作：导出所有重复号码为 CSV
    function selectAllDuplicates(){
        const duplicates = Array.from(State.uniqueMap.values()).filter(v=>v.count && v.count>1);
        if(!duplicates || duplicates.length===0){ alert('未检测到重复号码'); return; }
        const data = duplicates.map(v=>({
            原始: v.original,
            标准化: formatBySelect(v.normalized),
            次数: v.count,
            来源: (v.sources||[]).join(';')
        }));
        const filename = `duplicates-${new Date().toISOString().slice(0,10)}.csv`;
        downloadCsv(data, filename);
    }

    // 快速导出：导出所有被认为是手机的号码（当前基于存在标准化号码）
    function quickExportMobile(){
        const rows = Array.from(State.uniqueMap.values()).filter(v=>v.normalized);
        if(rows.length===0){ alert('暂无可导出的手机号码'); return; }
        const data = rows.map(v=>({ 原始: v.original, 标准化: formatBySelect(v.normalized) }));
        const filename = `mobiles-${new Date().toISOString().slice(0,10)}.csv`;
        downloadCsv(data, filename);
    }

    // 主题
    function applyTheme(theme){ if(theme==='dark') document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark'); localStorage.setItem('theme', theme); }
    function toggleTheme(){ State.theme = State.theme==='dark'?'light':'dark'; applyTheme(State.theme); }

    // util
    function escapeHtml(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // init
    init();
    window.PhoneTool = { State };
})();
