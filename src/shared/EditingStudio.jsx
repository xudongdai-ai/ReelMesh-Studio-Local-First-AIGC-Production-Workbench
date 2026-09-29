import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  CaretLeft,
  CaretRight,
  Check,
  DownloadSimple,
  FilmStrip,
  FileText,
  FolderOpen,
  MagicWand,
  MusicNotes,
  Pause,
  Play,
  Plus,
  ArrowClockwise,
  ArrowCounterClockwise,
  Scissors,
  SlidersHorizontal,
  SpeakerHigh,
  Trash,
  UploadSimple,
  Waveform,
} from "@phosphor-icons/react";
import { STORAGE_KEYS, useStoredState } from "./storage.js";
import { AppButton, PageHeader, StatusPill } from "./ui.jsx";

const PANEL_DEFS = [
  { id: "媒体", label: "媒体", icon: FilmStrip },
  { id: "音乐", label: "音乐", icon: MusicNotes },
  { id: "音效", label: "音效", icon: Waveform },
  { id: "转场", label: "转场", icon: FilmStrip },
  { id: "特效", label: "特效", icon: MagicWand },
  { id: "文本", label: "文本", icon: FileText },
];

const EFFECT_PRESETS = [
  { id: "clean", name: "原片", note: "不改变画面", filter: "none" },
  { id: "cinematic", name: "电影感", note: "压高光、提对比", filter: "contrast(1.08) saturate(.9)" },
  { id: "warm", name: "暖色", note: "适合婚礼与回忆", filter: "sepia(.16) saturate(1.16)" },
  { id: "cool", name: "冷调", note: "适合夜景与悬疑", filter: "hue-rotate(172deg) saturate(.82)" },
  { id: "black-white", name: "黑白", note: "保留情绪层次", filter: "grayscale(1) contrast(1.08)" },
  { id: "dream", name: "柔光", note: "降低锐度与对比", filter: "brightness(1.04) saturate(.82) blur(.25px)" },
];

const TRANSITION_PRESETS = [
  { id: "cut", name: "硬切", note: "节奏清晰，默认效果", duration: 0 },
  { id: "dissolve", name: "叠化", note: "自然衔接镜头", duration: 0.6 },
  { id: "fade-black", name: "黑场淡入淡出", note: "章节或情绪转折", duration: 0.8 },
  { id: "whip", name: "甩镜", note: "快节奏视觉转场", duration: 0.35 },
  { id: "flash", name: "白闪", note: "记忆、情绪、节拍", duration: 0.22 },
  { id: "match", name: "匹配剪辑", note: "按动作或构图连接", duration: 0 },
];

const BUILT_IN_MUSIC = [
  { id: "calm-loop", name: "平静循环", mood: "温情 / 轻柔", duration: "循环", file: "calm-loop.mp3", source: "OpenGameArt · CC0" },
  { id: "dark-upbeat-loop", name: "暗色节奏", mood: "悬疑 / 节奏", duration: "循环", file: "dark-upbeat-loop.mp3", source: "OpenGameArt · CC0" },
  { id: "ambient-persistence-loop", name: "空间氛围", mood: "科幻 / 空镜", duration: "循环", file: "ambient-persistence-loop.mp3", source: "OpenGameArt · CC0" },
];

const BUILT_IN_SFX = [
  { id: "click", name: "确认点击", mood: "按钮 / 确认", file: "click.wav", source: "OpenGameArt · CC0", duration: 1.2 },
  { id: "mouseclick", name: "轻点", mood: "界面 / 轻响", file: "mouseclick.wav", source: "OpenGameArt · CC0", duration: 1.2 },
  { id: "erase", name: "甩动空气", mood: "转场 / 甩动", file: "erase.wav", source: "OpenGameArt · CC0", duration: 2.4 },
];

const TEXT_PRESETS = [
  { id: "title", name: "片头标题", text: "输入片头标题", style: "标题" },
  { id: "subtitle", name: "对白字幕", text: "输入对白或字幕", style: "字幕" },
  { id: "chapter", name: "章节标题", text: "第一章", style: "章节" },
  { id: "outro", name: "片尾字幕", text: "感谢观看", style: "片尾" },
];

const EMPTY_EDITOR = { clips: [], music: [], sfx: [], textOverlays: [], playhead: 0, zoom: 1, updatedAt: null };

function publicAssetUrl(route, file) {
  const prefix = window.location.protocol === "file:" ? "http://127.0.0.1:8787" : "";
  return `${prefix}/${route}/${encodeURIComponent(file)}`;
}

function publicMusicUrl(file) {
  return publicAssetUrl("music", file);
}

function publicSfxUrl(file) {
  return publicAssetUrl("sfx", file);
}

function restoreAudio(items, route) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    src: item.src || (item.file ? publicAssetUrl(route, item.file) : ""),
  }));
}

function fileKind(file) {
  if (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name)) return "audio";
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return "image";
  return "video";
}

function secondsLabel(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function makeClip(file, src) {
  const kind = fileKind(file);
  const duration = kind === "audio" ? 12 : kind === "image" ? 5 : 8;
  return {
    id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: file.name.replace(/\.[^.]+$/, ""),
    fileName: file.name,
    kind,
    mimeType: file.type || "application/octet-stream",
    src,
    duration,
    trimStart: 0,
    trimEnd: duration,
    speed: 1,
    volume: 100,
    effect: "clean",
    transition: "cut",
    transitionDuration: 0,
    source: "本地导入",
  };
}

function editorExportName(projectName) {
  const safe = String(projectName || "未命名项目").replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名项目";
  return `${safe}-剪辑工程.json`;
}

function downloadJson(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function EditingStudio({ currentProject, notify, recordActivity }) {
  const editorKey = `${STORAGE_KEYS.editingStudio}.${currentProject?.id || "general"}`;
  const [savedEditor, setSavedEditor] = useStoredState(editorKey, EMPTY_EDITOR);
  const [clips, setClips] = useState(() => Array.isArray(savedEditor?.clips) ? savedEditor.clips : []);
  const [music, setMusic] = useState(() => restoreAudio(savedEditor?.music, "music"));
  const [sfx, setSfx] = useState(() => restoreAudio(savedEditor?.sfx, "sfx"));
  const [textOverlays, setTextOverlays] = useState(() => Array.isArray(savedEditor?.textOverlays) ? savedEditor.textOverlays : []);
  const [selectedId, setSelectedId] = useState(() => savedEditor?.clips?.[0]?.id || savedEditor?.music?.[0]?.id || savedEditor?.sfx?.[0]?.id || null);
  const [activePanel, setActivePanel] = useState("媒体");
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(Number(savedEditor?.playhead) || 0);
  const [zoom, setZoom] = useState(Number(savedEditor?.zoom) || 1);
  const [timelineMessage, setTimelineMessage] = useState("");
  const fileInputRef = useRef(null);
  const musicInputRef = useRef(null);
  const sfxInputRef = useRef(null);
  const previewRef = useRef(null);
  const objectUrlsRef = useRef([]);
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const lastSnapshotRef = useRef(null);

  useEffect(() => {
    setClips(Array.isArray(savedEditor?.clips) ? savedEditor.clips : []);
    setMusic(restoreAudio(savedEditor?.music, "music"));
    setSfx(restoreAudio(savedEditor?.sfx, "sfx"));
    setTextOverlays(Array.isArray(savedEditor?.textOverlays) ? savedEditor.textOverlays : []);
    setPlayhead(Number(savedEditor?.playhead) || 0);
    setZoom(Number(savedEditor?.zoom) || 1);
    setSelectedId(savedEditor?.clips?.[0]?.id || savedEditor?.music?.[0]?.id || savedEditor?.sfx?.[0]?.id || null);
    historyRef.current = [];
    futureRef.current = [];
    lastSnapshotRef.current = null;
  }, [editorKey]);

  useEffect(() => () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const snapshot = useMemo(() => ({ clips, music, sfx, textOverlays, playhead, zoom }), [clips, music, sfx, textOverlays, playhead, zoom]);
  const snapshotString = useMemo(() => JSON.stringify(snapshot), [snapshot]);

  useEffect(() => {
    if (lastSnapshotRef.current === null) {
      lastSnapshotRef.current = snapshotString;
      return;
    }
    if (lastSnapshotRef.current === snapshotString) return;
    historyRef.current = [...historyRef.current, lastSnapshotRef.current].slice(-40);
    futureRef.current = [];
    lastSnapshotRef.current = snapshotString;
  }, [snapshotString]);

  useEffect(() => {
    setSavedEditor({
      clips: clips.map(({ src, ...clip }) => clip),
      music: music.map(({ src, ...item }) => item),
      sfx: sfx.map(({ src, ...item }) => item),
      textOverlays,
      playhead,
      zoom,
      updatedAt: new Date().toISOString(),
    });
  }, [clips, music, sfx, textOverlays, playhead, zoom]);

  const selected = clips.find((item) => item.id === selectedId)
    || music.find((item) => item.id === selectedId)
    || sfx.find((item) => item.id === selectedId)
    || textOverlays.find((item) => item.id === selectedId)
    || null;
  const selectedClip = clips.find((item) => item.id === selectedId) || null;
  const totalDuration = Math.max(
    12,
    clips.reduce((total, item) => total + Math.max(0.1, item.trimEnd - item.trimStart), 0),
    music.reduce((total, item) => total + Math.max(0.1, item.duration || 0), 0),
    sfx.reduce((total, item) => total + Math.max(0.1, item.duration || 0), 0),
    textOverlays.reduce((total, item) => total + Math.max(0.1, item.duration || 0), 0),
  );
  const timelineWidth = Math.max(920, totalDuration * 82 * zoom);
  const currentEffect = EFFECT_PRESETS.find((item) => item.id === selectedClip?.effect) || EFFECT_PRESETS[0];
  const currentTransition = TRANSITION_PRESETS.find((item) => item.id === selectedClip?.transition) || TRANSITION_PRESETS[0];
  const previewStyle = { filter: currentEffect.filter };

  const addFiles = (fileList, target = "clips") => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const next = files.map((file) => {
      const src = URL.createObjectURL(file);
      objectUrlsRef.current.push(src);
      return makeClip(file, src);
    });
    if (target === "music") setMusic((items) => [...items, ...next.filter((item) => item.kind === "audio").map((item) => ({ ...item, trackType: "music" }))]);
    else if (target === "sfx") setSfx((items) => [...items, ...next.filter((item) => item.kind === "audio").map((item) => ({ ...item, trackType: "sfx" }))]);
    else setClips((items) => [...items, ...next.filter((item) => item.kind !== "audio")]);
    setSelectedId(next[0]?.id || null);
    setTimelineMessage(target === "music" ? `已导入 ${next.length} 条配乐` : target === "sfx" ? `已导入 ${next.length} 条音效` : `已导入 ${next.length} 个素材`);
  };

  const addMusicToTimeline = (item) => {
    const next = { ...item, id: `music-${item.id}-${Date.now()}`, kind: "audio", trackType: "music", src: item.src || publicMusicUrl(item.file), duration: 12, volume: 70, source: item.source || "本地配乐库" };
    setMusic((items) => [...items, next]);
    setSelectedId(next.id);
    setTimelineMessage(`已把「${item.name}」加入配乐轨道`);
  };

  const addSfxToTimeline = (item) => {
    const next = { ...item, id: `sfx-${item.id}-${Date.now()}`, kind: "audio", trackType: "sfx", src: item.src || publicSfxUrl(item.file), duration: item.duration || 1.2, volume: 85, source: item.source || "本地音效库" };
    setSfx((items) => [...items, next]);
    setSelectedId(next.id);
    setTimelineMessage(`已把「${item.name}」加入音效轨道`);
  };

  const addTextOverlay = (item) => {
    const next = { id: `text-${item.id}-${Date.now()}`, kind: "text", name: item.name, text: item.text, style: item.style, duration: 3, start: Math.max(0, playhead), source: "文字面板" };
    setTextOverlays((items) => [...items, next]);
    setSelectedId(next.id);
    setTimelineMessage(`已加入「${item.name}」`);
  };

  const updateSelected = (patch) => {
    if (!selectedId) return;
    setClips((items) => items.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
    setMusic((items) => items.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
    setSfx((items) => items.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
    setTextOverlays((items) => items.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
  };

  const removeSelected = () => {
    if (!selected) return;
    setClips((items) => items.filter((item) => item.id !== selectedId));
    setMusic((items) => items.filter((item) => item.id !== selectedId));
    setSfx((items) => items.filter((item) => item.id !== selectedId));
    setTextOverlays((items) => items.filter((item) => item.id !== selectedId));
    setSelectedId(null);
    setTimelineMessage(`已移除「${selected.name}」`);
  };

  const moveSelected = (direction) => {
    if (!selectedId) return;
    setClips((items) => {
      const index = items.findIndex((item) => item.id === selectedId);
      if (index < 0) return items;
      const nextIndex = Math.max(0, Math.min(items.length - 1, index + direction));
      const next = [...items];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const splitSelected = () => {
    if (!selectedClip) return notify("请选择视频或图片素材后再分割");
    const length = Math.max(0.4, selectedClip.trimEnd - selectedClip.trimStart);
    const cutAt = Math.max(0.2, Math.min(length - 0.2, playhead - selectedClip.trimStart));
    if (cutAt <= 0.2 || cutAt >= length - 0.2) return notify("播放头要落在素材中间才能分割");
    const first = { ...selectedClip, id: `${selectedClip.id}-a`, trimEnd: selectedClip.trimStart + cutAt, name: `${selectedClip.name} · 片段 1` };
    const second = { ...selectedClip, id: `${selectedClip.id}-b`, trimStart: selectedClip.trimStart + cutAt, name: `${selectedClip.name} · 片段 2` };
    setClips((items) => { const index = items.findIndex((item) => item.id === selectedId); return [...items.slice(0, index), first, second, ...items.slice(index + 1)]; });
    setSelectedId(second.id);
    setTimelineMessage("已按播放头分割为两个连续片段");
  };

  const applySnapshot = (value) => {
    const next = typeof value === "string" ? JSON.parse(value) : value;
    setClips(Array.isArray(next.clips) ? next.clips : []);
    setMusic(restoreAudio(next.music, "music"));
    setSfx(restoreAudio(next.sfx, "sfx"));
    setTextOverlays(Array.isArray(next.textOverlays) ? next.textOverlays : []);
    setPlayhead(Number(next.playhead) || 0);
    setZoom(Number(next.zoom) || 1);
    lastSnapshotRef.current = JSON.stringify(next);
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return notify("没有可撤销的操作");
    futureRef.current.push(snapshotString);
    applySnapshot(previous);
    setTimelineMessage("已撤销上一步操作");
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return notify("没有可重做的操作");
    historyRef.current.push(snapshotString);
    applySnapshot(next);
    setTimelineMessage("已重做上一步操作");
  };

  const openSelectedPreview = () => {
    if (!previewRef.current || !selected || selected.kind === "text") return;
    if (playing) previewRef.current.pause();
    else previewRef.current.play().catch(() => {});
    setPlaying((value) => !value);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      if (command && key === "z" && event.shiftKey) { event.preventDefault(); redo(); return; }
      if (command && key === "z") { event.preventDefault(); undo(); return; }
      if (command && key === "y") { event.preventDefault(); redo(); return; }
      if (event.code === "Space") { event.preventDefault(); openSelectedPreview(); return; }
      if (key === "s") { event.preventDefault(); splitSelected(); return; }
      if (key === "i" && selectedClip) { event.preventDefault(); updateSelected({ trimStart: Math.max(0, playhead) }); setTimelineMessage("已设置入点"); return; }
      if (key === "o" && selectedClip) { event.preventDefault(); updateSelected({ trimEnd: Math.max(playhead, (selectedClip.trimStart || 0) + 0.1) }); setTimelineMessage("已设置出点"); return; }
      if (key === "j") { event.preventDefault(); setPlayhead((value) => Math.max(0, value - 1)); return; }
      if (key === "l") { event.preventDefault(); setPlayhead((value) => Math.min(totalDuration, value + 1)); return; }
      if (key === "k") { event.preventDefault(); if (playing) openSelectedPreview(); return; }
      if (event.key === "ArrowLeft") { event.preventDefault(); setPlayhead((value) => Math.max(0, value - (event.shiftKey ? 1 : 0.1))); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); setPlayhead((value) => Math.min(totalDuration, value + (event.shiftKey ? 1 : 0.1))); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, playhead, selectedClip, selected, snapshotString, totalDuration]);

  const exportProject = () => {
    const payload = {
      format: "ReelMesh Studio剪辑工程",
      version: 2,
      project: { id: currentProject?.id || null, name: currentProject?.name || "未命名项目", aspectRatio: currentProject?.aspectRatio || "16:9" },
      tracks: [
        { id: "V1", type: "video", clips: clips.filter((item) => item.kind !== "audio").map(({ src, ...clip }) => clip) },
        { id: "A1", type: "music", clips: music.map(({ src, ...item }) => item) },
        { id: "A2", type: "sfx", clips: sfx.map(({ src, ...item }) => item) },
        { id: "T1", type: "text", clips: textOverlays },
      ],
      playhead,
      updatedAt: new Date().toISOString(),
    };
    downloadJson(payload, editorExportName(currentProject?.name));
    recordActivity?.("导出剪辑工程", currentProject?.name || "未命名项目", "已完成");
    notify("剪辑工程已导出，可在工作台继续编辑");
  };

  const resetEditor = () => {
    if (!window.confirm("确定清空当前剪辑台的时间线吗？已导入素材不会从资产库删除。")) return;
    setClips([]);
    setMusic([]);
    setSfx([]);
    setTextOverlays([]);
    setSelectedId(null);
    setPlayhead(0);
    setTimelineMessage("时间线已清空");
  };

  const onPreviewTime = (event) => setPlayhead(Number(event.currentTarget.currentTime || 0));
  const timelineScale = useMemo(() => Array.from({ length: Math.ceil(totalDuration / 5) + 1 }, (_, index) => index * 5), [totalDuration]);

  return (
    <section className="editing-studio">
      <PageHeader eyebrow="后期制作" title="剪辑制作台" description="按剪映式工作流组织媒体、音乐、音效、转场、特效和文字，快捷完成日常剪辑。">
        <StatusPill status={clips.length || music.length || sfx.length ? "制作中" : "待配置"}>{clips.length + music.length + sfx.length + textOverlays.length} 个时间线素材</StatusPill>
        <AppButton onClick={resetEditor}><ArrowsClockwise size={15} /> 清空时间线</AppButton>
        <AppButton variant="primary" onClick={exportProject}><DownloadSimple size={15} /> 导出剪辑工程</AppButton>
      </PageHeader>

      <div className="editing-toolbar panel">
        <div className="editing-toolbar-group"><button className="editing-tool active" title="选择素材"><SlidersHorizontal size={17} />选择</button><button className="editing-tool" title="分割素材（S）" onClick={splitSelected}><Scissors size={17} />分割</button><button className="editing-tool" title="删除素材（Delete）" onClick={removeSelected}><Trash size={17} />删除</button><button className="editing-tool" title="撤销（⌘/Ctrl + Z）" onClick={undo}><ArrowCounterClockwise size={17} />撤销</button><button className="editing-tool" title="重做（⌘/Ctrl + Shift + Z）" onClick={redo}><ArrowClockwise size={17} />重做</button></div>
        <div className="editing-toolbar-group editing-transport"><button className="icon-button" onClick={() => setPlayhead(Math.max(0, playhead - 1))} title="后退 1 秒"><CaretLeft size={18} /></button><button className="editing-play" onClick={openSelectedPreview} title={playing ? "暂停（空格）" : "播放（空格）"}>{playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}</button><button className="icon-button" onClick={() => setPlayhead(Math.min(totalDuration, playhead + 1))} title="前进 1 秒"><CaretRight size={18} /></button><span>{secondsLabel(playhead)} / {secondsLabel(totalDuration)}</span></div>
        <div className="editing-toolbar-group editing-zoom"><span>时间线</span><button className="icon-button" onClick={() => setZoom((value) => Math.max(.65, value - .1))} title="缩小时间线">−</button><strong>{Math.round(zoom * 100)}%</strong><button className="icon-button" onClick={() => setZoom((value) => Math.min(2, value + .1))} title="放大时间线">＋</button></div>
      </div>

      <div className="editing-shortcuts panel"><span><b>快捷键</b></span><span><kbd>空格</kbd> 播放 / 暂停</span><span><kbd>S</kbd> 分割</span><span><kbd>I</kbd> / <kbd>O</kbd> 入点 / 出点</span><span><kbd>J</kbd> <kbd>K</kbd> <kbd>L</kbd> 后退 / 暂停 / 前进</span><span><kbd>Delete</kbd> 删除</span><span><kbd>⌘/Ctrl + Z</kbd> 撤销</span></div>

      <div className="editing-main-grid">
        <aside className="editing-library panel">
          <div className="editing-tabs">{PANEL_DEFS.map(({ id, label, icon: Icon }) => <button key={id} className={activePanel === id ? "active" : ""} onClick={() => setActivePanel(id)}><Icon size={16} /><span>{label}</span></button>)}</div>
          {activePanel === "媒体" && <div className="editing-library-body"><div className="editing-import-actions"><button onClick={() => fileInputRef.current?.click()}><UploadSimple size={16} /><span>导入视频 / 图片</span><small>支持 MP4、MOV、PNG、JPG</small></button><input ref={fileInputRef} hidden type="file" multiple accept="video/*,image/*" onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} /><button onClick={() => musicInputRef.current?.click()}><MusicNotes size={16} /><span>导入音频</span><small>支持 MP3、WAV、M4A、AAC</small></button></div><div className="editing-list-heading"><span>本次导入</span><small>{clips.length} 个</small></div>{clips.length ? clips.map((item) => <button className={`editing-media-item ${selectedId === item.id ? "active" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}><span className="editing-media-icon">{item.kind === "image" ? "图" : "片"}</span><span><strong>{item.name}</strong><small>{item.kind === "image" ? "图片" : "视频"} · {secondsLabel(item.trimEnd - item.trimStart)}</small></span><Plus size={14} /></button>) : <div className="editing-empty"><FolderOpen size={22} /><strong>还没有素材</strong><span>导入后会自动进入视频轨道。</span></div>}</div>}
          {activePanel === "音乐" && <div className="editing-library-body"><div className="editing-import-actions"><button onClick={() => musicInputRef.current?.click()}><MusicNotes size={16} /><span>导入本地配乐</span><small>支持 MP3、WAV、M4A、AAC</small></button><input ref={musicInputRef} hidden type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg" onChange={(event) => { addFiles(event.target.files, "music"); event.target.value = ""; }} /></div><div className="editing-list-heading"><span>内置免版权配乐</span><small>CC0</small></div><div className="editing-music-list">{BUILT_IN_MUSIC.map((item) => <article key={item.id}><div className="editing-music-cover"><Waveform size={19} /></div><div><strong>{item.name}</strong><small>{item.mood} · {item.source}</small></div><button title="加入配乐轨道" onClick={() => addMusicToTimeline(item)}><Plus size={15} /></button></article>)}</div>{music.filter((item) => item.source === "本地导入").map((item) => <article className="editing-local-music" key={item.id}><MusicNotes size={16} /><span>{item.name}</span><button onClick={() => { setSelectedId(item.id); setTimelineMessage(`已选中「${item.name}」`); }}><CaretRight size={15} /></button></article>)}</div>}
          {activePanel === "音效" && <div className="editing-library-body"><div className="editing-import-actions"><button onClick={() => sfxInputRef.current?.click()}><UploadSimple size={16} /><span>导入本地音效</span><small>支持 WAV、MP3、M4A、OGG</small></button><input ref={sfxInputRef} hidden type="file" multiple accept="audio/*,.wav,.mp3,.m4a,.ogg" onChange={(event) => { addFiles(event.target.files, "sfx"); event.target.value = ""; }} /></div><div className="editing-list-heading"><span>常用音效</span><small>CC0</small></div><div className="editing-sfx-list">{BUILT_IN_SFX.map((item) => <article key={item.id}><div className="editing-sfx-cover"><Waveform size={18} /></div><div><strong>{item.name}</strong><small>{item.mood} · {item.source}</small></div><button title="加入音效轨道" onClick={() => addSfxToTimeline(item)}><Plus size={15} /></button></article>)}</div>{sfx.filter((item) => item.source === "本地导入").map((item) => <article className="editing-local-music" key={item.id}><Waveform size={16} /><span>{item.name}</span><button onClick={() => { setSelectedId(item.id); setTimelineMessage(`已选中「${item.name}」`); }}><CaretRight size={15} /></button></article>)}</div>}
          {activePanel === "特效" && <div className="editing-library-body"><div className="editing-panel-intro"><MagicWand size={22} /><strong>常用画面效果</strong><span>点击效果即可应用到当前选中的片段，右侧可以继续调参数。</span></div><div className="editing-preset-grid">{EFFECT_PRESETS.map((item) => <button key={item.id} className={selectedClip?.effect === item.id ? "active" : ""} onClick={() => { updateSelected({ effect: item.id }); setTimelineMessage(`已应用「${item.name}」`); }}><span className={`editing-effect-swatch effect-${item.id}`} /><strong>{item.name}</strong><small>{item.note}</small></button>)}</div></div>}
          {activePanel === "转场" && <div className="editing-library-body"><div className="editing-panel-intro"><FilmStrip size={22} /><strong>常用转场效果</strong><span>转场会记录在当前片段的结尾，后续渲染时按参数合成。</span></div><div className="editing-preset-list">{TRANSITION_PRESETS.map((item) => <button key={item.id} className={selectedClip?.transition === item.id ? "active" : ""} onClick={() => { updateSelected({ transition: item.id, transitionDuration: item.duration }); setTimelineMessage(`已设置「${item.name}」`); }}><span><strong>{item.name}</strong><small>{item.note}</small></span><em>{item.duration ? `${item.duration}s` : "直接切换"}</em></button>)}</div></div>}
          {activePanel === "文本" && <div className="editing-library-body"><div className="editing-panel-intro"><FileText size={22} /><strong>文字轨道</strong><span>先加入常用文字片段，再在右侧修改文案、时长和样式。</span></div><div className="editing-preset-list">{TEXT_PRESETS.map((item) => <button key={item.id} onClick={() => addTextOverlay(item)}><span><strong>{item.name}</strong><small>{item.text}</small></span><Plus size={15} /></button>)}</div></div>}
        </aside>

        <section className="editing-preview panel">
          <div className="editing-preview-head"><div><span className="eyebrow">预览窗口</span><strong>{selected?.name || currentProject?.name || "未命名剪辑"}</strong></div><span>{currentProject?.aspectRatio || "16:9"}</span></div>
          <div className="editing-preview-screen">
            {selected?.kind === "video" && selected.src ? <video ref={previewRef} src={selected.src} style={previewStyle} controls={false} onTimeUpdate={onPreviewTime} onEnded={() => setPlaying(false)} /> : selected?.kind === "image" && selected.src ? <img src={selected.src} style={previewStyle} alt={selected.name} /> : selected?.kind === "audio" && selected.src ? <div className="editing-audio-preview"><Waveform size={48} /><strong>{selected.name}</strong><span>{selected.trackType === "sfx" ? "音效轨道" : "配乐轨道"} · {selected.source}</span><audio ref={previewRef} src={selected.src} preload="metadata" controls /></div> : selected?.kind === "text" ? <div className="editing-text-preview"><span>{selected.style}</span><strong>{selected.text}</strong></div> : <div className="editing-preview-empty"><FilmStrip size={38} /><strong>把素材放进时间线开始剪辑</strong><span>左侧导入视频、图片、音乐或音效</span></div>}
            {selectedClip && <span className="editing-preview-badge">{currentEffect.name}{currentTransition.id !== "cut" ? ` · ${currentTransition.name}` : ""}</span>}
          </div>
          <div className="editing-preview-footer"><span>播放头 {secondsLabel(playhead)}</span><span>{selectedClip ? `${currentEffect.name} · ${currentTransition.name}` : selected?.kind === "text" ? selected.style : "未选择片段"}</span></div>
        </section>

        <aside className="editing-inspector panel">
          <div className="editing-inspector-head"><div><span className="eyebrow">属性</span><h2>片段参数</h2></div><SlidersHorizontal size={19} /></div>
          {selected ? <div className="editing-inspector-body"><div className="editing-selected-file"><span className="editing-media-icon">{selected.kind === "audio" ? "音" : selected.kind === "image" ? "图" : selected.kind === "text" ? "字" : "片"}</span><div><strong>{selected.name}</strong><small>{selected.fileName || selected.source}</small></div></div><label className="editing-field"><span>片段名称</span><input value={selected.name || ""} onChange={(event) => updateSelected({ name: event.target.value })} /></label>{selected.kind === "text" && <label className="editing-field"><span>文字内容</span><textarea rows="3" value={selected.text || ""} onChange={(event) => updateSelected({ text: event.target.value })} /></label>}{selected.kind !== "audio" && selected.kind !== "text" && <><label className="editing-field"><span>入点（秒）</span><input type="number" min="0" step="0.1" value={selected.trimStart ?? 0} onChange={(event) => updateSelected({ trimStart: Math.max(0, Number(event.target.value) || 0) })} /></label><label className="editing-field"><span>出点（秒）</span><input type="number" min="0.1" step="0.1" value={selected.trimEnd ?? selected.duration} onChange={(event) => updateSelected({ trimEnd: Math.max(0.1, Number(event.target.value) || selected.duration) })} /></label></>}{selected.kind === "text" && <label className="editing-field"><span>显示时长 <b>{selected.duration || 3}s</b></span><input type="range" min="0.5" max="15" step="0.5" value={selected.duration || 3} onChange={(event) => updateSelected({ duration: Number(event.target.value) })} /></label>}{selected.kind !== "text" && <><label className="editing-field"><span>播放速度 <b>{selected.speed || 1}x</b></span><input type="range" min="0.5" max="2" step="0.05" value={selected.speed || 1} onChange={(event) => updateSelected({ speed: Number(event.target.value) })} /></label><label className="editing-field"><span>音量 <b>{selected.volume ?? 100}%</b></span><input type="range" min="0" max="150" step="1" value={selected.volume ?? 100} onChange={(event) => updateSelected({ volume: Number(event.target.value) })} /></label></>}{selected.kind !== "audio" && selected.kind !== "text" && <><div className="editing-inspector-section"><span>画面效果</span><strong>{currentEffect.name}</strong></div><div className="editing-inspector-section"><span>片段结尾转场</span><strong>{currentTransition.name}{currentTransition.duration ? ` · ${currentTransition.duration}s` : ""}</strong></div></>}<div className="editing-inspector-actions">{selected.kind !== "text" && <><AppButton onClick={() => moveSelected(-1)}><CaretLeft size={14} /> 前移</AppButton><AppButton onClick={() => moveSelected(1)}>后移 <CaretRight size={14} /></AppButton></>}<AppButton onClick={removeSelected}><Trash size={14} /> 移除</AppButton></div></div> : <div className="editing-inspector-empty"><SlidersHorizontal size={24} /><strong>选择一个片段</strong><span>时间线中的素材参数会显示在这里。</span></div>}
        </aside>
      </div>

      <section className="editing-timeline panel">
        <div className="editing-timeline-head"><div><span className="eyebrow">时间线</span><strong>{currentProject?.name || "未命名项目"} · 主序列</strong></div><div className="editing-timeline-head-actions"><span><SpeakerHigh size={14} /> 自动保存在当前项目</span>{timelineMessage && <em>{timelineMessage}</em>}</div></div>
        <div className="editing-timeline-scroll"><div className="editing-timeline-inner" style={{ width: `${timelineWidth}px` }}><div className="editing-ruler"><span className="editing-track-label">时间</span>{timelineScale.map((tick) => <span key={tick} style={{ left: `${(tick / totalDuration) * 100}%` }}>{secondsLabel(tick)}</span>)}</div><div className="editing-track"><span className="editing-track-label">视频轨道 V1</span><div className="editing-track-lane">{clips.filter((item) => item.kind !== "audio").map((item) => <button key={item.id} className={`editing-timeline-clip ${selectedId === item.id ? "active" : ""}`} style={{ width: `${Math.max(9, ((item.trimEnd - item.trimStart) / totalDuration) * 100)}%`, filter: EFFECT_PRESETS.find((effect) => effect.id === item.effect)?.filter || "none" }} onClick={() => setSelectedId(item.id)}><span>{item.name}</span><small>{item.transition !== "cut" ? TRANSITION_PRESETS.find((transition) => transition.id === item.transition)?.name : ""}</small></button>)}</div></div><div className="editing-track"><span className="editing-track-label">配乐轨道 A1</span><div className="editing-track-lane editing-audio-lane">{music.map((item) => <button key={item.id} className={`editing-timeline-clip editing-timeline-audio ${selectedId === item.id ? "active" : ""}`} style={{ width: `${Math.max(13, ((item.duration || 12) / totalDuration) * 100)}%` }} onClick={() => setSelectedId(item.id)}><Waveform size={15} /><span>{item.name}</span></button>)}</div></div><div className="editing-track"><span className="editing-track-label">音效轨道 A2</span><div className="editing-track-lane editing-audio-lane">{sfx.map((item) => <button key={item.id} className={`editing-timeline-clip editing-timeline-audio editing-sfx-clip ${selectedId === item.id ? "active" : ""}`} style={{ width: `${Math.max(10, ((item.duration || 1.2) / totalDuration) * 100)}%` }} onClick={() => setSelectedId(item.id)}><Waveform size={15} /><span>{item.name}</span></button>)}</div></div><div className="editing-track"><span className="editing-track-label">文字轨道 T1</span><div className="editing-track-lane editing-text-lane">{textOverlays.map((item) => <button key={item.id} className={`editing-timeline-clip editing-timeline-text ${selectedId === item.id ? "active" : ""}`} style={{ width: `${Math.max(13, ((item.duration || 3) / totalDuration) * 100)}%` }} onClick={() => setSelectedId(item.id)}><FileText size={15} /><span>{item.text || item.name}</span></button>)}</div></div><button className="editing-playhead" style={{ left: `calc(116px + ${(playhead / totalDuration) * (timelineWidth - 116)}px)` }} onClick={(event) => { const bounds = event.currentTarget.parentElement.getBoundingClientRect(); setPlayhead(Math.max(0, Math.min(totalDuration, ((event.clientX - bounds.left - 116) / (timelineWidth - 116)) * totalDuration))); }} aria-label="设置播放头" /></div></div>
      </section>

      <div className="editing-footnote"><span><Check size={14} /> 工程结构支持视频、音乐、音效、文字四类轨道</span><span>内置配乐与音效均来自公开授权素材，来源信息已随安装包保存</span></div>
    </section>
  );
}
